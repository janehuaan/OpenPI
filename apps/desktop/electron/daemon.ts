/**
 * Daemon lifecycle, from the main process's side.
 *
 * Starting the daemon detached is what lets it outlive the app: closing the
 * window does not end a running agent turn, and reopening reattaches. Version
 * drift is detected by comparing the pi entry's mtime, so a rebuilt backend is
 * picked up without reinstalling the .app - but never by killing a session
 * mid-turn.
 *
 * The old fork had this logic here *and* in the orchestrator, two copies to keep
 * in step. Single-instance enforcement now lives only in the daemon; this file
 * just starts it and reports.
 */

import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { HealthInfo } from "@openpi/shared";
import { DaemonClient, isDaemonLive } from "@openpi/daemon";

/** Resolve the daemon CLI inside this repo or the packaged runtime. */
function daemonCli(): string {
	const override = process.env.OPENPI_DAEMON_CLI;
	if (override) return override;

	const here = dirname(fileURLToPath(import.meta.url));
	const candidates = [
		// packaged: Resources/openpi/daemon.js, a bundle beside its node_modules
		join(process.resourcesPath ?? "", "openpi/daemon.js"),
		// staged but unpackaged, e.g. after `npm run build:runtime`
		join(here, "../runtime/daemon.js"),
		// dev, from source
		join(here, "../../../packages/daemon/src/cli.ts"),
	];
	const found = candidates.find(existsSync);
	if (found) return found;
	throw new Error(
		`openpi daemon CLI not found. Looked in:\n  ${candidates.join("\n  ")}\n` +
			"Set OPENPI_DAEMON_CLI, or reinstall the app.",
	);
}

let client: DaemonClient | undefined;
let deferredRestartNotice: (() => void) | undefined;

export function onRestartDeferred(notify: () => void): void {
	deferredRestartNotice = notify;
}

/** Connect, starting the daemon first if nothing is listening. */
export async function ensureDaemon(): Promise<DaemonClient> {
	if (client) return client;
	if (!(await isDaemonLive())) await startDaemon();

	const connected = new DaemonClient();
	await connected.connect();
	client = connected;
	return connected;
}

export function currentClient(): DaemonClient | undefined {
	return client;
}

function spawnDaemon(): void {
	// process.execPath is the Electron binary; ELECTRON_RUN_AS_NODE makes it behave
	// as plain Node, so no second runtime has to be shipped. A packaged daemon is a
	// plain-JS bundle; only the dev path needs TS stripping, which Electron 38's
	// Node 22 supports.
	const entry = daemonCli();
	const args = entry.endsWith(".ts")
		? ["--experimental-strip-types", entry, "serve"]
		: [entry, "serve"];
	const child = spawn(process.execPath, args, {
		detached: true,
		stdio: "ignore",
		env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
	});
	child.unref();
}

async function startDaemon(): Promise<void> {
	spawnDaemon();
	// Poll rather than sleeping a fixed interval: the socket appears as soon as
	// the daemon binds, usually well under a second.
	for (let attempt = 0; attempt < 40; attempt++) {
		if (await isDaemonLive()) return;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error("daemon did not start within 4s");
}

/**
 * Restart the daemon when its code is older than what is on disk.
 *
 * Never kills a live session to do it: interrupting an in-flight turn loses the
 * reply with no error surfaced anywhere, so the restart is deferred and the UI is
 * told instead.
 */
export async function restartIfStale(): Promise<"restarted" | "deferred" | "current"> {
	const connection = await ensureDaemon();
	const health = (await connection.request({ type: "health" })) as HealthInfo;

	let onDiskMtime = 0;
	try {
		onDiskMtime = statSync(health.cliPath).mtimeMs;
	} catch {
		return "current";
	}
	if (onDiskMtime === health.cliMtimeMs) return "current";

	if (health.runningCount > 0) {
		deferredRestartNotice?.();
		return "deferred";
	}
	await restartDaemon();
	return "restarted";
}

export async function restartDaemon(): Promise<void> {
	if (await isDaemonLive()) {
		const connection = client ?? new DaemonClient();
		if (!client) await connection.connect();
		await connection.request({ type: "shutdown" }).catch(() => undefined);
		connection.close();
		client = undefined;
		// Give the socket time to disappear before rebinding.
		for (let attempt = 0; attempt < 20; attempt++) {
			if (!(await isDaemonLive())) break;
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	}
	await ensureDaemon();
}

export function disconnect(): void {
	client?.close();
	client = undefined;
}
