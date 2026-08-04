/**
 * Optional semantic reranking for search tools (built-in).
 *
 * Zero-config by default: only active when OPENPI_EMBEDDING_API_KEY is set
 * (plus optional OPENPI_EMBEDDING_BASE_URL / OPENPI_EMBEDDING_MODEL, default
 * text-embedding-3-small on the OpenAI-compatible /embeddings endpoint).
 * Embeddings are fingerprinted and cached at `<cwd>/.pi/embeddings-cache.json`.
 * Any failure (missing key, network, provider error) degrades silently to
 * the caller's non-semantic path — never throws.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureLocalEmbeddingServer, LOCAL_EMBEDDING_BASE_URL } from "../local-embedding-server.ts";

export interface EmbeddingConfig {
	apiKey: string;
	baseUrl: string;
	model: string;
}

export function loadEmbeddingConfig(env: NodeJS.ProcessEnv = process.env): EmbeddingConfig | null {
	// Local mode (OPENPI_EMBEDDING_LOCAL=1): spawn/attach to a llama.cpp
	// llama-server on this machine — no API key required.
	if (env.OPENPI_EMBEDDING_LOCAL !== undefined && env.OPENPI_EMBEDDING_LOCAL !== "0") {
		return {
			apiKey: "local",
			baseUrl: LOCAL_EMBEDDING_BASE_URL,
			model: env.OPENPI_EMBEDDING_MODEL ?? "local-bge",
		};
	}
	const apiKey = env.OPENPI_EMBEDDING_API_KEY;
	if (!apiKey) return null;
	return {
		apiKey,
		baseUrl: (env.OPENPI_EMBEDDING_BASE_URL ?? "https://api.openai.com/v1").replace(/\/+$/, ""),
		model: env.OPENPI_EMBEDDING_MODEL ?? "text-embedding-3-small",
	};
}

interface EmbeddingCacheFile {
	version: 1;
	entries: Array<[string, number[]]>;
}

function fingerprint(text: string): string {
	return createHash("sha256").update(text).digest("hex").slice(0, 32);
}

function loadCache(cachePath: string): Map<string, number[]> {
	try {
		if (!existsSync(cachePath)) return new Map();
		const raw = JSON.parse(readFileSync(cachePath, "utf8")) as EmbeddingCacheFile;
		return new Map(raw.entries);
	} catch {
		return new Map();
	}
}

function saveCache(cachePath: string, cache: Map<string, number[]>): void {
	try {
		const file: EmbeddingCacheFile = { version: 1, entries: Array.from(cache.entries()) };
		mkdirSync(join(cachePath, ".."), { recursive: true });
		writeFileSync(cachePath, JSON.stringify(file), "utf8");
	} catch {
		// Cache persistence is best-effort.
	}
}

/**
 * Embed the given texts. Returns null on any failure (missing key, network,
 * provider error). Cache hits are reused across calls.
 */
export async function embedTexts(
	texts: string[],
	config: EmbeddingConfig,
	cachePath?: string,
): Promise<Float32Array[] | null> {
	if (texts.length === 0) return [];
	// Local mode: make sure the llama-server is up before calling it.
	if (config.apiKey === "local") {
		const ensured = ensureLocalEmbeddingServer();
		if (ensured && !(await ensured)) return null;
	}
	const cache = cachePath ? loadCache(cachePath) : new Map<string, number[]>();
	const unique = Array.from(new Set(texts));
	const missing: string[] = [];
	for (const text of unique) {
		if (!cache.has(fingerprint(text))) missing.push(text);
	}
	if (missing.length > 0) {
		try {
			const response = await fetch(`${config.baseUrl}/embeddings`, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					authorization: `Bearer ${config.apiKey}`,
				},
				body: JSON.stringify({ model: config.model, input: missing }),
			});
			if (!response.ok) return null;
			const data = (await response.json()) as {
				data: Array<{ index: number; embedding: number[] }>;
			};
			for (const item of data.data) {
				const text = missing[item.index];
				if (text !== undefined && Array.isArray(item.embedding)) {
					cache.set(fingerprint(text), item.embedding);
				}
			}
			if (cachePath) saveCache(cachePath, cache);
		} catch {
			return null;
		}
	}
	return unique.map((text) => {
		const vector = cache.get(fingerprint(text));
		return vector ? Float32Array.from(vector) : new Float32Array(0);
	});
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
	if (a.length === 0 || a.length !== b.length) return 0;
	let dot = 0;
	let normA = 0;
	let normB = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}
	if (normA === 0 || normB === 0) return 0;
	return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Rank texts by cosine similarity to the query; returns indices in rank order. */
export function rankBySimilarity(queryVector: Float32Array, textVectors: Float32Array[]): number[] {
	return textVectors
		.map((vector, index) => ({ index, similarity: cosineSimilarity(queryVector, vector) }))
		.sort((a, b) => b.similarity - a.similarity)
		.map((entry) => entry.index);
}

/** Default cache path for a workspace. */
export function embeddingCachePath(cwd: string): string {
	return join(cwd, ".pi", "embeddings-cache.json");
}

// ---------------------------------------------------------------------------
// Zero-dependency local embedding (fallback when no embedding API key is set).
// Character-level hashing into a fixed-dimension vector: crude but free, and
// gives search tools a semantic-ish rerank without any network access.
// ---------------------------------------------------------------------------

const LOCAL_EMBEDDING_DIM = 256;

function fnv1a(text: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

/** Local hashing embedding: word tokens (weight 1) + char bigrams (weight 0.5), L2-normalized. */
export function localEmbedding(text: string): Float32Array {
	const vector = new Float32Array(LOCAL_EMBEDDING_DIM);
	const tokens = text.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
	for (const token of tokens) {
		vector[fnv1a(token) % LOCAL_EMBEDDING_DIM] += 1;
	}
	for (let i = 0; i < text.length - 1; i++) {
		vector[fnv1a(text.slice(i, i + 2)) % LOCAL_EMBEDDING_DIM] += 0.5;
	}
	let norm = 0;
	for (const value of vector) norm += value * value;
	norm = Math.sqrt(norm);
	if (norm > 0) {
		for (let i = 0; i < vector.length; i++) vector[i] /= norm;
	}
	return vector;
}

/** Rank texts by local-embedding cosine similarity to the query; returns indices in rank order. */
export function rankByLocalSimilarity(query: string, texts: string[]): number[] {
	const queryVector = localEmbedding(query);
	return rankBySimilarity(
		queryVector,
		texts.map((text) => localEmbedding(text)),
	);
}
