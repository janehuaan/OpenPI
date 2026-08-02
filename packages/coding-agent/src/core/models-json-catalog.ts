/**
 * Model discovery for OpenAI-compatible providers configured in models.json
 * without a static `models` array: fetch `GET {baseUrl}/models` (with the
 * configured API key) and expose the returned model ids dynamically.
 *
 * Mirrors withRemoteCatalog's overlay pattern (remote-catalog-provider.ts).
 */
import type { Api, Model, Provider } from "@earendil-works/pi-ai";
import type { ModelsJsonProvider } from "./model-config.ts";

const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 32_768;

function mergeModels(baseline: readonly Model<Api>[], dynamic: readonly Model<Api>[]): Model<Api>[] {
	const merged = [...baseline];
	for (const model of dynamic) {
		const index = merged.findIndex((entry) => entry.id === model.id);
		if (index >= 0) merged[index] = model;
		else merged.push(model);
	}
	return merged;
}

function parseOpenAiModelsResponse(providerId: string, api: Api, baseUrl: string, value: unknown): Model<Api>[] {
	const data =
		typeof value === "object" && value !== null && Array.isArray((value as { data?: unknown }).data)
			? (value as { data: Array<{ id?: unknown }> }).data
			: Array.isArray(value)
				? (value as Array<{ id?: unknown }>)
				: [];
	return data
		.filter((entry): entry is { id: string } => typeof entry?.id === "string")
		.map((entry) => ({
			id: entry.id,
			name: entry.id,
			api,
			provider: providerId,
			baseUrl,
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: DEFAULT_CONTEXT_WINDOW,
			maxTokens: DEFAULT_MAX_TOKENS,
		}));
}

/**
 * Wrap an OpenAI-compatible provider so its models are discovered from the
 * `GET {baseUrl}/models` endpoint when models.json has no static `models`
 * array for it. Requires a configured apiKey; without one the provider keeps
 * its baseline (empty) model list.
 */
export function withModelsJsonEndpoint(provider: Provider, config: ModelsJsonProvider): Provider {
	let dynamicModels: readonly Model<Api>[] = [];
	let inflightRefresh: Promise<void> | undefined;

	return {
		...provider,
		getModels: () => mergeModels(provider.getModels(), dynamicModels),
		refreshModels: (context) => {
			inflightRefresh ??= (async () => {
				try {
					const stored = await context.store.read();
					if (stored) {
						dynamicModels = stored.models.filter((model) => model.provider === provider.id);
					}
					if (!context.allowNetwork || context.signal?.aborted) return;
					if (stored?.checkedAt !== undefined && Date.now() - stored.checkedAt < 4 * 60 * 60 * 1000) {
						return;
					}
					if (typeof config.apiKey !== "string" || !config.apiKey) return;

					const url = `${config.baseUrl.replace(/\/+$/, "")}/models`;
					const response = await fetch(url, {
						headers: {
							accept: "application/json",
							authorization: `Bearer ${config.apiKey}`,
						},
						signal: context.signal,
					});
					if (context.signal?.aborted) return;
					const checkedAt = Date.now();
					if (response.status === 401 || response.status === 403 || response.status === 404) {
						await context.store.write({ models: dynamicModels, checkedAt });
						return;
					}
					if (!response.ok) {
						await context.store.write({ models: dynamicModels, checkedAt });
						throw new Error(`Model discovery failed for ${provider.id}: ${response.status}`);
					}
					const refreshed = parseOpenAiModelsResponse(
						provider.id,
						provider.api,
						config.baseUrl,
						await response.json(),
					);
					if (context.signal?.aborted) return;
					dynamicModels = refreshed;
					await context.store.write({ models: refreshed, checkedAt });
				} finally {
					inflightRefresh = undefined;
				}
			})();
			return inflightRefresh;
		},
	};
}
