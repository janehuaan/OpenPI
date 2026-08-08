export type TaskStatus = "active" | "paused";
export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "interrupted";
export type InstanceStatus = "starting" | "online" | "stopping" | "stopped" | "error";
export type AgentMode = "work" | "code";
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export type TaskSchedule = { kind: "once"; runAt: string } | { kind: "cron"; expression: string; timezone?: string };

export interface TaskDefinition {
	id: string;
	title: string;
	prompt: string;
	cwd?: string;
	schedule: TaskSchedule;
	status: TaskStatus;
	createdAt: string;
	updatedAt: string;
	nextRunAt?: string;
}

export interface TaskRun {
	id: string;
	taskId: string;
	status: RunStatus;
	trigger: "manual" | "scheduled";
	createdAt: string;
	startedAt?: string;
	finishedAt?: string;
	pid?: number;
	exitCode?: number;
	result?: string;
	error?: string;
	stdoutPath?: string;
	stderrPath?: string;
}

export interface DaemonHealth {
	version?: string;
	uptimeMs?: number;
	socketPath?: string;
	sessionsIndexed?: boolean;
	tasksActive?: number;
	tasksPaused?: number;
	runsRunning?: number;
	runsQueued?: number;
}

export interface InstanceStats {
	total: number;
	active: number;
	stopped: number;
	shown: number;
	includeStopped: boolean;
}

export interface DesktopSnapshot {
	daemonRunning: boolean;
	instances: AgentInstance[];
	instanceStats?: InstanceStats;
	tasks: TaskDefinition[];
	runs: TaskRun[];
	health?: DaemonHealth;
}

export interface CreateTaskInput {
	title: string;
	prompt: string;
	cwd?: string;
	schedule: TaskSchedule;
}

export interface AgentInstance {
	id: string;
	status: InstanceStatus;
	mode: AgentMode;
	cwd: string;
	label?: string;
	sessionId?: string;
	sessionFile?: string;
	radiusPiId?: string;
}

export interface WorkspaceSummary {
	fileCount: number;
	files: string[];
	truncated: boolean;
}

export interface WorkspaceFileContent {
	path: string;
	text: string;
}

export interface DocumentTextExtractionInput {
	name: string;
	mimeType: string;
	data: string;
}

export interface DocumentTextExtractionResult {
	text: string;
}

export interface RunningTool {
	toolCallId: string;
	toolName: string;
	args?: unknown;
}

export interface ConversationMessage {
	role: string;
	content: unknown;
	timestamp?: number;
	toolName?: string;
	isError?: boolean;
	errorMessage?: string;
	usage?: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		cost?: { total: number };
	};
}

export interface ConversationStats {
	sessionFile?: string;
	sessionId: string;
	userMessages: number;
	assistantMessages: number;
	toolCalls: number;
	toolResults: number;
	totalMessages: number;
	tokens: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		total: number;
	};
	cost: number;
	contextUsage?: {
		tokens: number;
		contextWindow: number;
		percent: number;
	};
	compaction?: {
		reserveTokens: number;
		keepRecentTokens: number;
	};
}

export type TodoStatus = "pending" | "in_progress" | "completed";

export interface TodoEvidence {
	kind: "verification" | "review" | "diff" | "files" | "manual";
	summary: string;
	command?: string;
	paths?: string[];
}

export interface TodoItem {
	content: string;
	status: TodoStatus;
	activeForm?: string;
	level?: 0 | 1;
	result?: string;
	evidence?: TodoEvidence[];
}

export interface TodoState {
	updatedAt: string;
	sessionId?: string;
	todos: TodoItem[];
}

export interface ImageContent {
	type: "image";
	data: string;
	mimeType: string;
}

export interface ConversationState {
	model?: {
		provider?: string;
		id?: string;
		name?: string;
		contextWindow?: number;
		reasoning?: boolean;
	};
	thinkingLevel: ThinkingLevel;
	isStreaming: boolean;
	isCompacting: boolean;
	sessionId: string;
	sessionName?: string;
	messageCount: number;
	pendingMessageCount: number;
}

export interface ConversationSnapshot {
	instance: AgentInstance;
	state: ConversationState;
	messages: ConversationMessage[];
}

export interface ConversationModelOption {
	provider: string;
	id: string;
	name: string;
	reasoning: boolean;
	supportsImages: boolean;
	thinkingLevels: ThinkingLevel[];
	contextWindow?: number;
	maxTokens?: number;
}

export interface CapabilitySourceInfo {
	path: string;
	source: string;
	scope: "user" | "project" | "temporary";
	origin: "package" | "top-level";
	baseDir?: string;
}

export interface CapabilitySkill {
	name: string;
	description: string;
	filePath: string;
	disableModelInvocation: boolean;
	sourceInfo: CapabilitySourceInfo;
}

export interface CapabilityExtension {
	path: string;
	commands: string[];
	tools: string[];
	sourceInfo: CapabilitySourceInfo;
}

