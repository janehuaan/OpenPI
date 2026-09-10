import type { SpeechInputEvent } from "./lib/speech-recognition";
import type { AppSettings } from "./lib/app-types";
import type {
	AgentInstance,
	AgnesImageRequest,
	AgnesImageResult,
	AgnesMediaCapabilities,
	AgnesVideoRequest,
	AgnesVideoResult,
	ArchivedMemoryEntry,
	AvailableModel,
	ConversationCapabilities,
	ConversationModelOption,
	ConversationSnapshot,
	ConversationState,
	ConversationStats,
	ConversationUiResponse,
	CreateConversationInput,
	CreateTaskInput,
	DesktopSnapshot,
	DocumentTextExtractionInput,
	DocumentTextExtractionResult,
	GitBranch,
	GitFileChange,
	GitFileStatus,
	GitStatusResult,
	ImageContent,
	MediaSaveInput,
	ModelProbeResult,
	ModelProviderConfig,
	PortProcessInfo,
	ProviderPingResult,
	StatusSegment,
	SystemTelemetryData,
	TaskDefinition,
	TaskRun,
	ThinkingLevel,
	TodoState,
	VisionFallbackConfig,
	VisionFallbackModel,
	WorkspaceFileContent,
	WorkspaceSummary,
} from "./types";

export type DaemonStatus = "connected" | "reconnecting" | "disconnected";

type OpenPiBridge = {
	isNative: boolean;
	invoke: (channel: string, args?: unknown) => Promise<unknown>;
	onConversationEvent: (handler: (payload: { instanceId: string; event: unknown }) => void) => () => void;
	onRefreshData: (handler: () => void) => () => void;
	onSpeechEvent: (handler: (event: SpeechInputEvent) => void) => () => void;
	onDaemonRestartDeferred: (handler: () => void) => () => void;
	onDaemonStatus?: (handler: (status: DaemonStatus) => void) => () => void;
	onNavigate?: (handler: (view: string, extra?: unknown) => void) => () => void;
	onNewConversation?: (handler: () => void) => () => void;
	onComposerPrefill?: (handler: (draft: { text: string; images?: string[] }) => void) => () => void;
};

function bridge(): OpenPiBridge | undefined {
	if (typeof window === "undefined") return undefined;
	return (window as unknown as { openpi?: OpenPiBridge }).openpi;
}

const isNative = Boolean(bridge()?.isNative);

const NON_RETRYABLE_CHANNELS = new Set([
	"send_message",
	"steer_conversation",
	"follow_up_conversation",
	"delete_conversation",
	"delete_task",
	"create_conversation",
]);

async function call<T>(channel: string, args?: unknown, maxRetries = 4): Promise<T> {
	const api = bridge();
	if (!api) throw new Error("OpenPI desktop bridge unavailable. Launch with Electron.");

	let delay = 350;
	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			return (await api.invoke(channel, args)) as T;
		} catch (error: any) {
			const message = error?.message || String(error);
			const isDisconnectError =
				/daemon (connection closed|disconnected|unavailable)|not connected|timed out connecting/i.test(message);
			if (isDisconnectError && attempt < maxRetries && !NON_RETRYABLE_CHANNELS.has(channel)) {
				await new Promise((resolve) => setTimeout(resolve, delay));
				delay *= 2;
				continue;
			}
			throw error;
		}
	}
	throw new Error(`IPC call ${channel} failed after retries`);
}

