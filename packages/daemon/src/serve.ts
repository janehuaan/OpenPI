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
import {
	defaultWorkspace,
	deleteMemory,
	listMemory,
	listArchivedMemory,
	restoreArchivedMemory,
	maintainMemory,
	memoryMeta,
	modelCatalog,
	providerStatus,
	readMemoryTopic,
	recentWorkspaces,
	workspaceSummary,
	writeMemory,
} from "./app-ops.ts";
import { bootstrapCredentials, listProviders } from "./bootstrap.ts";
import { agentDir, openpiDir, piCliMtimeMs, piRpcEntry, pidPath, socketPath, VERSION } from "./config.ts";
import { type Connection, startServer } from "./ipc/server.ts";
import {
	createVideo,
	generateImage,
	getVideo,
	mediaCapabilities,
} from "./media-ops.ts";
import {
	addExtension,
	capabilities,
	extractDocument,
	getProfile,
	installPackage,
	removeExtension,
	removePackage,
	saveProfile,
} from "./profile-ops.ts";
import {
	cancelRun,
	createTask,
	deleteTask,
	listTasks,
	readRunLog,
	runTaskNow,
	setTaskPaused,
	stepRuns,
	stopScheduler,
} from "./scheduler-ops.ts";
import { isDaemonLive } from "./ipc/client.ts";
import { MemoryEngine } from "./memory/memory-engine.ts";
import { Supervisor } from "./supervisor.ts";

const startedAt = Date.now();

/**
 * Kill a daemon that left its socket behind but stopped answering. Only
 * processes whose command line matches this daemon's entry are touched.
 */
function reapStaleDaemon(): void {
	if (process.platform !== "win32") {
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
		if (existsSync(path)) {
			try {
				unlinkSync(path);
			} catch {}
		}
	}
}

async function handleApp(op: AppOp, supervisor: Supervisor): Promise<unknown> {
	switch (op.name) {
		case "list_models":
			return { models: modelCatalog() };
		case "auth_status":
			return { providers: providerStatus() };
		case "import_global_credentials":
			return bootstrapCredentials({ force: true });
		case "default_workspace":
			return { cwd: defaultWorkspace() };
		case "recent_workspaces":
			return { cwds: recentWorkspaces(supervisor.list().map((session) => session.cwd)) };
		case "workspace_summary":
			return workspaceSummary(op.cwd);
		case "list_memory":
			return { entries: listMemory(op.cwd, op.scope ?? "project") };
		case "read_memory_topic":
			return { body: readMemoryTopic(op.cwd, op.scope ?? "project", op.type, op.key) };
		case "write_memory":
			return {
				entries: writeMemory(op.cwd, op.scope ?? "project", {
					type: op.type,
					key: op.key,
					value: op.value,
					body: op.body,
				}),
			};
		case "delete_memory":
			return { entries: deleteMemory(op.cwd, op.scope ?? "project", op.type, op.key) };
		case "maintain_memory":
			return maintainMemory(op.cwd);
		case "list_archived_memory":
			return { entries: listArchivedMemory(op.cwd, op.scope ?? "project") };
		case "restore_archived_memory":
			return {
				entries: restoreArchivedMemory(op.cwd, op.scope ?? "project", op.entry),
			};
		case "memory_meta":
			return memoryMeta(op.cwd);
		case "get_memory_hub":
			return MemoryEngine.get().getMemoryHub(op.cwd);
		case "save_memory_handbook":
			return { ok: MemoryEngine.get().saveHandbook(op.content, op.cwd) };
		case "trigger_memory_consolidation":
			MemoryEngine.get().triggerConsolidation(op.force ?? true);
			return { ok: true };

		case "list_tasks":
			return { tasks: listTasks() };
		case "create_task":
			return createTask(op.input as Parameters<typeof createTask>[0]);
		case "set_task_paused":
			return setTaskPaused(op.taskId, op.paused) ?? null;
		case "delete_task":
			return { deleted: deleteTask(op.taskId) };
		case "run_task":
			return runTaskNow(op.taskId);
		case "cancel_run":
			return cancelRun(op.runId) ?? null;
		case "step_runs":
			return { stepRuns: stepRuns(op.runId) };
		case "read_run_log":
			return readRunLog(op.runId, op.stream);

		case "get_profile":
			return getProfile();
		case "save_profile":
			return saveProfile(op.profile);
		case "capabilities":
			return capabilities();
		case "add_extension":
			return addExtension(op.path);
		case "remove_extension":
			return removeExtension(op.path);
		case "install_package":
			return installPackage(op.source);
		case "remove_package":
			return removePackage(op.source);
		case "extract_document":
			return extractDocument(op.fileName, op.dataBase64);

		case "media_capabilities":
			return mediaCapabilities();
		case "generate_image":
			return generateImage(op.input);
		case "create_video":
			return createVideo(op.input);
		case "get_video":
			return getVideo(op.id);

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

	const supervisor = new Supervisor({ enableWarmPool: true });
	supervisor.scheduleWarmRefill(defaultWorkspace(), "code");
	let server: Server | undefined;
	let shuttingDown = false;

	const shutdown = (reason: string) => {
		if (shuttingDown) return;
		shuttingDown = true;
		process.stderr.write(`[daemon] shutting down (${reason})\n`);
		MemoryEngine.get().stop();
		supervisor.stopAll();
		stopScheduler();
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
					eager: (request as any).eager,
				});
			case "stop_session":
				supervisor.stop(request.sessionId);
				return { ok: true };
			case "delete_session":
				supervisor.delete(request.sessionId);
				return { ok: true };
			case "rename_session":
				return supervisor.rename(request.sessionId, request.name);
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
				return handleApp(request.op, supervisor);
			default: {
				const exhaustive: never = request;
				throw new Error(`unknown request: ${JSON.stringify(exhaustive)}`);
			}
		}
	});

	MemoryEngine.get().start();
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
