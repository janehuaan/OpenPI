/**
 * OpenPI scheduled tasks — orchestrator-backed (same store as Desktop "定时任务").
 *
 * NOT the session todo list (`tasks` tool). This writes to ~/.pi/orchestrator/tasks.json
 * via the orchestrator daemon so the desktop UI lists them.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface OrchResponse {
	ok: boolean;
	error?: string;
	task?: Record<string, unknown>;
	tasks?: Array<Record<string, unknown>>;
	run?: Record<string, unknown>;
	runs?: Array<Record<string, unknown>>;
	deleted?: boolean;
}

function resolveOrchestratorCli(): string {
	if (process.env.PI_ORCHESTRATOR_CLI && existsSync(process.env.PI_ORCHESTRATOR_CLI)) {
		return resolve(process.env.PI_ORCHESTRATOR_CLI);
	}
	const candidates = [
		// monorepo (backend-first)
		resolve(__dirname, "../../../orchestrator/dist/cli.js"),
		resolve(process.cwd(), "packages/orchestrator/dist/cli.js"),
		// common install
		join(homedir(), "OpenPI/packages/orchestrator/dist/cli.js"),
	];
	const hit = candidates.find((p) => existsSync(p));
	if (!hit) {
		throw new Error(
			"Orchestrator CLI not found. Build packages/orchestrator or set PI_ORCHESTRATOR_CLI. Desktop must have daemon running.",
		);
	}
	return hit;
}

function runProcess(args: string[], detached = false): Promise<{ stdout: string; stderr: string; code: number }> {
	const cli = resolveOrchestratorCli();
	return new Promise((resolveResult, reject) => {
		const child = spawn(process.execPath, [cli, ...args], {
			detached,
			env: process.env,
			stdio: detached ? "ignore" : ["ignore", "pipe", "pipe"],
		});
		if (detached) {
			child.unref();
			resolveResult({ stdout: "", stderr: "", code: 0 });
			return;
		}
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		child.stdout?.on("data", (c: Buffer) => stdout.push(c));
		child.stderr?.on("data", (c: Buffer) => stderr.push(c));
		child.once("error", reject);
		child.once("close", (code) => {
			resolveResult({
				stdout: Buffer.concat(stdout).toString("utf8").trim(),
				stderr: Buffer.concat(stderr).toString("utf8").trim(),
				code: code ?? 1,
			});
		});
	});
}

async function orch(args: string[]): Promise<OrchResponse> {
	const attempt = async () => {
		const result = await runProcess(args);
		if (result.code !== 0) {
			throw new Error(result.stderr || result.stdout || `orchestrator exit ${result.code}`);
		}
		if (!result.stdout) throw new Error("Empty orchestrator response");
		return JSON.parse(result.stdout) as OrchResponse;
	};

	try {
		return await attempt();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (!/ENOENT|ECONNREFUSED|socket|connect|not running|no-socket/i.test(message)) {
			// still try start for generic failures once
		}
		await runProcess(["serve"], true);
		for (let i = 0; i < 30; i++) {
			await delay(100);
			try {
				return await attempt();
			} catch (retryError) {
				if (i === 29) throw retryError;
			}
		}
		throw error;
	}
}

function formatTask(task: Record<string, unknown>): string {
	const schedule = task.schedule as
		| { kind?: string; expression?: string; runAt?: string; timezone?: string }
		| undefined;
	const sched =
		schedule?.kind === "cron"
			? `cron ${schedule.expression}${schedule.timezone ? ` (${schedule.timezone})` : ""}`
			: schedule?.kind === "once"
				? `once ${schedule.runAt}`
				: JSON.stringify(schedule ?? {});
	return [
		`[${task.id}] ${task.title}`,
		`  status: ${task.status}`,
		`  schedule: ${sched}`,
		`  nextRunAt: ${task.nextRunAt ?? "-"}`,
		`  cwd: ${task.cwd ?? "-"}`,
		`  prompt: ${String(task.prompt ?? "").slice(0, 200)}`,
	].join("\n");
}

const Params = Type.Object({
	action: Type.String({
		description: "create | list | show | pause | resume | delete | run | runs",
	}),
	title: Type.Optional(Type.String({ description: "Task title (create)" })),
	prompt: Type.Optional(
		Type.String({
			description: "What the agent should do when the task fires (create). Full instructions, not a one-liner only.",
		}),
	),
	cron: Type.Optional(
		Type.String({
			description: 'Cron expression for recurring runs, e.g. "0 9 * * *" (create). Mutually exclusive with at.',
		}),
	),
	at: Type.Optional(
		Type.String({
			description: "RFC3339 one-shot time, e.g. 2026-07-25T01:00:00.000Z (create). Mutually exclusive with cron.",
		}),
	),
	timezone: Type.Optional(
		Type.String({ description: 'IANA timezone for cron wall clock, e.g. "Asia/Shanghai" (default UTC if omitted)' }),
	),
	cwd: Type.Optional(Type.String({ description: "Working directory for the task (default: current project)" })),
	taskId: Type.Optional(Type.String({ description: "Task id (show/pause/resume/delete/run/runs)" })),
	securityMode: Type.Optional(
		Type.String({ description: "strict | confirm | permissive (default strict for unattended)" }),
	),
});

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "scheduled_task",
		label: "Scheduled Task",
		description: `Create and manage OpenPI **desktop scheduled tasks** (定时任务).

These are the same tasks shown in the Desktop "定时任务" UI and stored by the orchestrator daemon (~/.pi/orchestrator/tasks.json).

Use this when the user wants:
- daily/weekly/cron jobs
- 定时抓取、日报、巡检、提醒
- tasks that run unattended outside the chat

Do NOT use GitHub Actions or random local JSON files for OpenPI scheduled tasks.
Do NOT use the session "tasks" todo tool for cron schedules.

Actions:
- create: requires title, prompt, and exactly one of cron or at
- list | show | pause | resume | delete | run | runs`,
		promptSnippet: "Use scheduled_task for OpenPI desktop cron/once jobs (not session todos, not GitHub Actions).",
		promptGuidelines: [
			"When the user asks for 定时任务 / daily cron / scheduled agent work, call scheduled_task create.",
			"Never invent GitHub Actions workflows as a substitute for OpenPI scheduled tasks unless the user explicitly wants CI.",
			"After create, confirm the task id and that it will appear under Desktop → 定时任务.",
			"Prefer Asia/Shanghai for Chinese users unless they specify otherwise.",
		],
		parameters: Params,
		async execute(_id, params, _signal, _update, ctx) {
			const action = String(params.action ?? "list").toLowerCase();
			try {
				if (action === "list") {
					const res = await orch(["task", "list"]);
					if (!res.ok) throw new Error(res.error || "list failed");
					const tasks = res.tasks ?? [];
					const text =
						tasks.length === 0
							? "No scheduled tasks. Use scheduled_task create to add one (shows in Desktop 定时任务)."
							: tasks.map((t) => formatTask(t)).join("\n\n");
					return {
						content: [{ type: "text", text }],
						details: { action, count: tasks.length, tasks },
					};
				}

				if (action === "create") {
					const title = String(params.title ?? "").trim();
					const prompt = String(params.prompt ?? "").trim();
					const cron = params.cron ? String(params.cron).trim() : "";
					const at = params.at ? String(params.at).trim() : "";
					if (!title || !prompt) {
						return {
							content: [{ type: "text", text: "create requires title and prompt." }],
							details: { action, error: "missing params" },
						};
					}
					if ((!cron && !at) || (cron && at)) {
						return {
							content: [
								{
									type: "text",
									text: 'create requires exactly one of cron (e.g. "0 9 * * *") or at (RFC3339).',
								},
							],
							details: { action, error: "schedule" },
						};
					}
					const args = [
						"task",
						"create",
						"--title",
						title,
						"--prompt",
						prompt,
						"--cwd",
						String(params.cwd ?? ctx.cwd),
						"--security-mode",
						String(params.securityMode ?? "strict"),
					];
					if (cron) {
						args.push("--cron", cron);
						if (params.timezone) args.push("--timezone", String(params.timezone));
						else args.push("--timezone", "Asia/Shanghai");
					} else {
						args.push("--at", at);
					}
					const res = await orch(args);
					if (!res.ok || !res.task) throw new Error(res.error || "create failed");
					const text = [
						"Scheduled task created (orchestrator / Desktop 定时任务):",
						formatTask(res.task),
						"",
						"Open Desktop → 定时任务 to see it. It will run under the orchestrator daemon.",
					].join("\n");
					return {
						content: [{ type: "text", text }],
						details: { action, task: res.task },
					};
				}

				const taskId = String(params.taskId ?? "").trim();
				if (!taskId && action !== "runs") {
					return {
						content: [{ type: "text", text: `${action} requires taskId.` }],
						details: { action, error: "missing taskId" },
					};
				}

				if (action === "show") {
					const res = await orch(["task", "show", taskId]);
					if (!res.ok || !res.task) throw new Error(res.error || "show failed");
					return {
						content: [{ type: "text", text: formatTask(res.task) }],
						details: { action, task: res.task },
					};
				}
				if (action === "pause" || action === "resume") {
					const res = await orch(["task", action, taskId]);
					if (!res.ok || !res.task) throw new Error(res.error || `${action} failed`);
					return {
						content: [{ type: "text", text: `Task ${action}d.\n${formatTask(res.task)}` }],
						details: { action, task: res.task },
					};
				}
				if (action === "delete") {
					const res = await orch(["task", "delete", taskId]);
					if (!res.ok) throw new Error(res.error || "delete failed");
					return {
						content: [{ type: "text", text: res.deleted ? `Deleted ${taskId}` : `Not found: ${taskId}` }],
						details: { action, deleted: res.deleted },
					};
				}
				if (action === "run") {
					const res = await orch(["task", "run", taskId]);
					if (!res.ok || !res.run) throw new Error(res.error || "run failed");
					return {
						content: [
							{
								type: "text",
								text: `Triggered run ${res.run.id} status=${res.run.status}`,
							},
						],
						details: { action, run: res.run },
					};
				}
				if (action === "runs") {
					const res = await orch(taskId ? ["task", "runs", taskId] : ["task", "runs"]);
					if (!res.ok) throw new Error(res.error || "runs failed");
					const runs = res.runs ?? [];
					const text =
						runs.length === 0
							? "No runs yet."
							: runs
									.map(
										(r) =>
											`${r.id} task=${r.taskId} ${r.status} trigger=${r.trigger} started=${r.startedAt ?? "-"}`,
									)
									.join("\n");
					return {
						content: [{ type: "text", text }],
						details: { action, runs },
					};
				}

				return {
					content: [{ type: "text", text: `Unknown action: ${action}` }],
					details: { action: "invalid" },
				};
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				return {
					content: [
						{
							type: "text",
							text: `scheduled_task failed: ${msg}\nEnsure the OpenPI desktop daemon is running (服务在线).`,
						},
					],
					details: { action, error: msg },
				};
			}
		},
	});
}
