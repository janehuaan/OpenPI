import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskExecution, TaskExecutionResult, TaskExecutor } from "../../../orchestrator/src/task-executor.ts";
import { nextRunForSchedule } from "../../../orchestrator/src/task-schedule.ts";
import { TaskScheduler } from "../../../orchestrator/src/task-scheduler.ts";
import { TaskStore } from "../../../orchestrator/src/task-store.ts";
import type { TaskDefinition } from "../../../orchestrator/src/types.ts";

class FauxExecutor implements TaskExecutor {
	readonly tasks: TaskDefinition[] = [];
	result: TaskExecutionResult = { exitCode: 0, result: "ok", error: "" };
	cancelled = false;
	deferred = false;
	private resolveCompletion?: (result: TaskExecutionResult) => void;

	execute(task: TaskDefinition): TaskExecution {
		this.tasks.push(task);
		const completion = this.deferred
			? new Promise<TaskExecutionResult>((resolve) => {
					this.resolveCompletion = resolve;
				})
			: Promise.resolve(this.result);
		return {
			pid: 123,
			stdoutPath: "/tmp/stdout.log",
			stderrPath: "/tmp/stderr.log",
			sessionDir: "/tmp/session",
			completion,
			cancel: () => {
				this.cancelled = true;
				this.resolveCompletion?.({ exitCode: 143, result: "", error: "cancelled" });
			},
		};
	}
}

describe("task scheduler", () => {
	let directory: string;
	let store: TaskStore;
	let executor: FauxExecutor;
	const now = new Date("2026-07-19T12:30:00.000Z");

	beforeEach(() => {
		directory = mkdtempSync(join(tmpdir(), "pi-orchestrator-tasks-"));
		process.env.PI_ORCHESTRATOR_DIR = directory;
		store = new TaskStore();
		executor = new FauxExecutor();
	});

	afterEach(() => {
		delete process.env.PI_ORCHESTRATOR_DIR;
		rmSync(directory, { recursive: true, force: true });
	});

	it("calculates cron schedules in UTC", () => {
		expect(nextRunForSchedule({ kind: "cron", expression: "*/15 * * * *" }, now)).toBe("2026-07-19T12:45:00.000Z");
		expect(nextRunForSchedule({ kind: "cron", expression: "0 9 * * 1" }, now)).toBe("2026-07-20T09:00:00.000Z");
	});

	it("persists definitions separately from run history", async () => {
		const scheduler = new TaskScheduler(store, executor, () => now);
		const task = scheduler.createTask({
			title: "Inspect repository",
			prompt: "Review the repository",
			schedule: { kind: "once", runAt: "2026-07-19T13:00:00Z" },
		});
		const run = await scheduler.trigger(task.id);

		expect(run.status).toBe("succeeded");
		expect(run.result).toBe("ok");
		expect(run.stdoutPath).toBe("/tmp/stdout.log");
		expect(scheduler.listTasks()).toHaveLength(1);
		expect(scheduler.listRuns(task.id)).toEqual([expect.objectContaining({ taskId: task.id, trigger: "manual" })]);
	});

	it("fires due once tasks and pauses them before execution", async () => {
		const scheduler = new TaskScheduler(store, executor, () => now);
		const task = scheduler.createTask({
			title: "Due task",
			prompt: "Run now",
			schedule: { kind: "once", runAt: "2026-07-19T12:00:00Z" },
		});

		await scheduler.tick();
		await vi.waitFor(() => expect(executor.tasks).toHaveLength(1));
		expect(store.getTask(task.id)).toEqual(expect.objectContaining({ status: "paused", nextRunAt: undefined }));
		expect(scheduler.listRuns(task.id)[0]).toEqual(
			expect.objectContaining({ status: "succeeded", trigger: "scheduled" }),
		);
	});

	it("records executor failures", async () => {
		executor.result = { exitCode: 2, result: "", error: "provider unavailable" };
		const scheduler = new TaskScheduler(store, executor, () => now);
		const task = scheduler.createTask({
			title: "Failure",
			prompt: "Fail",
			schedule: { kind: "once", runAt: "2026-07-20T12:00:00Z" },
		});

		const run = await scheduler.trigger(task.id);
		expect(run).toEqual(expect.objectContaining({ status: "failed", exitCode: 2, error: "provider unavailable" }));
	});

	it("cancels a running execution without overwriting its final state", async () => {
		executor.deferred = true;
		const scheduler = new TaskScheduler(store, executor, () => now);
		const task = scheduler.createTask({
			title: "Long run",
			prompt: "Wait",
			schedule: { kind: "once", runAt: "2026-07-20T12:00:00Z" },
		});
		const completion = scheduler.trigger(task.id);
		await vi.waitFor(() => expect(scheduler.listRuns(task.id)[0]?.status).toBe("running"));
		const runId = scheduler.listRuns(task.id)[0].id;

		expect(scheduler.cancel(runId)?.status).toBe("cancelled");
		expect(executor.cancelled).toBe(true);
		await completion;
		expect(scheduler.getRun(runId)?.status).toBe("cancelled");
	});

	it("marks unfinished runs interrupted after restart", () => {
		const task = store.createTask(
			{ title: "Interrupted", prompt: "Wait", schedule: { kind: "once", runAt: "2026-07-20T12:00:00Z" } },
			"2026-07-20T12:00:00.000Z",
		);
		const run = store.createRun(task.id, "manual");
		store.updateRun(run.id, (current) => ({ ...current, status: "running", startedAt: now.toISOString() }));

		store.markInterruptedRuns("2026-07-19T12:31:00.000Z");
		expect(store.loadRuns()[0]).toEqual(
			expect.objectContaining({ status: "interrupted", finishedAt: "2026-07-19T12:31:00.000Z" }),
		);
	});
});
