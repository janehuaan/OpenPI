/**
 * Scheduler paths and version.
 *
 * The scheduler owns its own directory under openpi's home, separate from the
 * daemon's session state: a cron job's definition outlives any session, and
 * mixing the two is what made the old orchestrator's storage layout confusing.
 */

import { homedir } from "node:os";
import { join } from "node:path";

export const VERSION = "0.1.0";

export function schedulerDir(): string {
	const explicit = process.env.OPENPI_SCHEDULER_DIR;
	if (explicit) return explicit;
	const home = process.env.OPENPI_DIR ?? join(homedir(), ".openpi");
	return join(home, "scheduler");
}

export function tasksPath(): string {
	return join(schedulerDir(), "tasks.json");
}

export function runsPath(): string {
	return join(schedulerDir(), "task-runs.json");
}

export function stepRunsPath(): string {
	return join(schedulerDir(), "step-runs.json");
}

/** Per-run stdout/stderr logs. One directory per run id. */
export function taskLogsDir(): string {
	return join(schedulerDir(), "task-logs");
}

/** Session files written by unattended runs, kept out of interactive sessions. */
export function taskSessionsDir(): string {
	return join(schedulerDir(), "sessions");
}
