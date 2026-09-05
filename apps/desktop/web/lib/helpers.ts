import type {
	AgentInstance,
	ConversationMessage,
	ConversationModelOption,
	ConversationUiRequest,
	ImageContent,
	RunStatus,
	TaskDefinition,
	ThinkingLevel,
} from "../types";
import {
	type BlockingConversationUiRequest,
	type DocumentAttachment,
	type ImageAttachment,
	MAX_DOCUMENT_FILE_BYTES,
	MAX_DOCUMENT_TEXT_BYTES,
	MAX_IMAGE_ATTACHMENTS,
	MAX_IMAGE_BASE64_BYTES,
	MAX_IMAGE_DIMENSION,
	MAX_TOTAL_IMAGE_BASE64_BYTES,
	SUPPORTED_IMAGE_TYPES,
} from "./app-types";

/** Standard thinking ladder available for every selected model. */
const BASE_THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high"];

/**
 * Keep the base controls available even when a provider omits or incorrectly
 * reports reasoning metadata. Extended levels remain model-declared.
 */
export function thinkingLevelsForModel(model: {
	reasoning?: boolean;
	thinkingLevels?: ThinkingLevel[];
	thinkingLevelMap?: Partial<Record<ThinkingLevel, string | null>>;
}): ThinkingLevel[] {
	const levels: ThinkingLevel[] = [...BASE_THINKING_LEVELS];
	const declaredLevels = new Set(model.thinkingLevels ?? []);
	const map = model.thinkingLevelMap;
	for (const level of ["xhigh", "max"] as const) {
		const mappedLevel = map?.[level];
		const isAvailable = mappedLevel === undefined ? declaredLevels.has(level) : mappedLevel !== null;
		if (isAvailable) levels.push(level);
	}
	return levels;
}

export function normalizeConversationModels(raw: unknown): ConversationModelOption[] {
	if (!Array.isArray(raw)) return [];
	const out: ConversationModelOption[] = [];
	for (const entry of raw) {
		if (!entry || typeof entry !== "object") continue;
		const row = entry as Record<string, unknown>;
		const id = typeof row.id === "string" ? row.id : "";
		const provider = typeof row.provider === "string" ? row.provider : "";
		if (!id || !provider) continue;
		const name = typeof row.name === "string" && row.name.trim() ? row.name : id;
		const reasoning = Boolean(row.reasoning);
		const input = row.input;
		const supportsImages = Array.isArray(input) ? input.includes("image") : Boolean(row.supportsImages);
		const thinkingLevelMap =
			row.thinkingLevelMap && typeof row.thinkingLevelMap === "object"
				? (row.thinkingLevelMap as Partial<Record<ThinkingLevel, string | null>>)
				: undefined;
		const existingLevels = Array.isArray(row.thinkingLevels)
			? (row.thinkingLevels.filter((level): level is ThinkingLevel => typeof level === "string") as ThinkingLevel[])
			: undefined;
		out.push({
			provider,
			id,
			name,
			reasoning,
			supportsImages,
			thinkingLevels: thinkingLevelsForModel({
				reasoning,
				thinkingLevels: existingLevels,
				thinkingLevelMap,
			}),
			contextWindow: typeof row.contextWindow === "number" ? row.contextWindow : undefined,
			maxTokens: typeof row.maxTokens === "number" ? row.maxTokens : undefined,
		});
	}
	return out;
}

export function thinkingLevelLabel(level: ThinkingLevel): string {
	const labels: Record<ThinkingLevel, string> = {
		off: "off",
		minimal: "minimal",
		low: "low",
		medium: "medium",
		high: "high",
		xhigh: "xhigh",
		max: "max",
	};
	return labels[level] ?? level;
}

