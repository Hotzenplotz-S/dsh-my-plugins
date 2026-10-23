#!/usr/bin/env node
// CLI for my-window-bounds. Use any Node runtime:
//   node cli.mjs status  [asarPath]   — show patch state
//   node cli.mjs install [asarPath]   — apply the patch (backup first)
//   node cli.mjs restore [asarPath]   — restore the pristine app.asar (quit DSH first)
import { inspectAsar, patchAsar, restoreAsar, resolveAsarPath } from "./asar-patch.js";

const [command, asarArg] = process.argv.slice(2);
const asarPath = resolveAsarPath(asarArg);

if (!command || !["status", "install", "restore"].includes(command)) {
	console.log("usage: node cli.mjs <status|install|restore> [path-to-app.asar]");
	process.exit(command ? 2 : 0);
}
if (!asarPath) {
	console.error(JSON.stringify({ status: "no-asar", detail: "app.asar not found; pass its path explicitly" }, null, 2));
	process.exit(1);
}

try {
	const result =
		command === "status" ? inspectAsar(asarPath) : command === "install" ? patchAsar(asarPath) : restoreAsar(asarPath);
	console.log(JSON.stringify({ asarPath, ...result }, null, 2));
	if (result.status === "anchor-miss" || result.status === "no-backup") process.exit(1);
} catch (error) {
	console.error(JSON.stringify({ status: "error", detail: String(error?.stack || error) }, null, 2));
	process.exit(1);
}
