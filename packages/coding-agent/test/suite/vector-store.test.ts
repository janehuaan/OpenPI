import { existsSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
	searchVectorStore,
	upsertVectorStore,
	type VectorStoreDoc,
	vectorStorePath,
} from "../../src/core/vector-store.ts";

const tmpDirs: string[] = [];

function makeTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "vector-store-test-"));
	tmpDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tmpDirs) {
		rmSync(dir, { recursive: true, force: true });
	}
	tmpDirs.length = 0;
});

function doc(id: string, text: string, role = "user", source = "session:x"): VectorStoreDoc {
	return { id, source, role, text };
}

describe("vector store", () => {
	it("upserts new docs and persists to disk", async () => {
		const cwd = makeTempDir();
		const result = await upsertVectorStore(cwd, [
			doc("a", "cache retention settings"),
			doc("b", "deploy the dashboard"),
		]);

		expect(result.upserted).toBe(2);
		expect(result.total).toBe(2);
		expect(existsSync(vectorStorePath(cwd))).toBe(true);
	});

	it("is incremental: unchanged docs are not re-embedded", async () => {
		const cwd = makeTempDir();
		await upsertVectorStore(cwd, [doc("a", "cache retention settings"), doc("b", "deploy the dashboard")]);

		const again = await upsertVectorStore(cwd, [
			doc("a", "cache retention settings"),
			doc("b", "deploy the dashboard"),
		]);
		expect(again.upserted).toBe(0);
		expect(again.total).toBe(2);
	});

	it("re-embeds changed docs and drops removed ones", async () => {
		const cwd = makeTempDir();
		await upsertVectorStore(cwd, [doc("a", "original text"), doc("b", "keep me")]);

		const changed = await upsertVectorStore(cwd, [doc("a", "changed text"), doc("b", "keep me")]);
		expect(changed.upserted).toBe(1);

		const removed = await upsertVectorStore(cwd, [doc("b", "keep me")]);
		expect(removed.total).toBe(1);
	});

	it("searches the whole store by cosine similarity", async () => {
		const cwd = makeTempDir();
		await upsertVectorStore(cwd, [
			doc("a", "how to fix the flaky integration test"),
			doc("b", "quarterly budget review for the finance team"),
			doc("c", "integration test keeps failing on CI"),
		]);

		const hits = await searchVectorStore(cwd, "flaky integration test", 3);
		expect(hits).toHaveLength(3);
		expect(hits[0].text).toContain("flaky integration test");
		expect(hits[0].score).toBeGreaterThan(hits[2].score);
	});

	it("persists across calls: search works after upsert in a later call", async () => {
		const cwd = makeTempDir();
		await upsertVectorStore(cwd, [doc("a", "cache retention settings")]);

		const hits = await searchVectorStore(cwd, "cache retention", 1);
		expect(hits[0].text).toContain("cache retention");
		expect(hits[0].score).toBeGreaterThan(0.1);
	});

	it("returns no hits on an empty store", async () => {
		const cwd = makeTempDir();
		expect(await searchVectorStore(cwd, "anything", 5)).toEqual([]);
	});
});
