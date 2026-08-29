/**
 * Lightweight lexical ranker (BM25-ish) — no embeddings, no native deps.
 * CJK-aware tokenization, inverted postings, durable lexicon.bin.
 */

export interface RankDocument {
	id: string;
	text: string;
}

export interface RankResult {
	id: string;
	score: number;
}

export const LEXICON_BIN = "lexicon.bin";
const LEX_MAGIC = 0x4f50494c; // "OPIL"
const LEX_VERSION = 1;

const STOP = new Set([
	"a",
	"an",
	"the",
	"and",
	"or",
	"to",
	"of",
	"in",
	"on",
	"for",
	"is",
	"are",
	"be",
	"this",
	"that",
	"with",
	"as",
	"at",
	"by",
	"it",
	"from",
	"的",
	"了",
	"是",
	"在",
	"和",
	"与",
	"把",
	"被",
	"就",
	"也",
	"都",
	"吗",
	"呢",
	"啊",
	"吧",
	"着",
	"过",
	"这",
	"那",
	"有",
	"不",
	"人",
	"我",
	"你",
	"他",
	"她",
	"它",
	"们",
]);

const CJK_RE = /[\u3400-\u9fff\uf900-\ufaff]/;

/**
 * Lightweight bilingual / paraphrase bridges for personal-agent vocabulary.
 * Expands queries only (documents unchanged) so Chinese↔English preference hits improve.
 */
const QUERY_EXPAND: Record<string, readonly string[]> = {
	concise: ["简洁", "简短", "精炼", "short", "brief"],
	brief: ["concise", "简洁", "short"],
	short: ["concise", "简洁", "brief"],
	简洁: ["concise", "brief", "short", "精炼", "简短"],
	简短: ["concise", "brief", "简洁"],
	废话: ["fluff", "filler", "verbose"],
	fluff: ["废话", "filler"],
	本地: ["local", "offline", "on-device"],
	local: ["本地", "offline"],
	远端: ["remote", "cloud", "hosted"],
	remote: ["远端", "cloud"],
	向量: ["vector", "embedding"],
	vector: ["向量", "embedding"],
	检索: ["search", "recall", "query"],
	search: ["检索", "query"],
	记忆: ["memory", "memories"],
	memory: ["记忆"],
	打包: ["packaging", "electron", "ditto"],
	packaging: ["打包"],
	提交: ["commit", "git"],
	commit: ["提交"],
	检查: ["check", "lint", "typecheck"],
	check: ["检查", "npm"],
	发送: ["send", "submit", "enter"],
	send: ["发送", "submit"],
	桌面: ["desktop", "electron"],
	desktop: ["桌面"],
	不要: ["never", "no", "avoid"],
	never: ["不要", "禁止"],
	emoji: ["表情", "emojis"],
	表情: ["emoji"],
};

/**
 * Tokenize for BM25.
 * - Latin/digit words (len > 1)
 * - CJK: character unigrams + bigrams (so short Chinese queries match)
 */
export function tokenize(text: string): string[] {
	const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
	if (!normalized) return [];

	const out: string[] = [];
	const seen = new Set<string>();
	const push = (t: string) => {
		if (!t || STOP.has(t) || seen.has(t)) return;
		if (t.length === 1 && !CJK_RE.test(t)) return;
		seen.add(t);
		out.push(t);
	};

	const parts = normalized.split(/([^\p{L}\p{N}_-]+)/u);
	for (const part of parts) {
		if (!part || /^[^\p{L}\p{N}_-]+$/u.test(part)) continue;

		if (CJK_RE.test(part)) {
			const chars: string[] = [];
			let latinBuf = "";
			const flushLatin = () => {
				if (latinBuf.length > 1 && !STOP.has(latinBuf)) push(latinBuf);
				latinBuf = "";
			};
			for (const ch of part) {
				if (CJK_RE.test(ch)) {
					flushLatin();
					chars.push(ch);
				} else if (/[\p{L}\p{N}]/u.test(ch)) {
					latinBuf += ch.toLowerCase();
				} else {
					flushLatin();
				}
			}
			flushLatin();
			for (const ch of chars) push(ch);
			for (let i = 0; i + 1 < chars.length; i++) {
				push(chars[i]! + chars[i + 1]!);
			}
			if (chars.length >= 6) {
				for (let i = 0; i + 2 < chars.length; i++) {
					push(chars[i]! + chars[i + 1]! + chars[i + 2]!);
				}
			}
		} else {
			for (const w of part.split(/[_\-/]+/).filter((t) => t.length > 1)) {
				push(w);
			}
		}
	}

	return out;
}

