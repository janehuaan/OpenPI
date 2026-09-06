import { describe, expect, it } from "vitest";
import { foldLongOutput, pruneHistoricalToolOutputs } from "../src/context-pruner.ts";

describe("Context Tool Output Pruner", () => {
	it("folds long text with head, marker, and tail", () => {
		const lines = Array.from({ length: 50 }, (_, i) => `Line ${i + 1}: detailed output information`);
		const text = lines.join("\n");

		const { folded, wasFolded, savedChars } = foldLongOutput(text, "grep", 5, 5);
		expect(wasFolded).toBe(true);
		expect(savedChars).toBeGreaterThan(100);
		expect(folded).toContain("Line 1:");
		expect(folded).toContain("Line 5:");
		expect(folded).toContain("... [Folded 40 lines of historical grep output");
		expect(folded).toContain("Line 46:");
		expect(folded).toContain("Line 50:");
	});

	it("leaves short text unchanged", () => {
		const shortText = "Command executed successfully in 2ms.";
		const { folded, wasFolded, savedChars } = foldLongOutput(shortText, "bash", 15, 10);
		expect(wasFolded).toBe(false);
		expect(folded).toBe(shortText);
		expect(savedChars).toBe(0);
	});

	it("preserves active window turns byte-exact and folds historical turns", () => {
		const longLog = Array.from({ length: 60 }, (_, i) => `Server log line ${i}: test data`).join("\n");

		const messages = [
			// Turn 1 (Historical)
			{ role: "user", content: "Check old build" },
			{ role: "assistant", content: [{ type: "text", text: "Running build" }] },
			{ role: "toolResult", toolName: "bash", content: [{ type: "text", text: longLog }] },

			// Turn 2 (Active Window - previous turn)
			{ role: "user", content: "Now check tests" },
			{ role: "assistant", content: [{ type: "text", text: "Running tests" }] },
			{ role: "toolResult", toolName: "bash", content: [{ type: "text", text: longLog }] },

			// Turn 3 (Active Window - current turn)
			{ role: "user", content: "What is the status?" },
		];

		const result = pruneHistoricalToolOutputs(messages, {
			activeWindowTurns: 2,
			charThreshold: 200,
			headLines: 5,
			tailLines: 5,
		});

		// Historical tool in Turn 1 should be folded
		expect(result.foldedCount).toBe(1);
		const tool1Content = result.messages[2].content as Array<{ type: string; text: string }>;
		expect(tool1Content[0].text).toContain("... [Folded");

		// Active window tool in Turn 2 must remain 100% UNTOUCHED
		const tool2Content = result.messages[5].content as Array<{ type: string; text: string }>;
		expect(tool2Content[0].text).toBe(longLog);
		expect(tool2Content[0].text).not.toContain("... [Folded");
	});
});
