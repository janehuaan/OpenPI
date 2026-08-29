import type { IntelligenceConfig } from "../config.ts";
import type { ContextCandidate } from "../contract.ts";
import { queryTerms } from "./utils.ts";

export interface EmbeddingProvider {
	name: string;
	embed(texts: string[]): Promise<number[][]>;
}

function hashTerm(term: string): number {
	let hash = 2166136261;
	for (const char of term) hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 16777619);
	return hash >>> 0;
}

export class LocalHashEmbeddingProvider implements EmbeddingProvider {
	readonly name = "local-hash";
	private readonly dimensions: number;
	constructor(dimensions = 256) {
		this.dimensions = dimensions;
	}
	async embed(texts: string[]): Promise<number[][]> {
		return texts.map((text) => {
			const vector = Array.from({ length: this.dimensions }, () => 0);
			for (const term of queryTerms(text)) vector[hashTerm(term) % this.dimensions] += 1;
			const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
			return vector.map((value) => value / norm);
		});
	}
}

export class HttpEmbeddingProvider implements EmbeddingProvider {
	readonly name = "http";
	private readonly endpoint: string;
	private readonly model: string;
	private readonly apiKey: string | undefined;
	constructor(endpoint: string, model: string, apiKey?: string) {
		this.endpoint = endpoint;
		this.model = model;
		this.apiKey = apiKey;
	}
	async embed(texts: string[]): Promise<number[][]> {
		const response = await fetch(this.endpoint, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
			},
			body: JSON.stringify({ model: this.model, input: texts }),
			signal: AbortSignal.timeout(15_000),
		});
		if (!response.ok) throw new Error(`Embedding endpoint returned ${response.status}.`);
		const value: unknown = await response.json();
		if (!value || typeof value !== "object" || !("data" in value) || !Array.isArray(value.data))
			throw new Error("Invalid embedding response.");
		return value.data.map((item: unknown) => {
			if (!item || typeof item !== "object" || !("embedding" in item) || !Array.isArray(item.embedding))
				throw new Error("Invalid embedding vector.");
			const embedding: unknown[] = item.embedding;
			return embedding.filter((entry): entry is number => typeof entry === "number");
		});
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
	if (config.embedding.mode === "http" && config.embedding.endpoint && config.embedding.model) {
		return new HttpEmbeddingProvider(
			config.embedding.endpoint,
			config.embedding.model,
			config.embedding.apiKeyEnv ? process.env[config.embedding.apiKeyEnv] : undefined,
		);
	}
	return new LocalHashEmbeddingProvider();
}

export async function applySemanticScores(
	candidates: ContextCandidate[],
	query: string,
	config: IntelligenceConfig,
): Promise<void> {
	const provider = providerFromConfig(config);
	if (!provider || candidates.length === 0) return;
	try {
		const vectors = await provider.embed([
			query,
			...candidates.map((candidate) => `${candidate.title}\n${candidate.content.slice(0, 4000)}`),
		]);
		const queryVector = vectors[0];
		for (let index = 0; index < candidates.length; index++)
			candidates[index].metadata.semanticScore = Math.max(0, cosine(queryVector, vectors[index + 1]));
	} catch {
		// Keep lexical fallback when the embedding provider is unavailable.
	}
}
