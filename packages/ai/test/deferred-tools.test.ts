import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { getModel, streamSimple } from "../src/compat.ts";
import type { Api, AssistantMessage, Context, Model, Tool, ToolResultMessage, UserMessage } from "../src/types.ts";
import { estimateContextTokens } from "../src/utils/estimate.ts";

interface AnthropicToolPayload {
	name: string;
	description?: string;
	defer_loading?: boolean;
}

interface AnthropicContentBlock {
	type: string;
	text?: string;
	tool_use_id?: string;
	content?: string | Array<{ type: string; tool_name?: string }>;
	source?: {
		type: string;
		media_type: string;
		data: string;
	};
}

interface AnthropicPayload {
	tools?: AnthropicToolPayload[];
	messages: Array<{
		content: string | AnthropicContentBlock[];
	}>;
}

interface OpenAIToolSearchCall {
	type: "tool_search_call";
	call_id?: string | null;
	execution?: string;
	status?: string | null;
}

interface OpenAIToolSearchOutput {
	type: "tool_search_output";
	call_id?: string | null;
	execution?: string;
	status?: string | null;
	tools: Array<{ type: string; name: string; defer_loading?: boolean }>;
}

interface OpenAIPayload {
	tools?: Array<{ name?: string; function?: { name: string } }>;
	input?: Array<OpenAIToolSearchCall | OpenAIToolSearchOutput | { type?: string }>;
}

class PayloadCaptured extends Error {}

function makeTool(name: string): Tool {
	return {
		name,
		description: `The ${name} tool`,
		parameters: Type.Object({ value: Type.String() }),
	};
}

function makeUserMessage(timestamp: number): UserMessage {
	return { role: "user", content: "Hello", timestamp };
}

function makeAssistantToolCall(): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "toolCall", id: "call_1", name: "base_tool", arguments: {} }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-opus-4-6",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "toolUse",
		timestamp: 2,
	};
}

function makeToolResult(addedToolNames: string[]): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId: "call_1",
		toolName: "base_tool",
		content: [{ type: "text", text: "done" }],
		addedToolNames,
		isError: false,
		timestamp: 3,
	};
}

function makeContext(tools: Tool[], addedToolNames = ["late_tool"]): Context {
	return {
		messages: [makeUserMessage(1), makeAssistantToolCall(), makeToolResult(addedToolNames), makeUserMessage(4)],
		tools,
	};
}

async function capturePayload<T>(model: Model<Api>, context: Context, apiKey = "fake-key"): Promise<T> {
	let captured: T | undefined;
	const stream = streamSimple({ ...model, baseUrl: "http://127.0.0.1:9" }, context, {
		apiKey,
		onPayload: (payload) => {
			captured = payload as T;
			throw new PayloadCaptured();
		},
	});
	await stream.result();
	if (!captured) throw new Error("Expected payload capture");
	return captured;
}

function findAnthropicToolResultContent(payload: AnthropicPayload): AnthropicContentBlock[] {
	for (const message of payload.messages) {
		if (typeof message.content !== "string" && message.content.some((block) => block.type === "tool_result")) {
			return message.content;
		}
	}
	throw new Error("No tool result in payload");
}

function _findAnthropicToolResult(payload: AnthropicPayload): AnthropicContentBlock {
	const result = findAnthropicToolResultContent(payload).find((block) => block.type === "tool_result");
	if (!result) throw new Error("No tool result in payload");
	return result;
}

function openAIToolNames(payload: OpenAIPayload): string[] {
	return (payload.tools ?? []).map((tool) => tool.name ?? tool.function?.name ?? "");
}

function makeCodexToken(): string {
	return `header.${btoa(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "account" } }))}.signature`;
}

describe("deferred tools", () => {
	it("loads an OpenAI Responses tool through client tool search", async () => {
		const context = makeContext([makeTool("base_tool"), makeTool("late_tool")]);
		const payload = await capturePayload<OpenAIPayload>(getModel("openai", "gpt-5.6-luna"), context);
		const searchCall = payload.input?.find((item): item is OpenAIToolSearchCall => item.type === "tool_search_call");
		const searchOutput = payload.input?.find(
			(item): item is OpenAIToolSearchOutput => item.type === "tool_search_output",
		);

		expect(openAIToolNames(payload)).toEqual(["base_tool"]);
		expect(searchCall).toMatchObject({ execution: "client", status: "completed" });
		expect(searchOutput?.call_id).toBe(searchCall?.call_id);
		expect(searchOutput?.tools).toMatchObject([{ type: "function", name: "late_tool", defer_loading: true }]);
	});

	it("uses the normal tool list when OpenAI tool search is explicitly disabled", async () => {
		const model: Model<"openai-responses"> = {
			...getModel("openai", "gpt-5.6-luna"),
			provider: "openai-proxy",
			compat: { supportsToolSearch: false },
		};
		const context = makeContext([makeTool("base_tool"), makeTool("late_tool")]);
		const payload = await capturePayload<OpenAIPayload>(model, context);

		expect(openAIToolNames(payload)).toEqual(["base_tool", "late_tool"]);
		expect(payload.input?.some((item) => item.type === "tool_search_output")).toBe(false);
	});

	it("uses tool search only for supported Codex models", async () => {
		const context = makeContext([makeTool("base_tool"), makeTool("late_tool")]);
		const supported = await capturePayload<OpenAIPayload>(
			getModel("openai-codex", "gpt-5.4"),
			context,
			makeCodexToken(),
		);
		const unsupported = await capturePayload<OpenAIPayload>(
			getModel("openai-codex", "gpt-5.3-codex-spark"),
			context,
			makeCodexToken(),
		);

		expect(openAIToolNames(supported)).toEqual(["base_tool"]);
		expect(supported.input?.some((item) => item.type === "tool_search_output")).toBe(true);
		expect(openAIToolNames(unsupported)).toEqual(["base_tool", "late_tool"]);
		expect(unsupported.input?.some((item) => item.type === "tool_search_output")).toBe(false);
	});

	it("counts definitions marked after the latest usage checkpoint", () => {
		const assistant: AssistantMessage = {
			...makeAssistantToolCall(),
			content: [{ type: "text", text: "done" }],
			usage: {
				input: 50,
				output: 50,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 100,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
		};
		const plain = estimateContextTokens({ messages: [assistant, makeUserMessage(4)], tools: [] });
		const lateTool = { ...makeTool("late_tool"), description: "x".repeat(4000) };
		const marked = estimateContextTokens({
			messages: [assistant, makeToolResult(["late_tool"])],
			tools: [lateTool],
		});

		expect(marked.tokens).toBeGreaterThan(plain.tokens + 500);
		expect(marked.trailingTokens).toBeGreaterThan(plain.trailingTokens + 500);
	});
});
