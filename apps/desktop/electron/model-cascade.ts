/**
 * Model Cascade Fallback Engine
 *
 * Intercepts 429 Rate Limits, 503 Overloaded, 504 Gateway Timeouts, and
 * provider-level outages, automatically cascading to a configured or discovered
 * backup model so that multi-step agent tasks do not terminate abruptly.
 */

export interface CascadeCandidate {
	provider: string;
	id: string;
	name?: string;
}

/**
 * Determines whether an error message indicates an API rate limit, quota exhaustion,
 * or temporary upstream model outage.
 */
export function isModelOutageOrRateLimitError(err: unknown): boolean {
	if (!err) return false;
	const text = err instanceof Error ? err.message : String(err);
	return (
		/\b(?:429|503|504)\b/i.test(text) ||
		/rate[-_ ]?limit/i.test(text) ||
		/quota[-_ ]?exceeded/i.test(text) ||
		/insufficient[-_ ]?quota/i.test(text) ||
		/overloaded/i.test(text) ||
		/model_busy/i.test(text) ||
		/service[-_ ]?unavailable/i.test(text) ||
		/gateway[-_ ]?timeout/i.test(text) ||
		/out[-_ ]?of[-_ ]?capacity/i.test(text) ||
		/server[-_ ]?is[-_ ]?busy/i.test(text)
	);
}

/**
 * Selects the optimal fallback model from the available candidate list.
 */
export function pickCascadeFallbackModel(
	currentModel: { provider?: string; id?: string } | undefined,
	availableModels: CascadeCandidate[],
	configuredPreferredFallback?: CascadeCandidate,
): CascadeCandidate | null {
	if (!availableModels || availableModels.length === 0) return null;

	const curProvider = currentModel?.provider?.toLowerCase() ?? "";
	const curId = currentModel?.id?.toLowerCase() ?? "";

	// 1. If a preferred fallback model is configured and is not the failing model
	if (
		configuredPreferredFallback &&
		(configuredPreferredFallback.provider.toLowerCase() !== curProvider ||
			configuredPreferredFallback.id.toLowerCase() !== curId)
	) {
		const match = availableModels.find(
			(m) =>
				m.provider.toLowerCase() === configuredPreferredFallback.provider.toLowerCase() &&
				m.id.toLowerCase() === configuredPreferredFallback.id.toLowerCase(),
		);
		if (match) return match;
	}

	// 2. Filter out the current failing model
	const candidates = availableModels.filter(
		(m) => !(m.provider.toLowerCase() === curProvider && m.id.toLowerCase() === curId),
	);
	if (candidates.length === 0) return null;

	// 3. Prefer a candidate from a different provider to bypass provider-wide outages
	const differentProvider = candidates.find(
		(m) => m.provider.toLowerCase() !== curProvider,
	);
	if (differentProvider) return differentProvider;

	// 4. Otherwise, pick the best alternate in the same provider (e.g. a flash/lite tier)
	const liteTier = candidates.find((m) =>
		/flash|lite|mini|small|turbo|instant|haiku|nano/i.test(m.id),
	);
	return liteTier || candidates[0];
}
