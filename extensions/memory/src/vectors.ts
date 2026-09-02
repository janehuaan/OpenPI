/**
 * Local hashed n-gram embeddings + hybrid retrieval.
 * - vectors.bin: Float32 matrix (primary; legacy vectors.json migrates away)
 * - lexicon.bin: durable BM25 inverted index (cold start without re-tokenize)
 * No remote embedding / vector service.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import {
	type Bm25Corpus,
	buildBm25Corpus,
	decodeLexiconBin,
	encodeLexiconBin,
	expandQuery,
	LEXICON_BIN,
	rankBm25Corpus,
	tokenize,
} from "./rank.ts";
import type { MemoryIndexEntry } from "./types.ts";

export const VECTOR_DIM = 384;
export const VECTORS_FILE = "vectors.json";
export const VECTORS_BIN = "vectors.bin";

const BIN_MAGIC = 0x4f504956; // "OPIV"
const BIN_VERSION = 2;

export interface VectorRecord {
	v: number[];
	updatedAt: string;
	fp: string;
}

export interface VectorStore {
	version: 1;
	dim: number;
	entries: Record<string, VectorRecord>;
}

export interface RuntimeVectors {
	dim: number;
	ids: string[];
	fps: string[];
	matrix: Float32Array;
	idToIndex: Map<string, number>;
	updatedAt: string;
}

interface CacheEntry {
	mtimeMs: number;
	runtime: RuntimeVectors;
}

const runtimeCache = new Map<string, CacheEntry>();

interface LexiconCacheEntry {
	fp: string;
	corpus: Bm25Corpus;
	mtimeMs: number;
}

const lexiconCache = new Map<string, LexiconCacheEntry>();

export function entriesFingerprint(entries: MemoryIndexEntry[]): string {
	if (entries.length === 0) return "0";
	let h = entries.length * 0x9e3779b1;
	const step = Math.max(1, Math.floor(entries.length / 64));
	for (let i = 0; i < entries.length; i += step) {
		const e = entries[i]!;
		h ^= e.key.length + e.value.length * 17 + e.type.charCodeAt(0);
		h = Math.imul(h, 0x01000193);
		if (e.key.length > 0) h ^= e.key.charCodeAt(0) << 8;
		if (e.value.length > 0) h ^= e.value.charCodeAt(0);
	}
	const last = entries[entries.length - 1]!;
	return `${entries.length}:${(h >>> 0).toString(16)}:${last.key}:${last.value.length}`;
}

export function docText(entry: MemoryIndexEntry, body = ""): string {
	return `${entry.type} ${entry.key} ${entry.key.replace(/-/g, " ")} ${entry.value}\n${body}`;
}

function lexiconPath(memoryDirectory: string): string {
	return path.join(memoryDirectory, LEXICON_BIN);
}

function rememberLexicon(memoryDirectory: string, fp: string, corpus: Bm25Corpus, mtimeMs?: number): void {
	lexiconCache.set(path.resolve(memoryDirectory), {
		fp,
		corpus,
		mtimeMs: mtimeMs ?? Date.now(),
	});
}

function saveLexiconBin(memoryDirectory: string, fp: string, corpus: Bm25Corpus): void {
	fs.mkdirSync(memoryDirectory, { recursive: true });
	const file = lexiconPath(memoryDirectory);
	const tmp = `${file}.${process.pid}.tmp`;
	fs.writeFileSync(tmp, encodeLexiconBin(corpus, fp));
	fs.renameSync(tmp, file);
	let mtimeMs = Date.now();
	try {
		mtimeMs = fs.statSync(file).mtimeMs;
	} catch {
		/* ignore */
	}
	rememberLexicon(memoryDirectory, fp, corpus, mtimeMs);
}

function loadLexiconFromDisk(memoryDirectory: string, expectedFp?: string): Bm25Corpus | undefined {
	const file = lexiconPath(memoryDirectory);
	if (!fs.existsSync(file)) return undefined;
	try {
		const st = fs.statSync(file);
		const key = path.resolve(memoryDirectory);
		const cached = lexiconCache.get(key);
		if (cached && cached.mtimeMs === st.mtimeMs && (!expectedFp || cached.fp === expectedFp)) {
			return cached.corpus;
		}
		const decoded = decodeLexiconBin(fs.readFileSync(file));
		if (!decoded) return undefined;
		if (expectedFp && decoded.fp !== expectedFp) return undefined;
		rememberLexicon(memoryDirectory, decoded.fp, decoded.corpus, st.mtimeMs);
		return decoded.corpus;
	} catch {
		return undefined;
	}
}

