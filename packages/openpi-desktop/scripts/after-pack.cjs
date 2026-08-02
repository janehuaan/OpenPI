/**
 * electron-builder afterPack:
 * 1) copy openpi-runtime including nested node_modules (ditto)
 * 2) copy first-party openpi-* packages as a mini monorepo for extensions + desktop-ops
 */
const { execFileSync } = require("node:child_process");
const { existsSync, mkdirSync, rmSync, cpSync, readdirSync, statSync } = require("node:fs");
const { join } = require("node:path");

const OPENPI_PACKAGES = [
	"openpi-memory",
	"openpi-security",
	"openpi-tools",
	"openpi-intelligence",
	"openpi-bootstrap",
];

function dittoOrCp(src, dest) {
	rmSync(dest, { recursive: true, force: true });
	try {
		execFileSync("ditto", [src, dest], { stdio: "inherit" });
	} catch {
		cpSync(src, dest, { recursive: true });
	}
}

function copyPackageTree(monorepoRoot, destPackagesRoot) {
	mkdirSync(join(destPackagesRoot, "packages"), { recursive: true });
	for (const name of OPENPI_PACKAGES) {
		const src = join(monorepoRoot, "packages", name);
		if (!existsSync(src)) {
			console.warn(`afterPack: skip missing package ${name}`);
			continue;
		}
		const dest = join(destPackagesRoot, "packages", name);
		// Copy source tree but skip node_modules / dist bloat where possible
		rmSync(dest, { recursive: true, force: true });
		mkdirSync(dest, { recursive: true });
		for (const entry of readdirSync(src)) {
			if (entry === "node_modules" || entry === "dist" || entry === ".turbo") continue;
			const from = join(src, entry);
			const to = join(dest, entry);
			const st = statSync(from);
			if (st.isDirectory()) {
				cpSync(from, to, { recursive: true });
			} else {
				cpSync(from, to);
			}
		}
		console.log(`afterPack: packaged ${name}`);
	}
}

exports.default = async function afterPack(context) {
	const projectDir = context.packager.projectDir;
	const monorepoRoot = join(projectDir, "../..");
	const runtimeSrc = join(projectDir, "runtime");
	const marker = join(
		runtimeSrc,
		"node_modules",
		"@earendil-works",
		"pi-orchestrator",
		"dist",
		"cli.js",
	);

	const appName = context.packager.appInfo.productFilename;
	const resources =
		context.electronPlatformName === "darwin"
			? join(context.appOutDir, `${appName}.app`, "Contents", "Resources")
			: join(context.appOutDir, "resources");

	if (existsSync(marker)) {
		const dest = join(resources, "openpi-runtime");
		dittoOrCp(runtimeSrc, dest);
		console.log(`afterPack: copied openpi-runtime → ${dest}`);
	} else {
		console.warn("afterPack: runtime missing; skip openpi-runtime copy");
	}

	// Mini monorepo for memory extension + desktop-ops + bootstrap
	const packagesDest = join(resources, "openpi-packages");
	rmSync(packagesDest, { recursive: true, force: true });
	copyPackageTree(monorepoRoot, packagesDest);
	console.log(`afterPack: openpi-packages → ${packagesDest}`);
};
