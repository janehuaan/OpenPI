import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getOrchestratorDir } from "./config.ts";
import { normalizeRetryPolicy } from "./task-retry.ts";
import type {
	TaskDefinition,
	TaskRetryOn,
	TaskRetryPolicy,
	TaskRun,
	TaskRunStatus,
	TaskSandboxProfile,
	TaskSchedule,
	TaskSecurityMode,
	TaskStepDefinition,
	TaskStepRun,
	TaskStepStatus,
} from "./types.ts";

interface TaskFile {
	schemaVersion: 1;
	tasks: TaskDefinition[];
}

interface RunFile {
	schemaVersion: 1;
	runs: TaskRun[];
}

interface StepRunFile {
	schemaVersion: 1;
	stepRuns: TaskStepRun[];
}

export interface CreateTaskInput {
	title: string;
	prompt: string;
	cwd?: string;
	schedule: TaskSchedule;
	retry?: TaskRetryPolicy;
	provider?: string;
	model?: string;
	tools?: string[];
	excludeTools?: string[];
	env?: Record<string, string>;
	extensions?: string[];
	securityMode?: TaskSecurityMode;
	sandbox?: TaskSandboxProfile;
	dockerImage?: string;
	steps?: TaskStepDefinition[];
	maxConcurrentSteps?: number;
	maxConcurrentRuns?: number;
}

export interface CreateRunOptions {
	attempt?: number;
	parentRunId?: string;
	trigger?: TaskRun["trigger"];
}

const TASK_SCHEMA_VERSION = 1;

function tasksPath(): string {
	return join(getOrchestratorDir(), "tasks.json");
}

function runsPath(): string {
	return join(getOrchestratorDir(), "task-runs.json");
}

function stepRunsPath(): string {
	return join(getOrchestratorDir(), "step-runs.json");
}

function atomicWrite(path: string, content: string): void {
	mkdirSync(dirname(path), { recursive: true });
	const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
	writeFileSync(temporaryPath, content, { encoding: "utf8", mode: 0o600 });
	renameSync(temporaryPath, path);
}

