import { readFileSync } from "node:fs";
import { getSocketPath, VERSION } from "./config.ts";
import { ProcessTaskExecutor, type TaskExecution, type TaskExecutor } from "./task-executor.ts";
import { computeBackoffMs, normalizeRetryPolicy, shouldRetryRun } from "./task-retry.ts";
import { nextRunForSchedule } from "./task-schedule.ts";
import type { CreateTaskInput, TaskStore } from "./task-store.ts";
import { taskStore } from "./task-store.ts";
import type {
	OrchestratorHealth,
	TaskDefinition,
	TaskRun,
	TaskStepDefinition,
	TaskStepRun,
	TaskStepStatus,
} from "./types.ts";

interface ActiveRun {
	runId: string;
	execution: TaskExecution;
	cancelled: boolean;
}

interface PendingRetry {
	taskId: string;
	attempt: number;
	parentRunId: string;
	timer: NodeJS.Timeout;
}

function readLog(path: string | undefined): string {
	if (!path) return "";
	try {
		return readFileSync(path, "utf8").trim();
	} catch {
		return "";
	}
}

/**
 * Determines which steps are ready to execute next based on dependency state.
 */
function getReadySteps(
	steps: TaskStepDefinition[],
	completed: Set<string>,
	skipped: Set<string>,
	failed: Set<string>,
	running: Set<string>,
): TaskStepDefinition[] {
	const ready: TaskStepDefinition[] = [];
	for (const step of steps) {
		if (completed.has(step.id) || skipped.has(step.id) || failed.has(step.id)) continue;
		if (running.has(step.id)) continue;

		// Dependencies must all be succeeded
		const depsSatisfied = (step.dependsOn ?? []).every((depId) => completed.has(depId));
		if (!depsSatisfied) continue;

		// Check skip conditions
		const skipIfFailed = (step.skipIfFailed ?? []).some((id) => failed.has(id));
		if (skipIfFailed) {
			ready.push(step);
			continue;
		}

		const skipIfSkipped = (step.skipIfSkipped ?? []).some((id) => skipped.has(id));
		if (skipIfSkipped) {
			ready.push(step);
			continue;
		}

		ready.push(step);
	}
	return ready;
}

export class TaskScheduler {
	private readonly activeRuns = new Map<string, ActiveRun>();
	private readonly pendingRetries = new Map<string, PendingRetry>();
	private readonly store: TaskStore;
	private readonly executor: TaskExecutor;
	private readonly now: () => Date;
	private timer?: NodeJS.Timeout;
	private startedAt?: string;
	private readonly maxConcurrentTasks: number;
	private activeTaskCount = 0;

	constructor(
		store: TaskStore = taskStore,
		executor: TaskExecutor = new ProcessTaskExecutor(),
		now: () => Date = () => new Date(),
		maxConcurrentTasks = 4,
	) {
		this.store = store;
		this.executor = executor;
		this.now = now;
		this.maxConcurrentTasks = maxConcurrentTasks;
	}

	start(intervalMs = 15_000): void {
		if (this.timer) return;
		this.startedAt = this.now().toISOString();
		const interruptedRuns = this.store.markInterruptedRuns(this.now().toISOString());
		this.store.markInterruptedStepRuns(this.now().toISOString());
		this.requeueInterrupted(interruptedRuns);
		void this.tick();
		this.timer = setInterval(() => void this.tick(), intervalMs);
	}

	stop(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
		for (const pending of this.pendingRetries.values()) clearTimeout(pending.timer);
		this.pendingRetries.clear();
	}

	health(): OrchestratorHealth {
		const tasks = this.store.loadTasks();
		const runs = this.store.loadRuns();
		const stepRuns = this.store.loadStepRuns();
		const startedAt = this.startedAt ?? this.now().toISOString();
		return {
			ok: true,
			version: VERSION,
			uptimeMs: Math.max(0, this.now().getTime() - Date.parse(startedAt)),
			socketPath: getSocketPath(),
			tasksActive: tasks.filter((task) => task.status === "active").length,
			tasksPaused: tasks.filter((task) => task.status === "paused").length,
			runsRunning: runs.filter((run) => run.status === "running").length + this.activeRuns.size,
			runsQueued: runs.filter((run) => run.status === "queued").length,
			startedAt,
			stepRunsRunning: stepRuns.filter((sr) => sr.status === "running").length,
			stepRunsQueued: stepRuns.filter((sr) => sr.status === "pending").length,
		};
	}

