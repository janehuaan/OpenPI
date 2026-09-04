/**
 * Build the Electron main and preload bundles.
 *
 * esbuild rather than plain `tsc` because the main process imports
 * `@openpi/daemon`, a workspace package whose entry is TypeScript. Bundling
 * resolves that at build time, so the shipped main process is plain JavaScript
 * and needs no TS-stripping flag from Electron's Node at runtime.
 *
 * The old desktop dodged this by writing the main process in `.mjs` and leaving
 * it out of typechecking entirely — ~2,500 lines with no types at all.
 */

import { build } from "esbuild";

/** Electron's own module, plus anything with native bindings, stays external. */
const EXTERNAL = ["electron"];

const shared = {
	bundle: true,
	platform: "node",
	// Electron 38 ships Node 22.
	target: "node22",
	format: "esm",
	sourcemap: true,
	external: EXTERNAL,
	logLevel: "info",
};

await build({
	...shared,
	entryPoints: ["electron/main.ts"],
	outfile: "dist-electron/main.js",
});

await build({
	...shared,
	entryPoints: ["electron/preload.ts"],
	outfile: "dist-electron/preload.cjs",
	// Preload runs before ESM is available in a sandboxed renderer, so it must be
	// CommonJS; Electron rejects an ESM preload with sandbox enabled.
	format: "cjs",
});
