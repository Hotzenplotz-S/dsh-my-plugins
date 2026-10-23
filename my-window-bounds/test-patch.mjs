// .tmp_test_patch.mjs — verify my-window-bounds against a COPY of the real app.asar.
// Usage: node .tmp_test_patch.mjs
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, openSync, readSync, closeSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { patchAsar, restoreAsar, readHeader, MARKER } from "./my-window-bounds/asar-patch.js";

const SRC = "C:\\Users\\sunxiaoguang\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\app.asar";
const TEST = join(tmpdir(), "app-test-mwb.asar");
const NODE = process.execPath;

const sha = (b) => createHash("sha256").update(b).digest("hex");
const extractMain = (asarPath) => {
	const fd = openSync(asarPath, "r");
	try {
		const { header, dataStart } = readHeader(fd);
		const entry = header.files.lib.files["main.js"];
		const buf = Buffer.alloc(entry.size);
		readSync(fd, buf, 0, entry.size, dataStart + Number(entry.offset || 0));
		return { buf, entry };
	} finally {
		closeSync(fd);
	}
};

let fail = 0;
const check = (name, cond, detail = "") => {
	console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
	if (!cond) fail++;
};

copyFileSync(SRC, TEST);
const sizeBefore = statSync(TEST).size;
const mainBefore = extractMain(TEST);

// 1. patch
const r1 = patchAsar(TEST);
console.log("patch result:", JSON.stringify(r1));
check("patch status=patched", r1.status === "patched");
check("backup created", existsSync(TEST + ".mywb.bak"));
check("archive size unchanged", statSync(TEST).size === sizeBefore);

// 2. marker + anchors consumed
const mainAfter = extractMain(TEST);
check("main.js size unchanged", mainAfter.buf.length === mainBefore.buf.length);
check("marker present", mainAfter.buf.includes(MARKER));
check("options anchor gone", !mainAfter.buf.includes("\t\twidth: 1280,\n\t\theight: 820,\n"));
check("comment anchor 1 gone", !mainAfter.buf.includes("Resolve the single-root DeepSeek Harness home."));
check("comment anchor 2 gone", !mainAfter.buf.includes("Zero-dependency atomic file replacement"));
check("...WBS(primary), present", mainAfter.buf.includes("...WBS(primary),"));
check("helpers present", mainAfter.buf.includes("function WBF()") && mainAfter.buf.includes("function WBS(p)"));

// 3. integrity rewritten correctly
const { entry: e2 } = mainAfter;
check("hash matches recomputed", e2.integrity.hash === sha(mainAfter.buf), e2.integrity.hash.slice(0, 16));
check("blocks[0] matches", e2.integrity.blocks[0] === sha(mainAfter.buf));

// 4. syntax check of patched main.js (parse only; imports not resolved)
const tmpMain = join(tmpdir(), "main-patched.mjs");
writeFileSync(tmpMain, mainAfter.buf);
try {
	execFileSync(NODE, ["--check", tmpMain], { stdio: "pipe" });
	check("patched main.js parses as ESM", true);
} catch (e) {
	check("patched main.js parses as ESM", false, String(e.stderr).slice(0, 300));
}

// 5. idempotent
const r2 = patchAsar(TEST);
check("second patch = already", r2.status === "already", r2.status);

// 6. restore
const r3 = restoreAsar(TEST);
check("restore ok", r3.status === "restored");
check("restored bytes == original", extractMain(TEST).buf.equals(mainBefore.buf));
check("restored size == original", statSync(TEST).size === sizeBefore);

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
process.exit(fail === 0 ? 0 : 1);
