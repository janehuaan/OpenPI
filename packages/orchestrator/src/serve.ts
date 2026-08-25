import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { getSocketPath } from "./config.ts";
import { handleIpcRequest, openRpcStream, setShutdownHandler } from "./handler.ts";
import { isSocketLive, startIpcServer } from "./ipc/server.ts";
import { getRadiusOrchestratorBaseUrl, isRadiusEnabled, radiusPresence } from "./radius.ts";
import { supervisor } from "./supervisor.ts";
import { taskScheduler } from "./task-scheduler.ts";

/**
 * The orchestrator is single-instance (one socket, one instances.json writer).
 * Electron and manual launches spawn a fresh `serve` whenever the socket looks
 * stale; without reaping, every stale launch leaves an orphan daemon behind,
 * and concurrent daemons race to write instances.json (reviving ghost "online"
 * instances whose RPC processes are long gone). Called only after we confirmed
 * no live daemon answers the socket — every other serve process is then a stale
 * orphan, so reap them so exactly one daemon owns the socket and the store.
 */
async function reapStaleServeProcesses(): Promise<void> {
	let stale: number[] = [];
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
	// Wait for them to fully exit so the socket is released before we bind.
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

export async function serve(): Promise<void> {
	const socketPath = getSocketPath();
	// Single-instance guard: if a live daemon already answers, refuse to start.
	// Do NOT reap it — it is serving real sessions and clients are connected.
	if (existsSync(socketPath) && (await isSocketLive(socketPath))) {
		throw new Error(`orchestrator is already running: ${socketPath}`);
	}
	// No live daemon — every other serve process is a stale orphan. Reap them
	// so a single daemon owns the socket and instances.json from here on.
	await reapStaleServeProcesses();
	mkdirSync(dirname(socketPath), { recursive: true });
	const server = await startIpcServer(
		Object.assign(handleIpcRequest, {
			openRpcStream,
		}),
	);

	try {
		if (isRadiusEnabled()) {
			const machine = await radiusPresence.start();
			console.log(`radius integration enabled: ${socketPath} -> ${getRadiusOrchestratorBaseUrl()}`);
			if (machine) {
				console.log(`radius machine id: ${machine.id}`);
			}
		} else {
			console.log("radius integration disabled: login radius in ~/.pi/agent/auth.json or set RADIUS_API_KEY");
		}
		await supervisor.recoverAfterRestart();
		taskScheduler.start();
	} catch (error) {
		server.close();
		if (existsSync(socketPath)) {
			unlinkSync(socketPath);
		}
		throw error;
	}

	console.log(`orchestrator listening on ${socketPath}`);

	let shutdownPromise: Promise<void> | undefined;
	const shutdown = async (exitCode: number) => {
		if (shutdownPromise) {
			await shutdownPromise;
			process.exit(exitCode);
		}

		shutdownPromise = (async () => {
			setShutdownHandler(undefined);
			server.close();
			taskScheduler.stop();
			await supervisor.shutdown();
			await radiusPresence.stop();
			if (existsSync(socketPath)) {
				unlinkSync(socketPath);
			}
		})();

		await shutdownPromise;
		process.exit(exitCode);
	};

	setShutdownHandler(() => {
		void shutdown(0);
	});

	process.on("SIGINT", () => {
		void shutdown(0);
	});
	process.on("SIGTERM", () => {
		void shutdown(0);
	});
	process.on("uncaughtException", (error) => {
		console.error(error);
		void shutdown(1);
	});
	process.on("unhandledRejection", (reason) => {
		console.error(reason);
		void shutdown(1);
	});

	await new Promise<void>(() => {
		// Keep the process alive until a signal or fatal error triggers shutdown.
	});
}