export function formatDate(value?: string): string {
	if (!value) return "未安排";
	return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function formatTime(value?: number): string {
	if (!value) return "";
	return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

/** Compact conversation timestamp: today → "HH:mm", else → "M/D". */
export function formatConversationTime(value?: string): string {
	if (!value) return "";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "";
	const now = new Date();
	if (date.toDateString() === now.toDateString()) {
		return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date);
	}
	return new Intl.DateTimeFormat(undefined, { month: "numeric", day: "numeric" }).format(date);
}

export function scheduleLabel(task: TaskDefinition): string {
	return task.schedule.kind === "once"
		? `单次 · ${formatDate(task.schedule.runAt)}`
		: `Cron · ${task.schedule.expression}`;
}

const RUN_STATUS_ZH: Record<string, string> = {
	queued: "排队中",
	running: "运行中",
	succeeded: "成功",
	failed: "失败",
	cancelled: "已取消",
	interrupted: "已中断",
	active: "启用",
	paused: "已暂停",
	online: "在线",
	offline: "离线",
	starting: "启动中",
	stopping: "停止中",
	stopped: "已停止",
	error: "错误",
};

export function statusLabel(status: RunStatus | string): string {
	return RUN_STATUS_ZH[status] ?? status;
}

/** True when later messages already include toolResult for this assistant turn's tools. */
export function assistantToolsHaveResults(messages: ConversationMessage[], assistantIndex: number): boolean {
	const message = messages[assistantIndex];
	if (!message || message.role !== "assistant") return false;
	for (let i = assistantIndex + 1; i < messages.length; i++) {
		const next = messages[i];
		if (!next) continue;
		if (next.role === "toolResult") return true;
		if (next.role === "user" || next.role === "assistant") return false;
	}
	return false;
}

/** Short human title for sidebar — not a raw dump of the first prompt. */
export function instanceTitle(instance: AgentInstance, sessionName?: string): string {
	const raw = (sessionName || instance.label || "").trim();
	if (!raw) return "新对话";
	let title = raw.replace(/\s+/g, " ");
	// Test / demos often store the full prompt as the label
	if (/^(reply|write|say|respond|exactly|ok)\b/i.test(title) && title.length > 28) {
		title = "快速测试";
	} else if (/^(调用|用 |使用)/.test(title) && title.length > 32) {
		title = `${title.slice(0, 20)}…`;
	}
	if (title.length > 36) title = `${title.slice(0, 34)}…`;
	return title;
}

/** Compact path for secondary sidebar line. */
export function shortWorkspacePath(cwd: string): string {
	const normalized = cwd.replace(/\\/g, "/");
	const parts = normalized.split("/").filter(Boolean);
	if (parts.length <= 2) return normalized.startsWith("/") ? normalized : cwd;
	return parts.slice(-2).join("/");
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isConversationMessage(value: unknown): value is ConversationMessage {
	return isRecord(value) && typeof value.role === "string" && "content" in value;
}

export function blockingConversationUiRequest(
	value: Record<string, unknown>,
): BlockingConversationUiRequest | undefined {
	if (
		value.type !== "extension_ui_request" ||
		typeof value.id !== "string" ||
		typeof value.method !== "string" ||
		typeof value.title !== "string"
	) {
		return undefined;
	}
	const timeout = typeof value.timeout === "number" ? value.timeout : undefined;
	if (
		value.method === "select" &&
		Array.isArray(value.options) &&
		value.options.every((option) => typeof option === "string")
	) {
		return {
			type: "extension_ui_request",
			id: value.id,
			method: "select",
			title: value.title,
			options: value.options,
			timeout,
		};
	}
	if (value.method === "confirm" && typeof value.message === "string") {
		return {
			type: "extension_ui_request",
			id: value.id,
			method: "confirm",
			title: value.title,
			message: value.message,
			timeout,
		};
	}
	if (value.method === "input" && (value.placeholder === undefined || typeof value.placeholder === "string")) {
		return {
			type: "extension_ui_request",
			id: value.id,
			method: "input",
			title: value.title,
			placeholder: value.placeholder,
			timeout,
		};
	}
	if (value.method === "editor" && (value.prefill === undefined || typeof value.prefill === "string")) {
		return {
			type: "extension_ui_request",
			id: value.id,
			method: "editor",
			title: value.title,
			prefill: value.prefill,
		};
	}
	return undefined;
}

export function contentText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((block) => {
			if (!isRecord(block)) return "";
			if (block.type !== "text" && block.type !== "output_text") return "";
			return typeof block.text === "string" ? block.text : "";
		})
		.filter(Boolean)
		.join("\n\n")
		.trim();
}

export function messageBlockCounts(content: unknown): { tools: number; thinking: number } {
	if (!Array.isArray(content)) return { tools: 0, thinking: 0 };
	let tools = 0;
	let thinking = 0;
	for (const block of content) {
		if (!isRecord(block)) continue;
		const type = typeof block.type === "string" ? block.type : "";
		if (type === "toolCall" || type === "tool_use") tools += 1;
		if (type === "thinking") thinking += 1;
	}
	return { tools, thinking };
}

/**
 * Thinking/reasoning text for collapsible display. Streaming turns carry it as
 * `thinking` content blocks; cached snapshots may carry a flat `reasoning` string.
 */
export function messageReasoning(message: ConversationMessage): string {
	if (typeof message.reasoning === "string" && message.reasoning.trim()) return message.reasoning.trim();
	if (!Array.isArray(message.content)) return "";
	return message.content
		.filter(
			(block): block is { type: "thinking"; thinking: string } =>
				isRecord(block) && block.type === "thinking" && typeof block.thinking === "string",
		)
		.map((block) => block.thinking)
		.join("\n\n")
		.trim();
}

export function contentImages(content: unknown): ImageContent[] {
	if (!Array.isArray(content)) return [];
	return content.flatMap((block) => {
		if (
			!isRecord(block) ||
			block.type !== "image" ||
			typeof block.data !== "string" ||
			typeof block.mimeType !== "string" ||
			!SUPPORTED_IMAGE_TYPES.has(block.mimeType)
		) {
			return [];
		}
		return [{ type: "image", data: block.data, mimeType: block.mimeType } satisfies ImageContent];
	});
}

export function conversationContentMatches(left: unknown, right: unknown): boolean {
	const visibleText = (content: unknown) =>
		contentText(content)
			.replace(/\n*<openpi-vision-context[\s\S]*?<\/openpi-vision-context>/g, "")
			.trim();
	if (visibleText(left) !== visibleText(right)) return false;
	const leftImages = contentImages(left);
	const rightImages = contentImages(right);
	return (
		leftImages.length === rightImages.length &&
		leftImages.every(
			(image, index) => image.mimeType === rightImages[index]?.mimeType && image.data === rightImages[index]?.data,
		)
	);
}

export function mergeConversationMessage(
	messages: ConversationMessage[],
	incoming: ConversationMessage,
): ConversationMessage[] {
	const nextMessages = [...messages];
	let messageIndex = -1;
	if (incoming.timestamp !== undefined) {
		messageIndex = nextMessages.findIndex(
			(message) => message.role === incoming.role && message.timestamp === incoming.timestamp,
		);
	}
	if (messageIndex === -1 && incoming.role !== "user") {
		for (let index = nextMessages.length - 1; index >= 0; index--) {
			const message = nextMessages[index];
			if (message.role === incoming.role && message.timestamp === undefined) {
				messageIndex = index;
				break;
			}
		}
	}
	if (messageIndex === -1) nextMessages.push(incoming);
	else nextMessages[messageIndex] = incoming;
	return nextMessages;
}

export function readBlobAsBase64(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onerror = () => reject(reader.error ?? new Error("Failed to read image"));
		reader.onload = () => {
			if (typeof reader.result !== "string") {
				reject(new Error("Failed to read image"));
				return;
			}
			const separator = reader.result.indexOf(",");
			if (separator === -1) {
				reject(new Error("Invalid image data"));
				return;
			}
			resolve(reader.result.slice(separator + 1));
		};
		reader.readAsDataURL(blob);
	});
}

