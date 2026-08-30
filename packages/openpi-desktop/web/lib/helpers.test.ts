import { describe, expect, it } from "vitest";
import type { ConversationMessage } from "../types";
import {
	mergeConversationMessage,
	messageReasoning,
	normalizeConversationModels,
	thinkingLevelsForModel,
} from "./helpers";

const BASE_LEVELS = ["off", "minimal", "low", "medium", "high"];

describe("desktop thinking levels", () => {
	it("keeps the base controls for models without reasoning metadata", () => {
		expect(thinkingLevelsForModel({ reasoning: false, thinkingLevels: ["off"] })).toEqual(BASE_LEVELS);
	});

	it("adds extended controls only when the model declares them", () => {
		expect(thinkingLevelsForModel({ reasoning: false, thinkingLevelMap: { xhigh: "xhigh", max: null } })).toEqual([
			...BASE_LEVELS,
			"xhigh",
		]);
	});

	it("normalizes custom provider models to the base controls", () => {
		const [model] = normalizeConversationModels([{ provider: "custom", id: "gpt-custom" }]);
		expect(model?.thinkingLevels).toEqual(BASE_LEVELS);
	});
});

describe("mergeConversationMessage", () => {
	it("coalesces untimestamped streaming assistant updates", () => {
		const start: ConversationMessage = {
			role: "assistant",
			content: [{ type: "text", text: "" }],
		};
		const firstDelta: ConversationMessage = {
			role: "assistant",
			content: [{ type: "text", text: "hel" }],
		};
		const secondDelta: ConversationMessage = {
			role: "assistant",
			content: [{ type: "text", text: "hello" }],
		};

		const messages = [start, firstDelta, secondDelta].reduce<ConversationMessage[]>(
			(current, message) => mergeConversationMessage(current, message),
			[],
		);

		expect(messages).toEqual([secondDelta]);
	});

	it("replaces the untimestamped streaming shell when the final message arrives", () => {
		const partial: ConversationMessage = {
			role: "assistant",
			content: [{ type: "text", text: "hello" }],
		};
		const final: ConversationMessage = {
			role: "assistant",
			content: [{ type: "text", text: "hello" }],
			timestamp: 123,
		};

		const messages = [partial, final].reduce<ConversationMessage[]>(
			(current, message) => mergeConversationMessage(current, message),
			[],
		);

		expect(messages).toEqual([final]);
	});

	it("does not merge distinct user messages without timestamps", () => {
		const first: ConversationMessage = { role: "user", content: "one" };
		const second: ConversationMessage = { role: "user", content: "two" };

		expect(mergeConversationMessage([first], second)).toEqual([first, second]);
	});
});

describe("message reasoning", () => {
	it("joins thinking blocks so a reasoning-only shell still renders", () => {
		const message: ConversationMessage = {
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "first" },
				{ type: "text", text: "answer" },
				{ type: "thinking", thinking: "second" },
			],
		};

		expect(messageReasoning(message)).toBe("first\n\nsecond");
	});

	it("prefers the flat reasoning field carried by cached snapshots", () => {
		const message: ConversationMessage = {
			role: "assistant",
			content: [{ type: "thinking", thinking: "from blocks" }],
			reasoning: "from snapshot",
		};

		expect(messageReasoning(message)).toBe("from snapshot");
	});

	it("is empty for messages without thinking content", () => {
		expect(messageReasoning({ role: "assistant", content: [{ type: "text", text: "hi" }] })).toBe("");
		expect(messageReasoning({ role: "user", content: "hi" })).toBe("");
	});
});
