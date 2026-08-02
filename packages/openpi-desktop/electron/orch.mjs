import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { existsSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { nodeBinary, nodeSpawnEnv, orchestratorCli, orchestratorDir, piCli } from "./paths.mjs";

const DAEMON_START_TIMEOUT_MS = 30_000;
let daemonStartPromise;

function socketPath() {
	return join(orchestratorDir(), "orchestrator.sock");
}

function encode(message) {
	return `${JSON.stringify(message)}\n`;
}

/**
 * Send one IPC request and wait for a single JSONL response.
 * Handles multi-chunk large payloads (e.g. long instance lists).
 */
export function sendIpcRequest(request, timeoutMs = 15_000) {
	const path = socketPath();
	return new Promise((resolve, reject) => {
		const socket = createConnection(path);
		let buffer = "";
		let settled = false;
		const timer = setTimeout(() => {
			done(new Error(`Orchestrator IPC timeout for ${request.type}`));
		}, timeoutMs);

		const done = (err, value) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			socket.removeAllListeners();
			try {
				socket.destroy();
			} catch {
				// ignore
			}
			if (err) reject(err);
			else resolve(value);
		};

		socket.on("connect", () => socket.write(encode(request)));
		socket.on("data", (chunk) => {
			buffer += chunk.toString();
			const idx = buffer.indexOf("\n");
			if (idx === -1) return;
			const line = buffer.slice(0, idx).trim();
			if (!line || line === "undefined") {
				done(new Error(`Orchestrator returned invalid response for ${request.type}`));
				return;
			}
			try {
				done(null, JSON.parse(line));
			} catch (error) {
				done(
					new Error(
						`Orchestrator JSON parse failed for ${request.type}: ${error instanceof Error ? error.message : String(error)}`,
					),
				);
			}
		});
		socket.on("error", (error) => done(error));
		socket.on("end", () => {
			if (!settled) {
				const line = buffer.trim();
				if (line && line !== "undefined") {
					try {
						done(null, JSON.parse(line));
						return;
					} catch {
						// fall through
					}
				}
				done(new Error(`Orchestrator socket closed before response for ${request.type}`));
			}
		});
	});
}

/** Probe whether a live daemon answers. Prefer list (works on older builds). */
export async function probeDaemon() {
	const path = socketPath();
	if (!existsSync(path)) return { alive: false, reason: "no-socket" };
	try {
		const list = await sendIpcRequest({ type: "list" }, 5_000);
		if (list && list.ok === true) return { alive: true, via: "list", list };
	} catch (error) {
		return { alive: false, reason: error instanceof Error ? error.message : String(error) };
	}
	return { alive: false, reason: "list-not-ok" };
}

export async function getHealthSafe() {
	try {
		const health = await sendIpcRequest({ type: "health" }, 3_000);
		if (health && health.ok && health.type === "health_result") return health.health ?? health;
	} catch {
		// Older daemons return invalid "undefined" for health — ignore.
	}
	return undefined;
}

/** True when the running daemon was started from a different CLI build than the current one. */
async function daemonNeedsRestart() {
	const health = await getHealthSafe();
	if (!health || typeof health.cliMtime !== "number") return false;
	try {
		const localMtime = statSync(orchestratorCli()).mtimeMs;
		return health.cliMtime !== localMtime;
	} catch {
		return false;
	}
}

export async function ensureDaemon() {
	if (daemonStartPromise) return daemonStartPromise;

	daemonStartPromise = startDaemon().finally(() => {
		daemonStartPromise = undefined;
	});
	return daemonStartPromise;
}

async function startDaemon() {
	const probe = await probeDaemon();
	if (probe.alive) {
		// Restart the daemon when its code differs from the current build
		// (e.g. after installing a new .app): the long-lived daemon would
		// otherwise keep running the old coding-agent indefinitely.
		if (await daemonNeedsRestart()) {
			await stopDaemon();
		} else {
			return true;
		}
	}

	// Stale socket: file exists but list failed
	const path = socketPath();
	if (existsSync(path) && !probe.alive) {
		try {
			unlinkSync(path);
		} catch {
			// may still be held; start will report
		}
	}

	// Must use real Node (or ELECTRON_RUN_AS_NODE). process.execPath under Electron is Electron.app.
	const env = nodeSpawnEnv({ PI_CLI_PATH: piCli() });
	const child = spawn(nodeBinary(), [orchestratorCli(), "serve"], {
		detached: true,
		stdio: "ignore",
		env,
	});
	let childFailure;
	child.once("error", (error) => {
		childFailure = error instanceof Error ? error.message : String(error);
	});
	child.once("exit", (code, signal) => {
		childFailure = signal ? `terminated by ${signal}` : `exited with code ${code ?? "unknown"}`;
	});
	child.unref();

	let lastProbe = probe;
	const deadline = Date.now() + DAEMON_START_TIMEOUT_MS;
	while (Date.now() < deadline) {
		await delay(100);
		lastProbe = await probeDaemon();
		if (lastProbe.alive) return true;
		if (childFailure) {
			throw new Error(`Orchestrator daemon failed to start (${childFailure}).`);
		}
	}
	throw new Error(`Orchestrator daemon failed to start (${lastProbe.reason ?? "unknown"}).`);
}

export async function stopDaemon() {
	try {
		await sendIpcRequest({ type: "shutdown" }, 3_000);
	} catch {
		// Older daemon may not support shutdown — best effort.
	}
	// Wait for socket to drop so a fresh serve can bind.
	const path = socketPath();
	for (let i = 0; i < 30; i++) {
		await delay(100);
		if (!existsSync(path)) break;
		const probe = await probeDaemon();
		if (!probe.alive) {
			try {
				unlinkSync(path);
			} catch {
				// ignore
			}
			break;
		}
	}
	return true;
}

/** Stop then start so health handler and other rebuilt code take effect. */
export async function restartDaemon() {
	await stopDaemon();
	return ensureDaemon();
}

export function readTasksAndRuns() {
	const dir = orchestratorDir();
	const tasksPath = join(dir, "tasks.json");
	const runsPath = join(dir, "task-runs.json");
	const instancesPath = join(dir, "instances.json");
	const tasks = existsSync(tasksPath) ? (JSON.parse(readFileSync(tasksPath, "utf8")).tasks ?? []) : [];
	const runs = existsSync(runsPath) ? (JSON.parse(readFileSync(runsPath, "utf8")).runs ?? []) : [];
	let instances = [];
	if (existsSync(instancesPath)) {
		const raw = JSON.parse(readFileSync(instancesPath, "utf8"));
		instances = Array.isArray(raw) ? raw : (raw.instances ?? []);
	}
	// Prefer live list ordering when available is handled by get_snapshot
	return { tasks, runs, instances };
}

export async function listInstancesLive() {
	try {
		const list = await sendIpcRequest({ type: "list" }, 8_000);
		if (list?.ok && Array.isArray(list.instances)) return list.instances;
	} catch {
		// fall back to files
	}
	return readTasksAndRuns().instances;
}

export async function rpc(instanceId, command) {
	await ensureDaemon();
	const response = await sendIpcRequest({ type: "rpc", instanceId, command }, 120_000);
	if (!response.ok) throw new Error(response.error || "RPC failed");
	return response.response;
}