export function loadImage(file: File): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const source = URL.createObjectURL(file);
		const image = new window.Image();
		image.onload = () => {
			URL.revokeObjectURL(source);
			resolve(image);
		};
		image.onerror = () => {
			URL.revokeObjectURL(source);
			reject(new Error(`Unable to decode ${file.name}`));
		};
		image.src = source;
	});
}

export function encodeCanvas(canvas: HTMLCanvasElement, mimeType: string, quality: number): Promise<Blob> {
	return new Promise((resolve, reject) => {
		canvas.toBlob(
			(blob) => {
				if (blob) resolve(blob);
				else reject(new Error("Unable to encode image"));
			},
			mimeType,
			quality,
		);
	});
}

export async function prepareImageAttachment(file: File): Promise<ImageAttachment> {
	if (!SUPPORTED_IMAGE_TYPES.has(file.type)) {
		throw new Error(`${file.name} is not a supported image`);
	}

	const [originalData, image] = await Promise.all([readBlobAsBase64(file), loadImage(file)]);
	if (
		image.naturalWidth <= MAX_IMAGE_DIMENSION &&
		image.naturalHeight <= MAX_IMAGE_DIMENSION &&
		originalData.length <= MAX_IMAGE_BASE64_BYTES
	) {
		return { id: crypto.randomUUID(), name: file.name, type: "image", data: originalData, mimeType: file.type };
	}

	let scale = Math.min(1, MAX_IMAGE_DIMENSION / image.naturalWidth, MAX_IMAGE_DIMENSION / image.naturalHeight);
	for (let attempt = 0; attempt < 7; attempt += 1) {
		const canvas = document.createElement("canvas");
		canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
		canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
		const context = canvas.getContext("2d");
		if (!context) throw new Error("Unable to prepare image");
		context.drawImage(image, 0, 0, canvas.width, canvas.height);
		const preferredType = file.type === "image/jpeg" ? "image/jpeg" : "image/webp";
		const blob = await encodeCanvas(canvas, preferredType, Math.max(0.58, 0.86 - attempt * 0.05));
		const data = await readBlobAsBase64(blob);
		if (data.length <= MAX_IMAGE_BASE64_BYTES && SUPPORTED_IMAGE_TYPES.has(blob.type || preferredType)) {
			return {
				id: crypto.randomUUID(),
				name: file.name,
				type: "image",
				data,
				mimeType: blob.type || preferredType,
			};
		}
		scale *= 0.75;
	}

	throw new Error(`${file.name} could not be reduced below the image size limit`);
}

