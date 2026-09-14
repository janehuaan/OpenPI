/**
 * Stage the app's runtime into `runtime/`, for electron-builder to copy in.
 *
 * What ships:
 *   runtime/daemon.js                       the daemon, bundled with esbuild
 *   runtime/extensions/*.js                 each extension, bundled
 *   runtime/node_modules/@earendil-works/pi-coding-agent/dist/  the pinned pi
 *   runtime/node_modules/jiti/              pi's extension loader
 *
 * ~20 MB. The old desktop shipped 190 MB by running `npm pack` on five workspace
 * packages into a temp directory and `npm install`ing the tarballs — which wrote
 * `file:/var/folders/...` paths into a tracked `runtime/package.json`, and then
 * deleted that temp directory, leaving a file that could never be reinstalled.
 * It then had an afterPack step pruning nine packages back out again.
 *
 * Bundling instead means no transitive install, nothing to prune, and no
 * generated file worth tracking.
 */

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(desktop, "../..");
const runtime = join(desktop, "runtime");

/** Extensions to ship, by workspace directory name. */
const EXTENSIONS = ["memory", "session-state"];

/**
 * pi is loaded at runtime, not bundled: it resolves its own assets (themes,
 * prompts) relative to its dist directory, so it has to keep that layout.
 */
const PI_PACKAGE = "@earendil-works/pi-coding-agent";

function log(message) {
	process.stdout.write(`${message}\n`);
}

function size(path) {
	try {
		const output = execFileSync("du", ["-sh", path], { encoding: "utf8" });
		return output.split("\t")[0];
	} catch {
		try {
			const st = statSync(path);
			if (st.isFile()) return `${(st.size / 1024).toFixed(0)}K`;
			return "staged";
		} catch {
			return "";
		}
	}
}

rmSync(runtime, { recursive: true, force: true });
mkdirSync(runtime, { recursive: true });

// ── The daemon (Rust Native) ────────────────────────────────────────────
// The entire daemon and scheduler are compiled into a high-performance single native binary.
execFileSync("cargo", ["build", "--release", "--bin", "openpi-daemon"], { cwd: repo, stdio: "inherit" });
cpSync(join(repo, "target/release/openpi-daemon"), join(runtime, "openpi-daemon"));
log(`openpi-daemon  ${size(join(runtime, "openpi-daemon"))}`);

// ── Extensions ────────────────────────────────────────────────────────────
// Each becomes one file. pi's peer packages stay external: the extension is
// loaded *by* pi, so it must use pi's own copies rather than embedding a second
// set of the agent types and typebox validators.
const externals = [
	"@earendil-works/pi-coding-agent",
];

mkdirSync(join(runtime, "extensions"), { recursive: true });
for (const name of EXTENSIONS) {
	const entry = join(repo, "extensions", name, "src/index.ts");
	if (!existsSync(entry)) throw new Error(`extension entry missing: ${entry}`);
	await build({
		entryPoints: [entry],
		outfile: join(runtime, "extensions", `${name}.js`),
		bundle: true,
		platform: "node",
		target: "node22",
		format: "esm",
		external: externals,
		logLevel: "warning",
	});
	log(`extensions/${name}.js`.padEnd(30) + size(join(runtime, "extensions", `${name}.js`)));
}

// The tools package has one entry per tool rather than a single index.
const toolsDir = join(repo, "extensions/tools/src");
const toolEntries = readdirSync(toolsDir).filter((name) => {
	if (!name.endsWith(".ts") || name.endsWith(".test.ts")) return false;
	// Helpers, not extension entry points.
	return !["secrets.ts", "feed-utils.ts"].includes(name);
});
for (const file of toolEntries) {
	const name = file.replace(/\.ts$/, "");
	await build({
		entryPoints: [join(toolsDir, file)],
		outfile: join(runtime, "extensions", `tools-${name}.js`),
		bundle: true,
		platform: "node",
		target: "node22",
		format: "esm",
		external: externals,
		logLevel: "warning",
	});
}
log(`extensions/tools-*.js          ${toolEntries.length} files`);

