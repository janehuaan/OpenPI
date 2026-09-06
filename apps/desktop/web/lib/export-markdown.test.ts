import { describe, expect, it } from "vitest";
import type { ConversationSnapshot } from "../types";
import {
	formatConversationToMarkdown,
	formatMessageToMarkdown,
	generateExportFilename,
} from "./export-markdown";

describe("export-markdown", () => {
	const sampleConversation: ConversationSnapshot = {
		instance: {
			id: "inst-123",
			status: "online",
			mode: "code",
			cwd: "/Users/dev/my-project",
			label: "Feature Discussion",
		},
		state: {
			sessionId: "session-123",
			sessionName: "Auth Feature",
			messageCount: 3,
			pendingMessageCount: 0,
			thinkingLevel: "off",
			isStreaming: false,
			isCompacting: false,
			model: {
				provider: "anthropic",
				id: "claude-3-5-sonnet",
			},
		},
		messages: [
			{
				role: "user",
				content: "Can you help add auth to the app?",
				timestamp: 1700000000000,
			},
			{
				role: "assistant",
				content: [
					{ type: "text", text: "I can help with that. Let me inspect the project files." },
					{
						type: "toolCall",
						id: "call-1",
						name: "read_file",
						arguments: { path: "src/auth.ts" },
					},
				],
				reasoning: "The user wants authentication. First inspect auth.ts.",
				timestamp: 1700000005000,
			},
			{
				role: "toolResult",
				toolName: "read_file",
				content: "export const auth = null;",
				timestamp: 1700000006000,
			},
			{
				role: "assistant",
				content: "I see `src/auth.ts` is currently null. Let's implement JWT auth.",
				timestamp: 1700000010000,
			},
		],
	};

	describe("formatMessageToMarkdown", () => {
		it("formats user message with text", () => {
			const md = formatMessageToMarkdown({
				role: "user",
				content: "Hello OpenPI",
			});
			expect(md).toContain("## 👤 User");
			expect(md).toContain("Hello OpenPI");
		});

		it("formats user message with attachments", () => {
			const md = formatMessageToMarkdown({
				role: "user",
				content:
					"Here are files:\n\n<openpi-attachments>\n--- readme.md ---\n# Title\n</openpi-attachments>",
			});
			expect(md).toContain("## 👤 User");
			expect(md).toContain("Here are files:");
			expect(md).toContain("<summary>📎 Attached Documents</summary>");
			expect(md).toContain("# Title");
		});

		it("formats assistant message with thinking, tool calls, and text", () => {
			const md = formatMessageToMarkdown({
				role: "assistant",
				content: [
					{ type: "text", text: "Done!" },
					{ type: "toolCall", id: "t1", name: "bash", arguments: { cmd: "npm test" } },
				],
				reasoning: "Running tests to verify.",
			});
			expect(md).toContain("## 🤖 OpenPI");
			expect(md).toContain("<summary>💭 Thinking Process</summary>");
			expect(md).toContain("Running tests to verify.");
			expect(md).toContain("<summary>🛠️ Tool Calls (1)</summary>");
			expect(md).toContain("**bash**");
			expect(md).toContain("npm test");
			expect(md).toContain("Done!");
		});

		it("strips embedded <think> tags from assistant text when reasoning exists", () => {
			const md = formatMessageToMarkdown({
				role: "assistant",
				content: "<think>My thought</think>Here is the final answer.",
			});
			expect(md).toContain("<summary>💭 Thinking Process</summary>");
			expect(md).toContain("My thought");
			expect(md).toContain("Here is the final answer.");
			expect(md).not.toContain("<think>");
		});

		it("formats assistant error message", () => {
			const md = formatMessageToMarkdown({
				role: "assistant",
				content: "",
				isError: true,
				errorMessage: "Rate limit exceeded",
			});
			expect(md).toContain("> ⚠️ **Error**: Rate limit exceeded");
		});

		it("formats toolResult message", () => {
			const md = formatMessageToMarkdown({
				role: "toolResult",
				toolName: "read_file",
				content: "file content here",
			});
			expect(md).toContain("### 🛠️ Tool Result: read_file");
			expect(md).toContain("file content here");
		});
	});

	describe("formatConversationToMarkdown", () => {
		it("generates a complete markdown document with metadata", () => {
			const doc = formatConversationToMarkdown(sampleConversation);

			// Title
			expect(doc).toContain("# Auth Feature");
			// Metadata
			expect(doc).toContain("> **Session**: Auth Feature");
			expect(doc).toContain("> **Session ID**: `inst-123`");
			expect(doc).toContain("> **Mode**: code");
			expect(doc).toContain("> **Workspace**: `/Users/dev/my-project`");
			expect(doc).toContain("> **Model**: anthropic/claude-3-5-sonnet");
			// Separator
			expect(doc).toContain("---");
			// Messages
			expect(doc).toContain("## 👤 User");
			expect(doc).toContain("Can you help add auth to the app?");
			expect(doc).toContain("## 🤖 OpenPI");
			expect(doc).toContain("<summary>💭 Thinking Process</summary>");
			expect(doc).toContain("### 🛠️ Tool Result: read_file");
			expect(doc).toContain("*Exported from OpenPI Desktop • 4 messages*");
		});

		it("supports disabling metadata, reasoning, and tool calls", () => {
			const doc = formatConversationToMarkdown(sampleConversation, {
				includeMetadata: false,
				includeReasoning: false,
				includeToolCalls: false,
			});

			expect(doc).not.toContain("> **Session ID**");
			expect(doc).not.toContain("💭 Thinking Process");
			expect(doc).not.toContain("🛠️ Tool Calls");
			expect(doc).toContain("Can you help add auth to the app?");
		});
	});

	describe("generateExportFilename", () => {
		it("generates safe filename from session name", () => {
			const filename = generateExportFilename(sampleConversation);
			expect(filename).toMatch(/^auth-feature-\d{4}-\d{2}-\d{2}\.md$/);
		});

		it("sanitizes forbidden filename characters", () => {
			const conversation: ConversationSnapshot = {
				...sampleConversation,
				state: {
					...sampleConversation.state,
					sessionName: "Fix: /path\\to/file *? <>|",
				},
			};
			const filename = generateExportFilename(conversation);
			expect(filename).not.toMatch(/[\\/:*?"<>|]/);
			expect(filename).toMatch(/^fix-path-to-file-\d{4}-\d{2}-\d{2}\.md$/);
		});

		it("falls back to label or 'conversation' when name is empty", () => {
			const conversation: ConversationSnapshot = {
				...sampleConversation,
				instance: { ...sampleConversation.instance, label: "" },
				state: { ...sampleConversation.state, sessionName: "" },
			};
			const filename = generateExportFilename(conversation);
			expect(filename).toMatch(/^conversation-\d{4}-\d{2}-\d{2}\.md$/);
		});
	});
});
