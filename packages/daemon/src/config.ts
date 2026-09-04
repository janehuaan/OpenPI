/**
 * Daemon paths and pi CLI resolution.
 *
 * Everything openpi owns lives under ~/.openpi/ so it never collides with a
 * user's own `pi` CLI install in ~/.pi/. The agent dir is handed to every
 * subprocess as PI_CODING_AGENT_DIR: without that isolation a spawned session
 * picks up the user's global extensions and model defaults (verified in the
 * Phase 0 spike - it loaded opencode-usage and plan-mode unasked).
 */

import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const VERSION = "0.1.0";

export function openpiDir(): string {
	return process.env.OPENPI_DIR ?? join(homedir(), ".openpi");
}

/** Isolated PI_CODING_AGENT_DIR for every spawned session. */
export function agentDir(): string {
	return join(openpiDir(), "agent");
}

export function sessionsDir(): string {
	return join(openpiDir(), "sessions");
}

export function socketPath(): string {
	return process.env.OPENPI_SOCKET ?? join(openpiDir(), "daemon.sock");
}

export function pidPath(): string {
	return join(openpiDir(), "daemon.pid");
}

export function instancesPath(): string {
	return join(openpiDir(), "instances.json");
}

/** The user's own pi CLI config dir, read once for credential bootstrap. */
export function globalAgentDir(): string {
	return process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
}

/**
 * Resolve the pi RPC entry we spawn per session.
 *
 * We resolve the installed package rather than a PATH lookup so the daemon and
 * its sessions always agree on one pinned version. OPENPI_PI_RPC_ENTRY exists
 * for tests and for pointing a dev build at a local checkout.
 */
export function piRpcEntry(): string {
	const override = process.env.OPENPI_PI_RPC_ENTRY;
	if (override) return override;

	const here = dirname(fileURLToPath(import.meta.url));
	const candidates = [
		// workspace install: packages/daemon/src -> repo root node_modules
		join(here, "../../../node_modules/@earendil-works/pi-coding-agent/dist/bundle/rpc-entry.js"),
		// package-local install
		join(here, "../node_modules/@earendil-works/pi-coding-agent/dist/bundle/rpc-entry.js"),
	];
	for (const candidate of candidates) {
		if (existsSync(candidate)) return candidate;
	}
	throw new Error(
		`pi RPC entry not found. Looked in:\n  ${candidates.join("\n  ")}\n` +
			"Run `npm install` at the repo root, or set OPENPI_PI_RPC_ENTRY.",
	);
}

/**
 * Resolve the pi CLI entry (not the RPC one) for app-level subcommands like
 * `pi auth`. Same pinned install, different entry point.
 */
export function piCli(): string {
	const override = process.env.OPENPI_PI_CLI;
	if (override) return override;

	const here = dirname(fileURLToPath(import.meta.url));
	const candidates = [
		join(here, "../../../node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js"),
		join(here, "../node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js"),
	];
	for (const candidate of candidates) {
		if (existsSync(candidate)) return candidate;
	}
	throw new Error(
		`pi CLI not found. Looked in:\n  ${candidates.join("\n  ")}\n` +
			"Run `npm install` at the repo root, or set OPENPI_PI_CLI.",
	);
}

/**
 * mtime of the pi entry, reported in health so a client can tell the daemon is
 * running older code than what is now on disk. The old OpenPI compared this to
 * decide when to restart the daemon after a rebuild; keeping the signal here
 * means the restart policy lives in one place instead of two.
 */
export function piCliMtimeMs(): number {
	try {
		return statSync(piRpcEntry()).mtimeMs;
	} catch {
		return 0;
	}
}