	createTask(input: CreateTaskInput): TaskDefinition {
		if (!input.title.trim() || !input.prompt.trim()) throw new Error("Task title and prompt are required.");
		const nextRunAt = nextRunForSchedule(input.schedule, this.now());
		return this.store.createTask(
			{
				...input,
				retry: normalizeRetryPolicy(input.retry),
			},
			nextRunAt,
		);
	}

	listTasks(): TaskDefinition[] {
		return this.store.loadTasks();
	}

	getTask(taskId: string): TaskDefinition | undefined {
		return this.store.getTask(taskId);
	}

	listRuns(taskId?: string): TaskRun[] {
		const runs = this.store.loadRuns();
		return taskId ? runs.filter((run) => run.taskId === taskId) : runs;
	}

	getRun(runId: string): TaskRun | undefined {
		return this.store.loadRuns().find((run) => run.id === runId);
	}

	getStepRuns(runId: string): TaskStepRun[] {
		return this.store.loadStepRunsByRunId(runId);
	}

	setPaused(taskId: string, paused: boolean): TaskDefinition | undefined {
		if (paused) this.clearPendingRetry(taskId);
		return this.store.updateTask(taskId, (task) => ({
			...task,
			status: paused ? "paused" : "active",
			updatedAt: this.now().toISOString(),
		}));
	}

	deleteTask(taskId: string): boolean {
		if (this.activeRuns.has(taskId)) throw new Error("Cannot delete a running task.");
		this.clearPendingRetry(taskId);
		return this.store.deleteTask(taskId);
	}

	cancel(runId: string): TaskRun | undefined {
		const current = this.getRun(runId);
		if (!current) return undefined;
		if (current.status !== "queued" && current.status !== "running") return current;
		const active = this.activeRuns.get(current.taskId);
		if (active?.runId === runId) {
			active.cancelled = true;
			active.execution.cancel();
		}
		this.clearPendingRetry(current.taskId);
		return this.store.updateRun(runId, (run) => ({
			...run,
			status: "cancelled",
			finishedAt: this.now().toISOString(),
			error: "Cancelled by user.",
		}));
	}

	async trigger(
		taskId: string,
		trigger: TaskRun["trigger"] = "manual",
		options: { attempt?: number; parentRunId?: string } = {},
	): Promise<TaskRun> {
		const task = this.store.getTask(taskId);
		if (!task) throw new Error(`Unknown task: ${taskId}`);

		if (this.activeTaskCount >= this.maxConcurrentTasks) {
			throw new Error(`Global concurrency limit reached (${this.maxConcurrentTasks}).`);
		}

		if (task.maxConcurrentRuns && this.activeRuns.size >= task.maxConcurrentRuns) {
			throw new Error(`Task concurrency limit reached (${task.maxConcurrentRuns}).`);
		}

		const attempt = options.attempt ?? 1;
		const run = this.store.createRun(taskId, trigger, {
			attempt,
			parentRunId: options.parentRunId,
			trigger,
		});

		this.activeTaskCount++;
		try {
			if (task.steps && task.steps.length > 0) {
				return await this.executeStepTask(task, run, trigger);
			}
			return await this.executeSingleStepTask(task, run);
		} finally {
			this.activeTaskCount--;
		}
	}

	private async executeSingleStepTask(task: TaskDefinition, run: TaskRun): Promise<TaskRun> {
		try {
			const execution = this.executor.execute(task, run);
			const active: ActiveRun = { runId: run.id, execution, cancelled: false };
			this.activeRuns.set(task.id, active);
			run =
				this.store.updateRun(run.id, (current) => ({
					...current,
					status: "running",
					startedAt: this.now().toISOString(),
					pid: execution.pid,
					stdoutPath: execution.stdoutPath,
					stderrPath: execution.stderrPath,
				})) ?? run;
			const result = await execution.completion;
			if (active.cancelled) return this.getRun(run.id) ?? run;
			run =
				this.store.updateRun(run.id, (current) => ({
					...current,
					status: result.exitCode === 0 ? "succeeded" : "failed",
					finishedAt: this.now().toISOString(),
					pid: result.pid ?? current.pid,
					exitCode: result.exitCode,
					result: result.result || readLog(current.stdoutPath),
					error:
						result.exitCode === 0
							? undefined
							: result.error || readLog(current.stderrPath) || `Pi exited with code ${result.exitCode}.`,
					sessionId: result.sessionId ?? current.sessionId,
					sessionFile: result.sessionFile ?? current.sessionFile,
				})) ?? run;
			if (run.status === "failed") this.maybeScheduleRetry(task, run);
			return run;
		} catch (error) {
			run =
				this.store.updateRun(run.id, (current) => ({
					...current,
					status: "failed",
					finishedAt: this.now().toISOString(),
					error: error instanceof Error ? error.message : String(error),
				})) ?? run;
			this.maybeScheduleRetry(task, run);
			return run;
		} finally {
			this.activeRuns.delete(task.id);
		}
	}

