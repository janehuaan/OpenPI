/** Calibration baseline for context-scoped budgets (matches DEFAULT_CONTEXT_WINDOW). */
const REFERENCE_WINDOW = 128_000;

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
