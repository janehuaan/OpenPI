import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_INTELLIGENCE_CONFIG } from "../src/config.ts";
import {
	applySemanticScores,
	DEFAULT_QWEN_QUERY_INSTRUCTION,
	QwenLocalEmbeddingProvider,
} from "../src/context/embedding.ts";
import type { ContextCandidate } from "../src/contract.ts";

function vector(valueAt: number): number[] {
	return Array.from({ length: 1024 }, (_, index) => (index === valueAt ? 2 : 0));
}

function candidate(): ContextCandidate {
	return {
		id: "candidate",
		source: "code",
		uri: "src/example.ts",
		title: "Example",
		content: "Example content",
		contentHash: "hash",
		estimatedTokens: 3,
		metadata: {},
		provenance: { adapter: "test", observedAt: "2026-01-01T00:00:00.000Z" },
	};
}

afterEach(() => vi.unstubAllGlobals());

describe("QwenLocalEmbeddingProvider", () => {
	it("prefixes only queries with the Qwen instruction and normalizes vectors", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ data: [{ index: 0, embedding: vector(0) }] }), { status: 200 }),
			)
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ data: [{ index: 0, embedding: vector(0) }] }), { status: 200 }),
			);
		vi.stubGlobal("fetch", fetchMock);
		const provider = new QwenLocalEmbeddingProvider("http://127.0.0.1:18080/v1/", "qwen-test");

		await expect(provider.embedQuery("find settings")).resolves.toEqual(vector(0).map((entry) => entry / 2));
		await provider.embedDocuments(["A document"]);

		expect(fetchMock).toHaveBeenNthCalledWith(
			1,
			"http://127.0.0.1:18080/v1/embeddings",
			expect.objectContaining({
				body: JSON.stringify({
					model: "qwen-test",
					input: [`Instruct: ${DEFAULT_QWEN_QUERY_INSTRUCTION}\nQuery: find settings`],
				}),
			}),
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			2,
			"http://127.0.0.1:18080/v1/embeddings",
			expect.objectContaining({ body: JSON.stringify({ model: "qwen-test", input: ["A document"] }) }),
		);
	});

	it("rejects malformed dimensions instead of accepting a fallback vector", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValue(
					new Response(JSON.stringify({ data: [{ index: 0, embedding: [1, 2] }] }), { status: 200 }),
				),
		);

		await expect(new QwenLocalEmbeddingProvider().embedDocuments(["document"])).rejects.toThrow(
			"expected a 1024-dimension vector",
		);
	});

	it("surfaces an unavailable local server instead of silently using hash embeddings", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("connection refused")));

		await expect(new QwenLocalEmbeddingProvider().embedDocuments(["document"])).rejects.toThrow(
			"Qwen local embedding server is unavailable",
		);
	});

	it("applies semantic scores from validated Qwen embeddings", async () => {
		const first = candidate();
		const second: ContextCandidate = {
			...candidate(),
			id: "candidate-two",
			uri: "src/other.ts",
			metadata: {},
		};
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce(
					new Response(JSON.stringify({ data: [{ index: 0, embedding: vector(0) }] }), { status: 200 }),
				)
				.mockResolvedValueOnce(
					new Response(
						JSON.stringify({
							data: [
								{ index: 0, embedding: vector(0) },
								{ index: 1, embedding: vector(1) },
							],
						}),
						{ status: 200 },
					),
				),
		);

		await applySemanticScores([first, second], "example", DEFAULT_INTELLIGENCE_CONFIG);

		expect(first.metadata.semanticScore).toBe(1);
		expect(second.metadata.semanticScore).toBe(0);
	});
});