const TEXT_DOCUMENT_EXTENSIONS = new Set([
	"c",
	"cc",
	"cpp",
	"cs",
	"css",
	"csv",
	"go",
	"graphql",
	"h",
	"html",
	"java",
	"js",
	"jsx",
	"json",
	"md",
	"mjs",
	"py",
	"rb",
	"rs",
	"sh",
	"sql",
	"svg",
	"toml",
	"ts",
	"tsx",
	"txt",
	"xml",
	"yaml",
	"yml",
]);
const BINARY_DOCUMENT_EXTENSIONS = new Set(["pdf", "docx"]);

export function isTextDocumentFile(file: File): boolean {
	if (file.type.startsWith("text/")) return true;
	if (
		[
			"application/json",
			"application/javascript",
			"application/sql",
			"application/xml",
			"application/x-yaml",
			"application/yaml",
		].includes(file.type)
	) {
		return true;
	}
	const extension = file.name.split(".").at(-1)?.toLowerCase();
	return extension !== undefined && TEXT_DOCUMENT_EXTENSIONS.has(extension);
}

export function isDocumentFile(file: File): boolean {
	if (isTextDocumentFile(file)) return true;
	if (
		["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"].includes(file.type)
	) {
		return true;
	}
	const extension = file.name.split(".").at(-1)?.toLowerCase();
	return extension !== undefined && BINARY_DOCUMENT_EXTENSIONS.has(extension);
}

