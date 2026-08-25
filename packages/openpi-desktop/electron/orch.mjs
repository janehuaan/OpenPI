import { execFileSync, spawn } from "node:child_process";
import { createConnection } from "node:net";
import { existsSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { nodeBinary, nodeSpawnEnv, orchestratorCli, orchestratorDir, piCli, agentDir, monorepoRoot } from "./paths.mjs";

const DAEMON_START_TIMEOUT_MS = 30_000;
let daemonStartPromise;
let restartDeferredNotice;

/** Register a callback invoked when a daemon restart is deferred because sessions are active. */
export function setRestartDeferredNotice(callback) {
	restartDeferredNotice = callback;
}

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
export async function probeDaemon(timeoutMs = 5_000) {
	const path = socketPath();
	if (!existsSync(path)) return { alive: false, reason: "no-socket" };
	try {
		const list = await sendIpcRequest({ type: "list" }, timeoutMs);
		if (list && list.ok === true) return { alive: true, via: "list", list };
	} catch (error) {
		return { alive: false, reason: error instanceof Error ? error.message : String(error) };
	}
	return { alive: false, reason: "list-not-ok" };
}

export async function getHealthSafe(timeoutMs = 3_000) {
	try {
		const health = await sendIpcRequest({ type: "health" }, timeoutMs);
		if (health && health.ok && health.type === "health_result") return health.health ?? health;
	} catch {
		// Older daemons return invalid "undefined" for health — ignore.
	}
	return undefined;
}

/** True when the running daemon was started from a different CLI build than the current one. */
async function daemonNeedsRestart() {
	const health = await getHealthSafe();
	if (!health) return false;
	// A daemon built before the cliMtime field exists cannot be verified;
	// restart it once so its code matches the current build.
	if (typeof health.cliMtime !== "number") return true;
	try {
		const localMtime = statSync(orchestratorCli()).mtimeMs;
		return health.cliMtime !== localMtime;
	} catch {
		return false;
	}
}

/** Whether any instance is online/starting (a turn may be executing). */
function hasActiveInstances(list) {
	if (!list || !Array.isArray(list.instances)) return false;
	return list.instances.some((instance) => instance?.status === "online" || instance?.status === "starting");
}

// --- Milvus self-check + auto-start (best-effort, never blocks the daemon) ----------
const MILVUS_HOST = "127.0.0.1";
const MILVUS_PORT = 19530;
const MILVUS_PROBE_TIMEOUT_MS = 1_500;
const DOCKER_WAIT_TIMEOUT_MS = 60_000; // Docker Desktop cold start
const MILVUS_WAIT_TIMEOUT_MS = 120_000; // first-time image pull can be slow
let milvusEnsurePromise;

/** Probe whether something answers on the Milvus gRPC port. */
function probeMilvus(timeoutMs = MILVUS_PROBE_TIMEOUT_MS) {
	return new Promise((resolve) => {
		const socket = createConnection({ host: MILVUS_HOST, port: MILVUS_PORT });
		let settled = false;
		const done = (ok) => {
			if (settled) return;
			settled = true;
			try {
				socket.destroy();
			} catch {
				// ignore
			}
			resolve(ok);
		};
		socket.setTimeout(timeoutMs);
		socket.once("connect", () => done(true));
		socket.once("timeout", () => done(false));
		socket.once("error", () => done(false));
	});
}

function dockerAvailable() {
	return new Promise((resolve) => {
		const child = spawn("docker", ["version", "--format", "{{.Server.Version}}"], { stdio: "ignore" });
		child.once("error", () => resolve(false));
		child.once("exit", (code) => resolve(code === 0));
	});
}

function waitFor(fn, timeoutMs, intervalMs = 2_000) {
	const deadline = Date.now() + timeoutMs;
	return new Promise((resolve) => {
		const tick = async () => {
			if (await fn()) return resolve(true);
			if (Date.now() >= deadline) return resolve(false);
			setTimeout(tick, intervalMs);
		};
		void tick();
	});
}

function autoStartMilvusEnabled() {
	try {
		const file = join(agentDir(), "settings.json");
		if (!existsSync(file)) return true;
		const parsed = JSON.parse(readFileSync(file, "utf8"));
		return parsed?.autoStartMilvus !== false;
	} catch {
		return true;
	}
}

/**
 * Idempotent, best-effort self-check: if Milvus is unreachable, start Docker
 * (if needed) and `docker compose up` the local Milvus stack. Never throws —
 * the conversation process degrades gracefully (lazy Milvus client) meanwhile.
 */
export function ensureMilvus() {
	if (!milvusEnsurePromise) {
		milvusEnsurePromise = runMilvusEnsure().finally(() => {
			milvusEnsurePromise = undefined;
		});
	}
	return milvusEnsurePromise;
}

async function runMilvusEnsure() {
	try {
		// Already reachable — nothing to do.
		if (await probeMilvus()) return true;

		// Respect the user's opt-out.
		if (!autoStartMilvusEnabled()) return false;

		// Docker must be running; launch Docker Desktop if not.
		if (!(await dockerAvailable())) {
			spawn("open", ["-a", "Docker"], { stdio: "ignore" }).unref();
			const ready = await waitFor(dockerAvailable, DOCKER_WAIT_TIMEOUT_MS);
			if (!ready) {
				console.warn("[orch] Docker did not become available; skipping Milvus auto-start.");
				return false;
			}
		}

		const root = monorepoRoot();
		const composeFile = join(root ?? "", "deploy", "milvus", "docker-compose.yml");
		if (!existsSync(composeFile)) {
			console.warn(`[orch] Milvus compose file not found at ${composeFile}; skipping auto-start.`);
			return false;
		}

		const started = await new Promise((resolve) => {
			const child = spawn("docker", ["compose", "-f", composeFile, "up", "-d"], { stdio: "ignore" });
			child.once("error", () => resolve(false));
			child.once("exit", (code) => resolve(code === 0));
		});
		if (!started) {
			console.warn("[orch] docker compose up failed; Milvus auto-start skipped.");
			return false;
		}

		const reachable = await waitFor(() => probeMilvus(), MILVUS_WAIT_TIMEOUT_MS);
		if (!reachable) {
			console.warn("[orch] Milvus did not become reachable within the timeout.");
			return false;
		}
		return true;
	} catch (error) {
		console.warn("[orch] Milvus auto-start failed:", error instanceof Error ? error.message : String(error));
		return false;
	}
}

export async function ensureDaemon() {
	// Best-effort Milvus self-check alongside daemon startup; never blocks it.
	void ensureMilvus();
	if (daemonStartPromise) return daemonStartPromise;

	daemonStartPromise = startDaemon().finally(() => {
		daemonStartPromise = undefined;
	});
	return daemonStartPromise;
}

/**
 * Reap stale orchestrator daemons before spawning a fresh one. Daemons are
 * detached orphans — when a socket looks stale a new `serve` is spawned but the
 * old one is never killed, so they pile up and race to write instances.json.
 * Reaching this point means no live daemon answered the probe, so killing every
 * leftover `serve` is safe and keeps the orchestrator single-instance.
 */
async function reapStaleDaemons() {
	let stale = [];
	try {
		const output = execFileSync("pgrep", ["-f", "orchestrator/dist/cli.js serve"], { encoding: "utf8" });
		stale = output
			.split("\n")
			.map((line) => Number(line.trim()))
			.filter((pid) => pid && pid !== process.pid);
	} catch {
		return; // pgrep found nothing — nothing to reap
	}
	for (const pid of stale) {
		try {
			process.kill(pid, "SIGKILL");
		} catch {
			// already gone
		}
	}
	// Wait for them to fully exit so the socket is released before spawning.
	const deadline = Date.now() + 3_000;
	while (Date.now() < deadline && stale.length > 0) {
		stale = stale.filter((pid) => {
			try {
				process.kill(pid, 0);
				return true;
			} catch {
				return false;
			}
		});
		if (stale.length > 0) {
			await delay(50);
		}
	}
}

async function startDaemon() {
	const probe = await probeDaemon(750);
	if (probe.alive) {
		// Restart the daemon when its code differs from the current build
		// (e.g. after installing a new .app): the long-lived daemon would
		// otherwise keep running the old coding-agent indefinitely.
		if (await daemonNeedsRestart()) {
			// Never kill live sessions to pick up new code. If any instance is
			// online/starting (a turn may be executing), defer the restart until
			// the session settles — otherwise a build silently interrupts an
			// in-flight agent turn: the message stays in the session but no reply
			// is produced and no error is surfaced.
			if (hasActiveInstances(probe.list)) {
				restartDeferredNotice?.();
				return true;
			}
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
	await reapStaleDaemons();
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
