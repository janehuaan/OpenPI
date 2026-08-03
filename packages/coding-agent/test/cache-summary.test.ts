import { describe, expect, it } from "vitest";
import { computeCacheSummary } from "../src/core/cache-stats.ts";
import type { SessionEntry } from "../src/core/session-manager.ts";

function assistantEntry(id: string, usage: { input?: number; cacheRead?: number; cacheWrite?: number }): SessionEntry {
	return {
		type: "message",
		id,
		parentId: null,
		timestamp: "2026-01-01T00:00:00.000Z",
		message: {
			role: "assistant",
			provider: "anthropic",
			model: "claude-opus-4-8",
			timestamp: 1,
			content: [{ type: "text", text: "hi" }],
			usage: {
				input: usage.input ?? 1000,
				cacheRead: usage.cacheRead ?? 0,
				cacheWrite: usage.cacheWrite ?? 0,
				output: 10,
				totalTokens: (usage.input ?? 1000) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0) + 10,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
		},
	};
}

describe("computeCacheSummary", () => {
	it("computes the hit rate across assistant messages", () => {
		const entries: SessionEntry[] = [
			assistantEntry("a", { input: 1000, cacheWrite: 1000 }),
			assistantEntry("b", { input: 100, cacheRead: 1900 }),
			assistantEntry("c", { input: 100, cacheRead: 1900 }),
		];
		const summary = computeCacheSummary(entries);
		expect(summary.requests).toBe(3);
		expect(summary.inputTokens).toBe(1200);
		expect(summary.cacheReadTokens).toBe(3800);
		expect(summary.cacheWriteTokens).toBe(1000);
		expect(summary.hitRate).toBeCloseTo(3800 / 6000);
	});

	it("returns undefined hit rate when there is no usage data", () => {
		const entries: SessionEntry[] = [
			{
				type: "message",
				id: "a",
				parentId: null,
				timestamp: "2026-01-01T00:00:00.000Z",
				message: { role: "user", content: [{ type: "text", text: "hi" }], timestamp: 1 },
			},
		];
		const summary = computeCacheSummary(entries);
		expect(summary.requests).toBe(0);
		expect(summary.hitRate).toBeUndefined();
	});

	it("ignores non-assistant entries", () => {
		const entries: SessionEntry[] = [
			assistantEntry("a", { input: 500, cacheRead: 500 }),
			{
				type: "message",
				id: "b",
				parentId: null,
				timestamp: "2026-01-01T00:00:00.000Z",
				message: {
					role: "toolResult",
					toolCallId: "call-1",
					toolName: "read",
					isError: false,
					content: [{ type: "text", text: "out" }],
					timestamp: 2,
				},
			},
		];
		const summary = computeCacheSummary(entries);
		expect(summary.requests).toBe(1);
		expect(summary.hitRate).toBe(0.5);
	});
});
