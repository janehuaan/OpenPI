#!/usr/bin/env node
/**
 * Copy the latest packed OpenPI.app into /Applications (macOS).
 *
 * Uses `ditto` (not Node cpSync): Electron frameworks contain relative
 * symlinks; cpSync rewrites them to absolute paths and GPU/helpers then crash
 * with "icudtl.dat not found" / exit_code=5.
 */
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = join(root, "release");

function findApp(dir, depth = 0) {
	if (depth > 4 || !existsSync(dir)) return null;
	for (const name of readdirSync(dir)) {
		const full = join(dir, name);
		let st;
		try {
			st = statSync(full);
		} catch {
			continue;
		}
		if (name === "OpenPI.app" && st.isDirectory()) return full;
		if (st.isDirectory() && !name.endsWith(".dSYM")) {
			const nested = findApp(full, depth + 1);
			if (nested) return nested;
		}
	}
	return null;
}

function installWithDitto(src, dest) {
	if (existsSync(dest)) {
		rmSync(dest, { recursive: true, force: true });
	}
	// ditto preserves relative symlinks, resource forks, and modes
	execFileSync("ditto", [src, dest], { stdio: "inherit" });
	// Drop quarantine so first launch is less likely to be blocked
	try {
		execFileSync("xattr", ["-cr", dest], { stdio: "ignore" });
	} catch {
		// ignore
	}
}

const appPath = findApp(releaseDir);
if (!appPath) {
	console.error(`OpenPI.app not found under ${releaseDir}. Run pack:mac first.`);
	process.exit(1);
}

const dest = "/Applications/OpenPI.app";
console.log(`Installing:\n  from ${appPath}\n  to   ${dest}`);

try {
	installWithDitto(appPath, dest);
} catch (error) {
	const userDest = join(homedir(), "Applications", "OpenPI.app");
	console.warn(
		`System install failed (${error instanceof Error ? error.message : error}); trying ${userDest}`,
	);
	installWithDitto(appPath, userDest);
	console.log(`Installed to ${userDest}`);
	try {
		execFileSync("open", ["-R", userDest]);
	} catch {
		// ignore
	}
	process.exit(0);
}

// Sanity: framework symlinks must stay relative
const fwLink = join(dest, "Contents/Frameworks/Electron Framework.framework/Resources");
try {
	const { readlinkSync } = await import("node:fs");
	const target = readlinkSync(fwLink);
	if (target.startsWith("/")) {
		console.error(`WARNING: absolute symlink still present: Resources -> ${target}`);
	} else {
		console.log(`Framework Resources link OK -> ${target}`);
	}
} catch {
	// ignore check failures
}

console.log("Installed to /Applications/OpenPI.app");
try {
	execFileSync("open", ["-R", dest]);
} catch {
	// ignore
}
console.log("Tip: first launch may need right-click → Open if Gatekeeper blocks unsigned builds.");
