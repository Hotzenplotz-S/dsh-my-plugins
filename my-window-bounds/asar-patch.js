// my-window-bounds — equal-length in-place patcher for the DSH desktop app.asar.
//
// The DSH desktop main process (lib/main.js inside app.asar) hardcodes
// `new BrowserWindow({ width: 1280, height: 820, ... })` and never persists
// window bounds. This module patches main.js IN PLACE with equal-length
// replacements so every archive offset stays valid:
//
//   1. Two doc comments become the helper functions WBF/WBR/WBW/WBS.
//   2. The `width: 1280, height: 820,` option lines become `...WBS(primary),`.
//   3. The entry's SHA256 integrity hash (and block hashes) are recomputed
//      in the JSON header; the JSON is padded with trailing spaces to its
//      original byte length, so the pickle framing is untouched.
//
// A one-time backup (app.asar.mywb.bak) is written before the first patch.
// All anchors must match exactly or the archive is left untouched.

import { createHash } from "node:crypto";
import * as nodeFs from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

// The DSH host runs the Electron binary as plain Node (ELECTRON_RUN_AS_NODE),
// where Electron's patched `fs` reports app.asar as a directory. `original-fs`
// is Electron's unpatched fs and gives raw archive access; plain Node (CLI)
// falls back to node:fs.
let rawFs = nodeFs;
try {
	rawFs = createRequire(import.meta.url)("original-fs");
} catch {}
const { closeSync, copyFileSync, existsSync, fsyncSync, openSync, readSync, statSync, writeSync } = rawFs;

export const MARKER = "/*my-wb*/";
export const BOUNDS_FILE = join(homedir(), ".dsh", "window-bounds.json");

// --- Injected payloads (ASCII only; the patcher pads them with spaces) ---

export const IO_CODE = `function WBF(){return join(homedir(),".dsh","window-bounds.json")}
function WBR(){try{return JSON.parse(readFileSync(WBF(),"utf8"))}catch{return null}}
function WBW(v){try{writeFileSync(WBF(),JSON.stringify(v))}catch{}}`;

export const LOGIC_CODE = `function WBS(p){if(!p)return{width:1280,height:820};const s=WBR(),o={width:1280,height:820};if(s&&s.w>=520&&s.h>=600){o.width=s.w;o.height=s.h;if(typeof s.x==="number"&&typeof s.y==="number"&&Math.abs(s.x)<3e4&&Math.abs(s.y)<3e4){o.x=s.x;o.y=s.y}}
app.once("browser-window-created",(e,w)=>{let L=WBR()||{},t=0;const S=()=>WBW(L);const U=()=>{if(w.isDestroyed()||!w.isNormal())return;const b=w.getBounds();L={x:b.x,y:b.y,w:b.width,h:b.height,m:L.m|0};clearTimeout(t);t=setTimeout(S,400)};w.on("resize",U);w.on("move",U);w.on("maximize",()=>{L.m=1;S()});w.on("unmaximize",()=>{L.m=0;U()});w.on("close",()=>{U();clearTimeout(t);S()});if(s&&s.m)w.maximize()});return o}${MARKER}`;

export const OPTIONS_ANCHOR = "\t\twidth: 1280,\n\t\theight: 820,\n";
export const OPTIONS_REPLACEMENT = "\t\t...WBS(primary)," + " ".repeat(11) + "\n";

// Doc-comment anchors in lib/main.js: a unique signature substring plus the
// exact byte length of the containing /** ... */ block (verified at runtime).
export const COMMENT_ANCHORS = [
	{ signature: "Resolve the single-root DeepSeek Harness home.", size: 534, payload: IO_CODE },
	{ signature: "Zero-dependency atomic file replacement", size: 709, payload: LOGIC_CODE },
];

function sha256hex(buf) {
	return createHash("sha256").update(buf).digest("hex");
}

function indexOfOnce(haystack, needle) {
	const first = haystack.indexOf(needle);
	if (first < 0) return -1;
	if (haystack.indexOf(needle, first + 1) >= 0) return -2;
	return first;
}

