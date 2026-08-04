/**
 * Background sub-agent jobs (built-in).
 *
 * `submit_job` starts a sub-agent task without blocking the parent turn and
 * returns a job id; `wait_job` collects the result (blocking up to a
 * timeout). Job state is persisted to `<cwd>/.pi/jobs/<jobId>.json` so it
 * survives across turns and is visible for debugging. Jobs run in-process:
 * they complete only while the daemon/session process stays alive.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentToolResult, AgentToolUpdateCallback } from "@earendil-works/pi-agent-core";
import type { Static } from "typebox";
import { Type } from "typebox";
import type { ExtensionContext, ToolDefinition } from "./extensions/types.ts";
import { type RunSubAgentTaskOptions, runSubAgentTask } from "./sub-agent.ts";
export interface BackgroundJobState {
	id: string;
	createdAt: string;
	description: string;
	status: "running" | "done" | "failed";
	result?: string;
	turns?: number;
	error?: string;
}

export function jobsDir(cwd: string): string {
	return join(cwd, ".pi", "jobs");
}

export function jobFilePath(cwd: string, jobId: string): string {
	return join(jobsDir(cwd), `${jobId}.json`);
}

export function loadJobState(cwd: string, jobId: string): BackgroundJobState | undefined {
	const file = jobFilePath(cwd, jobId);
	if (!existsSync(file)) return undefined;
	try {
		return JSON.parse(readFileSync(file, "utf8")) as BackgroundJobState;
	} catch {
		return undefined;
	}
}

/**
 * Mark any job left in `running` state as failed — the process that owned it
 * is gone (daemon restart / crash), so it can never complete. Call once at
 * session startup.
 */
export function recoverInterruptedJobs(cwd: string): number {
	let dir: string[] = [];
	try {
		dir = readdirSync(jobsDir(cwd)).filter((name) => name.endsWith(".json"));
	} catch {
		return 0;
	}
	let recovered = 0;
	for (const name of dir) {
		const jobId = name.slice(0, -".json".length);
		const state = loadJobState(cwd, jobId);
		if (!state || state.status !== "running") continue;
		saveJobState(cwd, {
			...state,
			status: "failed",
			error: "interrupted by process restart",
		});
		recovered += 1;
	}
	return recovered;
}

