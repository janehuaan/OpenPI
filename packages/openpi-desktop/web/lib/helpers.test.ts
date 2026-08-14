import { describe, expect, it } from "vitest";
import type { ConversationMessage } from "../types";
import { mergeConversationMessage, normalizeConversationModels, thinkingLevelsForModel } from "./helpers";

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
