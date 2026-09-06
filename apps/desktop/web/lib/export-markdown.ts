import type { ConversationMessage, ConversationSnapshot } from "../types";
import { contentImages, contentText, instanceTitle, messageReasoning, toolCalls, visibleMessageText } from "./helpers";

export interface ExportMarkdownOptions {
	title?: string;
	filename?: string;
	includeMetadata?: boolean;
	includeReasoning?: boolean;
	includeToolCalls?: boolean;
	includeToolResults?: boolean;
}

/**
 * Formats a conversation snapshot into a clean, GitHub-Flavored Markdown document.
 */
export function formatConversationToMarkdown(
	conversation: ConversationSnapshot,
	options: ExportMarkdownOptions = {},
): string {
	const {
		title: customTitle,
		includeMetadata = true,
		includeReasoning = true,
		includeToolCalls = true,
		includeToolResults = true,
	} = options;

	const title = customTitle || instanceTitle(conversation.instance, conversation.state.sessionName);
	const lines: string[] = [`# ${title}`, ""];

	if (includeMetadata) {
		const metaLines: string[] = [];
		const sessionName = conversation.state.sessionName || conversation.instance.label;
		if (sessionName) metaLines.push(`> **Session**: ${sessionName}`);
		if (conversation.instance.id) metaLines.push(`> **Session ID**: \`${conversation.instance.id}\``);
		if (conversation.instance.mode) metaLines.push(`> **Mode**: ${conversation.instance.mode}`);
		if (conversation.instance.cwd) metaLines.push(`> **Workspace**: \`${conversation.instance.cwd}\``);
		if (conversation.state.model) {
			const { provider, id } = conversation.state.model;
			const modelLabel = provider ? (id ? `${provider}/${id}` : provider) : (id ?? "");
			if (modelLabel) metaLines.push(`> **Model**: ${modelLabel}`);
		}
		const dateStr = new Date().toISOString().replace("T", " ").slice(0, 19);
		metaLines.push(`> **Exported**: ${dateStr}`);

		if (metaLines.length > 0) {
			lines.push(...metaLines);
			lines.push("", "---", "");
		}
	}

	const messages = conversation.messages ?? [];

	for (const message of messages) {
		const formatted = formatMessageToMarkdown(message, {
			includeReasoning,
			includeToolCalls,
			includeToolResults,
		});
		if (formatted) {
			lines.push(formatted, "");
		}
	}

	lines.push("---", `*Exported from OpenPI Desktop • ${messages.length} messages*`, "");

	return lines.join("\n");
}

/**
 * Formats a single conversation message to Markdown.
 */
export function formatMessageToMarkdown(
	message: ConversationMessage,
	options: {
		includeReasoning?: boolean;
		includeToolCalls?: boolean;
		includeToolResults?: boolean;
	} = {},
): string {
	const { includeReasoning = true, includeToolCalls = true, includeToolResults = true } = options;

	if (message.role === "user") {
		const lines: string[] = ["## 👤 User", ""];
		const rawText = contentText(message.content);
		const visibleText = visibleMessageText(rawText);

		if (visibleText) {
			lines.push(visibleText);
		}

		// Check for embedded openpi-attachments
		const attachmentMatch = rawText.match(/<openpi-attachments>([\s\S]*?)<\/openpi-attachments>/);
		if (attachmentMatch && attachmentMatch[1].trim()) {
			lines.push(
				"",
				"<details>",
				"<summary>📎 Attached Documents</summary>",
				"",
				"```",
				attachmentMatch[1].trim(),
				"```",
				"</details>",
			);
		}

		// Check for attached images
		const images = contentImages(message.content);
		if (images.length > 0) {
			lines.push(
				"",
				`> 🖼️ *[${images.length} image attachment${images.length > 1 ? "s" : ""}]*`,
			);
		}

		return lines.join("\n");
	}

	if (message.role === "assistant") {
		const lines: string[] = ["## 🤖 OpenPI", ""];

		// Reasoning / Thinking block
		if (includeReasoning) {
			const reasoning = messageReasoning(message);
			if (reasoning) {
				lines.push(
					"<details>",
					"<summary>💭 Thinking Process</summary>",
					"",
					reasoning,
					"",
					"</details>",
					"",
				);
			}
		}

		// Tool calls in assistant message
		if (includeToolCalls) {
			const calls = toolCalls(message);
			if (calls.length > 0) {
				lines.push(
					"<details>",
					`<summary>🛠️ Tool Calls (${calls.length})</summary>`,
					"",
				);
				for (const call of calls) {
					lines.push(`- **${call.name}**`);
					if (call.detail) {
						lines.push("```json", call.detail, "```");
					}
				}
				lines.push("</details>", "");
			}
		}

		// Main response content
		const rawText = contentText(message.content);
		// Strip <think>...</think> if present, as reasoning is rendered separately
		const cleanText = rawText.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "").trim();

		if (cleanText) {
			lines.push(cleanText);
		}

		if (message.isError || message.errorMessage) {
			lines.push("", `> ⚠️ **Error**: ${message.errorMessage || "Unknown error"}`);
		}

		return lines.join("\n");
	}

	if (message.role === "toolResult") {
		if (!includeToolResults) return "";
		const toolName = message.toolName || "Tool";
		const lines: string[] = [`### 🛠️ Tool Result: ${toolName}`, ""];

		if (message.isError) {
			lines.push("> ⚠️ **Tool execution failed**", "");
		}

		const detail = contentText(message.content);
		if (detail) {
			lines.push("```", detail, "```");
		}

		return lines.join("\n");
	}

	if (message.role === "system") {
		const text = contentText(message.content);
		return `> ℹ️ **System**: ${text}`;
	}

	return "";
}

/**
 * Generates a clean, filesystem-safe filename for exporting a conversation.
 */
export function generateExportFilename(conversation: ConversationSnapshot): string {
	const rawTitle = conversation.state.sessionName || conversation.instance.label || "conversation";
	const sanitized = rawTitle
		.trim()
		.toLowerCase()
		.replace(/[\\/:*?"<>|]+/g, "-")
		.replace(/\s+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
	const date = new Date().toISOString().slice(0, 10);
	return `${sanitized || "conversation"}-${date}.md`;
}

/**
 * Triggers a download of a Markdown file in the browser or Electron renderer.
 */
export function downloadMarkdownFile(content: string, filename: string): void {
	if (typeof document === "undefined") return;
	const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
	URL.revokeObjectURL(url);
}

/**
 * Formats and downloads the given conversation snapshot as Markdown.
 */
export function exportAndDownloadConversation(
	conversation: ConversationSnapshot,
	options?: ExportMarkdownOptions,
): string {
	const markdown = formatConversationToMarkdown(conversation, options);
	const filename = options?.filename || generateExportFilename(conversation);
	downloadMarkdownFile(markdown, filename);
	return markdown;
}
