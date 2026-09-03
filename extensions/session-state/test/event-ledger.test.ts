/**
 * event-ledger.ts coverage: append/read round-trip, per-session files, the
 * input-summarization guard that keeps file contents out of the ledger, and the
 * best-effort contract (a failed write must never throw into a tool call).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	appendEvent,
	checkpointSaveEvent,
	compactionEvent,
	eventFilePath,
	readEvents,
	sessionEndEvent,
	sessionStartEvent,
	taskUpdateEvent,
	toolCallEvent,
	toolResultEvent,
} from "../src/event-ledger.ts";

const temporaryDirs: string[] = [];

function makeCwd(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openpi-ledger-"));
	temporaryDirs.push(dir);
	return dir;
}

afterEach(() => {
	while (temporaryDirs.length > 0) {
		const dir = temporaryDirs.pop();
		if (dir) fs.rmSync(dir, { recursive: true, force: true });
	}
});

describe("append/read", () => {
	it("round-trips events in order", () => {
		const cwd = makeCwd();
		appendEvent(cwd, sessionStartEvent("s1", cwd, "claude-opus-5"));
		appendEvent(cwd, toolCallEvent("s1", "read", { path: "src/index.ts" }));
		appendEvent(cwd, toolResultEvent("s1", "read", { durationMs: 12, isError: false, resultBytes: 400 }));

		const events = readEvents(cwd, "s1");
		expect(events.map((event) => event.type)).toEqual(["session_start", "tool_call", "tool_result"]);
		expect(events[0]?.data.model).toBe("claude-opus-5");
		expect(events[2]?.data.durationMs).toBe(12);
	});

	it("writes one file per session", () => {
		const cwd = makeCwd();
		appendEvent(cwd, sessionStartEvent("a", cwd));
		appendEvent(cwd, sessionStartEvent("b", cwd));

		expect(readEvents(cwd, "a")).toHaveLength(1);
		expect(readEvents(cwd, "b")).toHaveLength(1);
		expect(fs.existsSync(eventFilePath(cwd, "a"))).toBe(true);
		expect(fs.existsSync(eventFilePath(cwd, "b"))).toBe(true);
	});

	it("stores each event as exactly one line", () => {
		const cwd = makeCwd();
		appendEvent(cwd, toolCallEvent("s1", "bash", { command: "echo hi\necho there" }));
		const lines = fs.readFileSync(eventFilePath(cwd, "s1"), "utf8").split("\n").filter(Boolean);
		expect(lines).toHaveLength(1);
	});

	it("stamps every event with a parseable timestamp", () => {
		const cwd = makeCwd();
		appendEvent(cwd, sessionStartEvent("s1", cwd));
		expect(Number.isFinite(Date.parse(readEvents(cwd, "s1")[0]!.at))).toBe(true);
	});

	it("returns an empty array for a session with no events", () => {
		expect(readEvents(makeCwd(), "never-ran")).toEqual([]);
	});

	it("honors the read limit by keeping the newest events", () => {
		const cwd = makeCwd();
		for (let index = 0; index < 10; index++) {
			appendEvent(cwd, toolCallEvent("s1", `tool-${index}`, {}));
		}
		const recent = readEvents(cwd, "s1", { limit: 3 });
		expect(recent).toHaveLength(3);
		expect(recent[2]?.data.toolName).toBe("tool-9");
	});

	it("skips a torn final line instead of failing the whole read", () => {
		const cwd = makeCwd();
		appendEvent(cwd, sessionStartEvent("s1", cwd));
		fs.appendFileSync(eventFilePath(cwd, "s1"), '{"version":1,"type":"tool_ca', "utf8");
		expect(readEvents(cwd, "s1")).toHaveLength(1);
	});
});

describe("input summarization", () => {
	it("truncates long strings and records their real length", () => {
		const cwd = makeCwd();
		appendEvent(cwd, toolCallEvent("s1", "write", { content: "x".repeat(5000) }));

		const recorded = readEvents(cwd, "s1")[0]?.data.input as Record<string, string>;
		expect(recorded.content.length).toBeLessThan(300);
		expect(recorded.content).toContain("5000 chars");
	});

	it("keeps short strings, numbers and booleans verbatim", () => {
		const cwd = makeCwd();
		appendEvent(cwd, toolCallEvent("s1", "read", { path: "src/a.ts", limit: 100, raw: false }));

		const recorded = readEvents(cwd, "s1")[0]?.data.input as Record<string, unknown>;
		expect(recorded.path).toBe("src/a.ts");
		expect(recorded.limit).toBe(100);
		expect(recorded.raw).toBe(false);
	});

	it("replaces arrays and objects with a placeholder", () => {
		const cwd = makeCwd();
		appendEvent(cwd, toolCallEvent("s1", "edit", { edits: [1, 2, 3], options: { deep: true } }));

		const recorded = readEvents(cwd, "s1")[0]?.data.input as Record<string, string>;
		expect(recorded.edits).toBe("[3 items]");
		expect(recorded.options).toBe("[object]");
	});

	it("tolerates a non-object input", () => {
		const cwd = makeCwd();
		appendEvent(cwd, toolCallEvent("s1", "weird", "just a string"));
		expect(readEvents(cwd, "s1")[0]?.data.input).toEqual({});
	});
});

describe("event builders", () => {
	it("marks a failed tool result as tool_error", () => {
		const cwd = makeCwd();
		appendEvent(cwd, toolResultEvent("s1", "bash", { isError: true, durationMs: 5 }));
		expect(readEvents(cwd, "s1")[0]?.type).toBe("tool_error");
	});

	it("records compaction, checkpoint, task and session-end events", () => {
		const cwd = makeCwd();
		appendEvent(cwd, compactionEvent("s1", { reason: "threshold", tokensBefore: 120_000, fromExtension: true }));
		appendEvent(cwd, checkpointSaveEvent("s1", { goal: "ship it", steps: 3 }));
		appendEvent(cwd, taskUpdateEvent("s1", { goal: "ship it", status: "running", completed: 1, total: 3 }));
		appendEvent(cwd, sessionEndEvent("s1", 42_000));

		const types = readEvents(cwd, "s1").map((event) => event.type);
		expect(types).toEqual(["compaction", "checkpoint_save", "task_update", "session_end"]);
		expect(readEvents(cwd, "s1")[0]?.data.tokensBefore).toBe(120_000);
	});
});

describe("best-effort writes", () => {
	it("does not throw when the events path is blocked by a file", () => {
		const cwd = makeCwd();
		// Occupy `.pi/events` with a regular file so mkdir must fail.
		fs.mkdirSync(path.join(cwd, ".pi"), { recursive: true });
		fs.writeFileSync(path.join(cwd, ".pi", "events"), "blocker", "utf8");

		expect(() => appendEvent(cwd, sessionStartEvent("s1", cwd))).not.toThrow();
		expect(readEvents(cwd, "s1")).toEqual([]);
	});
});
