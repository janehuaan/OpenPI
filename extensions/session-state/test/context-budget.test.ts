import { describe, it, expect } from "vitest";
import { estimateMessageTokens, assessAndBudgetMessages } from "../src/context-budget.ts";

describe("Context Budget & Micro-Compaction", () => {
	it("accurately estimates message tokens", () => {
		const messages = [
			{ role: "user", content: "Hello world, this is a test prompt." },
			{
				role: "assistant",
				content: [
					{ type: "text", text: "Here is your solution." },
					{ type: "toolCall", name: "read", arguments: { path: "src/index.ts" } },
				],
			},
		];

		const tokens = estimateMessageTokens(messages);
		expect(tokens).toBeGreaterThan(15);
		expect(tokens).toBeLessThan(100);
	});

	it("accurately handles CJK non-ASCII text tokens higher than ASCII", () => {
		const englishMessage = [{ role: "user", content: "a".repeat(100) }];
		const cjkMessage = [{ role: "user", content: "中".repeat(100) }];

		const engTokens = estimateMessageTokens(englishMessage);
		const cjkTokens = estimateMessageTokens(cjkMessage);

		// 100 Chinese characters should produce ~150 tokens (+ overhead), much higher than 100 ASCII chars (~26 tokens)
		expect(cjkTokens).toBeGreaterThan(150);
		expect(cjkTokens).toBeGreaterThan(engTokens * 3);
	});

	it("returns safe assessment when well below context limits", () => {
		const messages = [
			{ role: "user", content: "Short message" },
			{ role: "assistant", content: [{ type: "text", text: "Short reply" }] },
		];

		const assessment = assessAndBudgetMessages(messages, 128_000);
		expect(assessment.warning).toBe(false);
		expect(assessment.compacted).toBe(false);
		expect(assessment.messages.length).toBe(2);
	});

	it("triggers warning when exceeding 80% budget", () => {
		// Context window of 100 tokens
		const longText = "a".repeat(320); // ~90 tokens
		const messages = [
			{ role: "user", content: longText },
			{ role: "assistant", content: [{ type: "text", text: "ok" }] },
		];

		const assessment = assessAndBudgetMessages(messages, 100, { criticalThreshold: 0.95 });
		expect(assessment.warning).toBe(true);
		expect(assessment.compacted).toBe(false);
	});

	it("triggers proactive micro-compaction when exceeding 85% critical threshold", () => {
		// Create 8 turns of messages exceeding 1000 tokens in a 1000-token window
		const messages: any[] = [];
		for (let i = 0; i < 8; i++) {
			messages.push({ role: "user", content: `Turn ${i}: ` + "code line ".repeat(40) });
			messages.push({ role: "assistant", content: [{ type: "text", text: `Reply ${i}` }] });
		}

		const assessment = assessAndBudgetMessages(messages, 800, { criticalThreshold: 0.85 });
		expect(assessment.compacted).toBe(true);
		expect(assessment.foldedTurns).toBeGreaterThan(0);
		// Compressed messages should have summary block + recent tail turns
		expect(assessment.messages.length).toBeLessThan(messages.length);
		const summaryText = assessment.messages[0].content[0].text;
		expect(summaryText).toContain("自适应微压缩");
	});
});
