/**
 * Daemon main loop.
 *
 * Single-instance enforcement lives here and only here. The old OpenPI had
 * near-identical guard-and-reap logic in both the orchestrator and the Electron
 * main process, which meant two copies to keep in step.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import type { Server } from "node:net";
import type { AppOp, ClientRequest, HealthInfo } from "@openpi/shared";
import { bootstrapCredentials, listProviders } from "./bootstrap.ts";
import { agentDir, openpiDir, piCliMtimeMs, piRpcEntry, pidPath, socketPath, VERSION } from "./config.ts";
import { type Connection, startServer } from "./ipc/server.ts";
import { isDaemonLive } from "./ipc/client.ts";
import { Supervisor } from "./supervisor.ts";

const startedAt = Date.now();

/**
 * Kill a daemon that left its socket behind but stopped answering. Only
 * processes whose command line matches this daemon's entry are touched.
 */
function reapStaleDaemon(): void {
	try {
		const output = execFileSync("pgrep", ["-f", "openpi-daemon serve"], { encoding: "utf8" });
		for (const line of output.split("\n")) {
			const pid = Number.parseInt(line.trim(), 10);
			if (!Number.isFinite(pid) || pid === process.pid) continue;
			try {
				process.kill(pid, "SIGKILL");
				process.stderr.write(`[daemon] reaped stale daemon pid ${pid}\n`);
			} catch {
				// Already gone between listing and killing.
			}
		}
	} catch {
		// pgrep exits non-zero when nothing matches; that is the normal case.
	}
	const path = socketPath();
	if (existsSync(path)) unlinkSync(path);
}

async function handleApp(op: AppOp): Promise<unknown> {
	switch (op.name) {
		case "list_models":
			return { providers: listProviders(agentDir()) };
		case "auth_status": {
			const providers = listProviders(agentDir());
			return { configured: providers.length > 0, providers };
		}
		case "import_global_credentials":
			return bootstrapCredentials({ force: true });
		default: {
			const exhaustive: never = op;
			throw new Error(`unknown app op: ${JSON.stringify(exhaustive)}`);
		}
	}
}

export async function serve(): Promise<void> {
	mkdirSync(openpiDir(), { recursive: true });

	if (await isDaemonLive()) {
		throw new Error(`a daemon is already listening on ${socketPath()}`);
	}
	reapStaleDaemon();

	// Decision B: import the user's pi CLI providers once, so a fresh install
	// can actually reach a model instead of failing every call with 401.
	const bootstrap = bootstrapCredentials();
	if (!bootstrap.alreadyBootstrapped) {
		process.stderr.write(
			`[daemon] credential bootstrap: imported ${bootstrap.imported.join(", ") || "nothing"}` +
				` | providers: ${bootstrap.providers.length}\n`,
		);
	}
	if (bootstrap.providers.length === 0) {
		process.stderr.write("[daemon] warning: no providers configured; model calls will fail with 401\n");
	}

	const supervisor = new Supervisor();
	let server: Server | undefined;
	let shuttingDown = false;

	const shutdown = (reason: string) => {
		if (shuttingDown) return;
		shuttingDown = true;
		process.stderr.write(`[daemon] shutting down (${reason})\n`);
		supervisor.stopAll();
		server?.close();
		if (existsSync(pidPath())) unlinkSync(pidPath());
		if (existsSync(socketPath())) unlinkSync(socketPath());
		setTimeout(() => process.exit(0), 200).unref();
	};

	server = await startServer(async (request: ClientRequest, connection: Connection) => {
		switch (request.type) {
			case "health": {
				const health: HealthInfo = {
					ok: true,
					pid: process.pid,
					version: VERSION,
					cliMtimeMs: piCliMtimeMs(),
					cliPath: piRpcEntry(),
					sessionCount: supervisor.sessionCount,
					runningCount: supervisor.runningCount,
					uptimeMs: Date.now() - startedAt,
				};
				return health;
			}
			case "shutdown":
				// Reply before tearing down so the caller sees success.
				setTimeout(() => shutdown("client request"), 50);
				return { ok: true };
			case "list_sessions":
				return { sessions: supervisor.list() };
			case "create_session":
				return supervisor.create({
					cwd: request.cwd,
					mode: request.mode,
					model: request.model,
					name: request.name,
				});
			case "stop_session":
				supervisor.stop(request.sessionId);
				return { ok: true };
			case "delete_session":
				supervisor.delete(request.sessionId);
				return { ok: true };
			case "subscribe": {
				const unsubscribe = supervisor.subscribe(request.sessionId, (sessionId, event) => {
					connection.pushEvent(sessionId, event);
				});
				connection.cleanups.add(unsubscribe);
				return { subscribed: request.sessionId };
			}
			case "unsubscribe":
				for (const cleanup of connection.cleanups) cleanup();
				connection.cleanups.clear();
				return { ok: true };
			case "rpc":
				return supervisor.rpc(request.sessionId, request.command);
			case "app":
				return handleApp(request.op);
			default: {
				const exhaustive: never = request;
				throw new Error(`unknown request: ${JSON.stringify(exhaustive)}`);
			}
		}
	});

	writeFileSync(pidPath(), String(process.pid), "utf8");
	process.stderr.write(`[daemon] listening on ${socketPath()} (pid ${process.pid})\n`);

	process.on("SIGINT", () => shutdown("SIGINT"));
	process.on("SIGTERM", () => shutdown("SIGTERM"));
	process.on("uncaughtException", (error) => {
		process.stderr.write(`[daemon] uncaught: ${error.stack ?? error.message}\n`);
	});
	process.on("unhandledRejection", (reason) => {
		process.stderr.write(`[daemon] unhandled rejection: ${String(reason)}\n`);
	});
}
