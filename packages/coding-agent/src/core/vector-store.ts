/**
 * Persistent local vector store (built-in).
 *
 * Offline vectorization of memory entries and session messages into a
 * persisted file at `<cwd>/.pi/vector-store.json`, with incremental updates
 * (content fingerprint dedupe) and a size cap. Retrieval is a full cosine
 * scan over the stored vectors — the actual "vector library" layer that
 * session_search queries instead of re-ranking BM25 candidates only.
 *
 * Embeddings come from the zero-dependency local hashing embedder by default
 * (works offline); a custom embedder (e.g. a real embedding API) can be
 * supplied for higher quality.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { localEmbedding } from "./tools/embedding.ts";

export interface VectorStoreDoc {
	/** Stable document id: `${source}:${entryId}` — dedupes across refreshes. */
	id: string;
	/** Where the text came from: `session:<file>` or `memory:<type>`. */
	source: string;
	role: string;
	text: string;
	/** Optional timestamp kept for rendering (session messages). */
	timestamp?: string;
}

export interface StoredVectorDoc extends VectorStoreDoc {
	fingerprint: string;
	vector: number[];
}

interface VectorStoreFile {
	version: 1;
	updatedAt: string;
	docs: StoredVectorDoc[];
}

const MAX_DOCS = 5000;
const MAX_TEXT_LENGTH = 2000;

export function vectorStorePath(cwd: string): string {
	return join(cwd, ".pi", "vector-store.json");
}

function fingerprintOf(text: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return `${hash.toString(36)}-${text.length}`;
}

function loadStore(file: string): Map<string, StoredVectorDoc> {
	try {
		if (!existsSync(file)) return new Map();
		const raw = JSON.parse(readFileSync(file, "utf8")) as VectorStoreFile;
		const map = new Map<string, StoredVectorDoc>();
		for (const doc of raw.docs ?? []) {
			if (doc && typeof doc.id === "string") map.set(doc.id, doc);
		}
		return map;
	} catch {
		return new Map();
	}
}

function saveStore(file: string, docs: Map<string, StoredVectorDoc>): void {
	try {
		const payload: VectorStoreFile = {
			version: 1,
			updatedAt: new Date().toISOString(),
			docs: Array.from(docs.values()),
		};
		mkdirSync(join(file, ".."), { recursive: true });
		writeFileSync(file, JSON.stringify(payload), "utf8");
	} catch {
		// Persistence is best-effort.
	}
}

/**
 * Incrementally upsert the given documents into the persisted store: docs
 * whose text fingerprint is unchanged are kept as-is; new/changed docs are
 * re-embedded; docs no longer in the input are dropped. Returns the number
 * of docs added or updated.
 */
export function upsertVectorStore(
	cwd: string,
	docs: VectorStoreDoc[],
	embed: (text: string) => Float32Array = localEmbedding,
): { upserted: number; total: number } {
	const file = vectorStorePath(cwd);
	const store = loadStore(file);

	const inputIds = new Set<string>();
	let upserted = 0;
	for (const doc of docs) {
		const text = doc.text.length > MAX_TEXT_LENGTH ? doc.text.slice(0, MAX_TEXT_LENGTH) : doc.text;
		if (text.length === 0) continue;
		inputIds.add(doc.id);
		const fingerprint = fingerprintOf(text);
		const existing = store.get(doc.id);
		if (existing && existing.fingerprint === fingerprint) continue;
		const vector = Array.from(embed(text));
		store.set(doc.id, { ...doc, text, fingerprint, vector });
		upserted += 1;
	}

	// Drop documents that no longer exist in the sources.
	for (const id of Array.from(store.keys())) {
		if (!inputIds.has(id)) store.delete(id);
	}

	// Size cap: keep the newest (input order is newest-first from callers).
	if (store.size > MAX_DOCS) {
		const trimmed = new Map<string, StoredVectorDoc>();
		for (const doc of store.values()) {
			trimmed.set(doc.id, doc);
			if (trimmed.size >= MAX_DOCS) break;
		}
		saveStore(file, trimmed);
		return { upserted, total: trimmed.size };
	}

	saveStore(file, store);
	return { upserted, total: store.size };
}

export interface VectorSearchHit {
	id: string;
	source: string;
	role: string;
	text: string;
	timestamp?: string;
	score: number;
}

/** Cosine-similarity search over the whole persisted store. */
export function searchVectorStore(
	cwd: string,
	query: string,
	limit: number,
	embed: (text: string) => Float32Array = localEmbedding,
): VectorSearchHit[] {
	const store = loadStore(vectorStorePath(cwd));
	if (store.size === 0) return [];
	const queryVector = embed(query);
	const results: Array<{ hit: VectorSearchHit; sim: number }> = [];
	for (const doc of store.values()) {
		const vector = new Float32Array(doc.vector);
		if (vector.length === 0 || vector.length !== queryVector.length) continue;
		let dot = 0;
		let normA = 0;
		let normB = 0;
		for (let i = 0; i < vector.length; i++) {
			dot += vector[i] * queryVector[i];
			normA += vector[i] * vector[i];
			normB += queryVector[i] * queryVector[i];
		}
		if (normA === 0 || normB === 0) continue;
		const sim = dot / (Math.sqrt(normA) * Math.sqrt(normB));
		results.push({
			hit: { id: doc.id, source: doc.source, role: doc.role, text: doc.text, timestamp: doc.timestamp, score: 0 },
			sim,
		});
	}
	results.sort((a, b) => b.sim - a.sim);
	return results.slice(0, limit).map(({ hit, sim }) => ({ ...hit, score: sim }));
}

/** The embedder used when a real embedding API key is configured. */
export type EmbedFn = (text: string) => Float32Array;
