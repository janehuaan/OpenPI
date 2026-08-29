import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { archiveEntry, backupMemoryDirectory, loadActiveOrRecover, recoverIndex } from "../src/durability.ts";
import {
	extractFromTranscript,
	extractSessionDigest,
	isSoftMemoryUtterance,
	parseStructuredExtract,
	refreshSessionDigest,
	similarText,
} from "../src/extract.ts";
import { buildLlmExtractPrompt, parseLlmExtractResponse } from "../src/llm-extract.ts";
import { maintainMemoryIndex } from "../src/maintain.ts";
import { buildBm25Corpus, expandQuery, LEXICON_BIN, rankBm25, rankBm25Corpus, tokenize } from "../src/rank.ts";
import { formatSelectiveSnapshot, selectSnapshotEntries } from "../src/snapshot.ts";
import {
	dedupeEntries,
	generateIndexContent,
	loadIndex,
	loadIndexFile,
	parseIndex,
	queryEntries,
	saveIndex,
	saveIndexAt,
	saveTopic,
	saveTopicAt,
	upsertEntry,
} from "../src/store.ts";
import { DEFAULT_MEMORY_CONFIG } from "../src/types.ts";
import {
	clearVectorCache,
	cosine,
	decodeVectorsBin,
	embedText,
	encodeVectorsBin,
	hybridSearch,
	loadRuntimeVectors,
	reindexVectors,
	VECTORS_BIN,
	VECTORS_FILE,
} from "../src/vectors.ts";

const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

function tempCwd(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openpi-memory-"));
	tempDirs.push(dir);
	return dir;
}

describe("memory store", () => {
	it("round-trips index parse/generate", () => {
		const content = generateIndexContent([
			{ type: "user", key: "role", value: "TS developer" },
			{ type: "lesson", key: "check", value: "Run npm run check" },
		]);
		const entries = parseIndex(content);
		expect(entries).toHaveLength(2);
		expect(entries[0]).toEqual({ type: "user", key: "role", value: "TS developer" });
	});

	it("saves and loads index from disk", () => {
		const cwd = tempCwd();
		const entries = upsertEntry([], "project", "deadline", "Ship by Friday");
		saveIndex(cwd, entries, 200);
		saveTopic(cwd, "project", "deadline", "Ship the personal agent MVP by Friday.");
		expect(loadIndex(cwd)).toEqual([{ type: "project", key: "deadline", value: "Ship by Friday" }]);
		expect(fs.existsSync(path.join(cwd, ".pi/memory/project-deadline.md"))).toBe(true);
	});

	it("queries by keyword", () => {
		const entries = [
			{ type: "user" as const, key: "role", value: "backend engineer" },
			{ type: "lesson" as const, key: "tests", value: "always run unit tests" },
		];
		expect(queryEntries(entries, "tests")).toHaveLength(1);
		expect(queryEntries(entries, undefined, "user")).toHaveLength(1);
	});

	it("ranks multi-token queries with key matches first", () => {
		const entries = [
			{ type: "lesson" as const, key: "npm-check", value: "run check before commit" },
			{ type: "lesson" as const, key: "other", value: "npm scripts overview" },
			{ type: "project" as const, key: "deadline", value: "ship friday" },
		];
		const ranked = queryEntries(entries, "npm check");
		expect(ranked.length).toBeGreaterThanOrEqual(1);
		expect(ranked[0]?.key).toBe("npm-check");
	});

	it("saves global-style memory directory", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openpi-global-mem-"));
		tempDirs.push(dir);
		const entries = upsertEntry([], "user", "tone", "concise");
		saveIndexAt(dir, entries, 200);
		saveTopicAt(dir, "user", "tone", "Prefer concise answers.");
		expect(loadIndexFile(dir)).toEqual([{ type: "user", key: "tone", value: "concise" }]);
		expect(fs.existsSync(path.join(dir, "user-tone.md"))).toBe(true);
	});

	it("keeps newest entries when over max capacity", () => {
		const cwd = tempCwd();
		let entries = [] as ReturnType<typeof upsertEntry>;
		for (let i = 0; i < 5; i++) {
			entries = upsertEntry(entries, "lesson", `k${i}`, `value ${i}`);
		}
		const saved = saveIndex(cwd, entries, 3);
		expect(saved).toHaveLength(3);
		expect(saved.map((e) => e.key)).toEqual(["k2", "k3", "k4"]);
	});

	it("dedupes similar values", () => {
		const entries = dedupeEntries([
			{ type: "user", key: "a", value: "prefer concise technical answers" },
			{ type: "user", key: "b", value: "Prefer concise technical answers please" },
			{ type: "lesson", key: "c", value: "always run tests" },
		]);
		expect(entries.filter((e) => e.type === "user")).toHaveLength(1);
		expect(entries).toHaveLength(2);
	});
});

