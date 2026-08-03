import type { SpeechInputEvent } from "./lib/speech-recognition";
import type {
	AgentInstance,
	AgnesImageRequest,
	AgnesImageResult,
	AgnesMediaCapabilities,
	AgnesVideoRequest,
	AgnesVideoResult,
	ConversationCapabilities,
	ConversationModelOption,
	ConversationSnapshot,
	ConversationState,
	ConversationStats,
	ConversationUiResponse,
	CreateConversationInput,
	CreateTaskInput,
	DesktopSnapshot,
	ImageContent,
	MediaSaveInput,
	ModelProviderConfig,
	TaskDefinition,
	TaskRun,
	ThinkingLevel,
} from "./types";

type OpenPiBridge = {
	isNative: boolean;
	invoke: (channel: string, args?: unknown) => Promise<unknown>;
	onConversationEvent: (handler: (payload: { instanceId: string; event: unknown }) => void) => () => void;
	onRefreshData: (handler: () => void) => () => void;
	onSpeechEvent: (handler: (event: SpeechInputEvent) => void) => () => void;
};

function bridge(): OpenPiBridge | undefined {
	return (window as unknown as { openpi?: OpenPiBridge }).openpi;
}

const isNative = Boolean(bridge()?.isNative);

async function call<T>(channel: string, args?: unknown): Promise<T> {
	const api = bridge();
	if (!api) throw new Error("OpenPI desktop bridge unavailable. Launch with Electron.");
	return (await api.invoke(channel, args)) as T;
}

export const desktopApi = {
	isNative,
	getSnapshot: (opts?: { includeStopped?: boolean }) =>
		call<DesktopSnapshot>("get_snapshot", { includeStopped: Boolean(opts?.includeStopped) }),
	getConversation: (instanceId: string) => call<ConversationSnapshot>("get_conversation", { instanceId }),
	getConversationStats: (instanceId: string) => call<ConversationStats>("get_conversation_stats", { instanceId }),
	getProviderBalance: (provider: string) =>
		call<{ currency: string; totalBalance: number } | null>("get_provider_balance", { provider }),
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
	sendMessage: (instanceId: string, message: string, images: ImageContent[], sessionName?: string) =>
		call<boolean>("send_message", { instanceId, message, images, sessionName }),
	abortConversation: (instanceId: string) => call<boolean>("abort_conversation", { instanceId }),
	renameConversation: (instanceId: string, name: string) =>
		call<AgentInstance>("rename_conversation", { instanceId, name }),
	deleteConversation: (instanceId: string) => call<boolean>("delete_conversation", { instanceId }),
	watchConversation: (instanceId: string) => call<boolean>("watch_conversation_stream", { instanceId }),
	stopWatchingConversation: (instanceId: string) => call<boolean>("stop_conversation_stream", { instanceId }),
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
	listSecurityAudit: (cwd: string) => call<string[]>("list_security_audit", { cwd }),
	getSecurityMode: () => call<string>("get_security_mode"),
	listIntelligenceRuns: (cwd: string) => call<string[]>("list_intelligence_runs", { cwd }),
	readIntelligenceRun: (cwd: string, runId: string) => call<string>("read_intelligence_run", { cwd, runId }),
	writeSecurityMode: (mode: string) => call<boolean>("write_security_mode", { mode }),
	stopInstance: (instanceId: string) => call<boolean>("stop_instance", { instanceId }),
	getConversationCommands: (instanceId: string) => call<string[]>("get_conversation_commands", { instanceId }),
	setupStatus: () => call<{ enabled: boolean; agentDir: string; workspace: string; repoRoot: string }>("setup_status"),
	runSetup: () => call<{ ok: boolean }>("run_setup"),
	doctor: () => call<{ ok: boolean; output: string }>("doctor"),
	defaultWorkspace: () => call<string>("default_workspace"),
	getModelProviders: () => call<Record<string, ModelProviderConfig>>("get_model_providers"),
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
	getMediaCapabilities: () => call<AgnesMediaCapabilities>("get_media_capabilities"),
	generateImage: (input: AgnesImageRequest) => call<AgnesImageResult>("generate_image", input),
	createVideo: (input: AgnesVideoRequest) => call<AgnesVideoResult>("create_video", input),
	getVideo: (videoId: string) => call<AgnesVideoResult>("get_video", { videoId }),
	saveMedia: (input: MediaSaveInput) => call<string | undefined>("save_media", input),
	startSpeechRecognition: (sessionId: string, language: string) =>
		call<boolean>("start_speech_recognition", { sessionId, language }),
	stopSpeechRecognition: (sessionId: string) => call<boolean>("stop_speech_recognition", { sessionId }),
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
};