	private async executeStepTask(task: TaskDefinition, run: TaskRun, trigger: TaskRun["trigger"]): Promise<TaskRun> {
		const steps = task.steps!;
		const maxConcurrent = task.maxConcurrentSteps ?? 1;
		const completed = new Set<string>();
		const skipped = new Set<string>();
		const failed = new Set<string>();
		const running = new Set<string>();
		const activeSteps = new Map<string, { execution: TaskExecution; cancelled: boolean }>();

		try {
			const execution = this.executor.execute(task, run);
			const active: ActiveRun = { runId: run.id, execution, cancelled: false };
			this.activeRuns.set(task.id, active);
			run =
				this.store.updateRun(run.id, (current) => ({
					...current,
					status: "running",
					startedAt: this.now().toISOString(),
				})) ?? run;

			// Load any existing step runs for resume
			const existingStepRuns = this.store.loadStepRunsByRunId(run.id);
			for (const sr of existingStepRuns) {
				if (sr.status === "succeeded") completed.add(sr.stepId);
				else if (sr.status === "skipped") skipped.add(sr.stepId);
				else if (sr.status === "failed") failed.add(sr.stepId);
				else if (sr.status === "running") {
					running.add(sr.stepId);
					// Re-acquire execution for running steps
					const stepDef = steps.find((s) => s.id === sr.stepId);
					if (stepDef) {
						// Step is running, will complete on next tick
					}
				}
			}

			let hasFailure = false;

			// Main scheduling loop
			while (completed.size + skipped.size + failed.size < steps.length) {
				if (active.cancelled) break;

				const ready = getReadySteps(steps, completed, skipped, failed, running);

				for (const step of ready) {
					if (running.has(step.id) || activeSteps.has(step.id)) continue;
					const currentRunning = activeSteps.size;
					const stepCanStart = maxConcurrent > 0 ? currentRunning < maxConcurrent : currentRunning === 0;
					if (!stepCanStart) break;

					const shouldSkip =
						(step.skipIfFailed ?? []).some((id) => failed.has(id)) ||
						(step.skipIfSkipped ?? []).some((id) => skipped.has(id));

					if (shouldSkip) {
						const skippedRun = this.store.createStepRun(run.id, step.id, step.title, trigger, 1);
						this.store.updateStepRun(skippedRun.id, (r) => ({
							...r,
							status: "skipped" as TaskStepStatus,
							finishedAt: this.now().toISOString(),
							result: "Skipped due to dependency failure.",
						}));
						skipped.add(step.id);
						continue;
					}

					// Create step run
					const stepRun = this.store.createStepRun(run.id, step.id, step.title, trigger, 1);
					running.add(step.id);

					// Update to running
					this.store.updateStepRun(stepRun.id, (r) => ({
						...r,
						status: "running" as TaskStepStatus,
						startedAt: this.now().toISOString(),
					}));

					// Build step-specific task
					const stepTask: TaskDefinition = {
						...task,
						id: `${task.id}-step-${step.id}`,
						prompt: step.prompt,
						tools: step.tools ?? task.tools,
						steps: undefined,
						maxConcurrentSteps: undefined,
						maxConcurrentRuns: undefined,
					};

					// Execute step
					const stepExec = this.executor.execute(stepTask, { ...run, id: stepRun.id } as TaskRun);
					activeSteps.set(step.id, { execution: stepExec, cancelled: false });
				}

				// Wait for active steps to complete
				if (activeSteps.size === 0) break;

				const results = await Promise.allSettled(
					Array.from(activeSteps.entries()).map(async ([stepId, entry]) => {
						try {
							const result = await entry.execution.completion;
							return { stepId, result, cancelled: entry.cancelled };
						} catch (error) {
							return { stepId, result: null, error, cancelled: entry.cancelled };
						}
					}),
				);

				for (const r of results) {
					if (r.status !== "fulfilled") continue;
					const { stepId, result, cancelled } = r.value;
					if (cancelled) continue;

					if (!result || result.exitCode !== 0) {
						this.store.updateStepRun(
							this.store
								.loadStepRunsByRunId(run.id)
								.find((sr) => sr.stepId === stepId && sr.status === "running")?.id ?? "",
							(sr) => ({
								...sr,
								status: "failed" as TaskStepStatus,
								finishedAt: this.now().toISOString(),
								error: result?.error || "Step failed.",
								exitCode: result?.exitCode,
							}),
						);
						failed.add(stepId);
						hasFailure = true;
					} else {
						this.store.updateStepRun(
							this.store
								.loadStepRunsByRunId(run.id)
								.find((sr) => sr.stepId === stepId && sr.status === "running")?.id ?? "",
							(sr) => ({
								...sr,
								status: "succeeded" as TaskStepStatus,
								finishedAt: this.now().toISOString(),
								result: result.result || readLog(sr.stdoutPath),
								sessionId: result.sessionId ?? sr.sessionId,
								sessionFile: result.sessionFile ?? sr.sessionFile,
							}),
						);
						completed.add(stepId);
					}

					running.delete(stepId);
					activeSteps.delete(stepId);
				}

				// Small delay to prevent tight loop
				await new Promise((resolve) => setTimeout(resolve, 100));
			}

			const finalStatus: TaskRun["status"] = active.cancelled ? "cancelled" : hasFailure ? "failed" : "succeeded";
			return (
				this.store.updateRun(run.id, (current) => ({
					...current,
					status: finalStatus,
					finishedAt: this.now().toISOString(),
				})) ?? run
			);
		} catch (error) {
			run =
				this.store.updateRun(run.id, (current) => ({
					...current,
					status: "failed",
					finishedAt: this.now().toISOString(),
					error: error instanceof Error ? error.message : String(error),
				})) ?? run;
			this.maybeScheduleRetry(task, run);
			return run;
		} finally {
			this.activeRuns.delete(task.id);
		}
	}

