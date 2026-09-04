/**
 * IPC handlers.
 *
 * Every one is either a forward to the daemon or an Electron capability that has
 * no other home (a native dialog, opening a URL). No business logic lives here —
 * that discipline is what the old `bridge.mjs` lost, growing to 1,326 lines of
 * workspace scanning, provider calls and memory I/O sealed inside the asar.
 *
 * If a handler here needs more than a translation from arguments to a daemon
 * request, the logic belongs in the daemon instead.
 */

import { type BrowserWindow, dialog, type IpcMain, shell } from "electron";
import type {
	AppOp,
	ClientRequestInput,
	CreateTaskInput,
	MemoryScope,
	PiRpcCommand,
	SessionMode,
} from "@openpi/shared";
import { INVOKE_CHANNELS, eventChannelName, invokeChannelName, type InvokeChannel } from "./channels.ts";
import { currentClient, ensureDaemon, onRestartDeferred, restartDaemon, restartIfStale } from "./daemon.ts";

type Args = Record<string, unknown>;

const asString = (args: Args, key: string): string => {
	const value = args[key];
	if (typeof value !== "string" || value.length === 0) throw new Error(`${key} is required`);
	return value;
};

const asScope = (args: Args): MemoryScope => (args.scope === "global" ? "global" : "project");

export function registerHandlers(ipcMain: IpcMain, getWindow: () => BrowserWindow | undefined): void {
	const send = (channel: "session_event" | "daemon_status" | "refresh_data", payload: unknown) => {
		const window = getWindow();
		if (window && !window.isDestroyed()) window.webContents.send(eventChannelName(channel), payload);
	};

	onRestartDeferred(() => send("daemon_status", { kind: "restart_deferred" }));

	/** Forward to the daemon, connecting on first use. */
	const forward = async (request: ClientRequestInput): Promise<unknown> => {
		const client = await ensureDaemon();
		return client.request(request);
	};

	const app = (op: AppOp) => forward({ type: "app", op });

	const handlers: Record<InvokeChannel, (args: Args) => Promise<unknown>> = {
		daemon_health: () => forward({ type: "health" }),
		daemon_start: async () => {
			await ensureDaemon();
			return { ok: true };
		},
		daemon_restart: async () => {
			await restartDaemon();
			return { ok: true };
		},

		list_sessions: () => forward({ type: "list_sessions" }),
		create_session: (args) =>
			forward({
				type: "create_session",
				cwd: asString(args, "cwd"),
				mode: args.mode === "code" ? ("code" as SessionMode) : ("chat" as SessionMode),
				model: typeof args.model === "string" ? args.model : undefined,
				name: typeof args.name === "string" ? args.name : undefined,
			}),
		stop_session: (args) => forward({ type: "stop_session", sessionId: asString(args, "sessionId") }),
		delete_session: (args) => forward({ type: "delete_session", sessionId: asString(args, "sessionId") }),
		subscribe_session: async (args) => {
			// Subscribing wires the daemon's pushed events to this window. One
			// handler per connection: the daemon already fans out to subscribers.
			const client = await ensureDaemon();
			if (!subscribed) {
				client.onEvent((sessionId, event) => send("session_event", { sessionId, event }));
				subscribed = true;
			}
			return client.request({ type: "subscribe", sessionId: asString(args, "sessionId") });
		},
		unsubscribe_session: (args) => forward({ type: "unsubscribe", sessionId: asString(args, "sessionId") }),
		session_rpc: (args) =>
			forward({
				type: "rpc",
				sessionId: asString(args, "sessionId"),
				command: (args.command ?? {}) as PiRpcCommand,
			}),

		auth_status: () => app({ name: "auth_status" }),
		list_models: () => app({ name: "list_models" }),
		import_credentials: () => app({ name: "import_global_credentials" }),
		default_workspace: () => app({ name: "default_workspace" }),
		recent_workspaces: () => app({ name: "recent_workspaces" }),
		workspace_summary: (args) => app({ name: "workspace_summary", cwd: asString(args, "cwd") }),
		list_memory: (args) => app({ name: "list_memory", cwd: asString(args, "cwd"), scope: asScope(args) }),
		read_memory_topic: (args) =>
			app({
				name: "read_memory_topic",
				cwd: asString(args, "cwd"),
				scope: asScope(args),
				type: asString(args, "type"),
				key: asString(args, "key"),
			}),
		write_memory: (args) =>
			app({
				name: "write_memory",
				cwd: asString(args, "cwd"),
				scope: asScope(args),
				type: asString(args, "type"),
				key: asString(args, "key"),
				value: asString(args, "value"),
				body: typeof args.body === "string" ? args.body : undefined,
			}),
		delete_memory: (args) =>
			app({
				name: "delete_memory",
				cwd: asString(args, "cwd"),
				scope: asScope(args),
				type: asString(args, "type"),
				key: asString(args, "key"),
			}),

		list_tasks: () => app({ name: "list_tasks" }),
		create_task: (args) => app({ name: "create_task", input: args.input as CreateTaskInput }),
		set_task_paused: (args) =>
			app({ name: "set_task_paused", taskId: asString(args, "taskId"), paused: args.paused === true }),
		delete_task: (args) => app({ name: "delete_task", taskId: asString(args, "taskId") }),
		run_task: (args) => app({ name: "run_task", taskId: asString(args, "taskId") }),
		cancel_run: (args) => app({ name: "cancel_run", runId: asString(args, "runId") }),
		step_runs: (args) => app({ name: "step_runs", runId: asString(args, "runId") }),
		read_run_log: (args) =>
			app({
				name: "read_run_log",
				runId: asString(args, "runId"),
				stream: args.stream === "stderr" ? "stderr" : "stdout",
			}),

		// Electron-only capabilities.
		select_workspace: async (args) => {
			const window = getWindow();
			const result = await dialog.showOpenDialog(window ?? undefined!, {
				properties: ["openDirectory", "createDirectory"],
				defaultPath: typeof args.defaultPath === "string" ? args.defaultPath : undefined,
			});
			return { cwd: result.canceled ? undefined : result.filePaths[0] };
		},
		open_external: async (args) => {
			const url = asString(args, "url");
			// Only http(s): a file:// or custom-scheme URL from page content would
			// hand arbitrary local execution to whatever rendered it.
			if (!/^https?:\/\//i.test(url)) throw new Error("only http(s) URLs can be opened");
			await shell.openExternal(url);
			return { ok: true };
		},
		show_item_in_folder: async (args) => {
			shell.showItemInFolder(asString(args, "path"));
			return { ok: true };
		},
	};

	let subscribed = false;

	for (const channel of INVOKE_CHANNELS) {
		ipcMain.handle(invokeChannelName(channel), async (_event, args: Args = {}) => {
			return handlers[channel](args ?? {});
		});
	}

	// Pick up a rebuilt backend on launch, without disturbing a live session.
	void restartIfStale().catch(() => undefined);
}

export function notifyRefresh(getWindow: () => BrowserWindow | undefined): void {
	const window = getWindow();
	if (window && !window.isDestroyed()) window.webContents.send(eventChannelName("refresh_data"), {});
}

export function daemonConnected(): boolean {
	return currentClient() !== undefined;
}