function readJson(path: string): unknown {
	if (!existsSync(path)) return undefined;
	return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
	return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
	if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a non-empty string.`);
	return value;
}

function optionalString(value: unknown, label: string): string | undefined {
	if (value === undefined) return undefined;
	return requireString(value, label);
}

function optionalStringArray(value: unknown, label: string): string[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string" && entry.length > 0)) {
		throw new Error(`${label} must be an array of non-empty strings.`);
	}
	return value as string[];
}

function optionalStringRecord(value: unknown, label: string): Record<string, string> | undefined {
	if (value === undefined) return undefined;
	const object = requireObject(value, label);
	const result: Record<string, string> = {};
	for (const [key, entry] of Object.entries(object)) {
		if (typeof entry !== "string") throw new Error(`${label}.${key} must be a string.`);
		result[key] = entry;
	}
	return result;
}

function parseSchedule(value: unknown): TaskSchedule {
	const schedule = requireObject(value, "task schedule");
	if (schedule.kind === "once") return { kind: "once", runAt: requireString(schedule.runAt, "runAt") };
	if (schedule.kind === "cron") {
		return {
			kind: "cron",
			expression: requireString(schedule.expression, "cron expression"),
			timezone: schedule.timezone === undefined ? undefined : requireString(schedule.timezone, "timezone"),
		};
	}
	throw new Error("Task schedule kind must be once or cron.");
}

function parseRetry(value: unknown): TaskRetryPolicy | undefined {
	if (value === undefined) return undefined;
	const retry = requireObject(value, "task retry");
	if (typeof retry.maxAttempts !== "number" || !Number.isInteger(retry.maxAttempts) || retry.maxAttempts < 0) {
		throw new Error("retry.maxAttempts must be a non-negative integer.");
	}
	const retryOn =
		retry.retryOn === undefined
			? undefined
			: (() => {
					if (!Array.isArray(retry.retryOn)) throw new Error("retry.retryOn must be an array.");
					const allowed: TaskRetryOn[] = ["failed", "interrupted"];
					for (const entry of retry.retryOn) {
						if (!allowed.includes(entry as TaskRetryOn)) {
							throw new Error("retry.retryOn entries must be failed or interrupted.");
						}
					}
					return retry.retryOn as TaskRetryOn[];
				})();
	return normalizeRetryPolicy({
		maxAttempts: typeof retry.maxAttempts === "number" ? retry.maxAttempts : 0,
		backoffMs: typeof retry.backoffMs === "number" ? retry.backoffMs : undefined,
		backoffMultiplier: typeof retry.backoffMultiplier === "number" ? Math.max(1, retry.backoffMultiplier) : undefined,
		maxBackoffMs: typeof retry.maxBackoffMs === "number" ? retry.maxBackoffMs : undefined,
		retryOn,
	});
}

function parseStepDefinition(value: unknown): TaskStepDefinition {
	const step = requireObject(value, "task step");
	const id = requireString(step.id, "step id");
	const dependsOn = optionalStringArray(step.dependsOn, "step.dependsOn");
	const skipIfFailed = optionalStringArray(step.skipIfFailed, "step.skipIfFailed");
	const skipIfSkipped = optionalStringArray(step.skipIfSkipped, "step.skipIfSkipped");
	const maxAttempts = typeof step.maxAttempts === "number" ? step.maxAttempts : 0;
	const retry = step.retry !== undefined ? parseRetry(step.retry) : undefined;
	return {
		id,
		title: requireString(step.title, "step title"),
		prompt: requireString(step.prompt, "step prompt"),
		tools: optionalStringArray(step.tools, "step.tools"),
		dependsOn: dependsOn ?? [],
		skipIfFailed: skipIfFailed ?? [],
		skipIfSkipped: skipIfSkipped ?? [],
		maxAttempts,
		retry,
	};
}

function parseSteps(value: unknown): TaskStepDefinition[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value)) throw new Error("steps must be an array");
	return value.map((entry) => parseStepDefinition(entry));
}

function parseTask(value: unknown): TaskDefinition {
	const task = requireObject(value, "task");
	if (task.status !== "active" && task.status !== "paused") throw new Error("Task status must be active or paused.");
	return {
		id: requireString(task.id, "task id"),
		title: requireString(task.title, "task title"),
		prompt: requireString(task.prompt, "task prompt"),
		cwd: optionalString(task.cwd, "task cwd"),
		schedule: parseSchedule(task.schedule),
		status: task.status,
		createdAt: requireString(task.createdAt, "task createdAt"),
		updatedAt: requireString(task.updatedAt, "task updatedAt"),
		nextRunAt: optionalString(task.nextRunAt, "task nextRunAt"),
		retry: parseRetry(task.retry),
		provider: optionalString(task.provider, "task provider"),
		model: optionalString(task.model, "task model"),
		tools: optionalStringArray(task.tools, "task tools"),
		excludeTools: optionalStringArray(task.excludeTools, "task excludeTools"),
		env: optionalStringRecord(task.env, "task env"),
		extensions: optionalStringArray(task.extensions, "task extensions"),
		securityMode:
			task.securityMode === "strict" || task.securityMode === "confirm" || task.securityMode === "permissive"
				? task.securityMode
				: undefined,
		sandbox: task.sandbox === "docker" || task.sandbox === "none" ? task.sandbox : undefined,
		dockerImage: optionalString(task.dockerImage, "task dockerImage"),
		steps: parseSteps(task.steps),
		maxConcurrentSteps: typeof task.maxConcurrentSteps === "number" ? task.maxConcurrentSteps : undefined,
		maxConcurrentRuns: typeof task.maxConcurrentRuns === "number" ? task.maxConcurrentRuns : undefined,
	};
}

function parseStepRun(value: unknown): TaskStepRun {
	const step = requireObject(value, "step run");
	const statuses: TaskStepStatus[] = ["pending", "running", "succeeded", "failed", "cancelled", "skipped"];
	if (!statuses.includes(step.status as TaskStepStatus)) throw new Error("Invalid step run status.");
	const trigger =
		step.trigger === "scheduled" ? "scheduled" : step.trigger === "retry" ? "retry" : ("manual" as const);
	return {
		id: requireString(step.id, "step run id"),
		runId: requireString(step.runId, "step run runId"),
		stepId: requireString(step.stepId, "step run stepId"),
		stepTitle: requireString(step.stepTitle, "step run stepTitle"),
		status: step.status as TaskStepStatus,
		trigger,
		attempt: typeof step.attempt === "number" ? step.attempt : 1,
		createdAt: requireString(step.createdAt, "step run createdAt"),
		startedAt: optionalString(step.startedAt, "step run startedAt"),
		finishedAt: optionalString(step.finishedAt, "step run finishedAt"),
		pid: typeof step.pid === "number" ? step.pid : undefined,
		exitCode: typeof step.exitCode === "number" ? step.exitCode : undefined,
		result: typeof step.result === "string" ? step.result : undefined,
		error: typeof step.error === "string" ? step.error : undefined,
		stdoutPath: typeof step.stdoutPath === "string" ? step.stdoutPath : undefined,
		stderrPath: typeof step.stderrPath === "string" ? step.stderrPath : undefined,
		sessionId: optionalString(step.sessionId, "step run sessionId"),
		sessionFile: optionalString(step.sessionFile, "step run sessionFile"),
	};
}

function parseStepRuns(value: unknown): TaskStepRun[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value)) throw new Error("stepRuns must be an array");
	return value.map((entry) => parseStepRun(entry));
}

function parseRun(value: unknown): TaskRun {
	const run = requireObject(value, "task run");
	const statuses: TaskRunStatus[] = ["queued", "running", "succeeded", "failed", "cancelled", "interrupted"];
	if (!statuses.includes(run.status as TaskRunStatus)) throw new Error("Invalid task run status.");
	const trigger = run.trigger === "scheduled" ? "scheduled" : run.trigger === "retry" ? "retry" : ("manual" as const);
	return {
		id: requireString(run.id, "run id"),
		taskId: requireString(run.taskId, "run taskId"),
		status: run.status as TaskRunStatus,
		trigger,
		createdAt: requireString(run.createdAt, "run createdAt"),
		startedAt: optionalString(run.startedAt, "run startedAt"),
		finishedAt: optionalString(run.finishedAt, "run finishedAt"),
		pid: typeof run.pid === "number" ? run.pid : undefined,
		exitCode: typeof run.exitCode === "number" ? run.exitCode : undefined,
		result: typeof run.result === "string" ? run.result : undefined,
		error: typeof run.error === "string" ? run.error : undefined,
		stdoutPath: typeof run.stdoutPath === "string" ? run.stdoutPath : undefined,
		stderrPath: typeof run.stderrPath === "string" ? run.stderrPath : undefined,
		attempt: typeof run.attempt === "number" ? run.attempt : undefined,
		parentRunId: optionalString(run.parentRunId, "run parentRunId"),
		sessionId: optionalString(run.sessionId, "run sessionId"),
		sessionFile: optionalString(run.sessionFile, "run sessionFile"),
		stepRuns: parseStepRuns(run.stepRuns),
	};
}

function parseFile<T>(value: unknown, key: "tasks" | "runs", parser: (item: unknown) => T): T[] {
	if (value === undefined) return [];
	const file = requireObject(value, `${key} file`);
	if (file.schemaVersion !== TASK_SCHEMA_VERSION) throw new Error(`Unsupported ${key} schema version.`);
	if (!Array.isArray(file[key])) throw new Error(`${key} must be an array.`);
	return file[key].map(parser);
}

function parseStepRunFile(value: unknown): TaskStepRun[] {
	if (value === undefined) return [];
	const file = requireObject(value, "step runs file");
	if (file.schemaVersion !== TASK_SCHEMA_VERSION) throw new Error("Unsupported step runs schema version.");
	if (!Array.isArray(file.stepRuns)) throw new Error("stepRuns must be an array.");
	return file.stepRuns.map(parseStepRun);
}

export class TaskStore {
	loadTasks(): TaskDefinition[] {
		return parseFile(readJson(tasksPath()), "tasks", parseTask);
	}

	saveTasks(tasks: TaskDefinition[]): void {
		const file: TaskFile = { schemaVersion: TASK_SCHEMA_VERSION, tasks };
		atomicWrite(tasksPath(), `${JSON.stringify(file, null, 2)}\n`);
	}

	loadRuns(): TaskRun[] {
		return parseFile(readJson(runsPath()), "runs", parseRun);
	}

	saveRuns(runs: TaskRun[]): void {
		const file: RunFile = { schemaVersion: TASK_SCHEMA_VERSION, runs };
		atomicWrite(runsPath(), `${JSON.stringify(file, null, 2)}\n`);
	}

	loadStepRuns(): TaskStepRun[] {
		return parseStepRunFile(readJson(stepRunsPath()));
	}

	saveStepRuns(stepRuns: TaskStepRun[]): void {
		const file: StepRunFile = { schemaVersion: TASK_SCHEMA_VERSION, stepRuns };
		atomicWrite(stepRunsPath(), `${JSON.stringify(file, null, 2)}\n`);
	}

	createTask(input: CreateTaskInput, nextRunAt: string): TaskDefinition {
		const now = new Date().toISOString();
		const task: TaskDefinition = {
			id: randomUUID(),
			title: input.title,
			prompt: input.prompt,
			cwd: input.cwd,
			schedule: input.schedule,
			status: "active",
			createdAt: now,
			updatedAt: now,
			nextRunAt,
			retry: normalizeRetryPolicy(input.retry),
			provider: input.provider,
			model: input.model,
			tools: input.tools,
			excludeTools: input.excludeTools,
			env: input.env,
			extensions: input.extensions,
			securityMode: input.securityMode,
			sandbox: input.sandbox,
			dockerImage: input.dockerImage,
			steps: input.steps,
			maxConcurrentSteps: input.maxConcurrentSteps,
			maxConcurrentRuns: input.maxConcurrentRuns,
		};
		const tasks = this.loadTasks();
		tasks.push(task);
		this.saveTasks(tasks);
		return task;
	}

	getTask(taskId: string): TaskDefinition | undefined {
		return this.loadTasks().find((task) => task.id === taskId);
	}

	updateTask(taskId: string, update: (task: TaskDefinition) => TaskDefinition): TaskDefinition | undefined {
		const tasks = this.loadTasks();
		const index = tasks.findIndex((task) => task.id === taskId);
		if (index === -1) return undefined;
		tasks[index] = update(tasks[index]);
		this.saveTasks(tasks);
		return tasks[index];
	}

	deleteTask(taskId: string): boolean {
		const tasks = this.loadTasks();
		const filtered = tasks.filter((task) => task.id !== taskId);
		if (filtered.length === tasks.length) return false;
		this.saveTasks(filtered);
		return true;
	}

	createRun(taskId: string, trigger: TaskRun["trigger"], options: CreateRunOptions = {}): TaskRun {
		const run: TaskRun = {
			id: randomUUID(),
			taskId,
			status: "queued",
			trigger: options.trigger ?? trigger,
			createdAt: new Date().toISOString(),
			attempt: options.attempt ?? 1,
			parentRunId: options.parentRunId,
		};
		const runs = this.loadRuns();
		runs.push(run);
		this.saveRuns(runs);
		return run;
	}

	updateRun(runId: string, update: (run: TaskRun) => TaskRun): TaskRun | undefined {
		const runs = this.loadRuns();
		const index = runs.findIndex((run) => run.id === runId);
		if (index === -1) return undefined;
		runs[index] = update(runs[index]);
		this.saveRuns(runs);
		return runs[index];
	}

	markInterruptedRuns(now = new Date().toISOString()): TaskRun[] {
		const runs = this.loadRuns();
		const interrupted: TaskRun[] = [];
		let changed = false;
		for (const run of runs) {
			if (run.status !== "queued" && run.status !== "running") continue;
			run.status = "interrupted";
			run.finishedAt = now;
			run.error = "Orchestrator restarted before the run completed.";
			interrupted.push(run);
			changed = true;
		}
		if (changed) this.saveRuns(runs);
		return interrupted;
	}

	createStepRun(
		runId: string,
		stepId: string,
		stepTitle: string,
		trigger: TaskStepRun["trigger"],
		attempt: number,
	): TaskStepRun {
		const stepRun: TaskStepRun = {
			id: randomUUID(),
			runId,
			stepId,
			stepTitle,
			status: "pending",
			trigger,
			attempt,
			createdAt: new Date().toISOString(),
		};
		const stepRuns = this.loadStepRuns();
		stepRuns.push(stepRun);
		this.saveStepRuns(stepRuns);
		return stepRun;
	}

	updateStepRun(stepRunId: string, update: (stepRun: TaskStepRun) => TaskStepRun): TaskStepRun | undefined {
		const stepRuns = this.loadStepRuns();
		const index = stepRuns.findIndex((sr) => sr.id === stepRunId);
		if (index === -1) return undefined;
		stepRuns[index] = update(stepRuns[index]);
		this.saveStepRuns(stepRuns);
		return stepRuns[index];
	}

	markInterruptedStepRuns(now = new Date().toISOString()): TaskStepRun[] {
		const stepRuns = this.loadStepRuns();
		const interrupted: TaskStepRun[] = [];
		let changed = false;
		for (const stepRun of stepRuns) {
			if (stepRun.status !== "pending" && stepRun.status !== "running") continue;
			stepRun.status = "cancelled";
			stepRun.finishedAt = now;
			stepRun.error = "Orchestrator restarted before the step run completed.";
			interrupted.push(stepRun);
			changed = true;
		}
		if (changed) this.saveStepRuns(stepRuns);
		return interrupted;
	}

	loadStepRunsByRunId(runId: string): TaskStepRun[] {
		return this.loadStepRuns().filter((sr) => sr.runId === runId);
	}
}

export const taskStore = new TaskStore();
