import type { TaskDefinition, TaskRetryOn, TaskRetryPolicy, TaskRun, TaskRunStatus } from "./types.ts";

export const DEFAULT_BACKOFF_MS = 1_000;
export const DEFAULT_BACKOFF_MULTIPLIER = 2;
export const DEFAULT_MAX_BACKOFF_MS = 60_000;

export function normalizeRetryPolicy(retry: TaskRetryPolicy | undefined): TaskRetryPolicy | undefined {
	if (!retry) return undefined;
	const maxAttempts = Math.max(0, Math.floor(retry.maxAttempts));
	if (maxAttempts <= 0) return undefined;
	return {
		maxAttempts,
		backoffMs: retry.backoffMs === undefined ? DEFAULT_BACKOFF_MS : Math.max(0, retry.backoffMs),
		backoffMultiplier:
			retry.backoffMultiplier === undefined ? DEFAULT_BACKOFF_MULTIPLIER : Math.max(1, retry.backoffMultiplier),
		maxBackoffMs: retry.maxBackoffMs === undefined ? DEFAULT_MAX_BACKOFF_MS : Math.max(0, retry.maxBackoffMs),
		retryOn: retry.retryOn && retry.retryOn.length > 0 ? [...retry.retryOn] : (["failed"] as TaskRetryOn[]),
	};
}

export function computeBackoffMs(policy: TaskRetryPolicy, failedAttempt: number): number {
	const base = policy.backoffMs ?? DEFAULT_BACKOFF_MS;
	const multiplier = policy.backoffMultiplier ?? DEFAULT_BACKOFF_MULTIPLIER;
	const max = policy.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
	const exponent = Math.max(0, failedAttempt - 1);
	const delay = base * multiplier ** exponent;
	return Math.min(max, Math.floor(delay));
}

export function shouldRetryRun(
	task: TaskDefinition,
	run: Pick<TaskRun, "status" | "attempt">,
	status: TaskRunStatus = run.status,
): boolean {
	const policy = normalizeRetryPolicy(task.retry);
	if (!policy) return false;
	const attempt = run.attempt ?? 1;
	if (attempt > policy.maxAttempts) return false;
	const retryOn = policy.retryOn ?? (["failed"] as TaskRetryOn[]);
	if (status === "failed" && retryOn.includes("failed")) return true;
	if (status === "interrupted" && retryOn.includes("interrupted")) return true;
	return false;
}
