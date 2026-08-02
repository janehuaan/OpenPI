import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Backend-first policy:
 * - Prefer live monorepo packages (memory / coding-agent / orchestrator) when present
 *   so feature updates do not require reinstalling OpenPI.app
 * - Fall back to Resources/openpi-runtime + openpi-packages only for pure packaged installs
 */

export function agentDir() {
	return process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}

function readOpenPiRepoRoot() {
	try {
		const file = join(agentDir(), "openpi.json");
		if (!existsSync(file)) return undefined;
		const parsed = JSON.parse(readFileSync(file, "utf8"));
		const root = typeof parsed.repoRoot === "string" ? parsed.repoRoot.trim() : "";
		if (root && existsSync(root)) return resolve(root);
	} catch {
		// ignore
	}
	return undefined;
}

function hasMonorepoClis(root) {
	return (
		existsSync(join(root, "packages/orchestrator/dist/cli.js")) &&
		existsSync(join(root, "packages/coding-agent/dist/cli.js"))
	);
}

function hasOpenPiPackages(root) {
	return existsSync(join(root, "packages/openpi-memory/src/index.ts"));
}

/**
 * Resolve monorepo checkout (packages/coding-agent + openpi-*).
 * Order: env → openpi.json → relative to desktop package → ~/OpenPI
 */
export function monorepoRoot() {
	const envRoot = process.env.OPENPI_REPO_ROOT || process.env.PI_REPO_ROOT;
	if (envRoot && existsSync(envRoot) && (hasMonorepoClis(envRoot) || hasOpenPiPackages(envRoot))) {
		return resolve(envRoot);
	}
	const fromConfig = readOpenPiRepoRoot();
	if (fromConfig && (hasMonorepoClis(fromConfig) || hasOpenPiPackages(fromConfig))) {
		return fromConfig;
	}
	const relative = resolve(__dirname, "../../..");
	if (hasMonorepoClis(relative) || hasOpenPiPackages(relative)) {
		return relative;
	}
	const homeOpenPi = join(homedir(), "OpenPI");
	if (hasMonorepoClis(homeOpenPi) || hasOpenPiPackages(homeOpenPi)) {
		return homeOpenPi;
	}
	return undefined;
}

/**
 * Packaged Electron Resources/openpi-runtime (production install of pi CLIs).
 * Dev: packages/openpi-desktop/runtime
 */
export function packagedRuntimeRoot() {
	const candidates = [];
	if (process.resourcesPath) {
		candidates.push(join(process.resourcesPath, "openpi-runtime"));
	}
	candidates.push(resolve(__dirname, "../runtime"));
	candidates.push(resolve(__dirname, "../../openpi-runtime"));
	for (const candidate of candidates) {
		if (
			existsSync(join(candidate, "node_modules/@earendil-works/pi-coding-agent/dist/cli.js")) &&
			existsSync(join(candidate, "node_modules/@earendil-works/pi-orchestrator/dist/cli.js"))
		) {
			return candidate;
		}
	}
	return undefined;
}

/**
 * First-party OpenPI packages root (memory / security / tools / bootstrap).
 * Prefer monorepo so edits hot-load without reinstalling the .app.
 */
export function openpiPackagesRoot() {
	const mono = monorepoRoot();
	if (mono && hasOpenPiPackages(mono)) return mono;

	const candidates = [];
	if (process.resourcesPath) {
		candidates.push(join(process.resourcesPath, "openpi-packages"));
	}
	candidates.push(resolve(__dirname, "../../openpi-packages"));
	candidates.push(resolve(__dirname, "../openpi-packages"));
	for (const candidate of candidates) {
		if (hasOpenPiPackages(candidate)) return candidate;
	}
	return undefined;
}

/** Absolute path to a first-party package source file, e.g. openpi-memory/src/desktop-ops.ts */
export function openpiPackageFile(...parts) {
	const root = openpiPackagesRoot();
	if (!root) {
		throw new Error(
			"OpenPI packages not found (openpi-memory). Clone monorepo, set OPENPI_REPO_ROOT, or reinstall OpenPI.app.",
		);
	}
	const file = join(root, "packages", ...parts);
	if (!existsSync(file)) {
		throw new Error(`OpenPI package file missing: ${file}`);
	}
	return file;
}

/**
 * Workspace / repo root for default cwd.
 * Prefer monorepo; fall back to packaged runtime only when no monorepo exists.
 */
export function repoRoot() {
	const mono = monorepoRoot();
	if (mono && hasMonorepoClis(mono)) return mono;
	if (mono && hasOpenPiPackages(mono)) return mono;

	const runtime = packagedRuntimeRoot();
	if (runtime) return runtime;

	return monorepoRoot() || resolve(__dirname, "../../..");
}

/**
 * Resolve a real Node binary for child processes.
 * Under Electron, process.execPath is Electron.app — never use it to run Node scripts
 * unless ELECTRON_RUN_AS_NODE=1 is set (fallback only).
 */
