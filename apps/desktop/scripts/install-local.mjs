#!/usr/bin/env node
/**
 * Install the packed OpenPI.app into /Applications (macOS).
 *
 * Uses `ditto`, not `cpSync`: Electron frameworks contain relative symlinks, and
 * `cpSync` rewrites them to absolute paths — the GPU and helper processes then
 * die with "icudtl.dat not found" and exit code 5.
 */

import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readlinkSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = join(desktop, "release");

if (process.platform !== "darwin") {
	process.stderr.write("install:local only supports macOS.\n");
	process.exit(1);
}

/** Find the built .app, preferring this machine's architecture. */
function findApp() {
	if (!existsSync(releaseDir)) return undefined;
	const preferred = process.arch === "arm64" ? "mac-arm64" : "mac";
	const dirs = readdirSync(releaseDir).filter((name) => name.startsWith("mac"));
	const ordered = [...dirs.filter((name) => name === preferred), ...dirs.filter((name) => name !== preferred)];
	for (const dir of ordered) {
		const app = join(releaseDir, dir, "OpenPI.app");
		if (existsSync(app)) return app;
	}
	return undefined;
}

const source = findApp();
if (!source) {
	process.stderr.write("No OpenPI.app in release/. Run `npm run pack:mac` first.\n");
	process.exit(1);
}

/** /Applications when writable, else ~/Applications. */
function installRoot() {
	try {
		execFileSync("test", ["-w", "/Applications"]);
		return "/Applications";
	} catch {
		return join(homedir(), "Applications");
	}
}

const target = join(installRoot(), "OpenPI.app");
process.stdout.write(`Installing ${source}\n         -> ${target}\n`);

// Terminate any running instances of the app before rewriting the bundle
// to prevent macOS LaunchServices error -600 and locked file conflicts.
try {
	execFileSync("pkill", ["-9", "-f", target], { stdio: "ignore" });
} catch {}

// Remove first: ditto merges into an existing bundle, which can leave stale
// files from a previous build alive inside the new one.
rmSync(target, { recursive: true, force: true });
execFileSync("ditto", [source, target], { stdio: "inherit" });

// Unsigned build: without this Gatekeeper refuses to launch it.
execFileSync("xattr", ["-cr", target], { stdio: "inherit" });

// Ad-hoc sign the installed app bundle so macOS TCC can reliably persist privacy permission grants
try {
	execFileSync("codesign", ["--force", "--deep", "-s", "-", target], { stdio: "inherit" });
	process.stdout.write("Applied ad-hoc code signature to installed app for macOS TCC persistence.\n");
} catch (err) {
	process.stderr.write(`Warning: failed to codesign ${target}: ${err.message}\n`);
}

// Refresh LaunchServices registration cache so macOS Finder / Spotlight recognizes the updated bundle immediately
try {
	const lsregister = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
	if (existsSync(lsregister)) {
		execFileSync(lsregister, ["-f", target], { stdio: "ignore" });
	}
} catch {}

/**
 * Verify the framework symlinks are still relative.
 *
 * This is the failure `ditto` exists to avoid, so it is worth asserting rather
 * than trusting — an absolute symlink here means the app launches and then dies
 * in the GPU process.
 */
const frameworks = join(target, "Contents", "Frameworks");
if (existsSync(frameworks)) {
	for (const name of readdirSync(frameworks)) {
		const versions = join(frameworks, name, "Versions", "Current");
		if (!existsSync(versions)) continue;
		if (lstatSync(versions).isSymbolicLink() && readlinkSync(versions).startsWith("/")) {
			process.stderr.write(`Absolute symlink in ${name}; the app will crash on launch.\n`);
			process.exit(1);
		}
	}
}

const runtime = join(target, "Contents", "Resources", "openpi", "daemon.js");
if (!existsSync(runtime)) {
	process.stderr.write("Installed app has no openpi runtime; afterPack did not run.\n");
	process.exit(1);
}

process.stdout.write(`Installed. Open with: open -a ${target}\n`);
