import type { IntelligenceConfig } from "../config.ts";
import type { ContextCandidate } from "../contract.ts";

export const QWEN_EMBEDDING_DIMENSIONS = 1024;
export const DEFAULT_QWEN_EMBEDDING_ENDPOINT = "http://127.0.0.1:18080/v1";
export const DEFAULT_QWEN_EMBEDDING_MODEL = "Qwen3-Embedding-0.6B";
export const DEFAULT_QWEN_QUERY_INSTRUCTION = "Given a user query, retrieve relevant passages that answer the query.";

export interface EmbeddingProvider {
	name: string;
	embedQuery(query: string): Promise<number[]>;
	embedDocuments(documents: string[]): Promise<number[][]>;
}

interface OpenAIEmbeddingResponse {
	data?: unknown;
}

function normalizeEndpoint(endpoint: string): string {
	return endpoint.replace(/\/+$/, "");
}

function normalizeVector(value: unknown, label: string): number[] {
	if (!Array.isArray(value) || value.length !== QWEN_EMBEDDING_DIMENSIONS) {
		throw new Error(`Invalid Qwen embedding ${label}: expected a ${QWEN_EMBEDDING_DIMENSIONS}-dimension vector.`);
	}
	if (!value.every((entry) => typeof entry === "number" && Number.isFinite(entry))) {
		throw new Error(`Invalid Qwen embedding ${label}: vector contains a non-finite value.`);
	}
	const vector = value as number[];
	const norm = Math.sqrt(vector.reduce((sum, entry) => sum + entry * entry, 0));
	if (!Number.isFinite(norm) || norm === 0) {
		throw new Error(`Invalid Qwen embedding ${label}: vector has zero norm.`);
	}
	return vector.map((entry) => entry / norm);
}

function parseEmbeddings(value: unknown, expectedCount: number): number[][] {
	if (!value || typeof value !== "object" || !Array.isArray((value as OpenAIEmbeddingResponse).data)) {
		throw new Error("Invalid Qwen embedding response: expected a data array.");
	}
	const data = (value as OpenAIEmbeddingResponse).data as unknown[];
	if (data.length !== expectedCount) {
		throw new Error(`Invalid Qwen embedding response: expected ${expectedCount} vectors, received ${data.length}.`);
	}
	return data.map((item, position) => {
		if (!item || typeof item !== "object") {
			throw new Error(`Invalid Qwen embedding response item ${position}.`);
		}
		const record = item as { embedding?: unknown; index?: unknown };
		if (record.index !== undefined && record.index !== position) {
			throw new Error(`Invalid Qwen embedding response: vector ${position} has an unexpected index.`);
		}
		return normalizeVector(record.embedding, String(position));
	});
}

/** Qwen3 embeddings served by a local OpenAI-compatible llama-server. */
export class QwenLocalEmbeddingProvider implements EmbeddingProvider {
	readonly name = "qwen3-local";

	private readonly endpoint: string;
	private readonly model: string;
	private readonly queryInstruction: string;

	constructor(
		endpoint = DEFAULT_QWEN_EMBEDDING_ENDPOINT,
		model = DEFAULT_QWEN_EMBEDDING_MODEL,
		queryInstruction = DEFAULT_QWEN_QUERY_INSTRUCTION,
	) {
		this.endpoint = endpoint;
		this.model = model;
		this.queryInstruction = queryInstruction;
	}

	async embedQuery(query: string): Promise<number[]> {
		return (await this.embed([`Instruct: ${this.queryInstruction}\nQuery: ${query}`]))[0];
	}

	async embedDocuments(documents: string[]): Promise<number[][]> {
		return this.embed(documents);
	}

	private async embed(input: string[]): Promise<number[][]> {
		if (input.length === 0) return [];
		let response: Response;
		try {
			response = await fetch(`${normalizeEndpoint(this.endpoint)}/embeddings`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ model: this.model, input }),
				signal: AbortSignal.timeout(15_000),
			});
		} catch (error) {
			throw new Error(
				`Qwen local embedding server is unavailable at ${normalizeEndpoint(this.endpoint)}. Start the Qwen3 llama-server or set embedding.mode to "off".`,
				{ cause: error },
			);
		}
		if (!response.ok) {
			throw new Error(
				`Qwen local embedding server at ${normalizeEndpoint(this.endpoint)} returned HTTP ${response.status}.`,
			);
		}
		return parseEmbeddings(await response.json(), input.length);
	}
}

export function cosine(left: number[], right: number[]): number {
	if (left.length === 0 || left.length !== right.length) return 0;
	let dot = 0;
	let leftNorm = 0;
	let rightNorm = 0;
	for (let index = 0; index < left.length; index++) {
		dot += left[index] * right[index];
		leftNorm += left[index] ** 2;
		rightNorm += right[index] ** 2;
	}
	return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : 0;
}

function providerFromConfig(config: IntelligenceConfig): EmbeddingProvider | undefined {
	if (config.embedding.mode === "off") return undefined;
	return new QwenLocalEmbeddingProvider(
		config.embedding.endpoint,
		config.embedding.model,
		config.embedding.queryInstruction,
	);
}

export async function applySemanticScores(
	candidates: ContextCandidate[],
	query: string,
	config: IntelligenceConfig,
): Promise<void> {
	const provider = providerFromConfig(config);
	if (!provider || candidates.length === 0) return;
	const queryVector = await provider.embedQuery(query);
	const documentVectors = await provider.embedDocuments(
		candidates.map((candidate) => `${candidate.title}\n${candidate.content.slice(0, 4000)}`),
	);
	for (let index = 0; index < candidates.length; index++) {
		candidates[index].metadata.semanticScore = Math.max(0, cosine(queryVector, documentVectors[index]));
	}
}
