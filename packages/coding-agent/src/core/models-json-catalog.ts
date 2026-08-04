/**
 * Model discovery for OpenAI-compatible providers configured in models.json
 * without a static `models` array: fetch `GET {baseUrl}/models` (with the
 * configured API key) and expose the returned model ids dynamically.
 *
 * Mirrors withRemoteCatalog's overlay pattern (remote-catalog-provider.ts).
 */
import type { Api, Model, Provider } from "@earendil-works/pi-ai";
import * as builtinProviderCatalog from "@earendil-works/pi-ai/providers/all";
import type { ModelsJsonProvider } from "./model-config.ts";
import { ensureModelsDevLoaded, lookupModelsDevMeta } from "./models-dev.ts";

const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 32_768;

/**
 * Built-in catalog indexed by normalized model id, built lazily. Lets models
 * discovered via `/models` inherit accurate metadata (context window, max
 * tokens, cost, reasoning) when the id matches a known built-in model.
 */
let builtinModelsById: Map<string, Model<Api>> | undefined;
function getBuiltinModelById(id: string): Model<Api> | undefined {
	if (!builtinModelsById) {
		const index = new Map<string, Model<Api>>();
		for (const provider of builtinProviderCatalog.getBuiltinProviders()) {
			for (const model of builtinProviderCatalog.getBuiltinModels(provider)) {
				if (!index.has(normalizeModelId(model.id))) index.set(normalizeModelId(model.id), model as Model<Api>);
			}
		}
		builtinModelsById = index;
	}
	return builtinModelsById.get(normalizeModelId(id));
}

/** Normalize a model id for cross-catalog matching: lowercase, strip `accounts/<org>/models/` prefixes. */
function normalizeModelId(id: string): string {
	return id.toLowerCase().replace(/^accounts\/[^/]+\/models\//, "");
}

/**
 * Read a context-window hint from a `/models` response entry when the server
 * provides one (e.g. `context_window`, `contextWindow`, `max_model_len`).
 */
function contextWindowFromEntry(entry: Record<string, unknown>): number | undefined {
	for (const key of ["context_window", "contextWindow", "context_length", "max_model_len"]) {
		const value = entry[key];
		if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.floor(value);
	}
	return undefined;
}

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
	const models = data
		.filter((entry): entry is { id: string } => typeof entry?.id === "string")
		.map((entry) => {
			// Inherit accurate metadata from the built-in catalog when the id
			// matches a known model; fall back to server-provided hints, then
			// conservative defaults (models.dev lookup happens lazily in
			// refreshModels, which awaits the shared index before parsing).
			const known = getBuiltinModelById(entry.id);
			const contextHint = contextWindowFromEntry(entry as Record<string, unknown>);
			return {
				id: entry.id,
				name: entry.id,
				api,
				provider: providerId,
				baseUrl,
				reasoning: known?.reasoning ?? false,
				input: known?.input ?? ["text"],
				cost: known?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: known?.contextWindow ?? contextHint ?? DEFAULT_CONTEXT_WINDOW,
				maxTokens: known?.maxTokens ?? DEFAULT_MAX_TOKENS,
			};
		});
	return applyModelsDevMeta(models);
}

/**
 * Overlay models.dev metadata on discovery results for ids that neither the
 * built-in catalog nor the server annotated. Synchronous: the models.dev
 * index is loaded (once, cached 24h) by refreshModels before parsing.
 */
function applyModelsDevMeta(models: Model<Api>[]): Model<Api>[] {
	let changed = false;
	const merged = models.map((model) => {
		const meta = lookupModelsDevMeta(model.id);
		if (!meta) return model;
		// models.dev fills only discovery defaults — never overrides built-in
		// catalog values or server-provided hints.
		const hasKnownCost = model.cost.input !== 0 || model.cost.output !== 0;
		if (
			model.contextWindow !== DEFAULT_CONTEXT_WINDOW &&
			model.maxTokens !== DEFAULT_MAX_TOKENS &&
			(hasKnownCost || meta.costInput === undefined) &&
			(model.reasoning || meta.reasoning !== true)
		) {
			return model;
		}
		changed = true;
		return {
			...model,
			reasoning: model.reasoning || (meta.reasoning ?? false),
			cost: hasKnownCost
				? model.cost
				: {
						input: meta.costInput ?? model.cost.input,
						output: meta.costOutput ?? model.cost.output,
						cacheRead: meta.costCacheRead ?? model.cost.cacheRead,
						cacheWrite: meta.costCacheWrite ?? model.cost.cacheWrite,
					},
			contextWindow:
				model.contextWindow !== DEFAULT_CONTEXT_WINDOW
					? model.contextWindow
					: (meta.context ?? model.contextWindow),
			maxTokens: model.maxTokens !== DEFAULT_MAX_TOKENS ? model.maxTokens : (meta.output ?? model.maxTokens),
		};
	});
	return changed ? merged : models;
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
					// A store whose models all carry the discovery defaults (128k /
					// zero cost / 32k max tokens) is stale: it was written before
					// metadata inheritance existed, so refresh it now.
					const staleDefaults =
						stored !== undefined &&
						stored.models.length > 0 &&
						stored.models.every(
							(model) =>
								model.contextWindow === DEFAULT_CONTEXT_WINDOW &&
								model.maxTokens === DEFAULT_MAX_TOKENS &&
								!model.cost?.input &&
								!model.cost?.output,
						);
					if (
						!staleDefaults &&
						stored?.checkedAt !== undefined &&
						Date.now() - stored.checkedAt < 4 * 60 * 60 * 1000
					) {
						return;
					}
					if (typeof config.apiKey !== "string" || !config.apiKey) return;
					if (!config.baseUrl) return;

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
					// Load the models.dev index once (cached 24h) so unknown ids
					// can inherit accurate metadata; any failure keeps defaults.
					await ensureModelsDevLoaded();
					const refreshed = await parseOpenAiModelsResponse(
						provider.id,
						(config.api as Api) ?? "openai-responses",
						config.baseUrl,
						await response.json(),
					);
					if (context.signal?.aborted) return;
					dynamicModels = refreshed;
					await context.store.write({ models: refreshed, checkedAt });
					await context.store.write({ models: refreshed, checkedAt });
				} finally {
					inflightRefresh = undefined;
				}
			})();
			return inflightRefresh;
		},
	};
}