	async tick(): Promise<void> {
		const now = this.now();
		const due = this.store
			.loadTasks()
			.filter((task) => task.status === "active" && task.nextRunAt && Date.parse(task.nextRunAt) <= now.getTime());
		for (const task of due) {
			if (this.activeRuns.has(task.id) || this.pendingRetries.has(task.id)) continue;
			this.advanceSchedule(task, now);
			void this.trigger(task.id, "scheduled");
		}
	}

	private advanceSchedule(task: TaskDefinition, now: Date): void {
		this.store.updateTask(task.id, (current) => ({
			...current,
			status: current.schedule.kind === "once" ? "paused" : current.status,
			nextRunAt: current.schedule.kind === "once" ? undefined : nextRunForSchedule(current.schedule, now),
			updatedAt: now.toISOString(),
		}));
	}

	private maybeScheduleRetry(task: TaskDefinition, run: TaskRun): void {
		if (!shouldRetryRun(task, run, "failed")) return;
		const policy = normalizeRetryPolicy(task.retry);
		if (!policy) return;
		const nextAttempt = (run.attempt ?? 1) + 1;
		const delay = computeBackoffMs(policy, run.attempt ?? 1);
		this.scheduleRetry(task.id, nextAttempt, run.id, delay);
	}

	private requeueInterrupted(interrupted: TaskRun[]): void {
		for (const run of interrupted) {
			const task = this.store.getTask(run.taskId);
			if (!task || task.status !== "active") continue;
			if (!shouldRetryRun(task, run, "interrupted")) continue;
			const policy = normalizeRetryPolicy(task.retry);
			if (!policy) continue;
			const nextAttempt = (run.attempt ?? 1) + 1;
			const delay = computeBackoffMs(policy, run.attempt ?? 1);
			this.scheduleRetry(task.id, nextAttempt, run.id, delay);
		}
	}

	private scheduleRetry(taskId: string, attempt: number, parentRunId: string, delayMs: number): void {
		this.clearPendingRetry(taskId);
		const timer = setTimeout(() => {
			this.pendingRetries.delete(taskId);
			void this.trigger(taskId, "retry", { attempt, parentRunId });
		}, delayMs);
		timer.unref?.();
		this.pendingRetries.set(taskId, { taskId, attempt, parentRunId, timer });
	}

	private clearPendingRetry(taskId: string): void {
		const pending = this.pendingRetries.get(taskId);
		if (!pending) return;
		clearTimeout(pending.timer);
		this.pendingRetries.delete(taskId);
	}
}

export const taskScheduler = new TaskScheduler();