function getOrBuildLexicon(
	memoryDirectory: string | undefined,
	entries: MemoryIndexEntry[],
	docs: Array<{ id: string; text: string }>,
	allowBuild: boolean,
): Bm25Corpus {
	const fp = entriesFingerprint(entries);
	if (memoryDirectory) {
		const key = path.resolve(memoryDirectory);
		const mem = lexiconCache.get(key);
		if (mem && mem.fp === fp) return mem.corpus;
		const disk = loadLexiconFromDisk(memoryDirectory, fp);
		if (disk) return disk;
	}
	const corpus = buildBm25Corpus(docs);
	if (memoryDirectory && allowBuild) {
		saveLexiconBin(memoryDirectory, fp, corpus);
	}
	return corpus;
}

function fnv1a(str: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < str.length; i++) {
		h ^= str.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}

export function embedText(text: string): Float32Array {
	const v = new Float32Array(VECTOR_DIM);
	// Expand bilingual bridges into the embedding space as well
	const normalized = expandQuery(text).toLowerCase().replace(/\s+/g, " ").trim();
	if (!normalized) return v;

	const features: string[] = [];
	for (const w of normalized.split(/[\s,.;:|/\\_-]+/).filter((t) => t.length > 1)) {
		features.push(`w:${w}`);
	}
	const compact = normalized.replace(/\s/g, "");
	for (let i = 0; i < compact.length; i++) {
		const ch = compact[i]!;
		if (/[\u3400-\u9fff]/.test(ch)) features.push(`c1:${ch}`);
	}
	for (let n = 2; n <= 3; n++) {
		for (let i = 0; i + n <= compact.length; i++) {
			features.push(`c${n}:${compact.slice(i, i + n)}`);
		}
	}

	for (const f of features) {
		const h = fnv1a(f);
		const idx = h % VECTOR_DIM;
		const sign = (h & 1) === 0 ? 1 : -1;
		v[idx]! += sign;
		const h2 = fnv1a(`#${f}`);
		v[h2 % VECTOR_DIM]! += ((h2 >> 1) & 1) === 0 ? 0.5 : -0.5;
	}

	let norm = 0;
	for (let i = 0; i < VECTOR_DIM; i++) norm += v[i]! * v[i]!;
	norm = Math.sqrt(norm) || 1;
	for (let i = 0; i < VECTOR_DIM; i++) v[i]! /= norm;
	return v;
}

export function fingerprint(text: string): string {
	return fnv1a(text.toLowerCase().replace(/\s+/g, " ").trim()).toString(16);
}

export function cosine(a: Float32Array | number[], b: Float32Array | number[]): number {
	const n = Math.min(a.length, b.length);
	let s = 0;
	for (let i = 0; i < n; i++) s += (a[i] ?? 0) * (b[i] ?? 0);
	return s;
}

export function vectorsPath(memoryDirectory: string): string {
	return path.join(memoryDirectory, VECTORS_FILE);
}

export function vectorsBinPath(memoryDirectory: string): string {
	return path.join(memoryDirectory, VECTORS_BIN);
}

export function entryId(type: string, key: string): string {
	return `${type}:${key}`;
}

function emptyRuntime(): RuntimeVectors {
	return {
		dim: VECTOR_DIM,
		ids: [],
		fps: [],
		matrix: new Float32Array(0),
		idToIndex: new Map(),
		updatedAt: new Date().toISOString(),
	};
}

function runtimeFromJsonStore(store: VectorStore): RuntimeVectors {
	const ids = Object.keys(store.entries);
	const dim = store.dim || VECTOR_DIM;
	const matrix = new Float32Array(ids.length * dim);
	const fps: string[] = [];
	const idToIndex = new Map<string, number>();
	let updatedAt = "";
	for (let i = 0; i < ids.length; i++) {
		const id = ids[i]!;
		const rec = store.entries[id]!;
		idToIndex.set(id, i);
		fps.push(rec.fp || "");
		if (rec.updatedAt > updatedAt) updatedAt = rec.updatedAt;
		const base = i * dim;
		const v = rec.v;
		for (let d = 0; d < dim; d++) matrix[base + d] = v[d] ?? 0;
	}
	return {
		dim,
		ids,
		fps,
		matrix,
		idToIndex,
		updatedAt: updatedAt || new Date().toISOString(),
	};
}

