import { describe, expect, it } from "vitest";
import { type NumericBudgetKey, scaleByContextWindow, scaleContextBudget } from "../src/scale.ts";

const FULL_BUDGET = {
	totalTokens: 24000,
	reservedForConversation: 6000,
	reservedForCompletion: 8000,
	sourceLimits: { conversation: 3000, code: 9000, git: 2500, memory: 2000, knowledge: 3500, web: 0 },
	maxItems: 20,
} as const;

describe("scaleByContextWindow", () => {
	it("is identity at the reference window (128k)", () => {
		expect(scaleByContextWindow(128_000, 2400)).toBe(2400);
	});

	it("scales down linearly for smaller windows", () => {
		expect(scaleByContextWindow(64_000, 2400)).toBe(1200);
		expect(scaleByContextWindow(32_000, 2400)).toBe(600);
	});

	it("returns base for undefined or non-positive windows", () => {
		expect(scaleByContextWindow(undefined, 2400)).toBe(2400);
		expect(scaleByContextWindow(0, 2400)).toBe(2400);
		expect(scaleByContextWindow(-100, 2400)).toBe(2400);
	});

	it("clamps to min", () => {
		expect(scaleByContextWindow(8000, 2400, { min: 600 })).toBe(600);
	});

	it("never scales up (max = base)", () => {
		expect(scaleByContextWindow(1_000_000, 2400, { max: 2400 })).toBe(2400);
	});
});

describe("scaleContextBudget", () => {
	it("scales all numeric keys proportionally", () => {
		const scaled = scaleContextBudget({ ...FULL_BUDGET }, 64_000);
		expect(scaled.totalTokens).toBe(12000);
		expect(scaled.reservedForConversation).toBe(3000);
		expect(scaled.reservedForCompletion).toBe(4000);
	});

	it("keeps sourceLimits and maxItems untouched", () => {
		const scaled = scaleContextBudget({ ...FULL_BUDGET }, 32_000);
		expect(scaled.sourceLimits).toEqual(FULL_BUDGET.sourceLimits);
		expect(scaled.maxItems).toBe(20);
	});

	it("preserves explicitly configured keys", () => {
		const explicit = new Set<NumericBudgetKey>(["totalTokens"]);
		const scaled = scaleContextBudget({ ...FULL_BUDGET }, 64_000, { explicit });
		expect(scaled.totalTokens).toBe(24000);
		expect(scaled.reservedForConversation).toBe(3000);
		expect(scaled.reservedForCompletion).toBe(4000);
	});

	it("returns the budget unchanged when scaleWithContext is false", () => {
		const scaled = scaleContextBudget({ ...FULL_BUDGET }, 32_000, { scaleWithContext: false });
		expect(scaled).toEqual(FULL_BUDGET);
	});

	it("keeps the conv + comp < total invariant", () => {
		const budget = { ...FULL_BUDGET, totalTokens: 1000, reservedForCompletion: 8000 };
		const scaled = scaleContextBudget(budget, 32_000);
		expect(scaled.reservedForConversation + scaled.reservedForCompletion).toBeLessThan(scaled.totalTokens);
	});

	it("is identity at 128k and does not mutate the input", () => {
		const scaled = scaleContextBudget({ ...FULL_BUDGET }, 128_000);
		expect(scaled).toEqual(FULL_BUDGET);
	});
});
