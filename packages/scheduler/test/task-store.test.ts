/**
 * task-store.ts coverage: persistence, run/step lifecycle, and the
 * interrupted-run sweep a restart depends on.
 *
 * The old file had one long test. Its most important behavior - marking runs
 * interrupted after a crash so they are not counted as still running forever -
 * was asserted only in passing.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TaskStore } from "../src/task-store.ts";
import type { TaskDefinition } from "../src/types.ts";

const temporaryDirs: string[] = [];
let previous: string | undefined;

beforeEach(() => {
	previous = process.env.OPENPI_SCHEDULER_DIR;
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openpi-store-"));
	temporaryDirs.push(dir);
	process.env.OPENPI_SCHEDULER_DIR = dir;
});

afterEach(() => {
	if (previous === undefined) delete process.env.OPENPI_SCHEDULER_DIR;
	else process.env.OPENPI_SCHEDULER_DIR = previous;
	for (const dir of temporaryDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const NEXT_RUN = "2026-08-01T09:00:00.000Z";

function createTask(store: TaskStore, overrides: Record<string, unknown> = {}): TaskDefinition {
	return store.createTask(
		{
			title: "Review",
			prompt: "review the repo",
			schedule: { kind: "once", runAt: NEXT_RUN },
			...overrides,
		} as Parameters<TaskStore["createTask"]>[0],
		NEXT_RUN,
	);
}

describe("tasks", () => {
	it("creates a task with an id, timestamps and the next run", () => {
		const task = createTask(new TaskStore());
		expect(task.id).toBeTruthy();
		expect(task.status).toBe("active");
		expect(task.nextRunAt).toBe(NEXT_RUN);
		expect(Number.isFinite(Date.parse(task.createdAt))).toBe(true);
	});

	it("persists optional fields the desktop UI sets", () => {
		const store = new TaskStore();
		const task = createTask(store, {
			securityMode: "strict",
			sandbox: "none",
			tools: ["read", "ls"],
			extensions: ["/tmp/x.ts"],
			env: { FOO: "bar" },
		});
		const loaded = store.getTask(task.id);
		expect(loaded?.securityMode).toBe("strict");
		expect(loaded?.tools).toEqual(["read", "ls"]);
		expect(loaded?.extensions).toEqual(["/tmp/x.ts"]);
		expect(loaded?.env).toEqual({ FOO: "bar" });
	});

	it("reads tasks back through a fresh store instance", () => {
		const task = createTask(new TaskStore());
		expect(new TaskStore().getTask(task.id)?.title).toBe("Review");
	});

	it("returns undefined for an unknown task", () => {
		expect(new TaskStore().getTask("nope")).toBeUndefined();
	});

	it("updates a task through the mutator", () => {
		const store = new TaskStore();
		const task = createTask(store);
		const updated = store.updateTask(task.id, (current) => ({ ...current, title: "Renamed" }));
		expect(updated?.title).toBe("Renamed");
		expect(store.getTask(task.id)?.title).toBe("Renamed");
	});

	it("advances updatedAt on update", () => {
		const store = new TaskStore();
		const task = createTask(store);
		const updated = store.updateTask(task.id, (current) => ({ ...current, status: "paused" }));
		expect(Date.parse(updated!.updatedAt)).toBeGreaterThanOrEqual(Date.parse(task.createdAt));
	});

	it("returns undefined when updating an unknown task", () => {
		expect(new TaskStore().updateTask("nope", (task) => task)).toBeUndefined();
	});

	it("deletes a task and reports whether anything was removed", () => {
		const store = new TaskStore();
		const task = createTask(store);
		expect(store.deleteTask(task.id)).toBe(true);
		expect(store.getTask(task.id)).toBeUndefined();
		expect(store.deleteTask(task.id)).toBe(false);
	});

	it("starts from an empty list on a fresh directory", () => {
		expect(new TaskStore().loadTasks()).toEqual([]);
		expect(new TaskStore().loadRuns()).toEqual([]);
		expect(new TaskStore().loadStepRuns()).toEqual([]);
	});
});

describe("runs", () => {
	it("creates a queued run tied to its task", () => {
		const store = new TaskStore();
		const task = createTask(store);
		const run = store.createRun(task.id, "manual", { attempt: 1 });
		expect(run.status).toBe("queued");
		expect(run.taskId).toBe(task.id);
		expect(run.trigger).toBe("manual");
		expect(store.loadRuns()).toHaveLength(1);
	});

	it("records the trigger that started it", () => {
		const store = new TaskStore();
		const task = createTask(store);
		expect(store.createRun(task.id, "scheduled").trigger).toBe("scheduled");
		expect(store.createRun(task.id, "retry").trigger).toBe("retry");
	});

	it("links a retry to its parent run", () => {
		const store = new TaskStore();
		const task = createTask(store);
		const first = store.createRun(task.id, "scheduled", { attempt: 1 });
		const retry = store.createRun(task.id, "retry", { attempt: 2, parentRunId: first.id });
		expect(retry.parentRunId).toBe(first.id);
		expect(retry.attempt).toBe(2);
	});

	it("updates a run through the mutator", () => {
		const store = new TaskStore();
		const task = createTask(store);
		const run = store.createRun(task.id, "manual");
		const updated = store.updateRun(run.id, (current) => ({ ...current, status: "succeeded", exitCode: 0 }));
		expect(updated?.status).toBe("succeeded");
		expect(store.loadRuns().find((entry) => entry.id === run.id)?.status).toBe("succeeded");
	});

	it("returns undefined when updating an unknown run", () => {
		expect(new TaskStore().updateRun("nope", (run) => run)).toBeUndefined();
	});
});

describe("markInterruptedRuns", () => {
	it("marks queued and running runs interrupted, which is how a crash is recovered", () => {
		const store = new TaskStore();
		const task = createTask(store);
		const queued = store.createRun(task.id, "manual");
		const running = store.createRun(task.id, "manual");
		store.updateRun(running.id, (run) => ({ ...run, status: "running", pid: 4242 }));

		const interrupted = store.markInterruptedRuns();
		expect(interrupted).toHaveLength(2);

		const statuses = store.loadRuns().map((run) => run.status);
		expect(statuses.every((status) => status === "interrupted")).toBe(true);
		expect(store.loadRuns().find((run) => run.id === queued.id)?.finishedAt).toBeTruthy();
	});

	it("leaves already-finished runs alone", () => {
		const store = new TaskStore();
		const task = createTask(store);
		const run = store.createRun(task.id, "manual");
		store.updateRun(run.id, (current) => ({ ...current, status: "succeeded" }));

		expect(store.markInterruptedRuns()).toHaveLength(0);
		expect(store.loadRuns()[0]?.status).toBe("succeeded");
	});

	it("is a no-op with no runs", () => {
		expect(new TaskStore().markInterruptedRuns()).toEqual([]);
	});
});

describe("step runs", () => {
	it("creates step runs and reads them back by run id", () => {
		const store = new TaskStore();
		const task = createTask(store, {
			steps: [
				{ id: "a", title: "Step a", prompt: "do a" },
				{ id: "b", title: "Step b", prompt: "do b", dependsOn: ["a"] },
			],
		});
		const run = store.createRun(task.id, "manual");
		store.createStepRun(run.id, "a", "Step a", "manual", 1);
		store.createStepRun(run.id, "b", "Step b", "manual", 1);

		const stepRuns = store.loadStepRunsByRunId(run.id);
		expect(stepRuns).toHaveLength(2);
		expect(stepRuns.map((stepRun) => stepRun.stepId).sort()).toEqual(["a", "b"]);
		expect(stepRuns.every((stepRun) => stepRun.status === "pending")).toBe(true);
	});

	it("does not return another run's step runs", () => {
		const store = new TaskStore();
		const task = createTask(store);
		const first = store.createRun(task.id, "manual");
		const second = store.createRun(task.id, "manual");
		store.createStepRun(first.id, "a", "Step a", "manual", 1);

		expect(store.loadStepRunsByRunId(second.id)).toEqual([]);
	});

	it("updates a step run", () => {
		const store = new TaskStore();
		const task = createTask(store);
		const run = store.createRun(task.id, "manual");
		const stepRun = store.createStepRun(run.id, "a", "Step a", "manual", 1);

		const updated = store.updateStepRun(stepRun.id, (current) => ({
			...current,
			status: "succeeded",
			result: "ok",
		}));
		expect(updated?.status).toBe("succeeded");
		expect(store.loadStepRunsByRunId(run.id)[0]?.result).toBe("ok");
	});

	it("marks unfinished step runs interrupted", () => {
		const store = new TaskStore();
		const task = createTask(store);
		const run = store.createRun(task.id, "manual");
		const stepRun = store.createStepRun(run.id, "a", "Step a", "manual", 1);
		store.updateStepRun(stepRun.id, (current) => ({ ...current, status: "running" }));

		expect(store.markInterruptedStepRuns()).toHaveLength(1);
		expect(store.loadStepRunsByRunId(run.id)[0]?.status).toBe("cancelled");
	});
});

describe("file storage", () => {
	it("writes the three JSON files under the scheduler directory", () => {
		const store = new TaskStore();
		const task = createTask(store);
		const run = store.createRun(task.id, "manual");
		store.createStepRun(run.id, "a", "Step a", "manual", 1);

		const dir = process.env.OPENPI_SCHEDULER_DIR!;
		expect(fs.existsSync(path.join(dir, "tasks.json"))).toBe(true);
		expect(fs.existsSync(path.join(dir, "task-runs.json"))).toBe(true);
		expect(fs.existsSync(path.join(dir, "step-runs.json"))).toBe(true);
	});

	it("writes task files with owner-only permissions", () => {
		// Task definitions can carry env values and prompts; other users on the
		// machine have no business reading them.
		const store = new TaskStore();
		createTask(store);
		const file = path.join(process.env.OPENPI_SCHEDULER_DIR!, "tasks.json");
		expect(fs.statSync(file).mode & 0o777).toBe(0o600);
	});

	it("leaves no temp files behind", () => {
		const store = new TaskStore();
		createTask(store);
		const files = fs.readdirSync(process.env.OPENPI_SCHEDULER_DIR!);
		expect(files.filter((name) => name.includes(".tmp"))).toEqual([]);
	});

	it("quarantines a corrupt tasks file instead of throwing on every tick", () => {
		const dir = process.env.OPENPI_SCHEDULER_DIR!;
		fs.mkdirSync(dir, { recursive: true });
		const file = path.join(dir, "tasks.json");
		fs.writeFileSync(file, "{ not json", "utf8");

		expect(new TaskStore().loadTasks()).toEqual([]);
		// The damaged bytes are preserved rather than overwritten by the next save.
		expect(fs.existsSync(file)).toBe(false);
		expect(fs.readdirSync(dir).some((name) => name.startsWith("tasks.json.corrupt."))).toBe(true);
	});

	it("keeps working after the quarantine, so a new task can be created", () => {
		const dir = process.env.OPENPI_SCHEDULER_DIR!;
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(dir, "tasks.json"), "]]]not json[[[", "utf8");

		const store = new TaskStore();
		const task = createTask(store);
		expect(store.getTask(task.id)?.title).toBe("Review");
	});
});
