import type {
	AgentInstance,
	ConversationMessage,
	ConversationUiRequest,
	DesktopSnapshot,
	ImageContent,
	ModelProviderConfig,
} from "../types.ts";

export const emptySnapshot: DesktopSnapshot = { daemonRunning: false, instances: [], tasks: [], runs: [], health: {} };

export type View =
	| "today"
	| "chat"
	| "tasks"
	| "capabilities"
	| "memory"
	| "intelligence"
	| "daemon"
	| "git"
	| "goals"
	| "activity"
	| "projects"
	| "agent";

export type InspectorTarget =
	| { kind: "conversation"; goalTitle?: string; projectName?: string; recentDecision?: string; relevantMemoryCount?: number; state?: string }
	| { kind: "goal"; goal: PersonalGoalRecord }
	| { kind: "activity"; activityId?: string; title?: string; decision?: string; reason?: string; evidence?: string; confidence?: number; goalTitle?: string; result?: string }
	| { kind: "agent"; safety?: SafetyStatus };

export type TaskFilter = "all" | "active" | "paused";
export type CapabilityTab =
	| "general"
	| "models"
	| "commands"
	| "market"
	| "skills"
	| "mcp"
	| "extensions"
	| "tools"
	| "packages"
	| "kernel";

export interface ReviewerSettings {
	enabled?: boolean;
	provider?: string;
	model?: string;
	mode?: "code_changes" | "always";
	executionMode?: "async" | "blocking";
}

export interface AppSettings {
	theme?: "system" | "dark" | "light";
	themeFlavor?: string;
	defaultProvider?: string;
	defaultModel?: string;
	defaultThinkingLevel?: string;
	defaultMode?: "chat" | "code" | "personal";
	fastPreset?: { provider?: string; model?: string; thinkingLevel?: string };
	deepPreset?: { provider?: string; model?: string; thinkingLevel?: string };
	autoCompact?: boolean;
	reserveTokens?: number;
	autoMemory?: boolean;
	reviewer?: ReviewerSettings;
	desktopNotifications?: boolean;
	notificationThresholdSec?: number;
	httpProxy?: string;
	jev?: {
		defenseMode?: "strict" | "confirm_all" | "token_saver";
		safetyGate?: boolean;
		leakHunter?: boolean;
		tokenCompressor?: boolean;
		loopBreaker?: boolean;
		stopDecider?: boolean;
	};
}

export interface OptimisticUserMessage {
	instanceId?: string;
	baselineMessageCount: number;
	message: ConversationMessage;
}

export interface ImageAttachment extends ImageContent {
	id: string;
	name: string;
}

export interface DocumentAttachment {
	id: string;
	name: string;
	text: string;
	path?: string;
}

export type BlockingConversationUiRequest = Extract<
	ConversationUiRequest,
	{ method: "select" | "confirm" | "input" | "editor" }
>;

export interface PendingConversationUiRequest {
	instanceId: string;
	request: BlockingConversationUiRequest;
}

export interface ExtensionNotice {
	id: string;
	message: string;
	type: "info" | "warning" | "error";
}

export const SUPPORTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
export const MAX_IMAGE_ATTACHMENTS = 4;
export const MAX_IMAGE_DIMENSION = 2_000;
export const MAX_IMAGE_BASE64_BYTES = 4.5 * 1024 * 1024;
export const MAX_TOTAL_IMAGE_BASE64_BYTES = 12 * 1024 * 1024;
export const MAX_DOCUMENT_ATTACHMENTS = 8;
export const MAX_DOCUMENT_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_DOCUMENT_TEXT_BYTES = 1 * 1024 * 1024;
export const MAX_TOTAL_DOCUMENT_TEXT_BYTES = 4 * 1024 * 1024;

export interface PersonalMemoryRecord {
	id: string;
	category: "profile" | "preference" | "project" | "decision" | "experience" | "feedback" | "temporary";
	content: string;
	source: string;
	confidence: number;
	importance: number;
	accessCount: number;
	createdAt: string;
	updatedAt: string;
	lastAccessedAt?: string | null;
	expiresAt?: string | null;
	tags: string[];
	relatedEntities: string[];
}

export interface PersonalGoalRecord {
	id: string;
	title: string;
	description?: string | null;
	status: "draft" | "active" | "blocked" | "waiting" | "completed" | "cancelled";
	priority: number;
	source: string;
	progress: number;
	constraints: string[];
	successCriteria: string[];
	activeSessionId?: string | null;
	createdAt: string;
	updatedAt: string;
	deadline?: string | null;
}

export interface ActionCard {
	id: string;
	title: string;
	summary: string;
	actionType: string;
	payload: Record<string, any>;
	createdAt: string;
}

export interface ActionCardRecord {
	id: string;
	title: string;
	summary: string;
	actionType: string;
	payload: string;
	status: "open" | "dismissed" | "acted";
	createdAt: string;
}

export interface TodayBriefing {
	date: string;
	greeting: string;
	dailyFocus: string;
	activeGoals: PersonalGoalRecord[];
	actionCards: ActionCard[];
	keyMemories: PersonalMemoryRecord[];
	generatedAt: string;
}

export type CircuitState =
	| { state: "healthy" }
	| { state: "degraded"; consecutive_failures: number }
	| { state: "open"; opened_at: number; cooldown_ms: number }
	| { state: "recovery"; probe_successes: number; required_successes: number };

export interface BudgetUsageReport {
	total_limit: number;
	personal_limit: number;
	personal_reserved: number;
	personal_used: number;
	execution_limit: number;
	execution_reserved: number;
	execution_used: number;
	total_remaining: number;
	usage_ratio: number;
	is_warning: boolean;
}

export interface ExecutionConstraint {
	timeoutMs: number;
	cpuQuota?: number;
	memoryLimitMb: number;
	retryBudget: number;
	concurrencyLimit: number;
	outputLimitBytes: number;
	toolCallLimit: number;
	recursiveAgentDepth: number;
	globalKillSwitch: boolean;
}

export interface SafetyStatus {
	circuitState: CircuitState;
	autonomousActionAllowed: boolean;
	budgetReport: BudgetUsageReport;
	constraints: ExecutionConstraint;
}

export interface DecisionMetrics {
	importance: number;
	relevance: number;
	confidence: number;
	expected_value: number;
	risk: number;
	interruption_cost: number;
	action_cost: number;
}

export type DiscreteDecisionAction =
	| "IGNORE"
	| "REMEMBER"
	| "SUGGEST"
	| "ASK"
	| "PREPARE"
	| "EXECUTE"
	| "RESUME"
	| "MONITOR";

export type { ModelProviderConfig, DesktopSnapshot };

