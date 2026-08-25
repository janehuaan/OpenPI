export const QWEN_EMBEDDING_DIMENSIONS = 1024;
export const QWEN_QUERY_INSTRUCTION =
	"Instruct: Given a user query, retrieve relevant memories that help answer it.\nQuery: ";

export type MemoryDocumentKind = "memory" | "session_digest" | "artifact";
export type MemoryRecordState = "active" | "archived" | "deleted";
export interface EmbeddingHealth {
	ok: boolean;
	state: "ready" | "unavailable" | "error";
	message?: string;
}
export interface RetrievalDocument {
	id: string;
	namespace: string;
	scope: string;
	documentKind: MemoryDocumentKind;
	type: string;
	key: string;
	state: MemoryRecordState;
	contentHash: string;
	sourceRevision: string;
	updatedAt: string;
	fullText: string;
	vector: number[];
}
export interface RetrievalFilters {
	namespace: string;
	documentKind: MemoryDocumentKind;
	state: MemoryRecordState;
}
export interface RetrievalMatch {
	document: RetrievalDocument;
	score: number;
}
export interface EmbeddingClient {
	embedDocuments(texts: readonly string[]): Promise<number[][]>;
	embedQueries(queries: readonly string[]): Promise<number[][]>;
	health(): Promise<EmbeddingHealth>;
}
export interface RetrievalRepository {
	connect(): Promise<void>;
	ensureSchema(): Promise<void>;
	upsert(documents: readonly RetrievalDocument[]): Promise<void>;
	delete(ids: readonly string[]): Promise<void>;
	search(vector: readonly number[], filters: RetrievalFilters, limit: number): Promise<RetrievalMatch[]>;
	health(): Promise<EmbeddingHealth>;
}
export function normalizeEmbedding(vector: readonly number[], dimensions = QWEN_EMBEDDING_DIMENSIONS): number[] {
	if (vector.length !== dimensions)
		throw new Error(`Expected embedding dimension ${dimensions}, received ${vector.length}`);
	let squared = 0;
	for (const value of vector) {
		if (!Number.isFinite(value)) throw new Error("Embedding contains a non-finite value");
		squared += value * value;
	}
	if (squared === 0) throw new Error("Embedding must not be a zero vector");
	const magnitude = Math.sqrt(squared);
	return vector.map((value) => value / magnitude);
}