/** Locate the exact /** ...*\/ block containing `signature`; enforce size. */
function findCommentBlock(code, signature, size) {
	const sig = Buffer.from(signature, "utf8");
	const at = indexOfOnce(code, sig);
	if (at === -2) throw new Error(`anchor signature is not unique: ${signature}`);
	if (at < 0) return null;
	const start = code.lastIndexOf("/**", at);
	const end = code.indexOf("*/", at);
	if (start < 0 || end < 0) return null;
	const block = code.subarray(start, end + 2);
	if (block.length !== size) {
		throw new Error(`anchor block size mismatch for "${signature}": got ${block.length}, want ${size}`);
	}
	if (indexOfOnce(code, block) < 0) throw new Error(`anchor block is not unique: ${signature}`);
	return block;
}

function padTo(buf, size, label) {
	if (buf.length > size) throw new Error(`${label} payload ${buf.length}B exceeds anchor ${size}B`);
	if (buf.length === size) return buf;
	return Buffer.concat([buf, Buffer.alloc(size - buf.length, 0x20)]);
}

/**
 * Read the asar header of `fd`. Returns framing offsets needed for in-place
 * writes. Throws if the file is not a plausible asar archive.
 */
export function readHeader(fd) {
	const prefix = Buffer.alloc(8);
	readSync(fd, prefix, 0, 8, 0);
	const headerSize = prefix.readUInt32LE(4);
	if (headerSize <= 8 || headerSize > 64 * 1024 * 1024) throw new Error("implausible asar header size");
	const raw = Buffer.alloc(headerSize);
	readSync(fd, raw, 0, headerSize, 8);
	// The header pickle may nest: locate the JSON object, then read the UInt32
	// length field immediately before it.
	const jsonStart = raw.indexOf(0x7b, 4); // '{'
	if (jsonStart < 4) throw new Error("asar JSON slot not found");
	const jsonLen = raw.readUInt32LE(jsonStart - 4);
	if (jsonLen <= 2 || jsonStart + jsonLen > headerSize) throw new Error("implausible asar JSON length");
	const header = JSON.parse(raw.subarray(jsonStart, jsonStart + jsonLen).toString("utf8"));
	return { header, headerSize, jsonLen, jsonOffset: 8 + jsonStart, dataStart: 8 + headerSize };
}

function findEntry(header, path) {
	const parts = path.split("/");
	let node = header.files;
	for (const part of parts) {
		node = node && node[part];
		if (!node) return null;
		if (node.files) node = node.files;
	}
	return node && typeof node.size === "number" ? node : null;
}

/**
 * Produce the patched main.js bytes, or null when every anchor is missing.
 * Throws on ambiguous anchors or payload overflow. Pure: no I/O.
 */
export function buildPatchedMain(mainBuf) {
	if (mainBuf.includes(MARKER)) return { buf: null, already: true };
	const optionsAnchor = Buffer.from(OPTIONS_ANCHOR, "utf8");
	const at = indexOfOnce(mainBuf, optionsAnchor);
	if (at === -2) throw new Error("options anchor is not unique");
	if (at < 0) return { buf: null, already: false, missing: "options" };
	const blocks = [];
	for (const spec of COMMENT_ANCHORS) {
		const block = findCommentBlock(mainBuf, spec.signature, spec.size);
		if (!block) return { buf: null, already: false, missing: spec.signature };
		blocks.push([block, padTo(Buffer.from(spec.payload, "utf8"), spec.size, spec.signature)]);
	}
	let buf = Buffer.from(mainBuf);
	const replace = (from, to) => {
		const i = buf.indexOf(from);
		buf = Buffer.concat([buf.subarray(0, i), to, buf.subarray(i + from.length)]);
	};
	replace(optionsAnchor, Buffer.from(OPTIONS_REPLACEMENT, "utf8"));
	for (const [from, to] of blocks) replace(from, to);
	if (buf.length !== mainBuf.length) throw new Error("internal: patched length drifted");
	return { buf, already: false };
}

export function asarCandidates() {
	const candidates = [];
	if (process.env.DSH_ASAR_PATH) candidates.push(process.env.DSH_ASAR_PATH);
	if (process.resourcesPath) candidates.push(join(process.resourcesPath, "app.asar"));
	// The DSH host runs the Electron binary as plain Node (ELECTRON_RUN_AS_NODE),
	// so resourcesPath is undefined; the executable then sits next to resources/.
	try {
		if (process.execPath) candidates.push(join(dirname(process.execPath), "resources", "app.asar"));
	} catch {}
	if (process.platform === "win32") {
		const local = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
		candidates.push(join(local, "Programs", "DeepSeek Harness", "resources", "app.asar"));
	}
	return candidates;
}

