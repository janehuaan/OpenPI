import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
	cosineSimilarity,
	type EmbeddingConfig,
	embedTexts,
	loadEmbeddingConfig,
	rankBySimilarity,
} from "../../src/core/tools/embedding.ts";

const tmpDirs: string[] = [];

function makeTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "embedding-test-"));
	tmpDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tmpDirs) {
		rmSync(dir, { recursive: true, force: true });
	}
	tmpDirs.length = 0;
});

function config(): EmbeddingConfig {
	return { apiKey: "test-key", baseUrl: "https://example.com/v1", model: "test-embed" };
}

describe("embedding", () => {
	it("loadEmbeddingConfig returns null without a key and a config with one", () => {
		expect(loadEmbeddingConfig({})).toBeNull();
		const loaded = loadEmbeddingConfig({ OPENPI_EMBEDDING_API_KEY: "k" });
		expect(loaded).not.toBeNull();
		expect(loaded?.model).toBe("text-embedding-3-small");
		expect(loaded?.baseUrl).toBe("https://api.openai.com/v1");
		const custom = loadEmbeddingConfig({
			OPENPI_EMBEDDING_API_KEY: "k",
			OPENPI_EMBEDDING_BASE_URL: "https://x.test/v1/",
			OPENPI_EMBEDDING_MODEL: "custom-embed",
		});
		expect(custom?.baseUrl).toBe("https://x.test/v1");
		expect(custom?.model).toBe("custom-embed");
	});

	it("embedTexts posts to the embeddings endpoint and returns vectors", async () => {
		const dir = makeTempDir();
		const calls: Array<{ url: string; body: unknown }> = [];
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
			calls.push({ url: String(input), body: init?.body });
			return new Response(
				JSON.stringify({
					data: [
						{ index: 0, embedding: [1, 0, 0] },
						{ index: 1, embedding: [0, 1, 0] },
					],
				}),
				{ status: 200 },
			);
		}) as typeof fetch;

		try {
			const vectors = await embedTexts(["first text", "second text"], config(), join(dir, "cache.json"));
			expect(vectors).toHaveLength(2);
			expect(Array.from(vectors![0])).toEqual([1, 0, 0]);
			expect(Array.from(vectors![1])).toEqual([0, 1, 0]);
			expect(calls).toHaveLength(1);
			expect(calls[0].url).toBe("https://example.com/v1/embeddings");
			const body = JSON.parse(String(calls[0].body));
			expect(body.model).toBe("test-embed");
			expect(body.input).toEqual(["first text", "second text"]);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("embedTexts returns null when the provider errors", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () => new Response("nope", { status: 500 })) as typeof fetch;
		try {
			const vectors = await embedTexts(["x"], config());
			expect(vectors).toBeNull();
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("embedTexts returns null on network failure", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () => {
			throw new Error("network down");
		}) as typeof fetch;
		try {
			const vectors = await embedTexts(["x"], config());
			expect(vectors).toBeNull();
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("cosineSimilarity and rankBySimilarity order by closeness", () => {
		const query = Float32Array.from([1, 0, 0]);
		const close = Float32Array.from([0.9, 0.1, 0]);
		const far = Float32Array.from([0, 1, 0]);
		expect(cosineSimilarity(query, close)).toBeGreaterThan(cosineSimilarity(query, far));

		const order = rankBySimilarity(query, [far, close]);
		expect(order).toEqual([1, 0]);
	});

	it("cosineSimilarity handles mismatched or empty vectors", () => {
		expect(cosineSimilarity(new Float32Array(0), new Float32Array(3))).toBe(0);
		expect(cosineSimilarity(new Float32Array([1]), new Float32Array([1, 2]))).toBe(0);
	});
});