export const desktopApi = {
	isNative,
	getSnapshot: (opts?: { includeStopped?: boolean }) =>
		call<DesktopSnapshot>("get_snapshot", { includeStopped: Boolean(opts?.includeStopped) }),
	getConversation: (instanceId: string) => call<ConversationSnapshot>("get_conversation", { instanceId }),
	getConversationStats: (instanceId: string) => call<ConversationStats>("get_conversation_stats", { instanceId }),
	getProviderBalance: (provider: string) =>
		call<{ currency: string; totalBalance: number } | null>("get_provider_balance", { provider }),
	getSessionTodo: (instanceId: string) => call<TodoState | null>("get_session_todo", { instanceId }),
	getStatusSegments: (instanceId: string) => call<StatusSegment[]>("get_status_segments", { instanceId }),
	getSessionEvents: (instanceId: string, limit = 20) => call<any[]>("get_session_events", { instanceId, limit }),
	getSessionTaskState: (instanceId: string) => call<any>("get_session_task_state", { instanceId }),
	getConversationModels: (instanceId: string) =>
		call<ConversationModelOption[]>("get_conversation_models", { instanceId }),
	getConversationCapabilities: (instanceId: string) =>
		call<ConversationCapabilities>("get_conversation_capabilities", { instanceId }),
	reloadConversationCapabilities: (instanceId: string) =>
		call<ConversationCapabilities>("reload_conversation_capabilities", { instanceId }),
	installConversationPackage: (instanceId: string, source: string, local = false) =>
		call<ConversationCapabilities>("install_conversation_package", { instanceId, source, local }),
	removeConversationPackage: (instanceId: string, source: string, local = false) =>
		call<ConversationCapabilities>("remove_conversation_package", { instanceId, source, local }),
	setConversationModel: (instanceId: string, provider: string, modelId: string) =>
		call<ConversationState>("set_conversation_model", { instanceId, provider, modelId }),
	setConversationThinkingLevel: (instanceId: string, level: ThinkingLevel) =>
		call<ConversationState>("set_conversation_thinking_level", { instanceId, level }),
	createConversation: (input: CreateConversationInput) =>
		call<AgentInstance>("create_conversation", { label: input.label, cwd: input.cwd, mode: input.mode }),
	selectWorkspace: (defaultPath?: string) => call<string | undefined>("select_workspace", { defaultPath }),
	getWorkspaceSummary: (cwd: string) => call<WorkspaceSummary>("get_workspace_summary", { cwd }),
	readWorkspaceFile: (cwd: string, path: string) => call<WorkspaceFileContent>("read_workspace_file", { cwd, path }),
	extractDocumentText: (input: DocumentTextExtractionInput) =>
		call<DocumentTextExtractionResult>("extract_document_text", input),
	sendMessage: (instanceId: string, message: string, images: ImageContent[], sessionName?: string) =>
		call<boolean>("send_message", { instanceId, message, images, sessionName }),
	steerConversation: (instanceId: string, message: string, images: ImageContent[] = []) =>
		call<boolean>("steer_conversation", { instanceId, message, images }),
	followUpConversation: (instanceId: string, message: string, images: ImageContent[] = []) =>
		call<boolean>("follow_up_conversation", { instanceId, message, images }),
	clearConversationQueue: (instanceId: string) =>
		call<{ steering: string[]; followUp: string[] }>("clear_conversation_queue", { instanceId }),
	abortConversation: (instanceId: string, reason?: string) => call<boolean>("abort_conversation", { instanceId, reason }),
	compactConversation: (instanceId: string, customInstructions?: string) =>
		call<unknown>("compact_conversation", { instanceId, customInstructions }),
	renameConversation: (instanceId: string, name: string) =>
		call<AgentInstance>("rename_conversation", { instanceId, name }),
	deleteConversation: (instanceId: string) => call<boolean>("delete_conversation", { instanceId }),
	watchConversation: (instanceId: string) => call<boolean>("watch_conversation_stream", { instanceId }),
	stopWatchingConversation: (instanceId: string) => call<boolean>("stop_conversation_stream", { instanceId }),
	stopConversationStream: (instanceId: string) => call<boolean>("stop_conversation_stream", { instanceId }),
	respondConversationUi: (instanceId: string, response: ConversationUiResponse) =>
		call<boolean>("respond_conversation_ui", { instanceId, response }),
	createTask: (input: CreateTaskInput) => call<TaskDefinition>("create_task", { input }),
	setTaskPaused: (taskId: string, paused: boolean) => call<TaskDefinition>("set_task_paused", { taskId, paused }),
	deleteTask: (taskId: string) => call<boolean>("delete_task", { taskId }),
	runTask: (taskId: string) => call<TaskRun>("run_task", { taskId }),
	cancelRun: (runId: string) => call<TaskRun>("cancel_run", { runId }),
	readRunLog: (runId: string, stream: "stdout" | "stderr") => call<string>("read_run_log", { runId, stream }),
	startDaemon: () => call<boolean>("start_daemon"),
	stopDaemon: () => call<boolean>("stop_daemon"),
	restartDaemon: () => call<boolean>("restart_daemon"),
	pruneStoppedInstances: () => call<{ deleted: number; total: number }>("prune_stopped_instances"),
	listMemoryIndex: (cwd: string, scope: "project" | "global" = "project") =>
		call<string[]>("list_memory_index", { cwd, scope }),
	writeMemoryEntry: (
		cwd: string,
		memoryType: string,
		key: string,
		value: string,
		body?: string,
		scope: "project" | "global" = "project",
	) => call<boolean>("write_memory_entry", { cwd, memoryType, key, value, body, scope }),
	deleteMemoryEntry: (cwd: string, memoryType: string, key: string, scope: "project" | "global" = "project") =>
		call<boolean>("delete_memory_entry", { cwd, memoryType, key, scope }),
	memoryMeta: (cwd: string) =>
		call<{
			meta: {
				lastMaintainAt?: string;
				sessionCountSinceMaintain?: number;
				lastLlmExtractAt?: string;
				lastIdleOrganizeAt?: string;
			};
			projectCount: number;
			globalCount: number;
			archiveCount?: number;
			digestCount?: number;
			latestDigest?: string | null;
			hasVectors?: boolean;
			hasLexicon?: boolean;
			features?: {
				proactiveInject?: boolean;
				softExtractEveryTurn?: boolean;
				autoSessionDigest?: boolean;
				promoteUserToGlobal?: boolean;
				searchArchive?: boolean;
			};
		}>("memory_meta", { cwd }),
	maintainMemory: (cwd: string) =>
		call<{
			project: { before: number; after: number; merged: number; pruned: number };
			global: { before: number; after: number; merged: number; pruned: number };
		}>("maintain_memory", { cwd }),
	listArchivedMemory: (cwd?: string, scope: "project" | "global" = "project") =>
		call<ArchivedMemoryEntry[]>("list_archived_memory", { cwd, scope }),
	restoreArchivedMemory: (cwd: string | undefined, scope: "project" | "global", entry: { type: string; key: string; value: string; body?: string }) =>
		call<any>("restore_archived_memory", { cwd, scope, entry }),
	getMemoryHub: (cwd?: string) =>
		call<{
			summary: string;
			handbook: string;
			rolloutSummaries: Array<{ slug: string; fileName: string; date: string; content: string }>;
			skills: Array<{ name: string; content: string }>;
			stats: { pending: number; running: number; completed: number; failed: number; unconsolidatedStage1: number };
			recentJobs: any[];
		}>("get_memory_hub", { cwd }),
	saveMemoryHandbook: (content: string, cwd?: string) =>
		call<{ ok: boolean }>("save_memory_handbook", { content, cwd }),
	triggerMemoryConsolidation: (force = true) =>
		call<{ ok: boolean }>("trigger_memory_consolidation", { force }),
	listIntelligenceRuns: (cwd: string) => call<string[]>("list_intelligence_runs", { cwd }),
	readIntelligenceRun: (cwd: string, runId: string) => call<string>("read_intelligence_run", { cwd, runId }),
	stopInstance: (instanceId: string) => call<boolean>("stop_instance", { instanceId }),
	getConversationCommands: (instanceId: string) => call<string[]>("get_conversation_commands", { instanceId }),
	setupStatus: () => call<{ enabled: boolean; agentDir: string; workspace: string; repoRoot: string }>("setup_status"),
	defaultWorkspace: () => call<string>("default_workspace"),
	getModelProviders: () => call<Record<string, ModelProviderConfig>>("get_model_providers"),
	getModelCatalog: (instanceId: string) => call<AvailableModel[]>("get_model_catalog", { instanceId }),
	getAvailableModels: (instanceId: string) => call<AvailableModel[]>("get_available_models", { instanceId }),
	getProviderAuthStatus: (instanceId: string) =>
		call<Array<{ provider: string; type?: string; source?: string; configured: boolean }>>(
			"get_provider_auth_status",
			{ instanceId },
		),
	providerLogin: (instanceId: string, provider: string, authType: "oauth" | "api_key") =>
		call<{ provider: string; type: string }>("provider_login", { instanceId, provider, authType }),
	providerLogout: (instanceId: string, provider: string) => call<boolean>("provider_logout", { instanceId, provider }),
	openExternal: (url: string) => call<boolean>("open_external", { url }),
	getUserProfile: () =>
		call<{ nickname?: string; avatar?: string; avatarEmoji?: string; synced?: boolean; updatedAt?: string }>(
			"get_user_profile",
		),
	saveUserProfile: (profile: { nickname?: string; avatar?: string; avatarEmoji?: string }) =>
		call<{ nickname?: string; avatar?: string; avatarEmoji?: string; synced?: boolean; updatedAt?: string }>(
			"save_user_profile",
			profile,
		),
	getVisionFallback: () => call<VisionFallbackConfig>("get_vision_fallback"),
	getVisionFallbackModels: () => call<VisionFallbackModel[]>("get_vision_fallback_models"),
	configureVisionFallback: async (input: { apiKey?: string; enabled: boolean; model?: string }) => {
		const result = await call<VisionFallbackConfig>("configure_vision_fallback", input);
		window.dispatchEvent(new Event("openpi:model-providers-changed"));
		return result;
	},
	saveModelProvider: async (providerId: string, config: ModelProviderConfig) => {
		const result = await call<boolean>("save_model_provider", { providerId, config });
		window.dispatchEvent(new Event("openpi:model-providers-changed"));
		return result;
	},
	deleteModelProvider: async (providerId: string) => {
		const result = await call<boolean>("delete_model_provider", { providerId });
		window.dispatchEvent(new Event("openpi:model-providers-changed"));
		return result;
	},
	fetchProviderRemoteModels: async (input: { providerId?: string; baseUrl?: string; apiKey?: string }) => {
		const result = await call<{ success: boolean; count: number; models: any[] }>("fetch_provider_remote_models", input);
		window.dispatchEvent(new Event("openpi:model-providers-changed"));
		return result;
	},
	pingModelProvider: (params: { providerId?: string; baseUrl: string; apiKey?: string }) =>
		call<ProviderPingResult>("ping_model_provider", params),
	probeModelCapabilities: (params: { providerId?: string; modelId: string; baseUrl?: string; apiKey?: string }) =>
		call<ModelProbeResult>("probe_model_capabilities", params),
	batchProbeProviderModels: (params: { providerId: string; modelIds?: string[]; baseUrl?: string; apiKey?: string }) =>
		call<{ results: ModelProbeResult[]; count: number }>("batch_probe_provider_models", params),
	getMediaCapabilities: () => call<AgnesMediaCapabilities>("get_media_capabilities"),
	generateImage: (input: AgnesImageRequest) => call<AgnesImageResult>("generate_image", input),
	createVideo: (input: AgnesVideoRequest) => call<AgnesVideoResult>("create_video", input),
	getVideo: (videoId: string) => call<AgnesVideoResult>("get_video", { videoId }),
	saveMedia: (input: MediaSaveInput) => call<string | undefined>("save_media", input),
	startSpeechRecognition: (sessionId: string, language: string) =>
		call<boolean>("start_speech_recognition", { sessionId, language }),
	stopSpeechRecognition: (sessionId: string) => call<boolean>("stop_speech_recognition", { sessionId }),
	notifyTaskCompleted: (opts?: { message?: string; title?: string; durationMs?: number; force?: boolean }) =>
		call<boolean>("notify_task_completed", opts),
	getAppSettings: () => call<AppSettings>("get_app_settings"),
	updateAppSettings: async (patch: Partial<AppSettings>) => {
		const result = await call<AppSettings>("update_app_settings", patch);
		window.dispatchEvent(new Event("openpi:app-settings-changed"));
		return result;
	},
	// Git operations
	getGitStatus: (cwd?: string) => call<GitStatusResult>("git_status", { cwd }),
	getGitDiff: (opts?: { cwd?: string; path?: string; staged?: boolean }) =>
		call<{ diff: string; error?: string }>("git_diff", opts),
	gitStage: (opts?: { cwd?: string; paths?: string[]; all?: boolean }) =>
		call<{ ok: boolean; error?: string }>("git_stage", opts),
	gitUnstage: (opts?: { cwd?: string; paths?: string[]; all?: boolean }) =>
		call<{ ok: boolean; error?: string }>("git_unstage", opts),
	gitDiscard: (opts: { cwd?: string; paths: string[] }) =>
		call<{ ok: boolean; error?: string }>("git_discard", opts),
	gitCommit: (opts: { cwd?: string; message: string; stageAll?: boolean }) =>
		call<{ ok: boolean; output?: string; error?: string }>("git_commit", opts),
	getGitBranches: (cwd?: string) =>
		call<{ current: string; branches: GitBranch[]; error?: string }>("git_branches", { cwd }),
	gitCheckout: (opts: { cwd?: string; branch: string; create?: boolean }) =>
		call<{ ok: boolean; currentBranch?: string; error?: string }>("git_checkout", opts),
	gitSync: (opts: { cwd?: string; action: "pull" | "push" | "sync" }) =>
		call<{ ok: boolean; output?: string; error?: string }>("git_sync", opts),
	gitInit: (cwd?: string) =>
		call<{ ok: boolean; output?: string; error?: string }>("git_init", { cwd }),
	gitResolveConflict: (opts: { cwd?: string; path: string; strategy: "ours" | "theirs" }) =>
		call<{ ok: boolean; status?: GitStatusResult; error?: string }>("git_resolve_conflict", opts),
	applyDiffHunks: (opts: { cwd?: string; filename: string; hunks: any[] }) =>
		call<{ success: boolean; appliedCount?: number; error?: string }>("apply_diff_hunks", opts),

	// ── System Operations ───────────────────────────────────────────────
	getSystemTelemetry: () =>
		call<SystemTelemetryData>("system_get_telemetry"),
	listListeningPorts: (port?: number) =>
		call<PortProcessInfo[]>("system_list_ports", { port }),
	killPort: (port: number) =>
		call<{ success: boolean; killed: number[] }>("system_kill_port", { port }),
	captureScreen: (opts?: { target?: "fullscreen" | "window"; savePath?: string }) =>
		call<{ path: string; dataUrl?: string }>("system_capture_screen", opts),
	getActiveApp: () =>
		call<{ name: string; title: string; url?: string }>("system_get_active_app"),
	runAppleScript: (script: string) =>
		call<{ ok: boolean; output?: string; error?: string }>("system_run_applescript", { script }),
	manageClipboard: (opts: { action: "read" | "write"; text?: string }) =>
		call<{ text?: string; hasImage?: boolean; ok?: boolean; length?: number }>("system_manage_clipboard", opts),
	toggleHud: () =>
		call<boolean>("toggle_hud_window"),

	// ── Codebase Symbol Graph ──────────────────────────────────────────
	searchCodeSymbols: (opts: { cwd?: string; query: string; kind?: string; limit?: number }) =>
		call<{ symbols: any[]; totalCount: number; totalIndexed: number; filesIndexed: number }>(
			"search_code_symbols",
			opts,
		),
	getCodeSymbolReferences: (opts: { cwd?: string; symbol: string }) =>
		call<{ symbol: string; references: Array<{ filePath: string; line: number; lineContent: string }>; count: number }>(
			"get_symbol_references",
			opts,
		),

	onConversationEvent: (handler: (payload: { instanceId: string; event: unknown }) => void) => {
		const api = bridge();
		if (!api) return () => undefined;
		return api.onConversationEvent(handler);
	},
	onRefreshData: (handler: () => void) => {
		const api = bridge();
		if (!api) return () => undefined;
		return api.onRefreshData(handler);
	},
	onSpeechEvent: (handler: (event: SpeechInputEvent) => void) => {
		const api = bridge();
		if (!api) return () => undefined;
		return api.onSpeechEvent(handler);
	},
	onDaemonRestartDeferred: (handler: () => void) => {
		const api = bridge();
		if (!api) return () => undefined;
		return api.onDaemonRestartDeferred(handler);
	},
	onDaemonStatus: (handler: (status: DaemonStatus) => void) => {
		const api = bridge();
		if (!api?.onDaemonStatus) return () => undefined;
		return api.onDaemonStatus(handler);
	},
	onNavigate: (handler: (view: string, extra?: unknown) => void) => {
		const api = bridge();
		if (!api?.onNavigate) return () => undefined;
		return api.onNavigate(handler);
	},
	onNewConversation: (handler: () => void) => {
		const api = bridge();
		if (!api?.onNewConversation) return () => undefined;
		return api.onNewConversation(handler);
	},
	onComposerPrefill: (handler: (draft: { text: string; images?: string[] }) => void) => {
		const api = bridge();
		if (!api?.onComposerPrefill) return () => undefined;
		return api.onComposerPrefill(handler);
	},
};
