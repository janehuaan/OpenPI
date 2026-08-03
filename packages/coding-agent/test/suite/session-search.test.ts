import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import type { ExtensionContext } from "../../src/core/extensions/types.ts";
import { createSessionSearchToolDefinition } from "../../src/core/tools/session-search.ts";

const tmpDirs: string[] = [];

function makeTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "session-search-test-"));
	tmpDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tmpDirs) {
		rmSync(dir, { recursive: true, force: true });
	}
	tmpDirs.length = 0;
});

function messageLine(id: string, role: string, content: string, timestamp: string): string {
	return JSON.stringify({
		type: "message",
		id,
		parentId: null,
		timestamp,
		message: { role, content },
	});
}

function labelLine(targetId: string, label: string, timestamp: string): string {
	return JSON.stringify({ type: "label", targetId, label, timestamp });
}

async function runSearch(sessionDir: string, params: { query: string; limit?: number }) {
	const tool = createSessionSearchToolDefinition();
	const ctx = {
		sessionManager: { getSessionDir: () => sessionDir },
	} as unknown as ExtensionContext;
	const result = await tool.execute("call-1", params, undefined, undefined, ctx);
	return result.content
		.filter((part) => part.type === "text")
		.map((part) => part.text)
		.join("\n");
}

describe("session_search", () => {
	it("finds matching messages and includes surrounding context", async () => {
		const dir = makeTempDir();
		writeFileSync(
			join(dir, "20260101_aaa.jsonl"),
			[
				messageLine("m1", "user", "How do we configure the cache retention?", "2026-01-01T10:00:00.000Z"),
				messageLine("m2", "assistant", "Set PI_CACHE_RETENTION=long in settings.json.", "2026-01-01T10:00:10.000Z"),
				messageLine("m3", "user", "Also mention the browser smoke test.", "2026-01-01T10:00:20.000Z"),
			].join("\n"),
		);

		const text = await runSearch(dir, { query: "cache retention" });

		expect(text).toContain("score=");
		expect(text).toContain("cache retention");
		// Context window includes the neighboring assistant reply.
		expect(text).toContain("PI_CACHE_RETENTION");
	});

	it("returns no-match message for unrelated queries", async () => {
		const dir = makeTempDir();
		writeFileSync(
			join(dir, "20260101_bbb.jsonl"),
			messageLine("m1", "user", "About the weather in Shanghai today.", "2026-01-01T10:00:00.000Z"),
		);

		const text = await runSearch(dir, { query: "quantum entanglement" });
		expect(text).toContain("No past conversation matched");
	});

	it("uses labels as session titles when present", async () => {
		const dir = makeTempDir();
		writeFileSync(
			join(dir, "20260101_ccc.jsonl"),
			[
				labelLine("m1", "Fix the model selector", "2026-01-01T09:59:00.000Z"),
				messageLine("m1", "user", "The model selector only shows deepseek.", "2026-01-01T10:00:00.000Z"),
			].join("\n"),
		);

		const text = await runSearch(dir, { query: "model selector deepseek" });
		expect(text).toContain("Fix the model selector");
	});

	it("respects the limit parameter", async () => {
		const dir = makeTempDir();
		writeFileSync(
			join(dir, "20260101_ddd.jsonl"),
			[
				messageLine("m1", "user", "alpha beta gamma", "2026-01-01T10:00:00.000Z"),
				messageLine("m2", "user", "alpha beta delta", "2026-01-01T10:00:10.000Z"),
				messageLine("m3", "user", "alpha beta epsilon", "2026-01-01T10:00:20.000Z"),
			].join("\n"),
		);

		const text = await runSearch(dir, { query: "alpha beta", limit: 1 });
		const hits = (text.match(/^### /gm) ?? []).length;
		expect(hits).toBe(1);
	});

	it("handles an unavailable session directory", async () => {
		const dir = makeTempDir();
		const text = await runSearch(dir, { query: "anything" });
		expect(text).toContain("No past conversation matched");
	});
});