describe("memory extract", () => {
	it("parses structured pending extract lines", () => {
		const items = parseStructuredExtract(
			["user:tone: concise", "[lesson/npm-check] run check before commit", "noise"].join("\n"),
		);
		expect(items).toHaveLength(2);
		expect(items[0]).toMatchObject({ type: "user", key: "tone" });
		expect(items[1]).toMatchObject({ type: "lesson", key: "npm-check" });
	});

	it("extracts preference heuristics from user turns", () => {
		const candidates = extractFromTranscript(
			[
				{ role: "user", text: "Please remember: always use TypeScript strict mode in this repo." },
				{ role: "assistant", text: "Got it." },
				{ role: "user", text: "I prefer short bullet answers." },
			],
			[],
		);
		expect(candidates.length).toBeGreaterThanOrEqual(1);
		expect(candidates.some((c) => /typescript|strict|bullet|short/i.test(c.summary))).toBe(true);
	});

	it("soft-extracts WIP without explicit remember", () => {
		expect(isSoftMemoryUtterance("继续优化跨对话记忆检索")).toBe(true);
		const candidates = extractFromTranscript(
			[{ role: "user", text: "继续实现 packaging 用 ditto 修闪退，不要用 cpSync。" }],
			[],
		);
		expect(candidates.length).toBeGreaterThanOrEqual(1);
	});

	it("builds a session digest for cross-chat continuity", () => {
		const digest = extractSessionDigest([
			{ role: "user", text: "我们在做 OpenPI 本地记忆的主动注入" },
			{
				role: "assistant",
				text: [
					"结论：Pi 与 Grok Build 质量最高。",
					"| 项目 | 评分 |",
					"| --- | --- |",
					"| pi-main | 8.5/10 |",
					"| OpenPI | 6.5/10 |",
					"| SecretVault | 6/10 |",
				].join("\n"),
			},
			{ role: "user", text: "继续完善跨对话检索，不用我提醒过去干了什么" },
		]);
		expect(digest?.type).toBe("project");
		expect(digest?.key.startsWith("session-")).toBe(true);
		expect(digest?.summary).toMatch(/Last session/i);
		// Must keep assistant structure so next chat can name projects
		expect(digest?.body).toMatch(/pi-main|OpenPI|SecretVault/);
		expect(digest?.body).toMatch(/8\.5\/10|评分/);
	});

	it("refreshSessionDigest force-updates same-day body", () => {
		const cwd = tempCwd();
		const turns1 = [
			{ role: "user" as const, text: "评估这几个项目质量" },
			{
				role: "assistant" as const,
				text: "结论：pi-main 很好。\n| 项目 | 分 |\n| --- | --- |\n| pi-main | 8.5/10 |",
			},
		];
		const r1 = refreshSessionDigest(cwd, turns1, DEFAULT_MEMORY_CONFIG);
		expect(r1.saved).toBe(true);
		const body1 = fs.readFileSync(
			path.join(cwd, ".pi/memory", `project-session-${new Date().toISOString().slice(0, 10)}.md`),
			"utf8",
		);
		expect(body1).toContain("pi-main");

		const turns2 = [
			...turns1,
			{ role: "user" as const, text: "SecretVault 呢" },
			{
				role: "assistant" as const,
				text: "结论：SecretVault 6/10，缺 CI。\n| 项目 | 分 |\n| --- | --- |\n| SecretVault | 6/10 |",
			},
		];
		const r2 = refreshSessionDigest(cwd, turns2, DEFAULT_MEMORY_CONFIG);
		expect(r2.saved).toBe(true);
		const body2 = fs.readFileSync(
			path.join(cwd, ".pi/memory", `project-session-${new Date().toISOString().slice(0, 10)}.md`),
			"utf8",
		);
		expect(body2).toContain("SecretVault");
	});

	it("inject snapshot expands session digest body", () => {
		const entries = [
			{ type: "user" as const, key: "tone", value: "concise" },
			{
				type: "project" as const,
				key: "session-2026-07-24",
				value: "Last session: project quality review",
			},
		];
		const bodies: Record<string, string> = {
			"project:session-2026-07-24": "## Continuity\n### Named topics\n- pi-main\n- OpenPI\n| pi-main | 8.5/10 |",
		};
		const text = formatSelectiveSnapshot(entries, 2, "上次聊到哪里了？", (e) => bodies[`${e.type}:${e.key}`] ?? "");
		expect(text).toContain("pi-main");
		expect(text).toContain("8.5/10");
		expect(text).toMatch(/where you left off|上次/i);
	});

	it("similarText detects near-duplicates", () => {
		expect(similarText("prefer concise answers", "Prefer concise answers please")).toBe(true);
		expect(similarText("ship friday", "use bun runtime")).toBe(false);
	});

	it("parses LLM extract responses", () => {
		expect(parseLlmExtractResponse("NONE")).toEqual([]);
		const items = parseLlmExtractResponse("user:tone: be concise\nlesson:check: run npm check");
		expect(items).toHaveLength(2);
		expect(items[0]?.type).toBe("user");
	});

	it("builds an LLM extract prompt", () => {
		const prompt = buildLlmExtractPrompt({
			at: new Date().toISOString(),
			turns: [{ role: "user", text: "Please remember to use strict TypeScript." }],
			existingSummary: "[user/role] developer",
		});
		expect(prompt).toContain("type:key:");
		expect(prompt).toContain("strict TypeScript");
	});
});