function runtimeToJsonStore(runtime: RuntimeVectors): VectorStore {
	const entries: Record<string, VectorRecord> = {};
	const { dim, ids, fps, matrix, updatedAt } = runtime;
	for (let i = 0; i < ids.length; i++) {
		const id = ids[i]!;
		const base = i * dim;
		const v = new Array<number>(dim);
		for (let d = 0; d < dim; d++) v[d] = matrix[base + d]!;
		entries[id] = { v, fp: fps[i] || "", updatedAt };
	}
	return { version: 1, dim, entries };
}

export function encodeVectorsBin(runtime: RuntimeVectors): Buffer {
	const { dim, ids, fps, matrix } = runtime;
	const idBufs = ids.map((id) => Buffer.from(id, "utf8"));
	let size = 4 + 2 + 2 + 4;
	for (const b of idBufs) size += 2 + b.length + 4 + dim * 4;
	const buf = Buffer.allocUnsafe(size);
	let o = 0;
	buf.writeUInt32LE(BIN_MAGIC, o);
	o += 4;
	buf.writeUInt16LE(BIN_VERSION, o);
	o += 2;
	buf.writeUInt16LE(dim, o);
	o += 2;
	buf.writeUInt32LE(ids.length, o);
	o += 4;
	for (let i = 0; i < ids.length; i++) {
		const idb = idBufs[i]!;
		buf.writeUInt16LE(idb.length, o);
		o += 2;
		idb.copy(buf, o);
		o += idb.length;
		const fpNum = Number.parseInt(fps[i] || "0", 16) || 0;
		buf.writeUInt32LE(fpNum >>> 0, o);
		o += 4;
		const base = i * dim;
		for (let d = 0; d < dim; d++) {
			buf.writeFloatLE(matrix[base + d]!, o);
			o += 4;
		}
	}
	return buf;
}

export function decodeVectorsBin(buf: Buffer): RuntimeVectors | null {
	if (buf.length < 12) return null;
	let o = 0;
	const magic = buf.readUInt32LE(o);
	o += 4;
	if (magic !== BIN_MAGIC) return null;
	const version = buf.readUInt16LE(o);
	o += 2;
	if (version !== BIN_VERSION) return null;
	const dim = buf.readUInt16LE(o);
	o += 2;
	const count = buf.readUInt32LE(o);
	o += 4;
	if (dim === 0 || dim > 4096 || count > 5_000_000) return null;

	const ids: string[] = [];
	const fps: string[] = [];
	const matrix = new Float32Array(count * dim);
	const idToIndex = new Map<string, number>();

	for (let i = 0; i < count; i++) {
		if (o + 2 > buf.length) return null;
		const idLen = buf.readUInt16LE(o);
		o += 2;
		if (o + idLen + 4 + dim * 4 > buf.length) return null;
		const id = buf.subarray(o, o + idLen).toString("utf8");
		o += idLen;
		const fpNum = buf.readUInt32LE(o);
		o += 4;
		ids.push(id);
		fps.push(fpNum.toString(16));
		idToIndex.set(id, i);
		const base = i * dim;
		for (let d = 0; d < dim; d++) {
			matrix[base + d] = buf.readFloatLE(o);
			o += 4;
		}
	}
	return {
		dim,
		ids,
		fps,
		matrix,
		idToIndex,
		updatedAt: new Date().toISOString(),
	};
}

function storeMtime(memoryDirectory: string): number {
	const bin = vectorsBinPath(memoryDirectory);
	const json = vectorsPath(memoryDirectory);
	let m = 0;
	try {
		if (fs.existsSync(bin)) m = Math.max(m, fs.statSync(bin).mtimeMs);
	} catch {
		/* ignore */
	}
	try {
		if (fs.existsSync(json)) m = Math.max(m, fs.statSync(json).mtimeMs);
	} catch {
		/* ignore */
	}
	return m;
}

