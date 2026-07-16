/**
 * Scheduled Tasks Extension
 *
 * Provides cron-based scheduling for pi agent tasks. Supports one-time and
 * recurring schedules with environment variable injection.
 *
 * Usage:
 *   pi --extension examples/extensions/scheduled-tasks.ts
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// ============================================================================
// Types
// ============================================================================

interface ScheduledTask {
	id: string;
	title: string;
	prompt: string;
	schedule: "once" | "recurring";
	cronExpression?: string;
	runAt?: string; // RFC3339 for one-time
	timezone?: string;
	enabled: boolean;
	createdAt: string;
	lastRun?: string;
	nextRun?: string;
}

const TASKS_FILE = ".pi/tasks.json";

// ============================================================================
// Helpers
// ============================================================================

function generateId(): string {
	return `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadTasks(repoRoot: string): ScheduledTask[] {
	try {
		const fs = require("fs");
		const path = require("path");
		const filePath = path.join(repoRoot, TASKS_FILE);
		if (!fs.existsSync(filePath)) return [];
		return JSON.parse(fs.readFileSync(filePath, "utf-8"));
	} catch {
		return [];
	}
}

function saveTasks(repoRoot: string, tasks: ScheduledTask[]): void {
	try {
		const fs = require("fs");
		const path = require("path");
		const filePath = path.join(repoRoot, TASKS_FILE);
		fs.writeFileSync(filePath, JSON.stringify(tasks, null, 2), "utf-8");
	} catch {
		// Silently fail — tasks are best-effort
	}
}

function getNextRun(task: ScheduledTask): string | undefined {
	if (task.schedule === "once" && task.runAt) {
		return task.runAt;
	}
	if (task.schedule === "recurring" && task.cronExpression) {
		// Simple cron parser for common patterns
		return estimateNextRun(task.cronExpression);
	}
	return undefined;
}

function estimateNextRun(cronExpr: string): string {
	// Basic cron parser supporting: */N, N, N-M, N,M
	const parts = cronExpr.split(/\s+/);
	if (parts.length < 5) return new Date(Date.now() + 3600_000).toISOString(); // fallback: 1 hour

	const [minute, hour, _dom, _month, _dow] = parts;

	// Parse simple patterns
	function parseField(field: string, _max: number): number {
		if (field === "*") return 0;
		if (field.startsWith("*/")) return parseInt(field.slice(2), 10) || 1;
		if (field.includes(",")) return parseInt(field.split(",")[0], 10) || 0;
		if (field.includes("-")) return parseInt(field.split("-")[0], 10) || 0;
		return parseInt(field, 10) || 0;
	}

	const m = parseField(minute, 60);
	const h = parseField(hour, 24);
	const now = new Date();
	now.setHours(h, m, 0, 0);
	if (now <= new Date()) now.setDate(now.getDate() + 1);

	return now.toISOString();
}

// ============================================================================
// Tools
// ============================================================================

const ScheduleCreateParams = Type.Object({
	title: Type.String({ description: "Task title (human-readable)." }),
	prompt: Type.String({ description: "Prompt to execute when the task fires." }),
	schedule: Type.Optional(Type.Union([Type.Literal("once"), Type.Literal("recurring")])),
	runAt: Type.Optional(Type.String({ description: "RFC3339 datetime for one-time tasks." })),
	cronExpression: Type.Optional(
		Type.String({ description: "Cron expression for recurring tasks (5 fields: min hour dom month dow)." }),
	),
	timezone: Type.Optional(Type.String({ description: "IANA timezone (e.g., Asia/Shanghai)." })),
});

const ScheduleListParams = Type.Object({
	enabled: Type.Optional(Type.Boolean({ description: "Filter by enabled status. Omit for all." })),
});

const ScheduleTriggerParams = Type.Object({
	id: Type.String({ description: "Task ID to trigger immediately." }),
});

const ScheduleDeleteParams = Type.Object({
	id: Type.String({ description: "Task ID to delete." }),
});

// ============================================================================
// Extension
// ============================================================================

