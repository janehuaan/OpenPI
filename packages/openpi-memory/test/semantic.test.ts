import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadSemanticEmbedderOptions, SemanticEmbedder, semanticRerank } from "../src/semantic.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
	delete process.env.OPENPI_EMBEDDING_API_KEY;
	delete process.env.OPENPI_EMBEDDING_BASE_URL;
	delete process.env.OPENPI_EMBEDDING_MODEL;
});

describe("loadSemanticEmbedderOptions", () => {
	it("returns null without an API key", () => {
		expect(loadSemanticEmbedderOptions({})).toBeNull();
	});

	it("reads config from the environment", () => {
		const options = loadSemanticEmbedderOptions({
			OPENPI_EMBEDDING_API_KEY: "k",
			OPENPI_EMBEDDING_BASE_URL: "http://localhost:1234/v1",
			OPENPI_EMBEDDING_MODEL: "nomic-embed-text",
		});
		expect(options).toEqual({
			apiKey: "k",
			baseUrl: "http://localhost:1234/v1",
			model: "nomic-embed-text",
			batchSize: 64,
		});
	});
});

describe("SemanticEmbedder", () => {
	it("embeds text via the API and caches by fingerprint", async () => {
		globalThis.fetch = vi.fn(async () => {
			return new Response(
				JSON.stringify({
					data: [
						{ index: 0, embedding: [1, 0, 0, 0] },
						{ index: 1, embedding: [0, 1, 0, 0] },
					],
				}),
				{ status: 200 },
			);
		}) as unknown as typeof fetch;

		const embedder = new SemanticEmbedder({ apiKey: "k" });
		const [a] = await embedder.embedBatch(["alpha", "beta"]);
		expect(Array.from(a)).toEqual([1, 0, 0, 0]);

		// Second call hits the cache (same fingerprint).
		const [cached] = await embedder.embedBatch(["alpha"]);
		expect(Array.from(cached)).toEqual([1, 0, 0, 0]);
		expect(globalThis.fetch).toHaveBeenCalledTimes(1);
	});

	it("throws on API errors", async () => {
		globalThis.fetch = vi.fn(async () => new Response("nope", { status: 401 })) as unknown as typeof fetch;
		const embedder = new SemanticEmbedder({ apiKey: "bad" });
		await expect(embedder.embedBatch(["x"])).rejects.toThrow(/401/);
	});

	it("persists and reloads the fingerprint cache", async () => {
		const dir = mkdtempSync(join(tmpdir(), "semantic-cache-"));
		const cachePath = join(dir, "semantic-cache.json");

		globalThis.fetch = vi.fn(async () => {
			return new Response(JSON.stringify({ data: [{ index: 0, embedding: [0.5, 0.5, 0] }] }), { status: 200 });
		}) as unknown as typeof fetch;

		const first = new SemanticEmbedder({ apiKey: "k", cachePath });
		await first.embedBatch(["persisted text"]);
		expect(globalThis.fetch).toHaveBeenCalledTimes(1);

		// New instance loads the cache and does not hit the API.
		globalThis.fetch = vi.fn() as unknown as typeof fetch;
		const second = new SemanticEmbedder({ apiKey: "k", cachePath });
		const [vector] = await second.embedBatch(["persisted text"]);
		expect(Array.from(vector)).toEqual([0.5, 0.5, 0]);
		expect(globalThis.fetch).not.toHaveBeenCalled();

		rmSync(dir, { recursive: true, force: true });
	});
});

describe("semanticRerank", () => {
	it("reranks entries by semantic similarity and falls back to base scores", async () => {
		globalThis.fetch = vi.fn(async () => {
			return new Response(
				JSON.stringify({
					data: [
						{ index: 0, embedding: [1, 0, 0] }, // query
						{ index: 1, embedding: [1, 0, 0] }, // doc A: identical to query
						{ index: 2, embedding: [0, 1, 0] }, // doc B: orthogonal
					],
				}),
				{ status: 200 },
			);
		}) as unknown as typeof fetch;

		const embedder = new SemanticEmbedder({ apiKey: "k" });
		const entries = [
			{ id: "a", text: "alpha alpha" },
			{ id: "b", text: "beta beta" },
		];
		// Pure semantic (alpha 1): doc A outranks doc B regardless of base scores.
		const ranked = await semanticRerank(
			embedder,
			"alpha",
			entries,
			(e) => e.text,
			(e) => e.id,
			{ alpha: 1 },
		);
		expect(ranked?.map((e) => e.id)).toEqual(["a", "b"]);
	});

	it("returns null on API failure so callers fall back", async () => {
		globalThis.fetch = vi.fn(async () => new Response("", { status: 500 })) as unknown as typeof fetch;
		const embedder = new SemanticEmbedder({ apiKey: "k" });
		const ranked = await semanticRerank(
			embedder,
			"q",
			[{ id: "a", text: "t" }],
			(e) => e.text,
			(e) => e.id,
		);
		expect(ranked).toBeNull();
	});

	it("returns null for empty input", async () => {
		const embedder = new SemanticEmbedder({ apiKey: "k" });
		const ranked = await semanticRerank(
			embedder,
			"",
			[] as Array<{ id: string; text: string }>,
			(e) => e.text,
			(e) => e.id,
		);
		expect(ranked).toBeNull();
	});
});