/** Expand query with bilingual/paraphrase bridges (for ranking only). */
export function expandQuery(query: string): string {
	const base = query.trim();
	if (!base) return base;
	const toks = tokenize(base);
	const extra: string[] = [];
	const seen = new Set(toks);
	for (const t of toks) {
		const syns = QUERY_EXPAND[t];
		if (!syns) continue;
		for (const s of syns) {
			if (seen.has(s)) continue;
			seen.add(s);
			extra.push(s);
		}
	}
	// also expand raw CJK bigrams from original string
	const compact = base.replace(/\s/g, "");
	for (let i = 0; i + 1 < compact.length; i++) {
		const bi = compact.slice(i, i + 2);
		const syns = QUERY_EXPAND[bi];
		if (!syns) continue;
		for (const s of syns) {
			if (seen.has(s)) continue;
			seen.add(s);
			extra.push(s);
		}
	}
	return extra.length === 0 ? base : `${base} ${extra.join(" ")}`;
}

export interface Bm25Corpus {
	ids: string[];
	/** token list per doc (with multiplicity) */
	tokens: string[][];
	/** precomputed term frequencies per doc */
	tfs: Array<Map<string, number>>;
	/** document lengths */
	lengths: number[];
	/** document frequency */
	df: Map<string, number>;
	/** inverted: token → doc indices that contain it */
	postings: Map<string, number[]>;
	avgdl: number;
	N: number;
}

/** Build a reusable BM25 corpus (tokenize once, query many). */
export function buildBm25Corpus(documents: RankDocument[]): Bm25Corpus {
	const ids: string[] = [];
	const tokens: string[][] = [];
	const tfs: Array<Map<string, number>> = [];
	const lengths: number[] = [];
	const df = new Map<string, number>();
	const postings = new Map<string, number[]>();
	let totalLen = 0;

	for (let i = 0; i < documents.length; i++) {
		const d = documents[i]!;
		ids.push(d.id);
		const toks = tokenize(d.text);
		tokens.push(toks);
		const tf = new Map<string, number>();
		for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
		tfs.push(tf);
		lengths.push(toks.length);
		totalLen += toks.length;
		for (const t of tf.keys()) {
			df.set(t, (df.get(t) ?? 0) + 1);
			const list = postings.get(t);
			if (list) list.push(i);
			else postings.set(t, [i]);
		}
	}

	return {
		ids,
		tokens,
		tfs,
		lengths,
		df,
		postings,
		avgdl: totalLen / Math.max(1, documents.length),
		N: documents.length,
	};
}

/**
 * BM25 over a prebuilt corpus. Only scores docs that share ≥1 query token.
 * Uses expandQuery so bilingual bridges apply.
 */