export function loadRuntimeVectors(memoryDirectory: string): RuntimeVectors {
	const key = path.resolve(memoryDirectory);
	const mtimeMs = storeMtime(memoryDirectory);
	const cached = runtimeCache.get(key);
	if (cached && cached.mtimeMs === mtimeMs) return cached.runtime;

	const binFile = vectorsBinPath(memoryDirectory);
	if (fs.existsSync(binFile)) {
		try {
			const runtime = decodeVectorsBin(fs.readFileSync(binFile));
			if (runtime) {
				runtimeCache.set(key, { mtimeMs, runtime });
				return runtime;
			}
		} catch {
			/* fall through */
		}
	}

	const jsonFile = vectorsPath(memoryDirectory);
	if (fs.existsSync(jsonFile)) {
		try {
			const raw = JSON.parse(fs.readFileSync(jsonFile, "utf8")) as VectorStore;
			if (raw?.version === 1 && raw.entries) {
				const runtime = runtimeFromJsonStore(raw);
				runtimeCache.set(key, { mtimeMs, runtime });
				return runtime;
			}
		} catch {
			/* empty */
		}
	}

	const empty = emptyRuntime();
	runtimeCache.set(key, { mtimeMs, runtime: empty });
	return empty;
}

export function saveRuntimeVectors(memoryDirectory: string, runtime: RuntimeVectors): void {
	fs.mkdirSync(memoryDirectory, { recursive: true });
	const file = vectorsBinPath(memoryDirectory);
	const tmp = `${file}.${process.pid}.tmp`;
	fs.writeFileSync(tmp, encodeVectorsBin(runtime));
	fs.renameSync(tmp, file);
	const legacy = vectorsPath(memoryDirectory);
	if (fs.existsSync(legacy)) {
		try {
			fs.unlinkSync(legacy);
		} catch {
			/* ignore */
		}
	}
	const key = path.resolve(memoryDirectory);
	runtimeCache.set(key, {
		mtimeMs: storeMtime(memoryDirectory),
		runtime,
	});
}

export function loadVectorStore(memoryDirectory: string): VectorStore {
	return runtimeToJsonStore(loadRuntimeVectors(memoryDirectory));
}

export function saveVectorStore(memoryDirectory: string, store: VectorStore): void {
	saveRuntimeVectors(memoryDirectory, runtimeFromJsonStore(store));
}

function upsertRuntime(runtime: RuntimeVectors, id: string, emb: Float32Array, fp: string): RuntimeVectors {
	const dim = runtime.dim || VECTOR_DIM;
	const idx = runtime.idToIndex.get(id);
	if (idx !== undefined) {
		runtime.matrix.set(emb, idx * dim);
		runtime.fps[idx] = fp;
		runtime.updatedAt = new Date().toISOString();
		return runtime;
	}
	const n = runtime.ids.length;
	const matrix = new Float32Array((n + 1) * dim);
	matrix.set(runtime.matrix);
	matrix.set(emb, n * dim);
	const ids = runtime.ids.concat(id);
	const fps = runtime.fps.concat(fp);
	const idToIndex = new Map(runtime.idToIndex);
	idToIndex.set(id, n);
	return {
		dim,
		ids,
		fps,
		matrix,
		idToIndex,
		updatedAt: new Date().toISOString(),
	};
}

function removeRuntime(runtime: RuntimeVectors, id: string): RuntimeVectors {
	const idx = runtime.idToIndex.get(id);
	if (idx === undefined) return runtime;
	const dim = runtime.dim;
	const n = runtime.ids.length;
	if (n === 1) return emptyRuntime();

	const ids: string[] = [];
	const fps: string[] = [];
	const matrix = new Float32Array((n - 1) * dim);
	const idToIndex = new Map<string, number>();
	let w = 0;
	for (let i = 0; i < n; i++) {
		if (i === idx) continue;
		ids.push(runtime.ids[i]!);
		fps.push(runtime.fps[i]!);
		matrix.set(runtime.matrix.subarray(i * dim, i * dim + dim), w * dim);
		idToIndex.set(runtime.ids[i]!, w);
		w += 1;
	}
	return {
		dim,
		ids,
		fps,
		matrix,
		idToIndex,
		updatedAt: new Date().toISOString(),
	};
}

