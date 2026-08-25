import { describe, expect, it, vi } from "vitest";
import { QwenEmbeddingClient } from "../src/qwen-embeddings.ts";
import { QWEN_EMBEDDING_DIMENSIONS, QWEN_QUERY_INSTRUCTION } from "../src/retrieval.ts";

const vector = (at = 0) => Array.from({ length: QWEN_EMBEDDING_DIMENSIONS }, (_, index) => (index === at ? 2 : 0));
const embeddings = (input: string[]) =>
	new Response(JSON.stringify({ data: input.map((_, index) => ({ index, embedding: vector(index) })) }), {
		status: 200,
	});
describe("QwenEmbeddingClient", () => {
	it("batches documents serially, preserves ordering, and caches repeated content", async () => {
		const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
			const body = JSON.parse(String(init?.body));
			return embeddings(body.input);
		});
		const client = new QwenEmbeddingClient(
			{ baseUrl: "http://localhost/v1", model: "qwen", timeoutMs: 1_000, maxBatchItems: 2 },
			fetchMock,
		);
		const result = await client.embedDocuments(["first", "second", "third", "first"]);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).input).toEqual(["first", "second"]);
		expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)).input).toEqual(["third"]);
		expect(result[0]).toEqual(result[3]);
		await client.embedDocuments(["first"]);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});
	it("keeps query requests direct and adds the Qwen instruction", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockImplementation(async (_url, init) => embeddings(JSON.parse(String(init?.body)).input));
		const client = new QwenEmbeddingClient(
			{ baseUrl: "http://localhost/v1", model: "qwen", timeoutMs: 1_000 },
			fetchMock,
		);
		await client.embedQueries(["question"]);
		await client.embedQueries(["question"]);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).input).toEqual([
			`${QWEN_QUERY_INSTRUCTION}question`,
		]);
	});
	it("health probes /models and clears a prior error after readiness", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(new Response("bad", { status: 503, statusText: "down" }))
			.mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "qwen" }] }), { status: 200 }));
		const client = new QwenEmbeddingClient(
			{ baseUrl: "http://localhost/v1", model: "qwen", timeoutMs: 1_000 },
			fetchMock,
		);
		await expect(client.health()).resolves.toMatchObject({ ok: false, state: "error" });
		await expect(client.health()).resolves.toEqual({ ok: true, state: "ready" });
		expect(fetchMock.mock.calls[1]?.[0]).toBe("http://localhost/v1/models");
	});
});