export async function prepareDocumentAttachment(
	file: File,
	extractDocumentText: (input: { name: string; mimeType: string; data: string }) => Promise<{ text: string }>,
): Promise<DocumentAttachment> {
	if (isTextDocumentFile(file)) {
		if (file.size > MAX_DOCUMENT_TEXT_BYTES) {
			throw new Error(`${file.name} 超过 1 MB 文本附件限制`);
		}
		const text = await file.text();
		if (text.includes("\0")) {
			throw new Error(`${file.name} 是二进制文件，无法作为文本上下文发送`);
		}
		return { id: crypto.randomUUID(), name: file.name, text };
	}
	if (!isDocumentFile(file)) {
		throw new Error(`${file.name} 不是支持的文档格式`);
	}
	if (file.size > MAX_DOCUMENT_FILE_BYTES) {
		throw new Error(`${file.name} 超过 10 MB 文档上传限制`);
	}
	const result = await extractDocumentText({
		name: file.name,
		mimeType: file.type,
		data: await readBlobAsBase64(file),
	});
	if (!result.text.trim()) {
		throw new Error(`${file.name} 未提取到可发送的文本内容`);
	}
	return { id: crypto.randomUUID(), name: file.name, text: result.text };
}

export function toolCalls(message: ConversationMessage): Array<{ name: string; detail?: string }> {
	const calls: Array<{ name: string; detail?: string }> = [];
	if (message.role === "toolResult") {
		calls.push({ name: message.toolName || "Tool result", detail: contentText(message.content) });
		return calls;
	}
	if (!Array.isArray(message.content)) return calls;
	for (const block of message.content) {
		if (!isRecord(block) || (block.type !== "toolCall" && block.type !== "tool_use")) continue;
		const name = typeof block.name === "string" ? block.name : "Tool call";
		const input = block.arguments ?? block.input;
		calls.push({ name, detail: input === undefined ? undefined : JSON.stringify(input, null, 2) });
	}
	return calls;
}

export interface ToolCallBlock {
	type: "toolCall" | "tool_use";
	id: string;
	name: string;
	arguments: Record<string, unknown>;
}

export function isToolCallBlock(block: unknown): block is ToolCallBlock {
	if (!isRecord(block)) return false;
	return block.type === "toolCall" || block.type === "tool_use";
}

/** Extract a short human-readable summary from a tool call's arguments. */
export function toolCallSummary(block: ToolCallBlock): string {
	const args = block.arguments;
	switch (block.name) {
		case "bash":
		case "bash_execution":
			return String(args.command ?? args.cmd ?? "");
		case "read_file":
		case "file_read":
		case "read":
			return String(args.path ?? args.file ?? "");
		case "write_file":
		case "file_write":
			return `写入 ${String(args.path ?? args.file ?? "")}`;
		case "glob":
		case "search_files":
		case "find_files":
			return String(args.pattern ?? args.glob ?? "");
		case "subagent":
		case "spawn_subagent":
		case "launch_subagent":
			return String(args.task ?? args.description ?? args.prompt ?? args.title ?? "");
		default: {
			const s = JSON.stringify(args);
			return s.length > 100 ? s.slice(0, 97) + "\u2026" : s;
		}
	}
}

/** Return the icon component to use for a tool call, based on its name. */
export function toolCallIconName(block: ToolCallBlock): string {
	switch (block.name) {
		case "bash":
		case "bash_execution":
			return "terminal";
		case "read_file":
		case "file_read":
		case "read":
		case "write_file":
		case "file_write":
			return "file";
		case "glob":
		case "search_files":
		case "find_files":
			return "search";
		case "subagent":
		case "spawn_subagent":
		case "launch_subagent":
			return "bot";
		default:
			return "wrench";
	}
}