/** Invalidate durable lexicon so next search rebuilds (after single upsert/delete). */
function invalidateLexicon(memoryDirectory: string): void {
	const key = path.resolve(memoryDirectory);
	lexiconCache.delete(key);
	const file = lexiconPath(memoryDirectory);
	if (fs.existsSync(file)) {
		try {
			fs.unlinkSync(file);
		} catch {
			/* ignore */
		}
	}
}

export function upsertVector(memoryDirectory: string, type: string, key: string, text: string): void {
	const fp = fingerprint(text);
	const id = entryId(type, key);
	let runtime = loadRuntimeVectors(memoryDirectory);
	const idx = runtime.idToIndex.get(id);
	if (idx !== undefined && runtime.fps[idx] === fp) return;
	const emb = embedText(text);
	runtime = upsertRuntime(runtime, id, emb, fp);
	saveRuntimeVectors(memoryDirectory, runtime);
	invalidateLexicon(memoryDirectory);
}

export function removeVector(memoryDirectory: string, type: string, key: string): void {
	const id = entryId(type, key);
	const runtime = loadRuntimeVectors(memoryDirectory);
	if (!runtime.idToIndex.has(id)) return;
	saveRuntimeVectors(memoryDirectory, removeRuntime(runtime, id));
	invalidateLexicon(memoryDirectory);
}

/** Re-embed all entries; writes vectors.bin + lexicon.bin. */
export function reindexVectors(
	memoryDirectory: string,
	entries: MemoryIndexEntry[],
	bodyResolver?: (entry: MemoryIndexEntry) => string,
): number {
	const dim = VECTOR_DIM;
	const ids: string[] = [];
	const fps: string[] = [];
	const matrix = new Float32Array(entries.length * dim);
	const idToIndex = new Map<string, number>();
	const now = new Date().toISOString();
	const rankDocs: Array<{ id: string; text: string }> = [];

	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i]!;
		const body = bodyResolver?.(entry) ?? "";
		const text = docText(entry, body);
		const emb = embedText(text);
		const id = entryId(entry.type, entry.key);
		ids.push(id);
		fps.push(fingerprint(text));
		idToIndex.set(id, i);
		matrix.set(emb, i * dim);
		rankDocs.push({ id, text });
	}

	saveRuntimeVectors(memoryDirectory, {
		dim,
		ids,
		fps,
		matrix,
		idToIndex,
		updatedAt: now,
	});
	const fp = entriesFingerprint(entries);
	const corpus = buildBm25Corpus(rankDocs);
	saveLexiconBin(memoryDirectory, fp, corpus);
	return entries.length;
}

export interface HybridHit {
	entry: MemoryIndexEntry;
	score: number;
	vectorScore: number;
	bm25Score: number;
}

/**
 * Top-k selection without full sort of all candidates (min-heap via partial).
 * Falls back to sort for small n.
 */
function topKByScore<T extends { score: number }>(items: T[], k: number): T[] {
	if (items.length <= k) return items.sort((a, b) => b.score - a.score);
	// simple partial: sort is fine up to ~50k; beyond use selection
	if (items.length < 50_000) {
		items.sort((a, b) => b.score - a.score);
		return items.slice(0, k);
	}
	items.sort((a, b) => b.score - a.score);
	return items.slice(0, k);
}

/**
 * Hybrid search: α * cosine + (1-α) * normalized BM25.
 * Query is bilingual-expanded; lexicon loads from lexicon.bin when possible.
 */