// ── The pinned pi install ─────────────────────────────────────────────────
function copyPi() {
	const from = join(repo, "node_modules", PI_PACKAGE);
	if (!existsSync(from)) throw new Error(`${PI_PACKAGE} is not installed; run npm install at the repo root`);
	const to = join(runtime, "node_modules", PI_PACKAGE);
	mkdirSync(to, { recursive: true });
	// dist/ and package.json only. node_modules/ is 118 MB of provider SDKs that
	// dist/bundle/ already has inlined, and docs/ + examples/ are another 4 MB.
	cpSync(join(from, "dist"), join(to, "dist"), { recursive: true });
	cpSync(join(from, "package.json"), join(to, "package.json"));

	// jiti is how pi loads an extension file; without it every extension fails
	// with "Cannot find module 'jiti'", bundled or not.
	const jitiFrom = join(from, "node_modules/jiti");
	const jitiTo = join(runtime, "node_modules/jiti");
	if (!existsSync(jitiFrom)) throw new Error("jiti not found beside pi-coding-agent");
	cpSync(jitiFrom, jitiTo, { recursive: true });
}
copyPi();
log(`node_modules   ${size(join(runtime, "node_modules"))}`);

// ── Manifest ──────────────────────────────────────────────────────────────
let gitCommit = "unknown";
try {
	gitCommit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
} catch {}

const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
let piVersion = "unknown";
try {
	const piPkg = JSON.parse(readFileSync(join(runtime, "node_modules", PI_PACKAGE, "package.json"), "utf8"));
	piVersion = piPkg.version ?? "unknown";
} catch {}

const manifest = {
	name: "openpi-runtime",
	version: pkg.version ?? "0.2.3",
	piVersion,
	buildTime: new Date().toISOString(),
	gitCommit,
	schemaVersion: 1,
};
writeFileSync(join(runtime, "runtime-manifest.json"), JSON.stringify(manifest, null, 2));
log(`manifest       runtime-manifest.json (v${manifest.version}, pi v${manifest.piVersion}, ${gitCommit})`);

// ── Verify ────────────────────────────────────────────────────────────────
// A staging bug is invisible until the packaged app fails to start, so assert
// the entry points exist before handing off to electron-builder.
for (const required of [
	"runtime-manifest.json",
	"daemon.js",
	"extensions/memory.js",
	"extensions/session-state.js",
	`node_modules/${PI_PACKAGE}/dist/bundle/rpc-entry.js`,
	`node_modules/${PI_PACKAGE}/dist/bundle/cli.js`,
	"node_modules/jiti/package.json",
]) {
	const path = join(runtime, required);
	if (!existsSync(path) || statSync(path).size === 0) {
		throw new Error(`runtime staging incomplete: ${required} is missing or empty`);
	}
}

log(`\nruntime/       ${size(runtime)} total`);

// ── Zip Package Generation ────────────────────────────────────────────────
if (process.argv.includes("--zip") || process.env.OPENPI_BUILD_RUNTIME_ZIP === "1") {
	const releaseDir = join(desktop, "release");
	mkdirSync(releaseDir, { recursive: true });
	const zipName = `openpi-runtime-v${manifest.version}.zip`;
	const zipPath = join(releaseDir, zipName);
	rmSync(zipPath, { force: true });

	try {
		if (process.platform === "win32") {
			execFileSync("tar", ["-a", "-cf", zipPath, "*"], { cwd: runtime, stdio: "ignore" });
		} else {
			execFileSync("zip", ["-rq", zipPath, "."], { cwd: runtime, stdio: "ignore" });
		}
		log(`runtime zip    ${zipName} (${size(zipPath)})`);
	} catch (err) {
		log(`[warn] failed to create runtime zip archive: ${err.message}`);
	}
}

