import type {
	AgentInstance,
	ConversationMessage,
	ConversationUiRequest,
	DesktopSnapshot,
	ImageContent,
	ModelProviderConfig,
} from "../types.ts";

export const emptySnapshot: DesktopSnapshot = { daemonRunning: false, instances: [], tasks: [], runs: [], health: {} };

export type View = "chat" | "tasks" | "capabilities" | "memory" | "intelligence" | "daemon";
export type TaskFilter = "all" | "active" | "paused";
export type CapabilityTab = "market" | "skills" | "mcp" | "extensions" | "tools" | "packages" | "models" | "kernel";

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

export type { ModelProviderConfig };