/** List every persisted job, newest first. */
export function listJobs(cwd: string): BackgroundJobState[] {
	let dir: string[] = [];
	try {
		dir = readdirSync(jobsDir(cwd)).filter((name) => name.endsWith(".json"));
	} catch {
		return [];
	}
	return dir
		.map((name) => loadJobState(cwd, name.slice(0, -".json".length)))
		.filter((state): state is BackgroundJobState => state !== undefined)
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function saveJobState(cwd: string, state: BackgroundJobState): void {
	const file = jobFilePath(cwd, state.id);
	mkdirSync(join(file, ".."), { recursive: true });
	writeFileSync(file, JSON.stringify(state, null, "\t"));
}

export interface StartBackgroundJobOptions extends RunSubAgentTaskOptions {
	description: string;
	task: string;
}

/** Start a sub-agent job in the background; resolves with the job id immediately. */
export async function startBackgroundJob(
	cwd: string,
	deps: Parameters<typeof runSubAgentTask>[0],
	options: StartBackgroundJobOptions,
): Promise<string> {
	const id = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	const state: BackgroundJobState = {
		id,
		createdAt: new Date().toISOString(),
		description: options.description,
		status: "running",
	};
	saveJobState(cwd, state);

	// Fire-and-forget: the parent turn does not wait for this.
	void runSubAgentTask(deps, options.task, {
		maxSteps: options.maxSteps,
		tools: options.tools,
		writePaths: options.writePaths,
	})
		.then((result) => {
			saveJobState(cwd, {
				...state,
				status: "done",
				result: result.answer,
				turns: result.turns,
			});
		})
		.catch((error: unknown) => {
			saveJobState(cwd, {
				...state,
				status: "failed",
				error: error instanceof Error ? error.message : String(error),
			});
		});

	return id;
}

/** Poll the job file until it finishes or the timeout elapses (0 = return once). */
export async function waitForJob(cwd: string, jobId: string, timeoutMs: number): Promise<BackgroundJobState> {
	const start = Date.now();
	for (;;) {
		const state = loadJobState(cwd, jobId);
		if (!state) {
			return { id: jobId, createdAt: "", description: "", status: "failed", error: "unknown job id" };
		}
		if (state.status !== "running") return state;
		if (Date.now() - start >= timeoutMs) return state;
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
}

const SubmitJobParams = Type.Object({
	description: Type.String({ description: "Short label for this job" }),
	prompt: Type.String({ description: "Task prompt for the sub-agent" }),
	maxSteps: Type.Optional(Type.Integer({ description: "Max turns for the sub-agent (default 20)" })),
	write_paths: Type.Optional(Type.Array(Type.String(), { description: "Write scope for this job's sub-agent" })),
});

const WaitJobParams = Type.Object({
	job_id: Type.String({ description: "Job id returned by submit_job" }),
	timeout_s: Type.Optional(
		Type.Integer({ default: 120, minimum: 1, maximum: 600, description: "Max seconds to wait (default 120)" }),
	),
});

const ListJobsParams = Type.Object({});

function textResult(text: string): AgentToolResult<undefined> {
	return { content: [{ type: "text", text }], details: undefined };
}

export function createSubmitJobToolDefinition(
	start: (ctx: ExtensionContext, options: StartBackgroundJobOptions) => Promise<string>,
): ToolDefinition<typeof SubmitJobParams> {
	return {
		name: "submit_job",
		label: "Submit Background Job",
		description:
			"Start a sub-agent task in the background and return a job id immediately (does not block the current turn). Collect the result later with wait_job. Use for long-running work that should not stall the conversation.",
		promptSnippet: "submit_job - run a long task in the background",
		promptGuidelines: [
			"Delegate long-running or independent work to submit_job and continue the conversation; collect with wait_job when the result is needed.",
		],
		parameters: SubmitJobParams,
		execute: async (
			_toolCallId: string,
			params: Static<typeof SubmitJobParams>,
			_signal: AbortSignal | undefined,
			_onUpdate: AgentToolUpdateCallback<undefined> | undefined,
			ctx: ExtensionContext,
		) => {
			const jobId = await start(ctx, {
				description: params.description,
				task: params.prompt,
				maxSteps: params.maxSteps,
				writePaths: params.write_paths,
			});
			return textResult(
				`Background job started: ${jobId} (${params.description}). Collect the result with wait_job.`,
			);
		},
	};
}

export function createWaitJobToolDefinition(
	wait: (jobId: string, timeoutMs: number) => Promise<BackgroundJobState>,
): ToolDefinition<typeof WaitJobParams> {
	return {
		name: "wait_job",
		label: "Wait for Background Job",
		description:
			"Block (up to timeout_s) until a background job from submit_job finishes, then return its result. Returns the current status if it is still running when the timeout elapses.",
		promptSnippet: "wait_job - collect a background job result",
		parameters: WaitJobParams,
		execute: async (_toolCallId: string, params: Static<typeof WaitJobParams>) => {
			const state = await wait(params.job_id, (params.timeout_s ?? 120) * 1000);
			if (state.status === "done") {
				return textResult(`Job ${state.id} done (${state.turns ?? 0} turns).\n\n${state.result ?? "(no output)"}`);
			}
			if (state.status === "failed") {
				return textResult(`Job ${state.id} failed: ${state.error ?? "unknown error"}`);
			}
			return textResult(
				`Job ${state.id} is still running (waited ${params.timeout_s ?? 120}s). Use wait_job again to collect.`,
			);
		},
	};
}

export function createListJobsToolDefinition(list: () => BackgroundJobState[]): ToolDefinition<typeof ListJobsParams> {
	return {
		name: "list_jobs",
		label: "List Background Jobs",
		description:
			"List every background job (submit_job) with its status: id, description, status (running/done/failed), turns and error.",
		promptSnippet: "list_jobs - list background jobs and their status",
		parameters: ListJobsParams,
		execute: async () => {
			const jobs = list();
			if (jobs.length === 0) return textResult("(no background jobs)");
			const lines = jobs.map((job) => {
				const result = job.status === "done" ? `${job.turns ?? 0} turns` : (job.error ?? job.status);
				return `${job.id} [${job.status}] ${job.description} — ${result}`;
			});
			return textResult(lines.join("\n"));
		},
	};
}