export function probeAsarCandidates() {
	return {
		platform: process.platform,
		fsDriver: rawFs === nodeFs ? "node:fs" : "original-fs",
		execPath: process.execPath ?? null,
		resourcesPath: process.resourcesPath ?? null,
		LOCALAPPDATA: process.env.LOCALAPPDATA ?? null,
		candidates: asarCandidates().map((p) => {
			let exists = false;
			try {
				exists = existsSync(p) && statSync(p).isFile();
			} catch {}
			return { path: p, exists };
		}),
	};
}

export function resolveAsarPath(explicit) {
	const candidates = [];
	if (explicit) candidates.push(explicit);
	candidates.push(...asarCandidates());
	for (const candidate of candidates) {
		try {
			if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
		} catch {}
	}
	return null;
}

export function backupPathFor(asarPath) {
	return asarPath + ".mywb.bak";
}

/**
 * Patch the archive in place. Returns a status object; never throws past the
 * point where the archive could be left half-written (all patching happens in
 * memory first; writes are header + one entry of unchanged sizes).
 */
export function patchAsar(asarPath) {
	const backupPath = backupPathFor(asarPath);
	const fd = openSync(asarPath, "r+");
	try {
		const { header, jsonLen, jsonOffset, dataStart } = readHeader(fd);
		const entry = findEntry(header, "lib/main.js");
		if (!entry) return { status: "anchor-miss", detail: "lib/main.js entry not found" };
		const offset = Number(entry.offset || 0);
		const mainBuf = Buffer.alloc(entry.size);
		readSync(fd, mainBuf, 0, entry.size, dataStart + offset);
		const built = buildPatchedMain(mainBuf);
		if (built.already) return { status: "already", detail: "marker present", backupPath };
		if (!built.buf) return { status: "anchor-miss", detail: built.missing || "anchors not found", backupPath };
		if (!existsSync(backupPath)) copyFileSync(asarPath, backupPath);
		// Recompute integrity for the patched entry (hashes keep their length).
		if (entry.integrity) {
			const blockSize = entry.integrity.blockSize || 4194304;
			const blocks = [];
			for (let i = 0; i < built.buf.length; i += blockSize) blocks.push(sha256hex(built.buf.subarray(i, i + blockSize)));
			entry.integrity.hash = sha256hex(built.buf);
			entry.integrity.blocks = blocks;
		}
		writeSync(fd, built.buf, 0, built.buf.length, dataStart + offset);
		const jsonBuf = Buffer.from(JSON.stringify(header), "utf8");
		if (jsonBuf.length > jsonLen) throw new Error("internal: header JSON grew beyond its slot");
		writeSync(fd, padTo(jsonBuf, jsonLen, "header"), 0, jsonLen, jsonOffset);
		fsyncSync(fd);
		return { status: "patched", detail: `lib/main.js +${MARKER}`, backupPath };
	} finally {
		closeSync(fd);
	}
}

/** Inspect without writing: is the marker present, is there a backup? */
export function inspectAsar(asarPath) {
	const backupPath = backupPathFor(asarPath);
	const out = { asarPath, backupPath, backup: existsSync(backupPath), patched: false };
	const fd = openSync(asarPath, "r");
	try {
		const { header, dataStart } = readHeader(fd);
		const entry = findEntry(header, "lib/main.js");
		if (!entry) return { ...out, status: "anchor-miss", detail: "lib/main.js entry not found" };
		const mainBuf = Buffer.alloc(entry.size);
		readSync(fd, mainBuf, 0, entry.size, dataStart + Number(entry.offset || 0));
		out.patched = mainBuf.includes(MARKER);
		out.status = out.patched ? "patched" : "unpatched";
		return out;
	} finally {
		closeSync(fd);
	}
}

/** Restore the pristine archive from the one-time backup. DSH must be quit. */
export function restoreAsar(asarPath) {
	const backupPath = backupPathFor(asarPath);
	if (!existsSync(backupPath)) return { status: "no-backup", backupPath };
	copyFileSync(backupPath, asarPath);
	return { status: "restored", backupPath };
}

export function defaultProfileDir() {
	if (process.env.DSH_PROFILE_DIR) return process.env.DSH_PROFILE_DIR;
	return join(homedir(), ".dsh", "profiles", process.env.DSH_PROFILE || "desktop");
}

export function defaultStatusPath() {
	return join(defaultProfileDir(), "my-window-bounds-status.json");
}
