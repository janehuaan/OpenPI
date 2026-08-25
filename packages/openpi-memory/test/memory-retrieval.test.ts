import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { MemoryRetrievalService } from "../src/memory-retrieval.ts";
import type { EmbeddingClient, EmbeddingHealth, RetrievalRepository } from "../src/retrieval.ts";
import { DEFAULT_MEMORY_CONFIG, type MemoryIndexEntry } from "../src/types.ts";

const health: EmbeddingHealth = { ok: true, state: "ready" };
const vector = Array.from({ length: 1024 }, (_, index) => (index === 0 ? 1 : 0));
const entry: MemoryIndexEntry = { type: "project", key: "retrieval", value: "Use retrieval" };
describe("MemoryRetrievalService index state", () => {
	it("skips unchanged documents and re-embeds changed content", async () => {
		const embedding: EmbeddingClient = {
			embedDocuments: vi.fn().mockResolvedValue([vector]),
			embedQueries: vi.fn(),
			health: vi.fn().mockResolvedValue(health),
		};
		const repository: RetrievalRepository = {
			connect: vi.fn(),
			ensureSchema: vi.fn(),
			upsert: vi.fn(),
			delete: vi.fn(),
			search: vi.fn(),
			health: vi.fn().mockResolvedValue(health),
		};
		const service = new MemoryRetrievalService(
			{ ...DEFAULT_MEMORY_CONFIG, strictDependency: true },
			{ embedding, repository },
		);
		const statePath = join(mkdtempSync(join(tmpdir(), "openpi-state-")), "milvus-index-state.json");
		await service.upsertEntries([entry], { cwd: "/project", scope: "project", statePath });
		await service.upsertEntries([entry], { cwd: "/project", scope: "project", statePath });
		expect(embedding.embedDocuments).toHaveBeenCalledTimes(1);
		await service.upsertEntries([{ ...entry, value: "Changed retrieval" }], {
			cwd: "/project",
			scope: "project",
			statePath,
		});
		expect(embedding.embedDocuments).toHaveBeenCalledTimes(2);
		expect(repository.upsert).toHaveBeenCalledTimes(2);
	});
});
