#!/usr/bin/env node
/**
 * Build packages/openpi-desktop/runtime with production installs of
 * pi-coding-agent + pi-orchestrator (and workspace deps) for packaging
 * into the Electron app Resources folder.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const monorepoRoot = resolve(desktopRoot, "../..");
const runtimeDir = join(desktopRoot, "runtime");
const packDir = mkdtempSync(join(tmpdir(), "openpi-packs-"));

const packages = ["ai", "agent", "tui", "coding-agent", "orchestrator"];

function run(cmd, args, cwd) {
	console.log(`$ ${cmd} ${args.join(" ")}`);
	execFileSync(cmd, args, { cwd, stdio: "inherit" });
}

console.log("Bundling OpenPI desktop runtime…");
console.log(`  monorepo: ${monorepoRoot}`);
console.log(`  runtime:  ${runtimeDir}`);

// Ensure dists exist
for (const name of packages) {
	const cli =
		name === "coding-agent"
			? join(monorepoRoot, "packages/coding-agent/dist/cli.js")
			: name === "orchestrator"
				? join(monorepoRoot, "packages/orchestrator/dist/cli.js")
				: join(monorepoRoot, `packages/${name}/dist`);
	if (name === "coding-agent" || name === "orchestrator") {
		if (!existsSync(cli)) {
			console.error(`Missing ${cli}. Run monorepo build first.`);
			process.exit(1);
		}
	}
}

rmSync(runtimeDir, { recursive: true, force: true });
mkdirSync(runtimeDir, { recursive: true });

for (const name of packages) {
	run("npm", ["pack", "--pack-destination", packDir], join(monorepoRoot, "packages", name));
}

const tarballs = readdirSync(packDir)
	.filter((f) => f.endsWith(".tgz"))
	.map((f) => join(packDir, f));
if (tarballs.length < packages.length) {
	console.error("Expected packed tarballs missing:", tarballs);
	process.exit(1);
}

writeFileSync(
	join(runtimeDir, "package.json"),
	`${JSON.stringify(
		{
			name: "openpi-desktop-runtime",
			private: true,
			type: "module",
			description: "Bundled Pi runtime for OpenPI Desktop (coding-agent + orchestrator)",
		},
		null,
		2,
	)}\n`,
);

run(
	"npm",
	["install", "--omit=dev", "--ignore-scripts", "--no-fund", "--no-audit", ...tarballs],
	runtimeDir,
);

rmSync(packDir, { recursive: true, force: true });

const piCli = join(runtimeDir, "node_modules/@earendil-works/pi-coding-agent/dist/cli.js");
const orchCli = join(runtimeDir, "node_modules/@earendil-works/pi-orchestrator/dist/cli.js");
if (!existsSync(piCli) || !existsSync(orchCli)) {
	console.error("Runtime install incomplete:", { piCli, orchCli });
	process.exit(1);
}

const version = execFileSync("node", [orchCli, "--version"], { encoding: "utf8" }).trim();
console.log(`Runtime ready (orchestrator ${version})`);
console.log(`  PI_CLI: ${piCli}`);
console.log(`  ORCH:   ${orchCli}`);
