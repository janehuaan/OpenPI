export function visibleMessageText(text: string): string {
	return text
		.replace(/\n*<openpi-attachments>[\s\S]*?<\/openpi-attachments>/g, "")
		.replace(/\n*<openpi-vision-context[\s\S]*?<\/openpi-vision-context>/g, "")
		.trim();
}

import type {
	AgentInstance,
	ConversationMessage,
	ConversationModelOption,
	ConversationUiRequest,
	ImageContent,
	RunningTool,
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

export function modelSupportsReasoning(model?: {
	id?: string;
	name?: string;
	provider?: string;
	reasoning?: boolean;
	thinkingLevels?: ThinkingLevel[];
	thinkingLevelMap?: Partial<Record<ThinkingLevel, string | null>>;
} | null): boolean {
	if (!model) return false;
	const id = (model.id || "").toLowerCase();
	const name = (model.name || "").toLowerCase();
	const provider = (model.provider || "").toLowerCase();

	if (
		provider.includes("agnes") ||
		id.includes("agnes") ||
		name.includes("agnes") ||
		provider.includes("sensenova") ||
		provider.includes("商汤") ||
		id.includes("sensenova") ||
		name.includes("sensenova")
	) {
		return true;
	}
	if (model.reasoning === true) return true;
	if (
		id.includes("thinking") ||
		id.includes("reason") ||
		id.includes("r1") ||
		id.includes("qwq") ||
		id.startsWith("o1") ||
		id.startsWith("o3") ||
		id.includes("claude-3-7") ||
		id.includes("claude-opus-5") ||
		id.includes("claude-opus-4") ||
		id.includes("deepseek") ||
		id.includes("kimi") ||
		id.includes("minimax") ||
		id.includes("glm-5") ||
		id.includes("qwen3") ||
		id.includes("mimo") ||
		id.includes("seed") ||
		name.includes("thinking") ||
		name.includes("reason")
	) {
		if (model.reasoning === false) {
			if (!id.includes("r1") && !id.includes("thinking") && !id.includes("reason") && !id.includes("qwq")) {
				return false;
			}
		}
		return true;
	}
	if (model.reasoning === false) return false;
	if (model.thinkingLevelMap && Object.keys(model.thinkingLevelMap).length > 0) return true;
	return false;
}

export function isFlashTierModel(modelIdOrName?: string): boolean {
	if (!modelIdOrName) return false;
	const lower = modelIdOrName.toLowerCase();
	return (
		lower.includes("flash") ||
		lower.includes("lite") ||
		lower.includes("mini") ||
		lower.includes("small") ||
		lower.includes("turbo") ||
		lower.includes("instant") ||
		lower.includes("haiku") ||
		lower.includes("nano")
	);
}

export function getHighestThinkingLevel(model?: {
	id?: string;
	name?: string;
	thinkingLevels?: ThinkingLevel[];
	thinkingLevelMap?: Partial<Record<ThinkingLevel, string | null>>;
} | null): ThinkingLevel {
	const levels = model?.thinkingLevels ?? [];
	const active = levels.filter((l) => l !== "off");
	const modelName = model?.name || model?.id || "";
	// For lightweight / Flash models: high/max thinking causes reasoning collapse / loops.
	// Recommend medium (or low if medium isn't available).
	if (isFlashTierModel(modelName)) {
		if (active.includes("medium")) return "medium";
		if (active.includes("low")) return "low";
		if (active.includes("minimal")) return "minimal";
		return active[0] || "medium";
	}

	if (active.includes("max")) return "max";
	if (active.includes("xhigh")) return "xhigh";
	if (active.includes("high")) return "high";
	return active[active.length - 1] || "high";
}

export interface RepetitionLoopResult {
	isLoop: boolean;
	repeatedPattern?: string;
	count?: number;
}

/**
 * Detects whether streaming text has fallen into a degenerate repetition loop (e.g. self-reinforcing tokens).
 * Checks if any substring of length 2..30 repeats consecutively >= 6 times near the tail.
 */
export function detectRepetitionLoop(text: string): RepetitionLoopResult {
	if (!text || text.length < 24) return { isLoop: false };
	const tail = text.slice(-250);
	for (let len = 2; len <= 30; len++) {
		if (tail.length < len * 5) continue;
		const pattern = tail.slice(-len);
		// Skip if pattern is only whitespace or markdown dividers / symbols (e.g., "------", "======", "......")
		if (!/[^\s\-_.*=#`~|\\/]/.test(pattern)) continue;

		let count = 0;
		let pos = tail.length - len;
		while (pos >= 0 && tail.slice(pos, pos + len) === pattern) {
			count++;
			pos -= len;
			if (count >= 6) {
				return { isLoop: true, repeatedPattern: pattern.trim() || pattern, count };
			}
		}
	}
	return { isLoop: false };
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
		const reasoning = typeof row.reasoning === "boolean"
			? row.reasoning
			: modelSupportsReasoning({ id, name, thinkingLevelMap: row.thinkingLevelMap as any });
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

export type DateGroupKey = "today" | "yesterday" | "week" | "earlier";

export interface DateGroup<T> {
	key: DateGroupKey;
	title: string;
	items: T[];
}

export function groupConversationsByDate(instances: AgentInstance[]): DateGroup<AgentInstance>[] {
	const now = new Date();
	const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
	const yesterdayStart = todayStart - 86400000;
	const weekStart = todayStart - 6 * 86400000;

	const groups: Record<DateGroupKey, AgentInstance[]> = {
		today: [],
		yesterday: [],
		week: [],
		earlier: [],
	};

	for (const inst of instances) {
		const ts = inst.lastSeenAt || inst.createdAt;
		const time = ts ? new Date(ts).getTime() : 0;
		if (time >= todayStart) {
			groups.today.push(inst);
		} else if (time >= yesterdayStart) {
			groups.yesterday.push(inst);
		} else if (time >= weekStart) {
			groups.week.push(inst);
		} else {
			groups.earlier.push(inst);
		}
	}

	const result: DateGroup<AgentInstance>[] = [];
	if (groups.today.length > 0) result.push({ key: "today", title: "今天", items: groups.today });
	if (groups.yesterday.length > 0) result.push({ key: "yesterday", title: "昨天", items: groups.yesterday });
	if (groups.week.length > 0) result.push({ key: "week", title: "近7天", items: groups.week });
	if (groups.earlier.length > 0) result.push({ key: "earlier", title: "更早", items: groups.earlier });
	return result;
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
	if (typeof message.content === "string") {
		const match = message.content.match(/<think>([\s\S]*?)(?:<\/think>|$)/i);
		if (match && match[1].trim()) return match[1].trim();
		return "";
	}
	if (!Array.isArray(message.content)) return "";
	const parts: string[] = [];
	for (const block of message.content) {
		if (!isRecord(block)) continue;
		if (block.type === "thinking" && typeof block.thinking === "string" && block.thinking.trim()) {
			parts.push(block.thinking.trim());
		} else if (typeof (block as any).reasoning === "string" && (block as any).reasoning.trim()) {
			parts.push((block as any).reasoning.trim());
		} else if (block.type === "text" && typeof block.text === "string") {
			const match = block.text.match(/<think>([\s\S]*?)(?:<\/think>|$)/i);
			if (match && match[1].trim()) {
				parts.push(match[1].trim());
			}
		}
	}
	return parts.join("\n\n").trim();
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

export interface ActionChainItem {
	id: string;
	name: string;
	summary: string;
	iconName: string;
	output?: string;
	isError?: boolean;
	args?: Record<string, unknown>;
	actionType?: "read" | "write" | "edit" | "bash" | "search" | "other";
	verb?: string;
	target?: string;
	badge?: string;
	durationMs?: number;
	startedAt?: number;
}

export function formatDuration(ms?: number): string {
	if (ms === undefined || ms === null || isNaN(ms) || ms < 0) return "";
	if (ms < 1000) return `${Math.round(ms)}ms`;
	const sec = ms / 1000;
	if (sec < 60) return `${sec.toFixed(1)}s`;
	const min = Math.floor(sec / 60);
	const remSec = Math.round(sec % 60);
	return `${min}m ${remSec}s`;
}

export function cleanPath(filePath: string): string {
	if (!filePath) return "";
	const parts = filePath.split("/openpi-next/");
	if (parts.length > 1) return parts[1];
	const usersMatch = filePath.match(/^\/Users\/[^/]+\/[^/]+\/(.+)$/);
	if (usersMatch && usersMatch[1]) {
		return usersMatch[1];
	}
	const homeMatch = filePath.match(/^~\/[^/]+\/(.+)$/);
	if (homeMatch && homeMatch[1]) {
		return homeMatch[1];
	}
	return filePath.replace(/^\/Users\/[^/]+\//, "~/");
}

export function formatActionItem(
	name: string,
	args?: Record<string, unknown> | null,
	output?: string,
	isError?: boolean,
): {
	actionType: "read" | "write" | "edit" | "bash" | "search" | "other";
	verb: string;
	target: string;
	badge?: string;
} {
	const lower = (name || "").toLowerCase();
	const safeArgs = args || {};

	const getPath = (): string => {
		const raw =
			safeArgs.path ??
			safeArgs.file_path ??
			safeArgs.filePath ??
			safeArgs.targetFile ??
			safeArgs.TargetFile ??
			safeArgs.AbsolutePath ??
			safeArgs.file;
		return typeof raw === "string" ? cleanPath(raw) : "";
	};

	const getLineRange = (): string => {
		const start = safeArgs.startLine ?? safeArgs.StartLine ?? safeArgs.line;
		const end = safeArgs.endLine ?? safeArgs.EndLine;
		if (start !== undefined && end !== undefined) {
			return `#L${start}-${end}`;
		}
		if (start !== undefined) {
			return `#L${start}`;
		}
		return "";
	};

	const getResultBadge = (): string | undefined => {
		if (isError) return "failed";
		if (output === undefined) return undefined;
		const trimmed = output.trim();
		if (!trimmed) return "✓";
		const lines = trimmed.split("\n");
		if (lines.length > 1) {
			return `${lines.length} results`;
		}
		return "✓";
	};

	if (
		lower.includes("bash") ||
		lower.includes("terminal") ||
		lower.includes("run_command") ||
		lower.includes("exec")
	) {
		const rawCmd =
			safeArgs.command ??
			safeArgs.cmd ??
			safeArgs.CommandLine ??
			safeArgs.commandLine ??
			"";
		const cmd = typeof rawCmd === "string" ? rawCmd.trim() : "";
		const target = cmd ? (cmd.length > 70 ? `${cmd.slice(0, 67)}...` : cmd) : "command";
		return {
			actionType: "bash",
			verb: "Ran",
			target,
			badge: isError ? "failed" : output !== undefined ? "✓" : undefined,
		};
	}

	if (
		lower.includes("read") ||
		lower.includes("view") ||
		lower.includes("cat")
	) {
		const p = getPath();
		const lines = getLineRange();
		const target = p ? `${p}${lines ? ` ${lines}` : ""}` : "file";
		return {
			actionType: "read",
			verb: "Analyzed",
			target,
			badge: isError ? "failed" : output !== undefined ? "✓" : undefined,
		};
	}

	if (
		lower.includes("edit") ||
		lower.includes("replace") ||
		lower.includes("patch")
	) {
		const p = getPath();
		return {
			actionType: "edit",
			verb: "Edited",
			target: p || "file",
			badge: isError ? "failed" : output !== undefined ? "✓" : undefined,
		};
	}

	if (
		lower.includes("write") ||
		lower.includes("create") ||
		lower.includes("save")
	) {
		const p = getPath();
		return {
			actionType: "write",
			verb: "Wrote",
			target: p || "file",
			badge: isError ? "failed" : output !== undefined ? "✓" : undefined,
		};
	}

	if (
		lower.includes("search") ||
		lower.includes("grep") ||
		lower.includes("find") ||
		lower.includes("glob")
	) {
		const query =
			safeArgs.query ??
			safeArgs.pattern ??
			safeArgs.Query ??
			safeArgs.Pattern ??
			safeArgs.term ??
			"";
		const target = typeof query === "string" && query ? `"${query}"` : getPath() || "codebase";
		return {
			actionType: "search",
			verb: "Searched",
			target,
			badge: getResultBadge(),
		};
	}

	const fallbackTarget = getPath() || (Object.keys(safeArgs).length > 0 ? JSON.stringify(safeArgs).slice(0, 50) : "");
	return {
		actionType: "other",
		verb: name || "Called",
		target: fallbackTarget,
		badge: isError ? "failed" : output !== undefined ? "✓" : undefined,
	};
}

export function computeTrajectorySummary(
	actions: ActionChainItem[],
	isWorking?: boolean,
	activeToolName?: string,
): string {
	if (isWorking && activeToolName) {
		const lower = activeToolName.toLowerCase();
		if (lower.includes("bash") || lower.includes("run") || lower.includes("terminal") || lower.includes("exec")) {
			return "Running bash command...";
		}
		if (lower.includes("search") || lower.includes("grep") || lower.includes("find")) {
			return "Searching codebase...";
		}
		if (lower.includes("read") || lower.includes("view")) {
			return "Analyzing files...";
		}
		if (lower.includes("edit") || lower.includes("write")) {
			return "Applying edits...";
		}
		return `Running ${activeToolName}...`;
	}

	if (actions.length === 0) {
		return isWorking ? "Working..." : "Completed";
	}

	let fileCount = 0;
	let searchCount = 0;
	let bashCount = 0;
	let otherCount = 0;

	for (const a of actions) {
		if (a.actionType === "read" || a.actionType === "edit" || a.actionType === "write") {
			fileCount++;
		} else if (a.actionType === "search") {
			searchCount++;
		} else if (a.actionType === "bash") {
			bashCount++;
		} else {
			otherCount++;
		}
	}

	const parts: string[] = [];
	if (fileCount > 0) parts.push(`${fileCount} file${fileCount > 1 ? "s" : ""}`);
	if (searchCount > 0) parts.push(`${searchCount} search${searchCount > 1 ? "es" : ""}`);
	if (bashCount > 0) parts.push(`${bashCount} command${bashCount > 1 ? "s" : ""}`);
	if (parts.length === 0 && otherCount > 0) {
		parts.push(`${otherCount} action${otherCount > 1 ? "s" : ""}`);
	}

	const prefix = isWorking ? "Exploring " : "Explored ";
	return `${prefix}${parts.join(", ")}`;
}

export function getRunningToolOutput(tool: RunningTool): string | undefined {
	if (!tool.partialResult) return undefined;
	if (typeof tool.partialResult === "string") return tool.partialResult;
	if (typeof tool.partialResult === "object") {
		const obj = tool.partialResult as {
			content?: Array<{ type?: string; text?: string }>;
			text?: string;
			stdout?: string;
			output?: string;
		};
		if (typeof obj.text === "string") return obj.text;
		if (typeof obj.stdout === "string") return obj.stdout;
		if (typeof obj.output === "string") return obj.output;
		const textContent = obj.content?.find((c) => c?.type === "text")?.text;
		if (textContent) return textContent;
	}
	return undefined;
}

export const fmtTokens = (n: number): string =>
	n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(n);

export const fmtCost = (n: number): string => (n >= 0.01 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`);

export interface LocalSlashCommand {
	id: string;
	match: RegExp;
	label: string;
	hint: string;
	kind: "action" | "nav" | "insert";
}

/** Local slash commands (OpenClaw-style: chat is the hub). */
export const LOCAL_SLASH: LocalSlashCommand[] = [
	// 会话与控制
	{ id: "clear", match: /^\/(clear|清屏|清空)\s*$/i, label: "/清屏", hint: "清空当前屏幕并开启新会话", kind: "action" },
	{ id: "compact", match: /^\/(compact|压缩)\s*$/i, label: "/压缩", hint: "压缩上下文并保存结构化检查点", kind: "action" },
	{ id: "new", match: /^\/(new|新建)\s*$/i, label: "/新建", hint: "新建对话会话", kind: "action" },
	{ id: "rename", match: /^\/(rename|重命名)(?:\s+([\s\S]+))?$/i, label: "/重命名", hint: "重命名当前会话标题 [/重命名 新名字]", kind: "action" },
	{ id: "export", match: /^\/(export|导出)\s*$/i, label: "/导出", hint: "导出当前对话为 Markdown 文档", kind: "action" },
	{ id: "copy", match: /^\/(copy|复制)\s*$/i, label: "/复制", hint: "复制最后一条回复内容到剪贴板", kind: "action" },
	{ id: "stats", match: /^\/(stats|统计)\s*$/i, label: "/统计", hint: "查看会话 Token 消耗、缓存命中与工具调用", kind: "action" },

	// 模型与思考配置
	{ id: "model", match: /^\/(model|模型)(?:\s+([\s\S]+))?$/i, label: "/模型", hint: "切换大模型 [/模型 模型名] 或弹出选择器", kind: "action" },
	{ id: "thinking", match: /^\/(thinking|思考)(?:\s+([\s\S]+))?$/i, label: "/思考", hint: "调整思考强度（off / low / medium / high）", kind: "action" },
	{ id: "fast", match: /^\/(fast|快速)\s*$/i, label: "/快速", hint: "快速响应模式：关闭深度思考", kind: "action" },
	{ id: "deep", match: /^\/(deep|深度)\s*$/i, label: "/深度", hint: "深度推理模式：开启最大深度思考", kind: "action" },
	{ id: "mode", match: /^\/(mode|模式)(?:\s+([\s\S]+))?$/i, label: "/模式", hint: "切换工作区模式：Chat / Personal / CWork", kind: "action" },

	// 长期记忆与知识
	{ id: "remember", match: /^\/(remember|记住)(?:\s+([\s\S]+))?$/i, label: "/记住", hint: "提取关键信息写入长期记忆知识库", kind: "action" },
	{ id: "memory", match: /^\/(memory|记忆)\s*$/i, label: "/记忆", hint: "打开长期记忆全景库与检索面板", kind: "nav" },

	// 任务与后台自动化
	{ id: "task", match: /^\/(task|任务)(?:\s+([\s\S]+))?$/i, label: "/任务", hint: "根据对话内容创建定时自动化任务", kind: "action" },
	{ id: "tasks", match: /^\/(tasks|任务列表)\s*$/i, label: "/任务列表", hint: "查看与管理后台定时自动化任务", kind: "nav" },

	// 智能工具直调
	{ id: "web", match: /^\/(web|搜索)(?:\s+([\s\S]+))?$/i, label: "/搜索", hint: "执行网络检索并汇总资讯 [/搜索 关键词]", kind: "insert" },
	{ id: "fetch", match: /^\/(fetch|抓取)(?:\s+([\s\S]+))?$/i, label: "/抓取", hint: "抓取指定 URL 网页核心正文 [/抓取 网址]", kind: "insert" },
	{ id: "code", match: /^\/(code|代码搜索)(?:\s+([\s\S]+))?$/i, label: "/代码搜索", hint: "在工作区检索代码符号定义 [/代码搜索 符号]", kind: "insert" },
	{ id: "kb", match: /^\/(kb|知识库)(?:\s+([\s\S]+))?$/i, label: "/知识库", hint: "查询工作区本地知识库索引 [/知识库 关键词]", kind: "insert" },
	{ id: "browser", match: /^\/(browser|浏览器)(?:\s+([\s\S]+))?$/i, label: "/浏览器", hint: "唤起无头浏览器进行页面渲染或操作", kind: "insert" },
	{ id: "github", match: /^\/(github|仓库)(?:\s+([\s\S]+))?$/i, label: "/仓库", hint: "检查 GitHub 仓库 PR / Issue / CI 状态", kind: "insert" },

	// 系统与导航
	{ id: "capabilities", match: /^\/(capabilities|能力|设置|settings)\s*$/i, label: "/能力", hint: "模型服务商、技能市场与 MCP 扩展", kind: "nav" },
	{ id: "skills", match: /^\/(skills|技能)\s*$/i, label: "/技能", hint: "浏览所有已安装的 Slash 技能", kind: "nav" },
	{ id: "mcp", match: /^\/mcp\s*$/i, label: "/mcp", hint: "配置外部 MCP 服务与连接适配器", kind: "nav" },
	{ id: "market", match: /^\/(market|市场)\s*$/i, label: "/市场", hint: "浏览技能市场与预置包", kind: "nav" },
	{ id: "git", match: /^\/(git|版本管理|分支|diff)\s*$/i, label: "/git", hint: "打开 Git 版本管理与变更审查面板", kind: "nav" },
	{ id: "daemon", match: /^\/(daemon|runtime|运行时)\s*$/i, label: "/运行时", hint: "查看后台守护进程与连接状态", kind: "nav" },
	{ id: "help", match: /^\/(help|帮助)\s*$/i, label: "/帮助", hint: "查看快捷斜杠命令列表与使用说明", kind: "action" },
];

export interface ParsedMemoryEntry {
	type: string;
	key: string;
	value: string;
	raw: string;
	parsed: boolean;
}

export function parseMemoryEntry(raw: string): ParsedMemoryEntry {
	const match = raw.match(/^\[(user|feedback|project|lesson)\]\s+([^:]+):\s*(.*)$/i);
	if (!match) return { type: "unknown", key: "Unrecognized entry", value: raw, raw, parsed: false };
	return {
		type: match[1]?.toLowerCase() ?? "unknown",
		key: match[2]?.trim() ?? "Memory",
		value: match[3]?.trim() ?? "",
		raw,
		parsed: true,
	};
}

export function formatAuditTimestamp(value?: string | number): string {
	if (value === undefined) return "Time unavailable";
	const numericValue = typeof value === "number" && value < 1_000_000_000_000 ? value * 1_000 : value;
	const date = new Date(numericValue);
	if (Number.isNaN(date.getTime())) return String(value);
	return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function prettyJson(value: string): string {
	if (!value.trim()) return "选择一次规划以查看详情。";
	try {
		const parsed: unknown = JSON.parse(value);
		return JSON.stringify(parsed, null, 2);
	} catch {
		return value;
	}
}

export function parseCommand(command: unknown): { name: string; description: string } {
	if (command && typeof command === "object") {
		const rec = command as Record<string, unknown>;
		const n = typeof rec.name === "string" ? rec.name.trim() : "";
		const d = typeof rec.description === "string" ? rec.description.trim() : "Conversation command";
		return { name: n, description: d };
	}
	if (typeof command !== "string") return { name: "", description: "Conversation command" };
	const [name, ...description] = command.split(/\s+(?:\u2014|\u2013|-)\s+/);
	return { name: name?.trim() || command, description: description.join(" - ").trim() || "Conversation command" };
}

export function formatUptime(uptimeMs?: number): string {
	if (uptimeMs === undefined) return "Unavailable";
	const totalMinutes = Math.max(0, Math.floor(uptimeMs / 60_000));
	const days = Math.floor(totalMinutes / 1_440);
	const hours = Math.floor((totalMinutes % 1_440) / 60);
	const minutes = totalMinutes % 60;
	if (days > 0) return `${days}d ${hours}h`;
	if (hours > 0) return `${hours}h ${minutes}m`;
	return `${minutes}m`;
}

