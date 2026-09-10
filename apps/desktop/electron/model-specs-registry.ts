/**
 * Dynamic Model Specs Registry
 *
 * Resolves model capabilities (context window, max tokens, reasoning, modalities)
 * dynamically from live registries (e.g. models.dev API, local dynamic cache, and upstream metadata),
 * completely decoupling model configuration from hardcoded codebase rules.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface DynamicModelSpec {
	contextWindow: number;
	maxTokens: number;
	reasoning: boolean;
	input: string[]; // ["text"] or ["text", "image"]
	cost?: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
	};
	source?: string;
}

interface CacheEntry {
	context?: number;
	output?: number;
	costInput?: number;
	costOutput?: number;
	costCacheRead?: number;
	costCacheWrite?: number;
	reasoning?: boolean;
	modalities?: string[];
}

let cachedEntries: Map<string, CacheEntry> | null = null;
let lastCacheLoad = 0;

function getCachePath(): string {
	const dir = process.env.OPENPI_HOME || join(homedir(), ".openpi");
	return join(dir, "agent", "models-dev-cache.json");
}

/** Load models.dev cache from disk if available */
export function loadDynamicRegistryCache(): Map<string, CacheEntry> {
	const now = Date.now();
	if (cachedEntries && now - lastCacheLoad < 30_000) {
		return cachedEntries;
	}

	const map = new Map<string, CacheEntry>();
	const cachePath = getCachePath();

	try {
		if (existsSync(cachePath)) {
			const raw = JSON.parse(readFileSync(cachePath, "utf-8"));
			const byId = raw.byId;
			if (Array.isArray(byId)) {
				for (const item of byId) {
					if (Array.isArray(item) && item.length >= 2 && typeof item[0] === "string") {
						map.set(item[0].toLowerCase(), item[1] as CacheEntry);
					}
				}
			} else if (byId && typeof byId === "object") {
				for (const [k, v] of Object.entries(byId)) {
					map.set(k.toLowerCase(), v as CacheEntry);
				}
			}
		}
	} catch (err) {
		console.warn("[model-specs-registry] Failed to read models-dev-cache.json:", err);
	}

	cachedEntries = map;
	lastCacheLoad = now;
	return map;
}

/** Refresh the dynamic registry from models.dev in the background */
export async function refreshDynamicRegistryOnline(): Promise<number> {
	try {
		const res = await fetch("https://models.dev/api.json", {
			signal: AbortSignal.timeout(10_000),
			headers: { "user-agent": "OpenPI-Desktop/0.2.0" },
		});
		if (!res.ok) return 0;
		const json = (await res.json()) as any;
		if (!json || typeof json !== "object") return 0;

		const map = new Map<string, CacheEntry>();
		const entries: [string, CacheEntry][] = [];

		// models.dev format
		const list = Array.isArray(json) ? json : Object.values(json);
		for (const m of list) {
			if (!m || typeof m !== "object") continue;
			const id = (m.id || m.name || "").toLowerCase();
			if (!id) continue;
			const entry: CacheEntry = {
				context: typeof m.context === "number" ? m.context : typeof m.context_length === "number" ? m.context_length : undefined,
				output: typeof m.output === "number" ? m.output : typeof m.max_tokens === "number" ? m.max_tokens : undefined,
				costInput: m.costInput ?? m.pricing?.prompt,
				costOutput: m.costOutput ?? m.pricing?.completion,
				costCacheRead: m.costCacheRead ?? m.pricing?.cache_read,
				reasoning: Boolean(m.reasoning || m.thinking || m.features?.reasoning),
				modalities: Array.isArray(m.modalities) ? m.modalities : m.features?.vision ? ["text", "image"] : ["text"],
			};
			map.set(id, entry);
			entries.push([id, entry]);
		}

		if (entries.length > 0) {
			const cachePath = getCachePath();
			writeFileSync(
				cachePath,
				JSON.stringify({ fetchedAt: Date.now(), byId: entries }),
				"utf-8"
			);
			cachedEntries = map;
			lastCacheLoad = Date.now();
			return entries.length;
		}
	} catch (err) {
		// Offline or network error; cache remains
	}
	return 0;
}

/**
 * Dynamically look up a model's specs from the registry without any hardcoded if-else trees.
 */
export function queryDynamicRegistry(modelId: string): DynamicModelSpec | null {
	if (!modelId) return null;
	const cache = loadDynamicRegistryCache();
	if (cache.size === 0) return null;

	const raw = modelId.trim().toLowerCase();
	const normalized = raw.replace(/[._]/g, "-");

	// Candidates to check against registry
	const candidates = [
		raw,
		normalized,
		// Strip date suffix e.g. -20250219
		normalized.replace(/-\d{8}$/, ""),
		// Strip thinking suffix
		normalized.replace(/-thinking$/, ""),
		normalized.replace(/-high$/, ""),
		normalized.replace(/-medium$/, ""),
		normalized.replace(/-low$/, ""),
	];

	for (const candidate of candidates) {
		// Exact match
		if (cache.has(candidate)) {
			const c = cache.get(candidate)!;
			return buildSpec(c, "registry-exact");
		}

		// Suffix match (e.g. anthropic/claude-3-7-sonnet-20250219 matching claude-3-7-sonnet-20250219)
		for (const [key, entry] of cache.entries()) {
			if (key.endsWith(`/${candidate}`) || key === candidate) {
				return buildSpec(entry, "registry-suffix");
			}
		}
	}

	return null;
}

function buildSpec(entry: CacheEntry, source: string): DynamicModelSpec {
	const contextWindow = entry.context && entry.context > 0 ? entry.context : 131072;
	const maxTokens = entry.output && entry.output > 0 ? entry.output : Math.min(contextWindow, 65536);
	const reasoning = Boolean(entry.reasoning);
	const hasVision = Array.isArray(entry.modalities) && entry.modalities.includes("image");

	return {
		contextWindow,
		maxTokens,
		reasoning,
		input: hasVision ? ["text", "image"] : ["text"],
		cost: {
			input: entry.costInput ?? 0,
			output: entry.costOutput ?? 0,
			cacheRead: entry.costCacheRead ?? 0,
			cacheWrite: entry.costCacheWrite ?? 0,
		},
		source,
	};
}
