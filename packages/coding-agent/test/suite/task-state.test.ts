import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	compactTaskState,
	formatTaskState,
	loadTaskState,
	saveTaskState,
	type TaskState,
} from "../../src/core/task-state.ts";

function makeState(overrides: Partial<TaskState> = {}): TaskState {
	return {
		version: 1,
		id: "test-task",
		goal: "Fix authentication bug",
		status: "running",
		steps: [
			{ content: "Analyze auth middleware", status: "completed", result: "Found token validation issue" },
			{ content: "Fix token validation", status: "in_progress", error: "Timeout on edge case" },
			{ content: "Run tests", status: "pending" },
			{ content: "Verify fix", status: "pending" },
		],
		checkpoints: [
			{ index: 0, label: "Initial analysis", done: true },
			{ index: 1, label: "Fix implemented", done: false },
		],
		errors: [{ message: "Token timeout", recovered: false, tool: "bash", createdAt: new Date().toISOString() }],
		nextSteps: ["Debug timeout", "Add retry logic"],
		contextNotes: ["Auth middleware in src/middleware/auth.ts"],
		updatedAt: new Date().toISOString(),
		sessionId: "test-session",
		...overrides,
	};
}

describe("task-state", () => {
	const dir = join(tmpdir(), `task-state-test-${Date.now()}`);

	it("saves and loads task state", () => {
		const state = makeState();
		saveTaskState(dir, state);
		const loaded = loadTaskState(dir);
		expect(loaded).toBeDefined();
		expect(loaded!.goal).toBe("Fix authentication bug");
		expect(loaded!.steps.length).toBe(4);
		expect(loaded!.steps[1].status).toBe("in_progress");
	});

	it("returns undefined for missing file", () => {
		expect(loadTaskState(join(dir, "nonexistent"))).toBeUndefined();
	});

	it("formatTaskState shows structured output", () => {
		const state = makeState();
		const formatted = formatTaskState(state);
		expect(formatted).toContain("Goal: Fix authentication bug");
		expect(formatted).toContain("✓ [completed] Analyze auth middleware");
		expect(formatted).toContain("● [in_progress] Fix token validation");
		expect(formatted).toContain("○ [pending] Run tests");
		expect(formatted).toContain("Error: Timeout on edge case");
	});

	it("compactTaskState returns short summary", () => {
		const state = makeState();
		const compact = compactTaskState(state);
		expect(compact).toContain("Goal: Fix authentication bug");
		expect(compact).toContain("Current: Fix token validation");
		expect(compact).toContain("Unresolved errors: 1");
	});

	it("compactTaskState for completed task", () => {
		const state = makeState({
			steps: [{ content: "Done", status: "completed" }],
			status: "completed",
		});
		expect(compactTaskState(state)).toContain("Task completed");
	});

	it("compactTaskState for empty state", () => {
		expect(compactTaskState(undefined)).toBe("");
	});

	it("persists across save/load cycles", () => {
		const state = makeState();
		saveTaskState(dir, state);
		const loaded = loadTaskState(dir);
		expect(loaded!.errors[0].message).toBe("Token timeout");
		expect(loaded!.nextSteps).toEqual(["Debug timeout", "Add retry logic"]);
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});
});
