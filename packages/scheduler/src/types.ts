/**
 * Scheduler types.
 *
 * Carried over from the old orchestrator package, minus everything about
 * session instances and machine registration - those belong to the daemon, and
 * bundling them is what made one 4,400-line package own two unrelated jobs.
 */

export type TaskStatus = "active" | "paused";
export type TaskRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "interrupted";
export type TaskStepStatus = "pending" | "running" | "succeeded" | "failed" | "cancelled" | "skipped";

export type TaskSchedule = { kind: "once"; runAt: string } | { kind: "cron"; expression: string; timezone?: string };

export type TaskRetryOn = "failed" | "interrupted";

export interface TaskRetryPolicy {
	/** Maximum additional attempts after the first run. 0 = no retry. */
	maxAttempts: number;
	/** Base backoff delay in milliseconds. Default 1000. */
	backoffMs?: number;
	/** Multiplier applied per attempt. Default 2. */
	backoffMultiplier?: number;
	/** Cap for backoff delay in milliseconds. Default 60000. */
	maxBackoffMs?: number;
	/** Which terminal statuses may trigger a retry. Default ["failed"]. */
	retryOn?: TaskRetryOn[];
}

export type TaskSecurityMode = "strict" | "confirm" | "permissive" | "bypass";
export type TaskSandboxProfile = "none" | "docker";

export interface TaskStepDefinition {
	id: string;
	title: string;
	prompt: string;
	/** Step-level tool override (empty = use task defaults). */
	tools?: string[];
	/** Steps that must succeed before this step runs. */
	dependsOn?: string[];
	/** Skip this step if any of these steps fail (requires dependent step to succeed first). */
	skipIfFailed?: string[];
	/** Skip this step if any of these steps are skipped. */
	skipIfSkipped?: string[];
	/** Maximum attempts for this step. Undefined = use task retry policy. */
	maxAttempts?: number;
	/** Per-step retry policy override. */
	retry?: TaskRetryPolicy;
}

export interface TaskDefinition {
	id: string;
	title: string;
	prompt: string;
	cwd?: string;
	schedule: TaskSchedule;
	status: TaskStatus;
	createdAt: string;
	updatedAt: string;
	nextRunAt?: string;
	retry?: TaskRetryPolicy;
	provider?: string;
	model?: string;
	tools?: string[];
	excludeTools?: string[];
	env?: Record<string, string>;
	/** Extra --extension paths loaded for this run. */
	extensions?: string[];
	/** Security gate mode flag for the child pi process. Default strict for unattended. */
	securityMode?: TaskSecurityMode;
	/** Optional sandbox profile. docker wraps the command in `docker run --rm -v cwd:/work`. */
	sandbox?: TaskSandboxProfile;
	/** Docker image when sandbox=docker. Default node:22-bookworm. */
	dockerImage?: string;
	/** Ordered steps for DAG execution. When absent, the prompt runs as a single step. */
	steps?: TaskStepDefinition[];
	/** Maximum concurrent steps. Undefined = 1 (sequential). */
	maxConcurrentSteps?: number;
	/** Global concurrency limit for this task. Undefined = no limit. */
	maxConcurrentRuns?: number;
}

export interface TaskStepRun {
	id: string;
	runId: string;
	stepId: string;
	stepTitle: string;
	status: TaskStepStatus;
	trigger: "manual" | "scheduled" | "retry";
	attempt: number;
	createdAt: string;
	startedAt?: string;
	finishedAt?: string;
	pid?: number;
	exitCode?: number;
	result?: string;
	error?: string;
	stdoutPath?: string;
	stderrPath?: string;
	sessionId?: string;
	sessionFile?: string;
}

export interface TaskRun {
	id: string;
	taskId: string;
	status: TaskRunStatus;
	trigger: "manual" | "scheduled" | "retry";
	createdAt: string;
	startedAt?: string;
	finishedAt?: string;
	pid?: number;
	exitCode?: number;
	result?: string;
	error?: string;
	stdoutPath?: string;
	stderrPath?: string;
	/** 1-based attempt number. */
	attempt?: number;
	parentRunId?: string;
	sessionId?: string;
	sessionFile?: string;
	/** Step-level execution records. Absent for legacy single-step runs. */
	stepRuns?: TaskStepRun[];
}

/**
 * Scheduler health. The old OrchestratorHealth also carried a socket path and
 * live-instance counts; those belong to the daemon, which reports its own.
 */
export interface SchedulerHealth {
	ok: true;
	version: string;
	uptimeMs: number;
	startedAt: string;
	tasksActive: number;
	tasksPaused: number;
	runsRunning: number;
	runsQueued: number;
	stepRunsRunning: number;
	stepRunsQueued: number;
	/** mtime of the resolved pi CLI entry, for version-drift detection. */
	cliMtime?: number;
}

