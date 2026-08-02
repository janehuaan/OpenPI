import { describe, expect, it } from "vitest";
import { normalizeConversationModels, thinkingLevelsForModel } from "./helpers";

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
