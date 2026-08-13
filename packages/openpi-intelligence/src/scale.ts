import type { ContextBudget } from "./contract.ts";

/** Calibration baseline for context-scoped budgets (matches DEFAULT_CONTEXT_WINDOW). */
const REFERENCE_WINDOW = 128_000;

/** Numeric budget keys that scale with the model context window. */
const NUMERIC_BUDGET_KEYS = ["totalTokens", "reservedForConversation", "reservedForCompletion"] as const;
export type NumericBudgetKey = (typeof NUMERIC_BUDGET_KEYS)[number];

/**
 * Scale a base budget proportionally to a model's context window.
 * Windows >= the reference window (128k) are unchanged; smaller windows scale
 * down linearly and are clamped by `min`/`max`. Never scales up (`max = base`).
 */
export function scaleByContextWindow(
	contextWindow: number | undefined,
	base: number,
	opts: { referenceWindow?: number; min?: number; max?: number } = {},
): number {
	if (!contextWindow || contextWindow <= 0) return base;
	const reference = opts.referenceWindow ?? REFERENCE_WINDOW;
	const raw = Math.round((base * contextWindow) / reference);
	const upper = opts.max ?? Number.POSITIVE_INFINITY;
	const lower = opts.min ?? 0;
	return Math.min(upper, Math.max(lower, raw));
}

/**
 * Scale the dynamic-context budget for a model's context window.
 * Explicitly configured keys are preserved as-is; `scaleWithContext: false`
 * disables scaling entirely. Budget fields are never mutated — a new budget is
 * returned so repeated calls stay idempotent.
 */
export function scaleContextBudget(
	budget: ContextBudget,
	contextWindow: number | undefined,
	opts: {
		explicit?: ReadonlySet<NumericBudgetKey>;
		scaleWithContext?: boolean;
		referenceWindow?: number;
	} = {},
): ContextBudget {
	if (opts.scaleWithContext === false) return budget;

	const explicit = opts.explicit ?? new Set<NumericBudgetKey>();
	const scale = (key: NumericBudgetKey, min: number): number =>
		explicit.has(key) ? budget[key] : scaleByContextWindow(contextWindow, budget[key], { min, max: budget[key] });

	const totalTokens = scale("totalTokens", 1000);
	let reservedForConversation = scale("reservedForConversation", 0);
	let reservedForCompletion = scale("reservedForCompletion", 0);

	// Keep the validateContextBudget invariant conv + comp < total, even when a
	// single key alone exceeds the (possibly min-clamped) total.
	if (reservedForCompletion >= totalTokens) {
		reservedForCompletion = Math.max(0, totalTokens - 1);
	}
	if (reservedForConversation + reservedForCompletion >= totalTokens) {
		reservedForConversation = Math.max(0, totalTokens - reservedForCompletion - 1);
	}

	return {
		totalTokens,
		reservedForConversation,
		reservedForCompletion,
		sourceLimits: { ...budget.sourceLimits },
		maxItems: budget.maxItems,
	};
}
