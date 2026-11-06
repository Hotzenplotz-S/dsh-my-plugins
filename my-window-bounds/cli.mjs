#!/usr/bin/env node
// CLI for my-window-bounds. Use any Node runtime:
//   node cli.mjs status  [asarPath]   — patch state + whether the backup is stale
//   node cli.mjs install [asarPath]   — apply the patch (backup refreshed if the build changed)
//   node cli.mjs restore [asarPath]   — restore the pristine app.asar (quit DSH first)
// Add --force to `restore` to overwrite even when the backup is from another build.
import { inspectAsar, patchAsar, restoreAsar, resolveAsarPath } from "./asar-patch.js";

const argv = process.argv.slice(2);
const force = argv.includes("--force") || argv.includes("-f");
const [command, asarArg] = argv.filter((arg) => !arg.startsWith("-"));
const asarPath = resolveAsarPath(asarArg);

if (!command || !["status", "install", "restore"].includes(command)) {
	console.log("usage: node cli.mjs <status|install|restore> [path-to-app.asar] [--force]");
	process.exit(command ? 2 : 0);
}
if (!asarPath) {
	console.error(JSON.stringify({ status: "no-asar", detail: "app.asar not found; pass its path explicitly" }, null, 2));
	process.exit(1);
}

try {
	const result =
		command === "status"
			? inspectAsar(asarPath)
			: command === "install"
				? patchAsar(asarPath)
				: restoreAsar(asarPath, { force });
	console.log(JSON.stringify({ asarPath, ...result }, null, 2));
	if (["anchor-miss", "no-backup", "version-mismatch"].includes(result.status)) process.exit(1);
} catch (error) {
	console.error(JSON.stringify({ status: "error", detail: String(error?.stack || error) }, null, 2));
	process.exit(1);
}
