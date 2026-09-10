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
import { app } from "electron";
import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ClientRequestInput, HealthInfo } from "@openpi/shared";
import { DaemonClient, isDaemonLive } from "@openpi/daemon";

export type DaemonStatus = "connected" | "reconnecting" | "disconnected";

let currentStatus: DaemonStatus = "disconnected";
const statusListeners = new Set<(status: DaemonStatus) => void>();

export function getDaemonStatus(): DaemonStatus {
	return currentStatus;
}

export function onDaemonStatusChange(listener: (status: DaemonStatus) => void): () => void {
	statusListeners.add(listener);
	listener(currentStatus);
	return () => statusListeners.delete(listener);
}

function setDaemonStatus(status: DaemonStatus): void {
	if (currentStatus === status) return;
	currentStatus = status;
	for (const listener of statusListeners) {
		try {
			listener(status);
		} catch {}
	}
}

/** Resolve the daemon CLI inside this repo or the packaged runtime. */
function daemonCli(): string {
	const override = process.env.OPENPI_DAEMON_CLI;
	if (override) return override;

	const here = dirname(fileURLToPath(import.meta.url));
	// Packaged first, then source. `runtime/` is deliberately NOT consulted when
	// running unpackaged: it is a build artifact that goes stale the moment the
	// daemon changes, and preferring it means an unpackaged run silently exercises
	// yesterday's backend - which is exactly how a new app op came back as
	// "unknown app op" while its source was right there.
	const candidates = app.isPackaged
		? [join(process.resourcesPath ?? "", "openpi/daemon.js")]
		: [join(here, "../../../packages/daemon/src/cli.ts")];
	const found = candidates.find(existsSync);
	if (found) return found;
	throw new Error(
		`openpi daemon CLI not found. Looked in:\n  ${candidates.join("\n  ")}\n` +
			"Set OPENPI_DAEMON_CLI, or reinstall the app.",
	);
}

let client: DaemonClient | undefined;
let connectingPromise: Promise<DaemonClient> | undefined;
let deferredRestartNotice: (() => void) | undefined;
let intentionalDisconnect = false;
let reconnectTimer: NodeJS.Timeout | undefined;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 15;
const BASE_RECONNECT_DELAY_MS = 400;
const MAX_RECONNECT_DELAY_MS = 6000;

export function onRestartDeferred(notify: () => void): void {
	deferredRestartNotice = notify;
}

export function scheduleReconnect(): void {
	if (intentionalDisconnect) return;
	if (reconnectTimer) return;
	if (connectingPromise) return;

	setDaemonStatus("reconnecting");
	const delay = Math.min(
		BASE_RECONNECT_DELAY_MS * Math.pow(1.6, reconnectAttempts),
		MAX_RECONNECT_DELAY_MS,
	);
	reconnectAttempts++;

	reconnectTimer = setTimeout(async () => {
		reconnectTimer = undefined;
		if (intentionalDisconnect) return;
		try {
			await ensureDaemon();
			reconnectAttempts = 0;
		} catch {
			if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
				scheduleReconnect();
			} else {
				setDaemonStatus("disconnected");
			}
		}
	}, delay);
}

/** Connect, starting the daemon first if nothing is listening. */
export async function ensureDaemon(): Promise<DaemonClient> {
	if (client && client.isConnected()) return client;
	if (connectingPromise) return connectingPromise;

	intentionalDisconnect = false;
	connectingPromise = (async () => {
		try {
			if (!(await isDaemonLive())) await startDaemon();
			const connected = new DaemonClient();
			await connected.connect();

			connected.onClose(() => {
				if (client === connected) {
					client = undefined;
					if (!intentionalDisconnect) {
						setDaemonStatus("reconnecting");
						scheduleReconnect();
					}
				}
			});

			client = connected;
			reconnectAttempts = 0;
			if (reconnectTimer) {
				clearTimeout(reconnectTimer);
				reconnectTimer = undefined;
			}
			setDaemonStatus("connected");
			return connected;
		} catch (error) {
			if (!intentionalDisconnect && currentStatus !== "connected") {
				setDaemonStatus("reconnecting");
			}
			throw error;
		} finally {
			connectingPromise = undefined;
		}
	})();

	return connectingPromise;
}

export function currentClient(): DaemonClient | undefined {
	return client;
}

/**
 * Forward a request to the daemon with automatic retry and exponential backoff
 * in case the daemon temporarily restarts or disconnects.
 */
export async function requestDaemon(
	request: ClientRequestInput,
	retries = 5,
): Promise<unknown> {
	let delay = 350;
	for (let attempt = 0; attempt <= retries; attempt++) {
		try {
			const activeClient = await ensureDaemon();
			return await activeClient.request(request);
		} catch (err: any) {
			const msg = err?.message || String(err);
			const isConnError =
				/daemon connection closed|not connected|timed out connecting|ECONNREFUSED|ENOENT/i.test(msg);
			if (isConnError && attempt < retries && !intentionalDisconnect) {
				client = undefined;
				setDaemonStatus("reconnecting");
				await new Promise((resolve) => setTimeout(resolve, delay));
				delay = Math.min(delay * 2, 2500);
				continue;
			}
			throw err;
		}
	}
	throw new Error("Daemon request failed after reconnection attempts");
}

function spawnDaemon(): void {
	// process.execPath is the Electron binary; ELECTRON_RUN_AS_NODE makes it behave
	// as plain Node, so no second runtime has to be shipped. A packaged daemon is a
	// plain-JS bundle; only the dev path needs TS stripping, which Electron 38's
	// Node 22 supports.
	const entry = daemonCli();
	const darwinArgs =
		process.platform === "darwin"
			? [
					"--import",
					"data:text/javascript,Object.defineProperty(process,'title',{get:()=>'openpi-daemon',set:()=>{},configurable:true});",
				]
			: [];
	const args = entry.endsWith(".ts")
		? [...darwinArgs, "--experimental-strip-types", entry, "serve"]
		: [...darwinArgs, entry, "serve"];
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
	for (let attempt = 0; attempt < 80; attempt++) {
		if (await isDaemonLive()) return;
		await new Promise((resolve) => setTimeout(resolve, 50));
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
	setDaemonStatus("reconnecting");
	if (await isDaemonLive()) {
		const connection = client ?? new DaemonClient();
		if (!client) await connection.connect().catch(() => undefined);
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
	intentionalDisconnect = true;
	if (reconnectTimer) {
		clearTimeout(reconnectTimer);
		reconnectTimer = undefined;
	}
	client?.close();
	client = undefined;
	setDaemonStatus("disconnected");
}