describe("memory maintain", () => {
	it("merges near-duplicate entries and prunes junk", () => {
		const cwd = tempCwd();
		let entries = upsertEntry([], "user", "a", "prefer concise technical answers always");
		entries = upsertEntry(entries, "user", "b", "Prefer concise technical answers always please");
		entries = upsertEntry(entries, "lesson", "noise", "ok");
		entries = upsertEntry(entries, "lesson", "good", "always run unit tests before push");
		saveIndex(cwd, entries, 200);
		const result = maintainMemoryIndex(cwd, DEFAULT_MEMORY_CONFIG);
		expect(result.after).toBeLessThan(result.before);
		const after = loadIndex(cwd);
		expect(after.some((e) => e.key === "noise")).toBe(false);
		expect(after.filter((e) => e.type === "user").length).toBe(1);
	});
});

describe("rank bm25", () => {
	it("tokenizes and ranks relevant docs first", () => {
		expect(tokenize("TypeScript strict mode").length).toBeGreaterThan(0);
		const ranked = rankBm25("typescript strict", [
			{ id: "a", text: "prefer python loose typing" },
			{ id: "b", text: "always use typescript strict mode in this repo" },
			{ id: "c", text: "ship friday deadline" },
		]);
		expect(ranked[0]?.id).toBe("b");
	});

	it("queryEntries uses body resolver for ranking", () => {
		const entries = [
			{ type: "lesson" as const, key: "a", value: "general tip" },
			{ type: "lesson" as const, key: "b", value: "workflow note" },
		];
		const matched = queryEntries(entries, "photon wasm resize", undefined, (entry) =>
			entry.key === "b" ? "use photon wasm for image resize pipeline" : "unrelated body",
		);
		expect(matched[0]?.key).toBe("b");
	});
});

