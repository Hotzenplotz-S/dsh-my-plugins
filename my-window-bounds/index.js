// my-window-bounds — host entry.
// On activation, ensure app.asar carries the window-bounds patch, then write a
// JSON status file the user can inspect from the UI with the bundled @prompt:
// "Read ~/.dsh/profiles/desktop/my-window-bounds-status.json".
import { writeFileSync } from "node:fs";
import { defaultStatusPath, inspectAsar, patchAsar, probeAsarCandidates, resolveAsarPath } from "./asar-patch.js";

export function apply(ctx) {
	return ctx.effect(() => {
		let disposed = false;
		const report = (obj) => {
			if (disposed) return;
			try {
				writeFileSync(defaultStatusPath(), JSON.stringify({ at: new Date().toISOString(), ...obj }, null, 2));
			} catch {}
		};
		queueMicrotask(async () => {
			try {
				const asarPath = resolveAsarPath();
				if (!asarPath) {
					report({ status: "no-asar", detail: "app.asar not found (web profile?)", probe: probeAsarCandidates() });
					return;
				}
				const result = patchAsar(asarPath);
				report({ ...result, asarPath });
				const log = result.status === "anchor-miss" || result.status === "error" ? "warn" : "info";
				ctx.logger?.[log]?.(`[my-window-bounds] ${result.status}: ${result.detail ?? ""}`);
			} catch (error) {
				report({ status: "error", detail: String(error?.stack || error) });
				ctx.logger?.warn?.(`[my-window-bounds] ${error}`);
			}
		});
		return () => {
			disposed = true;
		};
	});
}

export { inspectAsar, patchAsar, resolveAsarPath };
