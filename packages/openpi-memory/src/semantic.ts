/**
 * Optional semantic embedding for memory search.
 *
 * Uses an OpenAI-compatible /v1/embeddings endpoint (OpenAI, or any local
 * gateway like LM Studio / Ollama / vLLM). When no API key is configured,
 * semantic search is disabled and existing hash-vector + BM25 search is used.
 *
 * Config via environment:
 * - OPENPI_EMBEDDING_API_KEY (required to enable)
 * - OPENPI_EMBEDDING_BASE_URL (default https://api.openai.com/v1)
 * - OPENPI_EMBEDDING_MODEL  (default text-embedding-3-small)
 */
import { cosine, fingerprint } from "./vectors.ts";

export interface SemanticEmbedderOptions {
	apiKey?: string;
	baseUrl?: string;
	model?: string;
	/** Maximum batch size per API call (default 64). */
	batchSize?: number;
}

export function loadSemanticEmbedderOptions(env: NodeJS.ProcessEnv = process.env): SemanticEmbedderOptions | null {
	const apiKey = env.OPENPI_EMBEDDING_API_KEY?.trim();
	if (!apiKey) return null;
	return {
		apiKey,
		baseUrl: env.OPENPI_EMBEDDING_BASE_URL?.trim() || "https://api.openai.com/v1",
		model: env.OPENPI_EMBEDDING_MODEL?.trim() || "text-embedding-3-small",
		batchSize: 64,
	};
}

export class SemanticEmbedder {
	private readonly apiKey: string;
	private readonly baseUrl: string;
	private readonly model: string;
	private readonly batchSize: number;
	private readonly cache = new Map<string, Float32Array>();

	constructor(options: SemanticEmbedderOptions) {
		if (!options.apiKey) throw new Error("SemanticEmbedder requires an apiKey");
		this.apiKey = options.apiKey;
		this.baseUrl = (options.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
		this.model = options.model ?? "text-embedding-3-small";
		this.batchSize = options.batchSize ?? 64;
	}

	/** Embed one text (cached by content fingerprint). */
	async embed(text: string): Promise<Float32Array> {
		const fp = fingerprint(text);
		const cached = this.cache.get(fp);
		if (cached) return cached;
		const [vector] = await this.embedBatch([text]);
		this.cache.set(fp, vector);
		return vector;
	}

	/** Embed a batch of texts; failed texts fall back to a zero vector. */
	async embedBatch(texts: string[]): Promise<Float32Array[]> {
		const out: Float32Array[] = new Array(texts.length);
		const missing: number[] = [];
		for (let i = 0; i < texts.length; i++) {
			const cached = this.cache.get(fingerprint(texts[i]!));
			if (cached) {
				out[i] = cached;
			} else {
				missing.push(i);
			}
		}
		if (missing.length === 0) return out;

		for (let start = 0; start < missing.length; start += this.batchSize) {
			const chunk = missing.slice(start, start + this.batchSize);
			const inputs = chunk.map((i) => texts[i]!);
			const vectors = await this.requestEmbeddings(inputs);
			for (let k = 0; k < chunk.length; k++) {
				const vector = vectors[k] ?? new Float32Array(0);
				out[chunk[k]!] = vector;
				this.cache.set(fingerprint(inputs[k]!), vector);
			}
		}
		return out;
	}

	private async requestEmbeddings(inputs: string[]): Promise<Float32Array[]> {
		const response = await fetch(`${this.baseUrl}/embeddings`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.apiKey}`,
			},
			body: JSON.stringify({ model: this.model, input: inputs }),
			signal: AbortSignal.timeout(30_000),
		});
		if (!response.ok) {
			const body = await response.text().catch(() => "");
			throw new Error(`Embedding API HTTP ${response.status}${body ? `: ${body.slice(0, 200)}` : ""}`);
		}
		const data = (await response.json()) as {
			data?: Array<{ embedding?: number[] }>;
		};
		return (data.data ?? [])
			.sort((a, b) => {
				// OpenAI returns data sorted by input index; keep it stable by index.
				const aIndex = "index" in a ? Number((a as { index?: unknown }).index) : 0;
				const bIndex = "index" in b ? Number((b as { index?: unknown }).index) : 0;
				return aIndex - bIndex;
			})
			.map((row) => Float32Array.from(row.embedding ?? []));
	}
}

export interface SemanticRerankOptions {
	/** Blend weight of semantic score vs base score (0-1; default 0.5). */
	alpha?: number;
	/** Hard cap on candidates embedded per query (default 200). */
	maxCandidates?: number;
	/** Optional base scores (e.g. hybrid/BM25) for the same entries, blended with semantic scores. */
	baseScores?: Map<string, number>;
}

/**
 * Rerank entries by semantic embedding similarity, blended with optional base
 * scores. Returns null when the embedder is unavailable or the API fails, so
 * callers fall back to their existing ranking.
 */
export async function semanticRerank<T>(
	embedder: SemanticEmbedder,
	query: string,
	entries: T[],
	textOf: (entry: T) => string,
	idOf: (entry: T) => string,
	options: SemanticRerankOptions = {},
): Promise<T[] | null> {
	const alpha = options.alpha ?? 0.5;
	const maxCandidates = options.maxCandidates ?? 200;
	if (entries.length === 0 || !query.trim()) return null;

	const candidates = entries.slice(0, maxCandidates);
	try {
		const qVector = await embedder.embed(query);
		if (qVector.length === 0) return null;
		const vectors = await embedder.embedBatch(candidates.map((entry) => textOf(entry)));
		const scored: Array<{ entry: T; score: number }> = [];
		for (let i = 0; i < candidates.length; i++) {
			const vector = vectors[i];
			const semantic = vector && vector.length > 0 ? cosine(qVector, vector) : 0;
			const base = options.baseScores?.get(idOf(candidates[i]!)) ?? 0;
			const score = alpha * semantic + (1 - alpha) * base;
			scored.push({ entry: candidates[i]!, score });
		}
		scored.sort((a, b) => b.score - a.score);
		return scored.map((s) => s.entry);
	} catch {
		// API failure: fall back to base ranking.
		return null;
	}
}
