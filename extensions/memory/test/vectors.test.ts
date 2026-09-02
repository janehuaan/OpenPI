/**
 * vectors.ts coverage.
 *
 * Focus is the parts a regression would break silently: the vectors.bin binary
 * format (our own format - a bad round-trip loses the whole index without an
 * error), the embedding's structural guarantees, and hybrid retrieval's
 * ordering. The old repo shipped this file with no tests at all.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { MemoryIndexEntry } from "../src/types.ts";
import {
	cosine,
	decodeVectorsBin,
	docText,
	embedText,
	encodeVectorsBin,
	entriesFingerprint,
	entryId,
	fingerprint,
	hybridSearch,
	loadRuntimeVectors,
	reindexVectors,
	removeVector,
	saveRuntimeVectors,
	upsertVector,
	VECTOR_DIM,
	vectorsBinPath,
} from "../src/vectors.ts";

const temporaryDirs: string[] = [];

function makeDir(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openpi-vectors-"));
	temporaryDirs.push(dir);
	return dir;
}

afterEach(() => {
	while (temporaryDirs.length > 0) {
		const dir = temporaryDirs.pop();
		if (dir) fs.rmSync(dir, { recursive: true, force: true });
	}
});

describe("embedText", () => {
	it("produces a unit-length vector of the declared dimension", () => {
		const vector = embedText("用户偏好中文简洁沟通");
		expect(vector).toHaveLength(VECTOR_DIM);
		const norm = Math.sqrt([...vector].reduce((sum, value) => sum + value * value, 0));
		expect(norm).toBeCloseTo(1, 5);
	});

	it("is deterministic for the same input", () => {
		expect([...embedText("hello world")]).toEqual([...embedText("hello world")]);
	});

	it("scores related text above unrelated text", () => {
		const query = embedText("typescript build error");
		const related = cosine(query, embedText("typescript compile error in build"));
		const unrelated = cosine(query, embedText("苹果派食谱和烘焙温度"));
		expect(related).toBeGreaterThan(unrelated);
	});

	it("handles empty and whitespace-only input without producing NaN", () => {
		for (const value of ["", "   ", "\n\t"]) {
			const vector = embedText(value);
			expect(vector).toHaveLength(VECTOR_DIM);
			expect([...vector].every((component) => Number.isFinite(component))).toBe(true);
		}
	});

	it("embeds CJK text into a non-zero vector", () => {
		// CJK has no whitespace word boundaries, so this exercises the unigram path.
		const vector = embedText("记忆检索");
		expect([...vector].some((component) => component !== 0)).toBe(true);
	});
});

describe("cosine", () => {
	it("returns 1 for identical vectors and 0 for orthogonal ones", () => {
		expect(cosine([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 6);
		expect(cosine([1, 0, 0], [0, 1, 0])).toBeCloseTo(0, 6);
	});

	it("returns 0 when either vector is all zeros", () => {
		expect(cosine([0, 0, 0], [1, 2, 3])).toBe(0);
	});
});

describe("vectors.bin round-trip", () => {
	it("restores ids, fingerprints and vectors byte-for-byte", () => {
		const dir = makeDir();
		upsertVector(dir, "user", "tone", "prefers concise Chinese replies");
		upsertVector(dir, "project", "build", "npm run check before commit");

		const before = loadRuntimeVectors(dir);
		const decoded = decodeVectorsBin(encodeVectorsBin(before));

		expect(decoded).not.toBeNull();
		expect(decoded?.ids).toEqual(before.ids);
		expect(decoded?.fps).toEqual(before.fps);
		expect([...(decoded?.matrix ?? [])]).toEqual([...before.matrix]);
	});

	it("survives a save/load cycle through the real file", () => {
		const dir = makeDir();
		upsertVector(dir, "user", "tone", "concise");
		const saved = loadRuntimeVectors(dir);

		expect(fs.existsSync(vectorsBinPath(dir))).toBe(true);
		saveRuntimeVectors(dir, saved);
		const reloaded = loadRuntimeVectors(dir);
		expect(reloaded.ids).toEqual(saved.ids);
	});

	it("rejects a truncated or corrupt buffer instead of returning junk", () => {
		const dir = makeDir();
		upsertVector(dir, "user", "tone", "concise");
		const encoded = encodeVectorsBin(loadRuntimeVectors(dir));

		expect(decodeVectorsBin(encoded.subarray(0, 8))).toBeNull();
		expect(decodeVectorsBin(Buffer.alloc(0))).toBeNull();
		const wrongMagic = Buffer.from(encoded);
		wrongMagic.writeUInt32BE(0xdeadbeef, 0);
		expect(decodeVectorsBin(wrongMagic)).toBeNull();
	});
});

describe("upsertVector / removeVector", () => {
	it("adds, replaces in place, and removes entries", () => {
		const dir = makeDir();
		upsertVector(dir, "user", "tone", "concise");
		upsertVector(dir, "user", "style", "no emoji");
		expect(loadRuntimeVectors(dir).ids).toHaveLength(2);

		// Same id with new text must update, not append.
		upsertVector(dir, "user", "tone", "very concise, technical prose only");
		const updated = loadRuntimeVectors(dir);
		expect(updated.ids).toHaveLength(2);
		expect(updated.ids).toContain(entryId("user", "tone"));

		removeVector(dir, "user", "tone");
		const removed = loadRuntimeVectors(dir);
		expect(removed.ids).toHaveLength(1);
		expect(removed.ids).not.toContain(entryId("user", "tone"));
	});

	it("removing a missing id is a no-op", () => {
		const dir = makeDir();
		upsertVector(dir, "user", "tone", "concise");
		removeVector(dir, "user", "does-not-exist");
		expect(loadRuntimeVectors(dir).ids).toHaveLength(1);
	});
});

describe("reindexVectors", () => {
	it("builds an index covering exactly the supplied entries", () => {
		const dir = makeDir();
		const entries: MemoryIndexEntry[] = [
			{ type: "user", key: "tone", value: "concise Chinese" },
			{ type: "project", key: "build", value: "npm run check" },
		];
		reindexVectors(dir, entries, (entry) => `body for ${entry.key}`);

		const runtime = loadRuntimeVectors(dir);
		expect(runtime.ids.sort()).toEqual([entryId("project", "build"), entryId("user", "tone")].sort());
	});

	it("drops vectors for entries that no longer exist", () => {
		const dir = makeDir();
		reindexVectors(
			dir,
			[
				{ type: "user", key: "tone", value: "concise" },
				{ type: "user", key: "gone", value: "obsolete" },
			],
			() => "",
		);
		reindexVectors(dir, [{ type: "user", key: "tone", value: "concise" }], () => "");

		expect(loadRuntimeVectors(dir).ids).toEqual([entryId("user", "tone")]);
	});
});

describe("hybridSearch", () => {
	const entries: MemoryIndexEntry[] = [
		{ type: "user", key: "tone", value: "用户偏好中文简洁沟通,不要 emoji" },
		{ type: "project", key: "openpi-arch", value: "OpenPI 热加载:改 coding-agent 需 build + 重启 daemon" },
		{ type: "lesson", key: "vitest", value: "run vitest from the package root, not the repo root" },
	];

	it("ranks the topically closest entry first", () => {
		const dir = makeDir();
		reindexVectors(dir, entries, () => "");
		const hits = hybridSearch(entries, "重启 daemon 热加载", dir, { limit: 3 });

		expect(hits.length).toBeGreaterThan(0);
		expect(hits[0].entry.key).toBe("openpi-arch");
	});

	it("respects the limit", () => {
		const dir = makeDir();
		reindexVectors(dir, entries, () => "");
		expect(hybridSearch(entries, "openpi", dir, { limit: 2 }).length).toBeLessThanOrEqual(2);
	});

	it("returns hits in non-increasing score order", () => {
		const dir = makeDir();
		reindexVectors(dir, entries, () => "");
		const scores = hybridSearch(entries, "vitest package root", dir, { limit: 3 }).map((hit) => hit.score);
		for (let index = 1; index < scores.length; index++) {
			expect(scores[index - 1]).toBeGreaterThanOrEqual(scores[index]);
		}
	});

	it("searches topic bodies, not just index values", () => {
		const dir = makeDir();
		const withBody: MemoryIndexEntry[] = [{ type: "project", key: "deploy", value: "部署说明" }];
		const resolveBody = () => "electron-builder 打包 arm64 与 x64 双架构";
		reindexVectors(dir, withBody, resolveBody);

		const hits = hybridSearch(withBody, "electron-builder arm64", dir, { bodyResolver: resolveBody, limit: 3 });
		expect(hits[0]?.entry.key).toBe("deploy");
	});

	it("handles an empty corpus and an empty query", () => {
		const dir = makeDir();
		expect(hybridSearch([], "anything", dir, { limit: 5 })).toEqual([]);
		reindexVectors(dir, entries, () => "");
		expect(() => hybridSearch(entries, "", dir, { limit: 5 })).not.toThrow();
	});
});

describe("fingerprints", () => {
	it("entriesFingerprint changes when any entry changes", () => {
		const base: MemoryIndexEntry[] = [{ type: "user", key: "tone", value: "concise" }];
		const changed: MemoryIndexEntry[] = [{ type: "user", key: "tone", value: "verbose" }];
		expect(entriesFingerprint(base)).toBe(entriesFingerprint([...base]));
		expect(entriesFingerprint(base)).not.toBe(entriesFingerprint(changed));
	});

	it("fingerprint is stable and differs for different text", () => {
		expect(fingerprint("abc")).toBe(fingerprint("abc"));
		expect(fingerprint("abc")).not.toBe(fingerprint("abd"));
	});

	it("docText combines the entry and its body", () => {
		const text = docText({ type: "user", key: "tone", value: "concise" }, "detail body");
		expect(text).toContain("tone");
		expect(text).toContain("concise");
		expect(text).toContain("detail body");
	});
});
