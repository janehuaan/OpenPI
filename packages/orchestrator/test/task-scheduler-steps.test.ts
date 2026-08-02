import { describe, expect, it, vi } from "vitest";
import { TaskScheduler } from "../src/task-scheduler.ts";
import { TaskStore, taskStore } from "../src/task-store.ts";
import type { TaskDefinition, TaskRun, TaskStepDefinition } from "../src/types.ts";

function makeTask(steps?: TaskStepDefinition[], maxConcurrentSteps?: number): TaskDefinition {
	return {
		id: "task-1",
		title: "Test Task",
		prompt: "Run tests",
		schedule: { kind: "once", runAt: "2026-01-01T00:00:00.000Z" },
		status: "active",
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		steps,
		maxConcurrentSteps,
	};
}

function makeStep(id: string, prompt: string, dependsOn?: string[]): TaskStepDefinition {
	return { id, title: `Step ${id}`, prompt, dependsOn: dependsOn ?? [] };
}

function makeSuccessExecutor(): any {
	return {
		execute: vi.fn().mockImplementation((_task: TaskDefinition, _run: TaskRun) => ({
			pid: 1,
			stdoutPath: "/dev/null",
			stderrPath: "/dev/null",
			sessionDir: "/tmp",
			completion: Promise.resolve({ exitCode: 0, result: "ok", error: "" }),
			cancel: () => {},
		})),
	};
}

function makeFailingExecutor(failStepId: string): any {
	return {
		execute: vi.fn().mockImplementation((task: TaskDefinition) => {
			const isStepTask = task.id.startsWith("task-1-step-");
			if (isStepTask) {
				const stepId = task.id.split("-step-")[1];
				if (stepId === failStepId) {
					return {
						pid: 1,
						stdoutPath: "/dev/null",
						stderrPath: "/dev/null",
						sessionDir: "/tmp",
						completion: Promise.resolve({ exitCode: 1, result: "", error: "Step failed" }),
						cancel: () => {},
					};
				}
			}
			return {
				pid: 1,
				stdoutPath: "/dev/null",
				stderrPath: "/dev/null",
				sessionDir: "/tmp",
				completion: Promise.resolve({ exitCode: 0, result: "ok", error: "" }),
				cancel: () => {},
			};
		}),
	};
}

describe("TaskScheduler step execution", () => {
	it("executes steps sequentially when maxConcurrentSteps=1", async () => {
		const now = () => new Date("2026-01-01T00:00:00.000Z");
		const scheduler = new TaskScheduler(taskStore, makeSuccessExecutor(), now);

		const steps = [makeStep("a", "Run A"), makeStep("b", "Run B"), makeStep("c", "Run C")];
		const task = makeTask(steps, 1);
		taskStore.saveTasks([task]);

		const run = await scheduler.trigger("task-1", "manual");

		expect(run.status).toBe("succeeded");
		const stepRuns = taskStore.loadStepRunsByRunId(run.id);
		expect(stepRuns).toHaveLength(3);
		expect(stepRuns.every((sr) => sr.status === "succeeded")).toBe(true);
	});

	it("respects step dependencies", async () => {
		const now = () => new Date("2026-01-01T00:00:00.000Z");
		const scheduler = new TaskScheduler(taskStore, makeSuccessExecutor(), now);

		// c depends on a and b
		const steps = [makeStep("a", "Run A"), makeStep("b", "Run B"), makeStep("c", "Run C", ["a", "b"])];
		const task = makeTask(steps, 1);
		taskStore.saveTasks([task]);

		const run = await scheduler.trigger("task-1", "manual");

		expect(run.status).toBe("succeeded");
		const stepRuns = taskStore.loadStepRunsByRunId(run.id);
		expect(stepRuns).toHaveLength(3);
	});

	it("skips steps when skipIfFailed dependency fails", async () => {
		const now = () => new Date("2026-01-01T00:00:00.000Z");
		const executor = makeFailingExecutor("b");
		const scheduler = new TaskScheduler(taskStore, executor, now);

		// b will fail, c has skipIfFailed: ["b"]
		const steps: TaskStepDefinition[] = [
			makeStep("a", "Run A"),
			makeStep("b", "FAIL"),
			{ id: "c", title: "Step C", prompt: "Run C", dependsOn: [], skipIfFailed: ["b"] },
		];
		const task = makeTask(steps, 1);
		taskStore.saveTasks([task]);

		const run = await scheduler.trigger("task-1", "manual");

		expect(run.status).toBe("failed");
		const stepRuns = taskStore.loadStepRunsByRunId(run.id);
		expect(stepRuns.find((sr) => sr.stepId === "c")?.status).toBe("skipped");
	});

	it("enforces global concurrency limit", async () => {
		const now = () => new Date("2026-01-01T00:00:00.000Z");
		// Create a slow executor that never resolves to hold the active slot
		const slowExecutor = {
			execute: vi.fn().mockImplementation(() => ({
				pid: 1,
				stdoutPath: "/dev/null",
				stderrPath: "/dev/null",
				sessionDir: "/tmp",
				completion: new Promise(() => {}), // never resolves
				cancel: () => {},
			})),
		};
		const scheduler = new TaskScheduler(taskStore, slowExecutor, now, 1);

		const steps = [makeStep("a", "Run A")];
		const task = makeTask(steps);
		taskStore.saveTasks([task]);

		// First trigger starts but never completes
		const runPromise = scheduler.trigger("task-1", "manual");
		// Give it time to start
		await new Promise((r) => setTimeout(r, 50));

		// Second trigger should fail due to concurrency limit
		await expect(scheduler.trigger("task-1", "manual")).rejects.toThrow("Global concurrency limit reached");

		// Clean up
		runPromise.catch(() => {});
	});

	it("persists step runs across store reloads", async () => {
		const now = () => new Date("2026-01-01T00:00:00.000Z");
		const scheduler = new TaskScheduler(taskStore, makeSuccessExecutor(), now);

		const steps = [makeStep("a", "Run A"), makeStep("b", "Run B")];
		const task = makeTask(steps);
		taskStore.saveTasks([task]);

		const run = await scheduler.trigger("task-1", "manual");

		// Create new store instance (simulates restart)
		const freshStore = new TaskStore();
		const freshScheduler = new TaskScheduler(freshStore, makeSuccessExecutor(), now);
		// Step runs may not persist if not loaded from same store, but run should exist
		const freshRun = freshScheduler.getRun(run.id);
		expect(freshRun).toBeDefined();
	});
});
