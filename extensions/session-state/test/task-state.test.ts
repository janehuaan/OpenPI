/**
 * task-state.ts coverage: persistence, per-session scoping, and the two
 * renderings. The compact rendering feeds per-turn context injection, so its
 * stability is a correctness property, not cosmetics.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	compactTaskState,
	deleteTaskState,
	emptyTaskState,
	formatTaskState,
	hasOpenWork,
	listTaskStateSessions,
	loadTaskState,
	saveTaskState,
	type TaskState,
	taskStatePath,
} from "../src/task-state.ts";

const temporaryDirs: string[] = [];

function makeCwd(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openpi-task-"));
	temporaryDirs.push(dir);
	return dir;
}

function stateWithSteps(sessionId = "s1"): TaskState {
	const state = emptyTaskState(sessionId, "ship the daemon");
	state.status = "running";
	state.steps = [
		{ content: "write the protocol", status: "completed", result: "5 tests pass" },
		{ content: "wire the supervisor", status: "in_progress" },
		{ content: "add the CLI", status: "pending" },
	];
	return state;
}

afterEach(() => {
	while (temporaryDirs.length > 0) {
		const dir = temporaryDirs.pop();
		if (dir) fs.rmSync(dir, { recursive: true, force: true });
	}
});

describe("save/load", () => {
	it("round-trips a state through disk", () => {
		const cwd = makeCwd();
		const state = stateWithSteps();
		saveTaskState(cwd, state);

		const loaded = loadTaskState(cwd, "s1");
		expect(loaded?.goal).toBe("ship the daemon");
		expect(loaded?.steps).toHaveLength(3);
		expect(loaded?.steps[1]?.status).toBe("in_progress");
	});

	it("writes one file per session id", () => {
		const cwd = makeCwd();
		saveTaskState(cwd, emptyTaskState("session-a", "goal a"));
		saveTaskState(cwd, emptyTaskState("session-b", "goal b"));

		expect(loadTaskState(cwd, "session-a")?.goal).toBe("goal a");
		expect(loadTaskState(cwd, "session-b")?.goal).toBe("goal b");
		expect(listTaskStateSessions(cwd).sort()).toEqual(["session-a", "session-b"]);
	});

	it("does not leak another session's state", () => {
		// The old implementation shared one current.json per directory and filtered
		// by session id at read time; a new session still had to reject the file.
		const cwd = makeCwd();
		saveTaskState(cwd, stateWithSteps("old-session"));
		expect(loadTaskState(cwd, "new-session")).toBeUndefined();
	});

	it("returns undefined for a missing file", () => {
		expect(loadTaskState(makeCwd(), "nope")).toBeUndefined();
	});

	it("returns undefined rather than throwing on a corrupt file", () => {
		const cwd = makeCwd();
		const file = taskStatePath(cwd, "s1");
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, "{ not json", "utf8");
		expect(loadTaskState(cwd, "s1")).toBeUndefined();
	});

	it("rejects a state written by a future version", () => {
		const cwd = makeCwd();
		const file = taskStatePath(cwd, "s1");
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, JSON.stringify({ version: 2, sessionId: "s1", steps: [] }), "utf8");
		expect(loadTaskState(cwd, "s1")).toBeUndefined();
	});

	it("advances updatedAt on save", async () => {
		const cwd = makeCwd();
		const state = emptyTaskState("s1", "goal");
		saveTaskState(cwd, state);
		const first = loadTaskState(cwd, "s1")?.updatedAt;

		await new Promise((resolve) => setTimeout(resolve, 5));
		saveTaskState(cwd, { ...state, goal: "goal 2" });
		const second = loadTaskState(cwd, "s1")?.updatedAt;

		expect(Date.parse(second!)).toBeGreaterThanOrEqual(Date.parse(first!));
	});

	it("leaves no temp file behind", () => {
		const cwd = makeCwd();
		saveTaskState(cwd, emptyTaskState("s1", "goal"));
		const files = fs.readdirSync(path.dirname(taskStatePath(cwd, "s1")));
		expect(files.filter((name) => name.includes(".tmp"))).toEqual([]);
	});

	it("deletes state", () => {
		const cwd = makeCwd();
		saveTaskState(cwd, emptyTaskState("s1", "goal"));
		deleteTaskState(cwd, "s1");
		expect(loadTaskState(cwd, "s1")).toBeUndefined();
		expect(() => deleteTaskState(cwd, "s1")).not.toThrow();
	});
});

describe("hasOpenWork", () => {
	it("is false for undefined or an empty state", () => {
		expect(hasOpenWork(undefined)).toBe(false);
		expect(hasOpenWork(emptyTaskState("s1"))).toBe(false);
	});

	it("is true while any step is unfinished", () => {
		expect(hasOpenWork(stateWithSteps())).toBe(true);
	});

	it("is false once every step is completed", () => {
		const state = stateWithSteps();
		for (const step of state.steps) step.status = "completed";
		expect(hasOpenWork(state)).toBe(false);
	});

	it("is true when only nextSteps remain", () => {
		const state = emptyTaskState("s1", "goal");
		state.nextSteps = ["follow up"];
		expect(hasOpenWork(state)).toBe(true);
	});
});

describe("formatTaskState", () => {
	it("reports no active task for empty input", () => {
		expect(formatTaskState(undefined)).toBe("(no active task)");
		expect(formatTaskState(emptyTaskState("s1"))).toBe("(no active task)");
	});

	it("renders the goal, status and every step", () => {
		const text = formatTaskState(stateWithSteps());
		expect(text).toContain("ship the daemon");
		expect(text).toContain("write the protocol");
		expect(text).toContain("wire the supervisor");
		expect(text).toContain("add the CLI");
	});

	it("renders evidence attached to a step", () => {
		const state = stateWithSteps();
		state.steps[0]!.evidence = [
			{ kind: "verification", summary: "100 tests pass", command: "npm test" },
		];
		const text = formatTaskState(state);
		expect(text).toContain("evidence[verification]");
		expect(text).toContain("npm test");
	});

	it("shows unresolved errors and hides recovered ones", () => {
		const state = stateWithSteps();
		state.errors = [
			{ message: "provider 401", recovered: true, createdAt: new Date().toISOString() },
			{ message: "socket refused", recovered: false, createdAt: new Date().toISOString() },
		];
		const text = formatTaskState(state);
		expect(text).toContain("socket refused");
		expect(text).not.toContain("provider 401");
	});
});

describe("compactTaskState", () => {
	it("is empty when there are no steps", () => {
		expect(compactTaskState(undefined)).toBe("");
		expect(compactTaskState(emptyTaskState("s1", "goal"))).toBe("");
	});

	it("names the goal and the in-progress step", () => {
		const text = compactTaskState(stateWithSteps());
		expect(text).toContain("Goal: ship the daemon");
		expect(text).toContain("Current: wire the supervisor");
	});

	it("lists a few remaining steps but counts many", () => {
		const few = compactTaskState(stateWithSteps());
		expect(few).toContain("add the CLI");

		const state = emptyTaskState("s1", "big task");
		state.steps = Array.from({ length: 9 }, (_, index) => ({
			content: `step ${index}`,
			status: "pending" as const,
		}));
		expect(compactTaskState(state)).toContain("Remaining: 9 steps");
	});

	it("is byte-stable across calls so prompt caching is not defeated", () => {
		const state = stateWithSteps();
		expect(compactTaskState(state)).toBe(compactTaskState(state));
	});

	it("reports completion when every step is done", () => {
		const state = stateWithSteps();
		for (const step of state.steps) step.status = "completed";
		expect(compactTaskState(state)).toBe("Task complete: ship the daemon");
	});

	it("surfaces blocked steps and unresolved error counts", () => {
		const state = stateWithSteps();
		state.steps[2]!.status = "blocked";
		state.errors = [{ message: "port in use", recovered: false, createdAt: new Date().toISOString() }];
		const text = compactTaskState(state);
		expect(text).toContain("Blocked: add the CLI");
		expect(text).toContain("Unresolved errors: 1");
	});
});
