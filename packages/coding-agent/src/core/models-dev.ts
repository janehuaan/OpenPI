/**
 * models.dev metadata lookup (built-in, optional).
 *
 * When `/models` discovery finds a model id that is neither in the built-in
 * catalog nor annotated by the server, consult the public models.dev database
 * (https://models.dev/api.json) for accurate context window / output limit /
 * cost / reasoning. The full dataset (~3.4 MB) is fetched once and cached for
 * 24h at `<agentDir>/models-dev-cache.json`; any failure (network, timeout,
 * parse) degrades silently to `undefined` — the caller keeps its defaults.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "../config.ts";

export interface ModelsDevMeta {
	context?: number;
	output?: number;
	costInput?: number;
	costOutput?: number;
	costCacheRead?: number;
	costCacheWrite?: number;
	reasoning?: boolean;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 45_000;
const MODELS_DEV_URL = "https://models.dev/api.json";

let cachePath = join(getAgentDir(), "models-dev-cache.json");
let byId: Map<string, ModelsDevMeta> | undefined;
let inflight: Promise<void> | undefined;

/** Test hook: redirect the cache file (e.g. to a temp dir). */
export function setModelsDevCachePath(path: string): void {
	cachePath = path;
}

/** Test hook: drop the in-memory index so the next load re-fetches. */
export function resetModelsDevForTest(): void {
	byId = undefined;
	inflight = undefined;
}

function parseModelsDevData(data: unknown): Map<string, ModelsDevMeta> {
	const index = new Map<string, ModelsDevMeta>();
	if (typeof data !== "object" || data === null) return index;
	for (const provider of Object.values(data as Record<string, unknown>)) {
		if (typeof provider !== "object" || provider === null) continue;
		const models = (provider as { models?: unknown }).models;
		if (typeof models !== "object" || models === null) continue;
		for (const model of Object.values(models as Record<string, unknown>)) {
			if (typeof model !== "object" || model === null) continue;
			const entry = model as Record<string, unknown>;
			const id = typeof entry.id === "string" ? entry.id : undefined;
			if (!id) continue;
			const limit = (entry.limit ?? {}) as Record<string, unknown>;
			const cost = (entry.cost ?? {}) as Record<string, unknown>;
			const meta: ModelsDevMeta = {};
			if (typeof limit.context === "number" && limit.context > 0) meta.context = Math.floor(limit.context);
			if (typeof limit.output === "number" && limit.output > 0) meta.output = Math.floor(limit.output);
			if (typeof cost.input === "number") meta.costInput = cost.input;
			if (typeof cost.output === "number") meta.costOutput = cost.output;
			if (typeof cost.cache_read === "number") meta.costCacheRead = cost.cache_read;
			if (typeof cost.cache_write === "number") meta.costCacheWrite = cost.cache_write;
			if (typeof entry.reasoning === "boolean") meta.reasoning = entry.reasoning;
			// Only index entries with at least one usable field.
			if (
				meta.context ||
				meta.output ||
				meta.costInput !== undefined ||
				meta.costOutput !== undefined ||
				meta.reasoning !== undefined
			) {
				index.set(id, meta);
			}
		}
	}
	return index;
}

async function loadModelsDevIndex(): Promise<void> {
	if (byId) return;

	// File cache first (within TTL).
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
				response = await fetch(MODELS_DEV_URL, { signal: controller.signal });
			} finally {
				clearTimeout(timer);
			}
			if (!response.ok) return;
			const parsed = parseModelsDevData(await response.json());
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
export async function ensureModelsDevLoaded(): Promise<boolean> {
	await loadModelsDevIndex();
	return byId !== undefined;
}

/** Synchronous lookup — only valid after the index has been loaded. */
export function lookupModelsDevMeta(id: string): ModelsDevMeta | undefined {
	return byId?.get(id);
}