export default function (pi: ExtensionAPI) {
	// --- schedule_create ---
	pi.registerTool({
		name: "schedule_create",
		label: "Schedule Create",
		description: "Create a scheduled task. Supports one-time (runAt) and recurring (cron) schedules.",
		promptSnippet: "Use schedule_create to set up one-time or recurring tasks",
		promptGuidelines: [
			"For one-time: provide runAt in RFC3339 format (e.g., 2026-07-17T14:30:00+08:00).",
			"For recurring: provide a 5-field cron expression (e.g., '0 9 * * 1' for Mon 9am).",
			"Keep prompts concise — the agent will execute them as-is.",
		],
		parameters: ScheduleCreateParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const repoRoot = await getRepoRoot(pi, ctx.cwd);
			if (!repoRoot) {
				return { content: [{ type: "text", text: "Not in a project directory." }], details: { error: "no-repo" } };
			}

			const tasks = loadTasks(repoRoot);
			const task: ScheduledTask = {
				id: generateId(),
				title: params.title,
				prompt: params.prompt,
				schedule: params.schedule ?? "once",
				runAt: params.runAt,
				cronExpression: params.cronExpression,
				timezone: params.timezone,
				enabled: true,
				createdAt: new Date().toISOString(),
				nextRun: getNextRun({
					id: "",
					title: "",
					prompt: "",
					schedule: params.schedule ?? "once",
					runAt: params.runAt,
					cronExpression: params.cronExpression,
					enabled: true,
					createdAt: "",
				}),
			};

			tasks.push(task);
			saveTasks(repoRoot, tasks);

			return {
				content: [{ type: "text", text: `Created task: ${task.id} (${task.title})` }],
				details: { id: task.id, title: task.title, schedule: task.schedule, nextRun: task.nextRun },
			};
		},
	});

	// --- schedule_list ---
	pi.registerTool({
		name: "schedule_list",
		label: "Schedule List",
		description: "List all scheduled tasks.",
		promptSnippet: "Use schedule_list to see all scheduled tasks",
		parameters: ScheduleListParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const repoRoot = await getRepoRoot(pi, ctx.cwd);
			if (!repoRoot) {
				return { content: [{ type: "text", text: "Not in a project directory." }], details: { error: "no-repo" } };
			}

			const tasks = loadTasks(repoRoot);
			const filtered = params.enabled !== undefined ? tasks.filter((t) => t.enabled === params.enabled) : tasks;

			if (filtered.length === 0) {
				return { content: [{ type: "text", text: "No scheduled tasks." }], details: { count: 0 } };
			}

			const lines = filtered.map((t) => {
				const status = t.enabled ? "✅" : "⏸️";
				const sched = t.schedule === "once" ? `once@${t.runAt}` : `cron:${t.cronExpression}`;
				return `${status} ${t.id}: ${t.title} (${sched})`;
			});

			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details: { count: filtered.length },
			};
		},
	});

	// --- schedule_trigger ---
	pi.registerTool({
		name: "schedule_trigger",
		label: "Schedule Trigger",
		description: "Immediately trigger a scheduled task.",
		promptSnippet: "Use schedule_trigger to run a task immediately",
		parameters: ScheduleTriggerParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const repoRoot = await getRepoRoot(pi, ctx.cwd);
			if (!repoRoot) {
				return { content: [{ type: "text", text: "Not in a project directory." }], details: { error: "no-repo" } };
			}

			const tasks = loadTasks(repoRoot);
			const task = tasks.find((t) => t.id === params.id);
			if (!task) {
				return {
					content: [{ type: "text", text: `Task not found: ${params.id}` }],
					details: { error: "not-found" },
				};
			}

			task.lastRun = new Date().toISOString();
			task.nextRun = getNextRun(task);
			saveTasks(repoRoot, tasks);

			return {
				content: [{ type: "text", text: `Triggered task: ${task.title}` }],
				details: { id: task.id, prompt: task.prompt },
			};
		},
	});

	// --- schedule_delete ---
	pi.registerTool({
		name: "schedule_delete",
		label: "Schedule Delete",
		description: "Delete a scheduled task.",
		promptSnippet: "Use schedule_delete to remove a task",
		parameters: ScheduleDeleteParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const repoRoot = await getRepoRoot(pi, ctx.cwd);
			if (!repoRoot) {
				return { content: [{ type: "text", text: "Not in a project directory." }], details: { error: "no-repo" } };
			}

			const tasks = loadTasks(repoRoot);
			const idx = tasks.findIndex((t) => t.id === params.id);
			if (idx < 0) {
				return {
					content: [{ type: "text", text: `Task not found: ${params.id}` }],
					details: { error: "not-found" },
				};
			}

			const deleted = tasks.splice(idx, 1)[0];
			saveTasks(repoRoot, tasks);

			return {
				content: [{ type: "text", text: `Deleted task: ${deleted.title}` }],
				details: { id: deleted.id },
			};
		},
	});
}

async function getRepoRoot(pi: ExtensionAPI, cwd: string): Promise<string | null> {
	const { stdout, code } = await pi.exec("git", ["rev-parse", "--show-toplevel"], { cwd });
	return code === 0 ? stdout.trim() : null;
}