export interface CapabilityTool {
	name: string;
	description: string;
	active: boolean;
	sourceInfo: CapabilitySourceInfo;
}

export interface ConfiguredPackage {
	source: string;
	scope: "user" | "project";
	filtered: boolean;
	installedPath?: string;
}

export interface CapabilityDiagnostic {
	resource: "skill" | "extension";
	type: "warning" | "error" | "collision";
	message: string;
	path?: string;
}

export interface ConversationCapabilities {
	skills: CapabilitySkill[];
	extensions: CapabilityExtension[];
	tools: CapabilityTool[];
	packages: ConfiguredPackage[];
	diagnostics: CapabilityDiagnostic[];
	mcp: {
		configured: boolean;
		loaded: boolean;
		packageSources: string[];
		extensionPaths: string[];
		commands: string[];
		tools: string[];
		servers: Array<{ name: string; status: "starting" | "connected" | "error"; toolCount: number; error?: string }>;
	};
}

export interface ConversationRpcEvent {
	instanceId: string;
	event: unknown;
}

export type ConversationUiRequest =
	| { type: "extension_ui_request"; id: string; method: "select"; title: string; options: string[]; timeout?: number }
	| { type: "extension_ui_request"; id: string; method: "confirm"; title: string; message: string; timeout?: number }
	| {
			type: "extension_ui_request";
			id: string;
			method: "input";
			title: string;
			placeholder?: string;
			timeout?: number;
	  }
	| { type: "extension_ui_request"; id: string; method: "editor"; title: string; prefill?: string }
	| {
			type: "extension_ui_request";
			id: string;
			method: "notify";
			message: string;
			notifyType?: "info" | "warning" | "error";
	  }
	| { type: "extension_ui_request"; id: string; method: "set_editor_text"; text: string };

export type ConversationUiResponse =
	| { id: string; value: string }
	| { id: string; confirmed: boolean }
	| { id: string; cancelled: true };

export interface CreateConversationInput {
	mode: AgentMode;
	label?: string;
	cwd?: string;
}

export interface ModelDefinition {
	id: string;
	name: string;
	api?: string;
	baseUrl?: string;
	reasoning?: boolean;
	input?: string[];
	cost?: {
		input?: number;
		output?: number;
		cacheRead?: number;
		cacheWrite?: number;
	};
	contextWindow?: number;
	maxTokens?: number;
	headers?: Record<string, string>;
}

export interface ModelProviderConfig {
	name?: string;
	baseUrl?: string;
	apiKey?: string;
	api?: string;
	headers?: Record<string, string>;
	authHeader?: boolean;
	models?: ModelDefinition[];
}

export interface VisionFallbackConfig {
	enabled: boolean;
	configured: boolean;
	provider: string;
	model: string;
}

export interface VisionFallbackModel {
	id: string;
	name: string;
	inputPrice: number;
	outputPrice: number;
	priceLabel: string;
}

export type AgnesImageSize = "1K" | "2K" | "3K" | "4K";
export type AgnesImageRatio = "1:1" | "3:4" | "4:3" | "16:9" | "9:16" | "2:3" | "3:2" | "21:9";
export type AgnesVideoStatus = "queued" | "in_progress" | "completed" | "failed";

export interface AgnesMediaCapabilities {
	configured: boolean;
	imageModel: string;
	videoModel: string;
}

export interface AgnesImageRequest {
	prompt: string;
	size: AgnesImageSize;
	ratio: AgnesImageRatio;
	returnBase64?: boolean;
	images?: string[];
}

export interface AgnesGeneratedImage {
	url?: string;
	data?: string;
	mimeType?: string;
	revisedPrompt?: string;
}

export interface AgnesImageResult {
	model: string;
	created?: number;
	images: AgnesGeneratedImage[];
}

export interface AgnesVideoRequest {
	prompt: string;
	width: number;
	height: number;
	numFrames: number;
	frameRate: number;
	image?: string;
	negativePrompt?: string;
	seed?: number;
}

export interface AgnesVideoResult {
	model: string;
	taskId?: string;
	videoId: string;
	status: AgnesVideoStatus;
	progress: number;
	createdAt?: number;
	completedAt?: number;
	seconds?: string;
	size?: string;
	url?: string;
	sizeMapping?: unknown;
	error?: unknown;
}

export interface MediaSaveInput {
	url?: string;
	data?: string;
	mimeType?: string;
	filename?: string;
}

export type MediaComposerMode = "chat" | "image" | "video";
export type GeneratedMediaStatus = "generating" | AgnesVideoStatus;

export interface GeneratedMediaItem {
	id: string;
	kind: "image" | "video";
	prompt: string;
	model: string;
	createdAt: number;
	status: GeneratedMediaStatus;
	progress?: number;
	settings: string;
	image?: AgnesGeneratedImage;
	video?: AgnesVideoResult;
	error?: string;
}