export function nodeBinary() {
	if (process.env.OPENPI_NODE_PATH && existsSync(process.env.OPENPI_NODE_PATH)) {
		return resolve(process.env.OPENPI_NODE_PATH);
	}
	if (!process.versions?.electron) {
		return process.execPath;
	}
	try {
		const which = execFileSync("which", ["node"], {
			encoding: "utf8",
			env: process.env,
		})
			.trim()
			.split("\n")[0]
			?.trim();
		if (which && existsSync(which) && !which.includes("Electron.app")) {
			return which;
		}
	} catch {
		// ignore
	}
	const candidates = [
		"/opt/homebrew/bin/node",
		"/usr/local/bin/node",
		"/usr/bin/node",
		join(homedir(), ".local/share/fnm/aliases/default/bin/node"),
	];
	for (const candidate of candidates) {
		if (existsSync(candidate)) return candidate;
	}
	try {
		const versionsDir = join(homedir(), ".nvm/versions/node");
		if (existsSync(versionsDir)) {
			const versions = readdirSync(versionsDir)
				.filter((name) => name.startsWith("v"))
				.sort()
				.reverse();
			for (const version of versions) {
				const bin = join(versionsDir, version, "bin/node");
				if (existsSync(bin)) return bin;
			}
		}
	} catch {
		// ignore
	}
	return process.execPath;
}

export function loadAgentSecretsEnv() {
	const dir = agentDir();
	const file = join(dir, "secrets.env");
	const out = {};
	if (!existsSync(file)) return out;
	try {
		for (const raw of readFileSync(file, "utf8").split("\n")) {
			const line = raw.trim();
			if (!line || line.startsWith("#")) continue;
			const eq = line.indexOf("=");
			if (eq <= 0) continue;
			const key = line.slice(0, eq).trim();
			let value = line.slice(eq + 1).trim();
			if (
				(value.startsWith('"') && value.endsWith('"')) ||
				(value.startsWith("'") && value.endsWith("'"))
			) {
				value = value.slice(1, -1);
			}
			if (key) out[key] = value;
		}
	} catch {
		// ignore
	}
	return out;
}

export function nodeSpawnEnv(extra = {}) {
	const binary = nodeBinary();
	const secrets = loadAgentSecretsEnv();
	const env = { ...secrets, ...process.env, ...extra };
	if (binary.includes("Electron.app") || process.versions?.electron) {
		env.ELECTRON_RUN_AS_NODE = "1";
	}
	try {
		if (!env.PI_CLI_PATH) env.PI_CLI_PATH = piCli();
	} catch {
		// ignore
	}
	try {
		if (!env.PI_ORCHESTRATOR_CLI) env.PI_ORCHESTRATOR_CLI = orchestratorCli();
	} catch {
		// ignore
	}
	const runtime = packagedRuntimeRoot();
	if (runtime) env.OPENPI_RUNTIME_ROOT = runtime;
	const mono = monorepoRoot();
	if (mono) env.OPENPI_REPO_ROOT = env.OPENPI_REPO_ROOT || mono;
	else {
		try {
			env.OPENPI_REPO_ROOT = env.OPENPI_REPO_ROOT || repoRoot();
		} catch {
			// ignore
		}
	}
	return env;
}

/**
 * Orchestrator CLI — monorepo dist first (hot updates), then packaged runtime.
 */
export function orchestratorCli() {
	if (process.env.PI_ORCHESTRATOR_CLI && existsSync(process.env.PI_ORCHESTRATOR_CLI)) {
		return resolve(process.env.PI_ORCHESTRATOR_CLI);
	}
	const mono = monorepoRoot();
	if (mono) {
		const candidate = join(mono, "packages/orchestrator/dist/cli.js");
		if (existsSync(candidate)) return candidate;
	}
	const runtime = packagedRuntimeRoot();
	if (runtime) {
		const bundled = join(runtime, "node_modules/@earendil-works/pi-orchestrator/dist/cli.js");
		if (existsSync(bundled)) return bundled;
	}
	throw new Error(
		"Orchestrator CLI missing. Build packages/orchestrator (npm run build) or reinstall OpenPI.app.",
	);
}

/**
 * Pi coding-agent CLI — monorepo dist first, then packaged runtime.
 */
export function piCli() {
	if (process.env.PI_CLI_PATH && existsSync(process.env.PI_CLI_PATH)) {
		return resolve(process.env.PI_CLI_PATH);
	}
	const mono = monorepoRoot();
	if (mono) {
		const candidate = join(mono, "packages/coding-agent/dist/cli.js");
		if (existsSync(candidate)) return candidate;
	}
	const runtime = packagedRuntimeRoot();
	if (runtime) {
		const bundled = join(runtime, "node_modules/@earendil-works/pi-coding-agent/dist/cli.js");
		if (existsSync(bundled)) return bundled;
	}
	throw new Error(
		"Pi CLI missing. Build packages/coding-agent (npm run build) or reinstall OpenPI.app.",
	);
}

export function orchestratorDir() {
	return process.env.PI_ORCHESTRATOR_DIR || join(homedir(), ".pi", "orchestrator");
}

export function defaultWorkspace() {
	if (process.env.PI_WORKSPACE_DIR || process.env.OPENPI_CHAT_CWD) {
		return process.env.PI_WORKSPACE_DIR || process.env.OPENPI_CHAT_CWD;
	}
	const mono = monorepoRoot();
	if (mono && !mono.includes("OpenPI.app") && !mono.includes("openpi-runtime")) {
		return mono;
	}
	const root = repoRoot();
	if (root.includes("openpi-runtime") || root.includes("OpenPI.app")) {
		return process.cwd();
	}
	return root;
}