describe("selective snapshot", () => {
	it("pins user/feedback and ranks project/lesson by prompt", () => {
		const entries = [
			{ type: "user" as const, key: "tone", value: "concise answers" },
			{ type: "feedback" as const, key: "no-any", value: "never use any type" },
			{ type: "project" as const, key: "deadline", value: "ship friday" },
			{ type: "project" as const, key: "stack", value: "typescript strict and bun" },
			{ type: "lesson" as const, key: "tests", value: "run unit tests first" },
		];
		const selected = selectSnapshotEntries(entries, "typescript strict mode bun", {
			...DEFAULT_MEMORY_CONFIG,
			maxSnapshotEntries: 4,
		});
		expect(selected.some((e) => e.key === "tone")).toBe(true);
		expect(selected.some((e) => e.key === "no-any")).toBe(true);
		expect(selected.length).toBeLessThanOrEqual(4);
		// stack should rank above deadline for this prompt
		const keys = selected.map((e) => e.key);
		if (keys.includes("stack") && keys.includes("deadline")) {
			expect(keys.indexOf("stack")).toBeLessThan(keys.indexOf("deadline"));
		}
		const text = formatSelectiveSnapshot(selected, entries.length, "typescript");
		expect(text).toContain("auto-loaded");
		expect(text).toContain("proactively");
		expect(text).toContain("tone");
	});

	it("pins recent session digests for proactive continuity", () => {
		const entries = [
			{ type: "user" as const, key: "tone", value: "concise" },
			{ type: "project" as const, key: "session-2026-07-24", value: "Last session: memory proactive inject" },
			{ type: "project" as const, key: "other", value: "unrelated grocery" },
		];
		const selected = selectSnapshotEntries(entries, "hello", {
			...DEFAULT_MEMORY_CONFIG,
			maxSnapshotEntries: 4,
		});
		expect(selected.some((e) => e.key === "session-2026-07-24")).toBe(true);
		expect(selected.some((e) => e.key === "tone")).toBe(true);
	});
});

