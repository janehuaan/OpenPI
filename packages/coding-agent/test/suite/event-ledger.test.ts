import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	appendEvent,
	compactionEvent,
	readEvents,
	taskStartEvent,
	taskStepEvent,
	toolCallEvent,
	toolResultEvent,
} from "../../src/core/event-ledger.ts";

describe("event-ledger", () => {
	const dir = join(tmpdir(), `event-ledger-test-${Date.now()}`);
	const filePath = join(dir, "events.jsonl");

	beforeEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});
	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("returns empty for non-existent file", () => {
		expect(readEvents(filePath)).toEqual([]);
	});

	it("appends and reads back events", () => {
		const event1 = toolCallEvent(dir, "sess-1", "bash", { command: "ls -la" });
		appendEvent(filePath, event1);
		const event2 = toolResultEvent(dir, "sess-1", "bash", 50, true, 1024);
		appendEvent(filePath, event2);

		const events = readEvents(filePath);
		expect(events).toHaveLength(2);
		expect(events[0].type).toBe("tool_call");
		expect(events[0].data.toolName).toBe("bash");
		expect(events[1].type).toBe("tool_result");
		expect((events[1].data as any).durationMs).toBe(50);
	});

	it("generates unique IDs", () => {
		const e1 = taskStartEvent(dir, "s1", "fix bug");
		const e2 = taskStartEvent(dir, "s1", "fix bug");
		expect(e1.id).not.toBe(e2.id);
	});

	it("task events have correct types", () => {
		const start = taskStartEvent(dir, "s1", "goal");
		expect(start.type).toBe("task_start");
		expect((start.data as any).goal).toBe("goal");

		const step = taskStepEvent(dir, "s1", "step 1", 0, 3);
		expect(step.type).toBe("task_step");
		expect((step.data as any).stepIndex).toBe(0);

		const complete = {
			version: 1,
			id: "test",
			type: "task_complete" as const,
			timestamp: new Date().toISOString(),
			cwd: dir,
			sessionId: "s1",
			data: { durationMs: 1200 },
		};
		expect(complete.type).toBe("task_complete");
		expect((complete.data as any).durationMs).toBe(1200);
	});

	it("compaction event", () => {
		const event = compactionEvent(dir, "s1", "threshold", 180000);
		expect(event.type).toBe("compaction");
		expect((event.data as any).tokensBefore).toBe(180000);
	});

	it("tool error event", () => {
		const event = toolResultEvent(dir, "s1", "bash", 3000, false);
		expect(event.type).toBe("tool_error");
		expect((event.data as any).success).toBe(false);
	});
});
