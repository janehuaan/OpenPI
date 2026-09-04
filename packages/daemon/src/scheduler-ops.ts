/**
 * Scheduler operations, exposed through the daemon.
 *
 * The scheduler is its own package, but it needs a long-lived process to tick
 * in — the daemon is the only one openpi has. So the daemon owns the instance
 * and forwards these ops; it does not reimplement any of the logic.
 *
 * The old fork instead had the desktop shell out to `orchestrator/dist/cli.js`
 * per action, which is why `scheduled-tasks.ts` carried three hardcoded paths to
 * find that CLI.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
	type CreateTaskInput,
	type TaskDefinition,
	type TaskRun,
	type TaskStepRun,
	taskLogsDir,
	TaskScheduler,
} from "@openpi/scheduler";

/** Tail size for a run log. A long unattended run can produce megabytes. */
const LOG_TAIL_BYTES = 256 * 1024;

let scheduler: TaskScheduler | undefined;

/**
 * The daemon's scheduler, started on first use.
 *
 * `markInterruptedRuns` runs inside the constructor path, so a crash leaves no
 * run stuck reporting "running" forever.
 */
export function ensureScheduler(): TaskScheduler {
	if (scheduler) return scheduler;
	scheduler = new TaskScheduler();
	scheduler.start();
	return scheduler;
}

export function stopScheduler(): void {
	scheduler?.stop();
	scheduler = undefined;
}

export interface TaskWithRuns {
	task: TaskDefinition;
	/** Most recent runs first. */
	runs: TaskRun[];
}

export function listTasks(): TaskWithRuns[] {
	const engine = ensureScheduler();
	const runs = engine.listRuns();
	return engine.listTasks().map((task) => ({
		task,
		runs: runs
			.filter((run) => run.taskId === task.id)
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
			.slice(0, 20),
	}));
}

export function createTask(input: CreateTaskInput): TaskDefinition {
	return ensureScheduler().createTask(input);
}

export function setTaskPaused(taskId: string, paused: boolean): TaskDefinition | undefined {
	return ensureScheduler().setPaused(taskId, paused);
}

export function deleteTask(taskId: string): boolean {
	return ensureScheduler().deleteTask(taskId);
}

export async function runTaskNow(taskId: string): Promise<TaskRun> {
	return ensureScheduler().trigger(taskId, "manual");
}

export function cancelRun(runId: string): TaskRun | undefined {
	return ensureScheduler().cancel(runId);
}

export function stepRuns(runId: string): TaskStepRun[] {
	return ensureScheduler().getStepRuns(runId);
}

/**
 * Tail of a run's captured output.
 *
 * Reads the tail rather than the whole file: this is shown in a log pane, and a
 * multi-megabyte read would stall the socket for every other request.
 */
export function readRunLog(runId: string, stream: "stdout" | "stderr"): { text: string; truncated: boolean } {
	const file = join(taskLogsDir(), `${runId}.${stream}.log`);
	if (!existsSync(file)) return { text: "", truncated: false };
	try {
		const size = statSync(file).size;
		if (size <= LOG_TAIL_BYTES) return { text: readFileSync(file, "utf8"), truncated: false };
		const buffer = readFileSync(file);
		return { text: buffer.subarray(size - LOG_TAIL_BYTES).toString("utf8"), truncated: true };
	} catch {
		return { text: "", truncated: false };
	}
}
