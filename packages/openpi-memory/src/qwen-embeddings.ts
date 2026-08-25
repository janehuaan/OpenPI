import {
	type EmbeddingClient,
	type EmbeddingHealth,
	normalizeEmbedding,
	QWEN_EMBEDDING_DIMENSIONS,
	QWEN_QUERY_INSTRUCTION,
} from "./retrieval.ts";

export interface QwenEmbeddingConfig {
	baseUrl: string;
	model: string;
	timeoutMs: number;
	apiKey?: string;
	/** Maximum document items per request; defaults to 2 to protect local servers. */
	maxBatchItems?: number;
	/** Maximum document characters per request; defaults to 10,000. */
	maxBatchChars?: number;
	/** Verify this model is listed by GET /models during health checks. */
	expectedModel?: string;
}
interface EmbeddingsResponse {
	data?: Array<{ embedding?: unknown; index?: unknown }>;
}
interface ModelsResponse {
	data?: Array<{ id?: unknown }>;
}

export class QwenEmbeddingClient implements EmbeddingClient {
	private readonly config: QwenEmbeddingConfig;
	private readonly fetchImpl: typeof fetch;
	private readonly documentCache = new Map<string, Promise<number[]>>();

	constructor(config: QwenEmbeddingConfig, fetchImpl?: typeof fetch) {
		this.config = config;
		this.fetchImpl = fetchImpl ?? fetch;
	}

	async embedDocuments(texts: readonly string[]): Promise<number[][]> {
		if (texts.length === 0) return [];
		const byText = new Map<string, Promise<number[]>>();
		const missing: string[] = [];
		const queued = new Set<string>();
		for (const text of texts) {
			const key = contentHash(text);
			const cached = this.documentCache.get(key);
			if (cached) byText.set(text, cached);
			else if (!queued.has(key)) {
				queued.add(key);
				missing.push(text);
			}
		}
		for (const batch of partition(missing, this.config.maxBatchItems ?? 2, this.config.maxBatchChars ?? 10_000)) {
			const request = this.embedOnce(batch, false);
			for (let index = 0; index < batch.length; index++) {
				const text = batch[index]!;
				const promise = request.then((vectors) => vectors[index]!);
				this.documentCache.set(contentHash(text), promise);
				void promise.catch(() => this.documentCache.delete(contentHash(text)));
				byText.set(text, promise);
			}
		}
		return Promise.all(texts.map((text) => byText.get(text)!));
	}

	/** Query embeddings deliberately stay on the direct, uncached request path. */
	async embedQueries(queries: readonly string[]): Promise<number[][]> {
		return this.embedOnce(queries, true);
	}

	async health(): Promise<EmbeddingHealth> {
		try {
			const payload = (await this.request("/models", { method: "GET" })) as ModelsResponse;
			const expected = this.config.expectedModel ?? this.config.model;
			if (
				expected &&
				Array.isArray(payload.data) &&
				!payload.data.some(
					(model) => typeof model.id === "string" && (model.id === expected || model.id.includes(expected)),
				)
			) {
				throw new Error(`Embedding model ${expected} is not ready`);
			}
			return { ok: true, state: "ready" };
		} catch (error) {
			const message = this.recordError(error);
			return { ok: false, state: "error", message };
		}
	}

	private async embedOnce(texts: readonly string[], isQuery: boolean): Promise<number[][]> {
		if (texts.length === 0) return [];
		const input = isQuery ? texts.map((text) => `${QWEN_QUERY_INSTRUCTION}${text}`) : [...texts];
		try {
			const payload = (await this.request("/embeddings", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ model: this.config.model, input }),
			})) as EmbeddingsResponse;
			if (!Array.isArray(payload.data) || payload.data.length !== input.length) {
				throw new Error(
					`Embedding response count ${payload.data?.length ?? 0} does not match request count ${input.length}`,
				);
			}
			const ordered = new Array<number[]>(input.length);
			for (let position = 0; position < payload.data.length; position++) {
				const item: { embedding?: unknown; index?: unknown } | undefined = payload.data[position];
				const index = typeof item?.index === "number" ? item.index : position;
				if (!Number.isInteger(index) || index < 0 || index >= input.length || ordered[index])
					throw new Error("Embedding response has invalid or duplicate indexes");
				if (!Array.isArray(item?.embedding)) throw new Error(`Embedding response item ${index} has no embedding`);
				ordered[index] = normalizeEmbedding(item.embedding, QWEN_EMBEDDING_DIMENSIONS);
			}
			if (ordered.some((embedding) => !embedding))
				throw new Error("Embedding response is missing one or more indexes");
			return ordered;
		} catch (error) {
			this.recordError(error);
			throw error;
		}
	}

	private async request(path: string, init: RequestInit): Promise<unknown> {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
		try {
			const response = await this.fetchImpl(`${this.config.baseUrl.replace(/\/$/, "")}${path}`, {
				...init,
				headers: {
					...init.headers,
					...(this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {}),
				},
				signal: controller.signal,
			});
			if (!response.ok) throw new Error(`Embedding request failed: ${response.status} ${response.statusText}`);
			return await response.json();
		} finally {
			clearTimeout(timeout);
		}
	}
	private recordError(error: unknown): string {
		return error instanceof Error ? error.message : String(error);
	}
}

function partition(texts: readonly string[], maxItems: number, maxChars: number): string[][] {
	const itemLimit = Math.max(1, Math.floor(maxItems));
	const charLimit = Math.max(1, Math.floor(maxChars));
	const batches: string[][] = [];
	let batch: string[] = [];
	let chars = 0;
	for (const text of texts) {
		if (batch.length && (batch.length >= itemLimit || chars + text.length > charLimit)) {
			batches.push(batch);
			batch = [];
			chars = 0;
		}
		batch.push(text);
		chars += text.length;
	}
	if (batch.length) batches.push(batch);
	return batches;
}
function contentHash(text: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return `${text.length}:${(hash >>> 0).toString(16)}`;
}
