/**
 * LiteLLM model metadata lookup (built-in, optional second source).
 *
 * Consults LiteLLM's `model_prices_and_context_window.json` (the largest
 * public model-pricing catalog, ~3000 entries) for ids that neither the
 * built-in catalog, the server response, nor models.dev cover. Fetched once,
 * cached 24h at `<agentDir>/litellm-cache.json`; any failure degrades
 * silently. Cost fields are per-1M-tokens (converted from per-token).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "../config.ts";
import type { ModelsDevMeta } from "./models-dev.ts";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 45_000;
const LITELLM_URL = "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

let cachePath = join(getAgentDir(), "litellm-cache.json");
let byId: Map<string, ModelsDevMeta> | undefined;
let inflight: Promise<void> | undefined;

/** Test hook: redirect the cache file (e.g. to a temp dir). */
export function setLiteLlmCachePath(path: string): void {
	cachePath = path;
}

/** Test hook: drop the in-memory index so the next load re-fetches. */
export function resetLiteLlmForTest(): void {
	byId = undefined;
	inflight = undefined;
}

function parseLiteLlmData(data: unknown): Map<string, ModelsDevMeta> {
	const index = new Map<string, ModelsDevMeta>();
	if (typeof data !== "object" || data === null) return index;
	for (const model of Object.values(data as Record<string, unknown>)) {
		if (typeof model !== "object" || model === null) continue;
		const entry = model as Record<string, unknown>;
		const id =
			typeof entry.id === "string" ? entry.id : typeof entry.model_name === "string" ? entry.model_name : undefined;
		if (!id) continue;
		// LiteLLM keys are "provider/model"; prefer the bare model name.
		const bareId = id.includes("/") ? id.slice(id.indexOf("/") + 1) : id;
		if (!bareId) continue;
		const meta: ModelsDevMeta = {};
		if (typeof entry.max_input_tokens === "number" && entry.max_input_tokens > 0) {
			meta.context = Math.floor(entry.max_input_tokens);
		}
		const output = typeof entry.max_output_tokens === "number" ? entry.max_output_tokens : entry.max_tokens;
		if (typeof output === "number" && output > 0) meta.output = Math.floor(output);
		// Cost fields are per token in LiteLLM; convert to per 1M tokens.
		if (typeof entry.input_cost_per_token === "number") {
			meta.costInput = entry.input_cost_per_token * 1_000_000;
		}
		if (typeof entry.output_cost_per_token === "number") {
			meta.costOutput = entry.output_cost_per_token * 1_000_000;
		}
		if (typeof entry.cache_read_input_token_cost === "number") {
			meta.costCacheRead = entry.cache_read_input_token_cost * 1_000_000;
		}
		if (typeof entry.cache_creation_input_token_cost === "number") {
			meta.costCacheWrite = entry.cache_creation_input_token_cost * 1_000_000;
		}
		if (
			meta.context ||
			meta.output ||
			meta.costInput !== undefined ||
			meta.costOutput !== undefined ||
			meta.costCacheRead !== undefined
		) {
			index.set(bareId, meta);
		}
	}
	return index;
}

async function loadLiteLlmIndex(): Promise<void> {
	if (byId) return;

	try {
		if (existsSync(cachePath)) {
			const cached = JSON.parse(readFileSync(cachePath, "utf8")) as {
				fetchedAt: number;
				byId: Array<[string, ModelsDevMeta]>;
			};
			if (
				typeof cached.fetchedAt === "number" &&
				Date.now() - cached.fetchedAt < CACHE_TTL_MS &&
				Array.isArray(cached.byId)
			) {
				byId = new Map(cached.byId);
				return;
			}
		}
	} catch {
		// Corrupt/absent cache: fall through to network.
	}

	if (inflight) {
		await inflight;
		return;
	}
	inflight = (async () => {
		try {
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
			let response: Response;
			try {
				response = await fetch(LITELLM_URL, { signal: controller.signal });
			} finally {
				clearTimeout(timer);
			}
			if (!response.ok) return;
			const parsed = parseLiteLlmData(await response.json());
			if (parsed.size === 0) return;
			byId = parsed;
			try {
				mkdirSync(join(cachePath, ".."), { recursive: true });
				writeFileSync(
					cachePath,
					JSON.stringify({ fetchedAt: Date.now(), byId: Array.from(parsed.entries()) }),
					"utf8",
				);
			} catch {
				// Cache persistence is best-effort.
			}
		} catch {
			// Network failure: byId stays undefined; callers keep defaults.
		} finally {
			inflight = undefined;
		}
	})();
	await inflight;
}

/** Force (re)load; returns true when the index is available afterwards. */
export async function ensureLiteLlmLoaded(): Promise<boolean> {
	await loadLiteLlmIndex();
	return byId !== undefined;
}

/** Synchronous lookup — only valid after the index has been loaded. */
export function lookupLiteLlmMeta(id: string): ModelsDevMeta | undefined {
	return byId?.get(id);
}