export function rankBm25Corpus(query: string, corpus: Bm25Corpus): RankResult[] {
	const qTokens = tokenize(expandQuery(query));
	if (qTokens.length === 0 || corpus.N === 0) return [];

	const candidates = new Set<number>();
	for (const qt of qTokens) {
		const posting = corpus.postings.get(qt);
		if (posting) for (const idx of posting) candidates.add(idx);
	}
	if (candidates.size === 0) return [];

	const k1 = 1.2;
	const b = 0.75;
	const results: RankResult[] = [];

	for (const idx of candidates) {
		const tf = corpus.tfs[idx]!;
		const dl = corpus.lengths[idx] || 1;
		let score = 0;
		for (const qt of qTokens) {
			const f = tf.get(qt) ?? 0;
			if (f === 0) continue;
			const n = corpus.df.get(qt) ?? 0;
			const idf = Math.log(1 + (corpus.N - n + 0.5) / (n + 0.5));
			const denom = f + k1 * (1 - b + (b * dl) / corpus.avgdl);
			score += idf * ((f * (k1 + 1)) / denom);
		}
		if (score > 0) results.push({ id: corpus.ids[idx]!, score });
	}

	return results.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

/**
 * BM25 ranking (k1=1.2, b=0.75). Returns docs with score > 0, highest first.
 */
export function rankBm25(query: string, documents: RankDocument[]): RankResult[] {
	if (documents.length === 0 || !query.trim()) return [];
	return rankBm25Corpus(query, buildBm25Corpus(documents));
}

/**
 * Encode BM25 corpus to compact binary (string dictionary + per-doc token index lists).
 * magic OPIL | ver | fp | N | avgdl | dict | docs
 */
export function encodeLexiconBin(corpus: Bm25Corpus, fp: string): Buffer {
	const dict: string[] = [];
	const dictIndex = new Map<string, number>();
	const ensure = (t: string): number => {
		let i = dictIndex.get(t);
		if (i !== undefined) return i;
		i = dict.length;
		dict.push(t);
		dictIndex.set(t, i);
		return i;
	};

	const docTokIdx: number[][] = [];
	for (const toks of corpus.tokens) {
		docTokIdx.push(toks.map(ensure));
	}

	const fpBuf = Buffer.from(fp, "utf8");
	const idBufs = corpus.ids.map((id) => Buffer.from(id, "utf8"));
	const dictBufs = dict.map((t) => Buffer.from(t, "utf8"));

	let size = 4 + 2 + 2 + fpBuf.length + 4 + 8 + 4;
	for (const b of dictBufs) size += 2 + b.length;
	for (let i = 0; i < corpus.N; i++) {
		size += 2 + idBufs[i]!.length + 2 + docTokIdx[i]!.length * 4;
	}

	const buf = Buffer.allocUnsafe(size);
	let o = 0;
	buf.writeUInt32LE(LEX_MAGIC, o);
	o += 4;
	buf.writeUInt16LE(LEX_VERSION, o);
	o += 2;
	buf.writeUInt16LE(fpBuf.length, o);
	o += 2;
	fpBuf.copy(buf, o);
	o += fpBuf.length;
	buf.writeUInt32LE(corpus.N, o);
	o += 4;
	buf.writeDoubleLE(corpus.avgdl, o);
	o += 8;
	buf.writeUInt32LE(dict.length, o);
	o += 4;
	for (const b of dictBufs) {
		buf.writeUInt16LE(b.length, o);
		o += 2;
		b.copy(buf, o);
		o += b.length;
	}
	for (let i = 0; i < corpus.N; i++) {
		const idb = idBufs[i]!;
		const idxs = docTokIdx[i]!;
		buf.writeUInt16LE(idb.length, o);
		o += 2;
		idb.copy(buf, o);
		o += idb.length;
		buf.writeUInt16LE(idxs.length, o);
		o += 2;
		for (const ti of idxs) {
			buf.writeUInt32LE(ti, o);
			o += 4;
		}
	}
	return buf;
}

export function decodeLexiconBin(buf: Buffer): { fp: string; corpus: Bm25Corpus } | null {
	if (buf.length < 20) return null;
	let o = 0;
	if (buf.readUInt32LE(o) !== LEX_MAGIC) return null;
	o += 4;
	if (buf.readUInt16LE(o) !== LEX_VERSION) return null;
	o += 2;
	const fpLen = buf.readUInt16LE(o);
	o += 2;
	if (o + fpLen > buf.length) return null;
	const fp = buf.subarray(o, o + fpLen).toString("utf8");
	o += fpLen;
	const N = buf.readUInt32LE(o);
	o += 4;
	const avgdl = buf.readDoubleLE(o);
	o += 8;
	const dictCount = buf.readUInt32LE(o);
	o += 4;
	if (N > 5_000_000 || dictCount > 50_000_000) return null;

	const dict: string[] = [];
	for (let i = 0; i < dictCount; i++) {
		if (o + 2 > buf.length) return null;
		const len = buf.readUInt16LE(o);
		o += 2;
		if (o + len > buf.length) return null;
		dict.push(buf.subarray(o, o + len).toString("utf8"));
		o += len;
	}

	const ids: string[] = [];
	const tokens: string[][] = [];
	const tfs: Array<Map<string, number>> = [];
	const lengths: number[] = [];
	const df = new Map<string, number>();
	const postings = new Map<string, number[]>();

	for (let i = 0; i < N; i++) {
		if (o + 2 > buf.length) return null;
		const idLen = buf.readUInt16LE(o);
		o += 2;
		if (o + idLen + 2 > buf.length) return null;
		const id = buf.subarray(o, o + idLen).toString("utf8");
		o += idLen;
		const tokCount = buf.readUInt16LE(o);
		o += 2;
		if (o + tokCount * 4 > buf.length) return null;
		const toks: string[] = [];
		const tf = new Map<string, number>();
		for (let t = 0; t < tokCount; t++) {
			const ti = buf.readUInt32LE(o);
			o += 4;
			const tok = dict[ti];
			if (!tok) continue;
			toks.push(tok);
			tf.set(tok, (tf.get(tok) ?? 0) + 1);
		}
		ids.push(id);
		tokens.push(toks);
		tfs.push(tf);
		lengths.push(toks.length);
		for (const tok of tf.keys()) {
			df.set(tok, (df.get(tok) ?? 0) + 1);
			const list = postings.get(tok);
			if (list) list.push(i);
			else postings.set(tok, [i]);
		}
	}

	return {
		fp,
		corpus: { ids, tokens, tfs, lengths, df, postings, avgdl, N },
	};
}
