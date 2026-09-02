/**
 * rank.ts coverage: CJK-aware tokenizer, BM25 scoring, query expansion, and the
 * lexicon.bin format. Untested in the old repo despite being the retrieval path
 * that runs when vectors are disabled.
 */

import { describe, expect, it } from "vitest";
import {
	buildBm25Corpus,
	decodeLexiconBin,
	encodeLexiconBin,
	expandQuery,
	rankBm25,
	rankBm25Corpus,
	tokenize,
} from "../src/rank.ts";

describe("tokenize", () => {
	it("splits ASCII words and lowercases them", () => {
		expect(tokenize("Hello World BUILD")).toEqual(expect.arrayContaining(["hello", "world", "build"]));
	});

	it("emits CJK unigrams so Chinese text is searchable without spaces", () => {
		const tokens = tokenize("热加载");
		expect(tokens).toEqual(expect.arrayContaining(["热", "加", "载"]));
	});

	it("handles mixed CJK and ASCII in one string", () => {
		const tokens = tokenize("重启 daemon 后生效");
		expect(tokens).toContain("daemon");
		expect(tokens).toContain("重");
	});

	it("returns an empty array for empty or symbol-only input", () => {
		expect(tokenize("")).toEqual([]);
		expect(tokenize("!!! ??? ...")).toEqual([]);
	});

	it("drops stop words", () => {
		// "the" is a stop word; the content word must survive.
		const tokens = tokenize("the daemon");
		expect(tokens).toContain("daemon");
		expect(tokens).not.toContain("the");
	});
});

describe("expandQuery", () => {
	it("returns a string containing the original query", () => {
		const expanded = expandQuery("build error");
		expect(typeof expanded).toBe("string");
		expect(expanded).toContain("build");
	});

	it("is stable for repeated calls", () => {
		expect(expandQuery("重启 daemon")).toBe(expandQuery("重启 daemon"));
	});

	it("does not throw on empty input", () => {
		expect(() => expandQuery("")).not.toThrow();
	});
});

describe("rankBm25", () => {
	const documents = [
		{ id: "a", text: "npm run check runs biome and the type checker" },
		{ id: "b", text: "electron builder packages the desktop app for macOS" },
		{ id: "c", text: "记忆检索使用 BM25 与向量混合排序" },
	];

	it("ranks the matching document first", () => {
		const results = rankBm25("type checker", documents);
		expect(results[0]?.id).toBe("a");
	});

	it("matches Chinese queries", () => {
		const results = rankBm25("向量混合", documents);
		expect(results[0]?.id).toBe("c");
	});

	it("returns scores in non-increasing order", () => {
		const scores = rankBm25("the desktop app", documents).map((result) => result.score);
		for (let index = 1; index < scores.length; index++) {
			expect(scores[index - 1]).toBeGreaterThanOrEqual(scores[index]);
		}
	});

	it("returns no results for a query with no shared terms", () => {
		expect(rankBm25("zzzz-nonexistent-token", documents)).toEqual([]);
	});

	it("handles an empty corpus", () => {
		expect(rankBm25("anything", [])).toEqual([]);
	});
});

describe("buildBm25Corpus / rankBm25Corpus", () => {
	const documents = [
		{ id: "a", text: "daemon restart picks up the new build" },
		{ id: "b", text: "memory extraction runs on session shutdown" },
	];

	it("scores the same as the one-shot ranker", () => {
		const corpus = buildBm25Corpus(documents);
		const viaCorpus = rankBm25Corpus("daemon restart", corpus);
		const direct = rankBm25("daemon restart", documents);
		expect(viaCorpus[0]?.id).toBe(direct[0]?.id);
	});

	it("keeps every document in the corpus", () => {
		const corpus = buildBm25Corpus(documents);
		expect(corpus.N).toBe(2);
	});
});

describe("lexicon.bin round-trip", () => {
	const documents = [
		{ id: "a", text: "daemon restart picks up the new build" },
		{ id: "b", text: "记忆检索使用 BM25 排序" },
	];

	it("restores a corpus that ranks identically", () => {
		const corpus = buildBm25Corpus(documents);
		const decoded = decodeLexiconBin(encodeLexiconBin(corpus, "fp-1"));

		expect(decoded).not.toBeNull();
		expect(decoded?.fp).toBe("fp-1");
		expect(decoded?.corpus.N).toBe(corpus.N);

		const before = rankBm25Corpus("daemon build", corpus);
		const after = rankBm25Corpus("daemon build", decoded!.corpus);
		expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id));
	});

	it("rejects corrupt buffers rather than returning a broken corpus", () => {
		const encoded = encodeLexiconBin(buildBm25Corpus(documents), "fp-1");
		expect(decodeLexiconBin(encoded.subarray(0, 6))).toBeNull();
		expect(decodeLexiconBin(Buffer.alloc(0))).toBeNull();
	});

	it("round-trips an empty corpus", () => {
		const decoded = decodeLexiconBin(encodeLexiconBin(buildBm25Corpus([]), "fp-empty"));
		expect(decoded?.corpus.N).toBe(0);
	});
});