describe("vectors + durability", () => {
	it("embeds and cosine-matches related text", () => {
		const a = embedText("typescript strict mode for this monorepo");
		const b = embedText("use strict typescript in monorepo packages");
		const c = embedText("buy milk and eggs tomorrow morning");
		expect(cosine(a, b)).toBeGreaterThan(cosine(a, c));
	});

	it("tokenizes CJK into unigrams and bigrams", () => {
		const toks = tokenize("本地向量检索不用远端");
		expect(toks).toContain("本地");
		expect(toks).toContain("向量");
		expect(toks.some((t) => t.includes("检"))).toBe(true);
	});

	it("BM25 inverted corpus matches full rank for positive hits", () => {
		const docs = [
			{ id: "a", text: "typescript strict mode monorepo" },
			{ id: "b", text: "buy milk and eggs" },
			{ id: "c", text: "本地向量检索 hybrid search" },
		];
		const full = rankBm25("typescript monorepo", docs);
		const corpus = buildBm25Corpus(docs);
		const inv = rankBm25Corpus("typescript monorepo", corpus);
		expect(inv.map((r) => r.id)).toEqual(full.map((r) => r.id));
		expect(inv[0]?.id).toBe("a");
		const zh = rankBm25Corpus("向量检索", corpus);
		expect(zh[0]?.id).toBe("c");
	});

	it("writes vectors.bin + lexicon.bin and round-trips", () => {
		const cwd = tempCwd();
		const dir = path.join(cwd, ".pi/memory");
		fs.mkdirSync(dir, { recursive: true });
		const entries = [
			{ type: "lesson" as const, key: "ts", value: "typescript strict" },
			{ type: "user" as const, key: "tone", value: "concise answers" },
		];
		clearVectorCache();
		reindexVectors(dir, entries);
		expect(fs.existsSync(path.join(dir, VECTORS_BIN))).toBe(true);
		expect(fs.existsSync(path.join(dir, LEXICON_BIN))).toBe(true);
		expect(fs.existsSync(path.join(dir, VECTORS_FILE))).toBe(false);
		clearVectorCache();
		const runtime = loadRuntimeVectors(dir);
		expect(runtime.ids).toHaveLength(2);
		const again = decodeVectorsBin(encodeVectorsBin(runtime));
		expect(again?.ids).toEqual(runtime.ids);
		expect(again?.matrix.length).toBe(runtime.matrix.length);
		// cold hybrid loads lexicon.bin without rebuild
		const hits = hybridSearch(entries, "typescript strict", dir, { limit: 3 });
		expect(hits[0]?.entry.key).toBe("ts");
	});

	it("expands bilingual queries", () => {
		const expanded = expandQuery("简洁回答");
		expect(expanded.toLowerCase()).toMatch(/concise|brief|short/);
	});

	it("finds archived memory when active index misses", () => {
		const cwd = tempCwd();
		const dir = path.join(cwd, ".pi/memory");
		const active = [{ type: "project" as const, key: "noise", value: "unrelated grocery list milk" }];
		saveIndex(cwd, active, 200);
		// plant only in archive
		archiveEntry(
			dir,
			"lesson",
			"secret-codename",
			"Azure Falcon release gate token 7f3a9c2e",
			"Internal codename Azure Falcon.",
			"capacity-overflow",
		);
		reindexVectors(dir, active);
		const hits = queryEntries(active, "Azure Falcon 7f3a9c2e", undefined, undefined, {
			memoryDirectory: dir,
			hybrid: true,
			searchArchive: true,
			limit: 10,
		});
		expect(hits.some((h) => h.key === "secret-codename")).toBe(true);
	});

	it("hybrid search finds related memories", () => {
		const cwd = tempCwd();
		const dir = path.join(cwd, ".pi/memory");
		const entries = [
			{ type: "lesson" as const, key: "ts", value: "always enable typescript strict" },
			{ type: "project" as const, key: "grocery", value: "buy milk" },
		];
		saveIndex(cwd, entries, 200);
		saveTopic(cwd, "lesson", "ts", "strict null checks and no any");
		saveTopic(cwd, "project", "grocery", "weekly shopping list");
		reindexVectors(dir, entries, (e) => (e.key === "ts" ? "strict null checks and no any" : "weekly shopping list"));
		const hits = hybridSearch(entries, "typescript strict null checks", dir, { limit: 5 });
		expect(hits[0]?.entry.key).toBe("ts");
	});

	it("hybrid search finds Chinese-indexed memory from Chinese query", () => {
		const cwd = tempCwd();
		const dir = path.join(cwd, ".pi/memory");
		const entries = [
			{
				type: "project" as const,
				key: "local-mem",
				value: "记忆全部本地存储，向量检索不用远端服务",
			},
			{ type: "project" as const, key: "grocery", value: "buy milk eggs bread" },
		];
		saveIndex(cwd, entries, 200);
		reindexVectors(dir, entries);
		const hits = hybridSearch(entries, "本地向量检索", dir, { limit: 5 });
		expect(hits[0]?.entry.key).toBe("local-mem");
	});

	it("archives instead of losing data and recovers index from journal", () => {
		const cwd = tempCwd();
		const dir = path.join(cwd, ".pi/memory");
		saveIndex(cwd, [{ type: "user", key: "tone", value: "be concise and technical" }], 200);
		saveTopic(cwd, "user", "tone", "Prefer concise technical answers.");
		archiveEntry(dir, "user", "tone", "be concise and technical", "Prefer concise technical answers.", "test");
		const backup = backupMemoryDirectory(dir, "test");
		expect(fs.existsSync(backup)).toBe(true);
		// wipe index and recover
		fs.unlinkSync(path.join(dir, "MEMORY.md"));
		const recovered = recoverIndex(dir, 200);
		expect(recovered.recovered).toBeGreaterThanOrEqual(1);
		const again = loadActiveOrRecover(dir, 200);
		expect(again.some((e) => e.key === "tone")).toBe(true);
	});
});
