/**
 * Renderer-side client for the main process.
 *
 * Every call goes through the preload allowlist, so a typo here fails fast with
 * "Blocked IPC channel" rather than silently doing nothing.
 *
 * `api.rpc()` forwards an upstream pi RPC command verbatim (see coding-agent
 * docs/rpc.md). Extension data written with `pi.appendEntry` comes back through
 * `get_entries` — that is why none of the old fork's twelve custom RPC commands
 * are needed here.
 */

import type {
	Capabilities,
	CreateVideoInput,
	GenerateImageInput,
	GenerateImageResult,
	MediaCapabilities,
	SaveMediaInput,
	VideoStatusResult,
	CreateTaskInput,
	DocumentText,
	HealthInfo,
	MemoryEntry,
	MemoryScope,
	ModelOption,
	PiRpcCommand,
	PiRpcEvent,
	ProviderStatus,
	SessionInfo,
	SessionMode,
	TaskRunSummary,
	TaskSummary,
	TaskWithRuns,
	UserProfile,
	WorkspaceSummary,
} from "@openpi/shared";

interface Bridge {
	isNative: boolean;
	invoke(channel: string, args?: unknown): Promise<unknown>;
	on(channel: string, handler: (payload: unknown) => void): () => void;
}

function bridge(): Bridge {
	const found = (globalThis as { openpi?: Bridge }).openpi;
	if (!found) throw new Error("OpenPI bridge unavailable — run inside Electron, not a plain browser tab.");
	return found;
}

export const isNative = Boolean((globalThis as { openpi?: Bridge }).openpi?.isNative);

async function invoke<T>(channel: string, args?: unknown): Promise<T> {
	return (await bridge().invoke(channel, args)) as T;
}

export interface SessionEventPayload {
	sessionId: string;
	event: PiRpcEvent;
}

export type DaemonStatus = { kind: "restart_deferred" };

export const api = {
	isNative,

	// daemon
	health: () => invoke<HealthInfo>("daemon_health"),
	startDaemon: () => invoke<{ ok: true }>("daemon_start"),
	restartDaemon: () => invoke<{ ok: true }>("daemon_restart"),

	// sessions
	listSessions: () => invoke<{ sessions: SessionInfo[] }>("list_sessions"),
	createSession: (input: { cwd: string; mode?: SessionMode; model?: string; name?: string }) =>
		invoke<SessionInfo>("create_session", input),
	stopSession: (sessionId: string) => invoke<{ ok: true }>("stop_session", { sessionId }),
	deleteSession: (sessionId: string) => invoke<{ ok: true }>("delete_session", { sessionId }),
	subscribe: (sessionId: string) => invoke<{ subscribed: string }>("subscribe_session", { sessionId }),
	unsubscribe: (sessionId: string) => invoke<{ ok: true }>("unsubscribe_session", { sessionId }),

	/** Forward an upstream RPC command to a session. */
	rpc: <T = unknown>(sessionId: string, command: PiRpcCommand) =>
		invoke<T>("session_rpc", { sessionId, command }),

	renameSession: (sessionId: string, name: string) =>
		invoke<SessionInfo>("rename_session", { sessionId, name }),

	// app-level
	authStatus: () => invoke<{ providers: ProviderStatus[] }>("auth_status"),
	listModels: () => invoke<{ models: ModelOption[] }>("list_models"),
	importCredentials: () => invoke<{ imported: string[]; providers: string[] }>("import_credentials"),
	defaultWorkspace: () => invoke<{ cwd: string }>("default_workspace"),
	recentWorkspaces: () => invoke<{ cwds: string[] }>("recent_workspaces"),
	workspaceSummary: (cwd: string) => invoke<WorkspaceSummary>("workspace_summary", { cwd }),

	listMemory: (cwd: string, scope: MemoryScope = "project") =>
		invoke<{ entries: MemoryEntry[] }>("list_memory", { cwd, scope }),
	readMemoryTopic: (cwd: string, type: string, key: string, scope: MemoryScope = "project") =>
		invoke<{ body: string }>("read_memory_topic", { cwd, type, key, scope }),
	writeMemory: (
		cwd: string,
		entry: { type: string; key: string; value: string; body?: string },
		scope: MemoryScope = "project",
	) => invoke<{ entries: MemoryEntry[] }>("write_memory", { cwd, scope, ...entry }),
	deleteMemory: (cwd: string, type: string, key: string, scope: MemoryScope = "project") =>
		invoke<{ entries: MemoryEntry[] }>("delete_memory", { cwd, type, key, scope }),

	// profile, capabilities, documents
	getProfile: () => invoke<UserProfile>("get_profile"),
	saveProfile: (profile: UserProfile) => invoke<UserProfile>("save_profile", { profile }),
	capabilities: () => invoke<Capabilities>("capabilities"),
	addExtension: (path: string) => invoke<Capabilities>("add_extension", { path }),
	removeExtension: (path: string) => invoke<Capabilities>("remove_extension", { path }),
	installPackage: (source: string) => invoke<Capabilities>("install_package", { source }),
	removePackage: (source: string) => invoke<Capabilities>("remove_package", { source }),
	extractDocument: (fileName: string, dataBase64: string) =>
		invoke<DocumentText>("extract_document", { fileName, dataBase64 }),

	// scheduled tasks
	listTasks: () => invoke<{ tasks: TaskWithRuns[] }>("list_tasks"),
	createTask: (input: CreateTaskInput) => invoke<TaskSummary>("create_task", { input }),
	setTaskPaused: (taskId: string, paused: boolean) =>
		invoke<TaskSummary | null>("set_task_paused", { taskId, paused }),
	deleteTask: (taskId: string) => invoke<{ deleted: boolean }>("delete_task", { taskId }),
	runTask: (taskId: string) => invoke<TaskRunSummary>("run_task", { taskId }),
	cancelRun: (runId: string) => invoke<TaskRunSummary | null>("cancel_run", { runId }),
	stepRuns: (runId: string) => invoke<{ stepRuns: unknown[] }>("step_runs", { runId }),
	readRunLog: (runId: string, stream: "stdout" | "stderr" = "stdout") =>
		invoke<{ text: string; truncated: boolean }>("read_run_log", { runId, stream }),

	// media generation
	mediaCapabilities: () => invoke<MediaCapabilities>("media_capabilities"),
	generateImage: (input: GenerateImageInput) => invoke<GenerateImageResult>("generate_image", { input }),
	createVideo: (input: CreateVideoInput) => invoke<VideoStatusResult>("create_video", { input }),
	getVideo: (id: string) => invoke<VideoStatusResult>("get_video", { id }),
	saveMedia: (input: SaveMediaInput) => invoke<{ filePath?: string }>("save_media", input),

	// native
	selectWorkspace: (defaultPath?: string) => invoke<{ cwd?: string }>("select_workspace", { defaultPath }),
	openExternal: (url: string) => invoke<{ ok: true }>("open_external", { url }),
	showInFolder: (path: string) => invoke<{ ok: true }>("show_item_in_folder", { path }),

	// pushed events
	onSessionEvent: (handler: (payload: SessionEventPayload) => void) =>
		bridge().on("session_event", (payload) => handler(payload as SessionEventPayload)),
	onDaemonStatus: (handler: (status: DaemonStatus) => void) =>
		bridge().on("daemon_status", (payload) => handler(payload as DaemonStatus)),
	onRefresh: (handler: () => void) => bridge().on("refresh_data", () => handler()),
};