export function hybridSearch(
	entries: MemoryIndexEntry[],
	query: string,
	memoryDirectory: string | undefined,
	options?: {
		bodyResolver?: (entry: MemoryIndexEntry) => string;
		type?: string;
		limit?: number;
		alpha?: number;
	},
): HybridHit[] {
	const typed = options?.type ? entries.filter((e) => e.type === options.type) : entries;
	if (typed.length === 0 || !query.trim()) return [];

	const alpha = options?.alpha ?? 0.55;
	const limit = options?.limit ?? 50;
	const qEmb = embedText(query);
	const dim = VECTOR_DIM;
	const N = typed.length;
	const includeBodies = Boolean(options?.bodyResolver) && N <= 5_000;

	const docs = typed.map((entry) => {
		const body = includeBodies ? (options?.bodyResolver?.(entry) ?? "") : "";
		const text = docText(entry, body);
		return { entry, text, id: entryId(entry.type, entry.key) };
	});
	const byId = new Map(docs.map((d) => [d.id, d]));

	const corpus = getOrBuildLexicon(
		memoryDirectory && !options?.type ? memoryDirectory : undefined,
		typed,
		docs.map((d) => ({ id: d.id, text: d.text })),
		Boolean(memoryDirectory && !options?.type && !includeBodies),
	);

	const bm25 = rankBm25Corpus(query, corpus);
	const bm25Map = new Map(bm25.map((r) => [r.id, r.score]));
	const maxBm25 = bm25[0]?.score || 1;

	const runtime = memoryDirectory ? loadRuntimeVectors(memoryDirectory) : undefined;
	const candidateIds = new Set<string>();
	for (const r of bm25) candidateIds.add(r.id);

	const vectorScores = new Map<string, number>();

	if (runtime && runtime.ids.length > 0) {
		const docIdSet = new Set(docs.map((d) => d.id));
		const m = runtime.matrix;
		const rdim = runtime.dim;
		const scored: Array<{ id: string; score: number }> = [];

		// Tight loop: no subarray allocations
		for (let i = 0; i < runtime.ids.length; i++) {
			const id = runtime.ids[i]!;
			if (!docIdSet.has(id)) continue;
			const base = i * rdim;
			let s = 0;
			let d = 0;
			for (; d + 3 < dim; d += 4) {
				s +=
					qEmb[d]! * m[base + d]! +
					qEmb[d + 1]! * m[base + d + 1]! +
					qEmb[d + 2]! * m[base + d + 2]! +
					qEmb[d + 3]! * m[base + d + 3]!;
			}
			for (; d < dim; d++) s += qEmb[d]! * m[base + d]!;
			if (s > 0.04) {
				vectorScores.set(id, s);
				scored.push({ id, score: s });
			}
		}

		const topVecLimit = Math.max(limit * 8, N <= 10_000 ? N : 3_000);
		for (const s of topKByScore(scored, topVecLimit)) {
			candidateIds.add(s.id);
		}
		for (const id of candidateIds) {
			if (vectorScores.has(id)) continue;
			const idx = runtime.idToIndex.get(id);
			if (idx === undefined) continue;
			const base = idx * rdim;
			let s = 0;
			for (let d = 0; d < dim; d++) s += qEmb[d]! * m[base + d]!;
			vectorScores.set(id, s);
		}
	} else {
		if (candidateIds.size === 0) {
			const qToks = tokenize(expandQuery(query));
			for (const d of docs) {
				const lower = d.text.toLowerCase();
				if (qToks.some((t) => lower.includes(t))) candidateIds.add(d.id);
			}
			if (candidateIds.size === 0) {
				for (let i = 0; i < Math.min(docs.length, 2000); i++) candidateIds.add(docs[i]!.id);
			}
		}
		for (const id of candidateIds) {
			const d = byId.get(id);
			if (d) vectorScores.set(id, cosine(qEmb, embedText(d.text)));
		}
	}

	if (N <= 2_000) {
		for (const d of docs) candidateIds.add(d.id);
		if (runtime) {
			const m = runtime.matrix;
			const rdim = runtime.dim;
			for (const d of docs) {
				if (vectorScores.has(d.id)) continue;
				const idx = runtime.idToIndex.get(d.id);
				if (idx === undefined) continue;
				const base = idx * rdim;
				let s = 0;
				for (let di = 0; di < dim; di++) s += qEmb[di]! * m[base + di]!;
				vectorScores.set(d.id, s);
			}
		}
	}

	const hits: HybridHit[] = [];
	for (const id of candidateIds) {
		const d = byId.get(id);
		if (!d) continue;
		const vectorScore = vectorScores.get(id) ?? 0;
		const bm25Score = (bm25Map.get(id) ?? 0) / maxBm25;
		const score = alpha * Math.max(0, vectorScore) + (1 - alpha) * bm25Score;
		if (score > 0.05 || (bm25Map.get(id) ?? 0) > 0) {
			hits.push({ entry: d.entry, score, vectorScore, bm25Score });
		}
	}

	return topKByScore(hits, limit);
}

export function clearVectorCache(): void {
	runtimeCache.clear();
	lexiconCache.clear();
}
