/**
 * Sub-agent Extension
 *
 * Runs independent pi print-mode processes in the background and persists
 * their lifecycle and results under .pi/sub-agents/.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

interface SubAgentTask {
	id: string;
	title: string;
	prompt: string;
	status: "pending" | "running" | "completed" | "failed" | "cancelled";
	result?: string;
	error?: string;
	createdAt: string;
	completedAt?: string;
	timeout: number;
	pid?: number;
}

const TASK_DIR = ".pi/sub-agents";
const TASK_INDEX = ".pi/sub-agents.json";

function generateId(): string {
	return `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadTasks(cwd: string): SubAgentTask[] {
	try {
		if (!fs.existsSync(path.join(cwd, TASK_INDEX))) return [];
		const value: unknown = JSON.parse(fs.readFileSync(path.join(cwd, TASK_INDEX), "utf8"));
		return Array.isArray(value) ? (value as SubAgentTask[]) : [];
	} catch {
		return [];
	}
}

function saveTasks(cwd: string, tasks: SubAgentTask[]): void {
	const dir = path.join(cwd, ".pi");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(cwd, TASK_INDEX), `${JSON.stringify(tasks, null, 2)}\n`, "utf8");
}

function taskPath(cwd: string, id: string): string {
	return path.join(cwd, TASK_DIR, `${id}.json`);
}

function saveTask(cwd: string, task: SubAgentTask): void {
	fs.mkdirSync(path.join(cwd, TASK_DIR), { recursive: true });
	fs.writeFileSync(taskPath(cwd, task.id), `${JSON.stringify(task, null, 2)}\n`, "utf8");
	const tasks = loadTasks(cwd).filter((item) => item.id !== task.id);
	tasks.push(task);
	saveTasks(cwd, tasks);
}

function resolvePiEntry(): string {
	const entry = process.argv[1];
	if (!entry) throw new Error("Cannot resolve the current pi CLI entry point.");
	return path.resolve(entry);
}

function refreshTask(cwd: string, task: SubAgentTask): SubAgentTask {
	const resultFile = taskPath(cwd, task.id);
	try {
		if (fs.existsSync(resultFile)) {
			const value: unknown = JSON.parse(fs.readFileSync(resultFile, "utf8"));
			if (value && typeof value === "object" && "status" in value) {
				return value as SubAgentTask;
			}
		}
	} catch {
		// Keep current state if the result file is temporarily incomplete.
	}
	return task;
}

function spawnSubAgent(cwd: string, task: SubAgentTask, apiKey?: string): void {
	const child = spawn(process.execPath, [resolvePiEntry(), "--no-session", "--print", task.prompt], {
		cwd,
		detached: true,
		stdio: ["ignore", "pipe", "pipe"],
		env: { ...process.env, ...(apiKey ? { AGNES_API_KEY: apiKey } : {}) },
	});

	task.status = "running";
	task.pid = child.pid;
	saveTask(cwd, task);

	const stdout: Buffer[] = [];
	const stderr: Buffer[] = [];
	child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
	child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
	child.on("error", (error) => {
		task.status = "failed";
		task.error = error.message;
		task.completedAt = new Date().toISOString();
		saveTask(cwd, task);
	});
	child.on("close", (code) => {
		task.status = code === 0 ? "completed" : "failed";
		task.result = Buffer.concat(stdout).toString("utf8").trim();
		task.error =
			code === 0 ? undefined : Buffer.concat(stderr).toString("utf8").trim() || `Sub-agent exited with code ${code}`;
		task.completedAt = new Date().toISOString();
		saveTask(cwd, task);
	});
	child.unref();
}

const SubAgentCreateParams = Type.Object({
	title: Type.String({ description: "Task title." }),
	prompt: Type.String({ description: "Prompt executed by an independent pi process." }),
	timeout: Type.Optional(
		Type.Number({ minimum: 10, maximum: 3600, description: "Timeout in seconds. Default: 300." }),
	),
});

const SubAgentListParams = Type.Object({
	status: Type.Optional(Type.String({ description: "Filter: pending, running, completed, failed, cancelled." })),
});

const SubAgentWaitParams = Type.Object({
	id: Type.String({ description: "Task ID." }),
	timeout: Type.Optional(
		Type.Number({ minimum: 1, maximum: 3600, description: "Wait timeout in seconds. Default: 600." }),
	),
});

const SubAgentCancelParams = Type.Object({ id: Type.String({ description: "Task ID." }) });

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "sub_agent_create",
		label: "Sub-agent Create",
		description: "Start an independent pi process in the background and return its task ID.",
		promptSnippet: "Use sub_agent_create to run an independent coding task in parallel",
		parameters: SubAgentCreateParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const task: SubAgentTask = {
				id: generateId(),
				title: params.title,
				prompt: params.prompt,
				status: "pending",
				createdAt: new Date().toISOString(),
				timeout: params.timeout ?? 300,
			};
			saveTask(ctx.cwd, task);
			spawnSubAgent(ctx.cwd, task);
			return {
				content: [{ type: "text", text: `Started sub-agent ${task.id}: ${task.title}` }],
				details: { id: task.id, status: task.status, pid: task.pid },
			};
		},
	});

	pi.registerTool({
		name: "sub_agent_list",
		label: "Sub-agent List",
		description: "List independent sub-agent processes and their results.",
		promptSnippet: "Use sub_agent_list to inspect sub-agent status",
		parameters: SubAgentListParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const tasks = loadTasks(ctx.cwd).map((task) => refreshTask(ctx.cwd, task));
			saveTasks(ctx.cwd, tasks);
			const filtered = params.status ? tasks.filter((task) => task.status === params.status) : tasks;
			if (filtered.length === 0)
				return { content: [{ type: "text", text: "No sub-agent tasks." }], details: { count: 0 } };
			return {
				content: [
					{ type: "text", text: filtered.map((task) => `${task.status}: ${task.id} — ${task.title}`).join("\n") },
				],
				details: { count: filtered.length },
			};
		},
	});

	pi.registerTool({
		name: "sub_agent_wait",
		label: "Sub-agent Wait",
		description: "Wait for a real sub-agent process to finish and return its output.",
		promptSnippet: "Use sub_agent_wait to collect a sub-agent result",
		parameters: SubAgentWaitParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const timeout = (params.timeout ?? 600) * 1000;
			const started = Date.now();
			let task = loadTasks(ctx.cwd).find((item) => item.id === params.id);
			if (!task)
				return {
					content: [{ type: "text", text: `Task not found: ${params.id}` }],
					details: { error: "not-found" },
				};
			while (task.status === "pending" || task.status === "running") {
				if (Date.now() - started >= timeout)
					return {
						content: [{ type: "text", text: `Timed out waiting for ${task.id}.` }],
						details: { id: task.id, status: task.status, timedOut: true },
					};
				await new Promise((resolve) => setTimeout(resolve, 250));
				task = refreshTask(ctx.cwd, task);
			}
			return {
				content: [
					{
						type: "text",
						text:
							task.status === "completed"
								? (task.result ?? "(empty result)")
								: (task.error ?? `Task ${task.status}.`),
					},
				],
				details: { id: task.id, status: task.status },
			};
		},
	});

	pi.registerTool({
		name: "sub_agent_cancel",
		label: "Sub-agent Cancel",
		description: "Cancel a running sub-agent process.",
		promptSnippet: "Use sub_agent_cancel to terminate a sub-agent",
		parameters: SubAgentCancelParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const tasks = loadTasks(ctx.cwd);
			const task = tasks.find((item) => item.id === params.id);
			if (!task)
				return {
					content: [{ type: "text", text: `Task not found: ${params.id}` }],
					details: { error: "not-found" },
				};
			if (task.pid && (task.status === "running" || task.status === "pending")) {
				try {
					process.kill(task.pid, "SIGTERM");
				} catch {
					/* Process may already have exited. */
				}
			}
			task.status = "cancelled";
			task.completedAt = new Date().toISOString();
			saveTask(ctx.cwd, task);
			return {
				content: [{ type: "text", text: `Cancelled ${task.id}.` }],
				details: { id: task.id, status: task.status },
			};
		},
	});
}
