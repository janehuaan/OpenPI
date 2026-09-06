import assert from "node:assert/strict";
import test, { describe, it } from "node:test";
import {
	buildStage1Prompt,
	heuristicStage1Extract,
	type ParsedSession,
} from "../src/memory/stage1-worker.ts";
import {
	heuristicConsolidation,
} from "../src/memory/phase2-worker.ts";
import { MemoryDb, type Stage1Output } from "../src/memory/memory-db.ts";
import { MemoryEngine } from "../src/memory/memory-engine.ts";

describe("Stage 1 & Phase 2 Memory Pipeline", () => {
	const sampleSession: ParsedSession = {
		sessionId: "test-sess-001",
		cwd: "/test/project",
		mtimeMs: 1788000000,
		turns: [
			{ role: "user", text: "Please always use Vitest for unit testing and don't use Jest." },
			{ role: "assistant", text: "Configured Vitest successfully.", toolCalls: ["edit"] },
			{ role: "user", text: "Also, macOS builds require ditto for symlinks." },
			{ role: "assistant", text: "Updated package scripts to use ditto." },
		],
	};

	it("builds clean Stage 1 prompt from session transcript", () => {
		const prompt = buildStage1Prompt(sampleSession);
		assert.ok(prompt.includes("Thread Extraction (Codex Stage 1)"));
		assert.ok(prompt.includes("Please always use Vitest"));
		assert.ok(prompt.includes("macOS builds require ditto"));
	});

	it("extracts durable raw memories, summary, and slug using heuristic extractor", () => {
		const result = heuristicStage1Extract(sampleSession);
		assert.ok(result.raw_memory.includes("Vitest"));
		assert.ok(result.raw_memory.includes("ditto"));
		assert.ok(result.rollout_summary.includes("Vitest"));
		assert.equal(typeof result.rollout_slug, "string");
		assert.ok(result.rollout_slug.length > 0);
	});

	it("consolidates multiple stage 1 outputs into MEMORY.md and memory_summary.md", () => {
		const outputs: Stage1Output[] = [
			{
				thread_id: "s1",
				source_updated_at: 1000,
				raw_memory: "- Always use Vitest for tests\n- Don't use Jest",
				rollout_summary: "Switched test framework to Vitest.",
				rollout_slug: "vitest-migration",
				generated_at: 1010,
				usage_count: 0,
				last_usage: null,
				selected_for_phase2: 0,
				selected_for_phase2_source_updated_at: null,
			},
			{
				thread_id: "s2",
				source_updated_at: 2000,
				raw_memory: "- macOS ditto preserves symlinks for Electron app bundle",
				rollout_summary: "Fixed macOS packaging symlink corruption.",
				rollout_slug: "macos-electron-ditto",
				generated_at: 2010,
				usage_count: 0,
				last_usage: null,
				selected_for_phase2: 0,
				selected_for_phase2_source_updated_at: null,
			},
		];

		const current = {
			memoryMd: "",
			memorySummaryMd: "",
			existingSkills: [],
		};

		const consolidated = heuristicConsolidation(outputs, current);
		assert.ok(consolidated.memoryMd.includes("# OpenPI Knowledge Handbook"));
		assert.ok(consolidated.memoryMd.includes("Vitest"));
		assert.ok(consolidated.memoryMd.includes("ditto"));
		assert.ok(consolidated.memorySummaryMd.includes("# Memory Index"));
		assert.ok(consolidated.memorySummaryMd.includes("MEMORY.md"));
	});

	it("MemoryEngine manages jobs and retrieves memory hub structure", () => {
		const db = new MemoryDb(":memory:");
		const engine = new MemoryEngine(db);

		engine.enqueueStage1("sess-123");
		const stats = db.getJobStats();
		assert.equal(stats.pending, 1);

		const hub = engine.getMemoryHub();
		assert.equal(hub.stats.pending, 1);
		assert.equal(Array.isArray(hub.rolloutSummaries), true);
		assert.equal(Array.isArray(hub.skills), true);
		db.close();
	});
});
