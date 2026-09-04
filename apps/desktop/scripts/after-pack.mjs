/**
 * electron-builder afterPack: copy `runtime/` into the app bundle.
 *
 * It cannot go in `files`: electron-builder ignores `**` + `node_modules` by
 * default, and the runtime deliberately contains one (pi resolves its own assets
 * relative to its dist directory, so it ships as a real package rather than a
 * bundle).
 *
 * Deliberately small. The old version was 291 lines that pruned nine npm
 * packages, 33 dylibs, Electron locales and GPU libraries back out of a 190 MB
 * staging directory — and carried two bugs while doing it: `pruneEmbeddingDylibs`
 * was defined twice (so the first definition never ran), and
 * `copyPiStorageBinary` / `copyRustBinary` were never called at all, which is why
 * the Rust binaries the fork built never actually shipped. Staging only what is
 * needed removes the need to prune anything.
 */

import { cpSync, existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Copy with `ditto` on macOS, not `cpSync`.
 *
 * Electron frameworks contain relative symlinks; `cpSync` rewrites them to
 * absolute paths and the GPU and helper processes then die with
 * "icudtl.dat not found". The runtime has no symlinks today, but the same tool is
 * used everywhere so a future addition cannot reintroduce that failure.
 */
function copyTree(from, to) {
	if (process.platform === "darwin") {
		execFileSync("ditto", [from, to], { stdio: "inherit" });
		return;
	}
	cpSync(from, to, { recursive: true, dereference: false });
}

export default async function afterPack(context) {
	const runtime = join(desktop, "runtime");
	if (!existsSync(runtime)) {
		throw new Error("runtime/ is missing — run `npm run build:runtime` before packaging.");
	}

	const resources =
		context.electronPlatformName === "darwin"
			? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Resources")
			: join(context.appOutDir, "resources");

	const target = join(resources, "openpi");
	copyTree(runtime, target);

	// A staging or copy failure is otherwise invisible until the app fails to
	// start, with no clue why.
	for (const required of [
		"daemon.js",
		"extensions/memory.js",
		"node_modules/@earendil-works/pi-coding-agent/dist/bundle/rpc-entry.js",
		"node_modules/jiti/package.json",
	]) {
		const path = join(target, required);
		if (!existsSync(path) || statSync(path).size === 0) {
			throw new Error(`packaged runtime is incomplete: ${required}`);
		}
	}

	const size = execFileSync("du", ["-sh", target], { encoding: "utf8" }).split("\t")[0];
	process.stdout.write(`  • openpi runtime staged  ${size}  ${context.arch === 1 ? "x64" : "arm64"}\n`);
}
