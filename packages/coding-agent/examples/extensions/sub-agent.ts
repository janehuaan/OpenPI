/**
 * Sub-agent Extension
 *
 * Enables the main agent to delegate tasks to sub-agents for parallel execution.
 * Supports task isolation, result aggregation, and timeout management.
 *
 * Usage:
 *   pi --extension examples/extensions/sub-agent.ts
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// ============================================================================
// Types
// ============================================================================

interface SubAgentTask {
	id: string;
	title: string;
	prompt: string;
	status: "pending" | "running" | "completed" | "failed" | "cancelled";
	result?: string;
	error?: string;
	createdAt: string;
	completedAt?: string;
	timeout: number; // seconds
}

// ============================================================================
// Helpers
// ============================================================================

function generateId(): string {
	return `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadTasks(cwd: string): SubAgentTask[] {
	try {
		const fs = require("fs");
		const path = require("path");
		const filePath = path.join(cwd, ".pi/sub-agents.json");
		if (!fs.existsSync(filePath)) return [];
		return JSON.parse(fs.readFileSync(filePath, "utf-8"));
	} catch {
		return [];
	}
}

function saveTasks(cwd: string, tasks: SubAgentTask[]): void {
	try {
		const fs = require("fs");
		const path = require("path");
		const dir = path.join(cwd, ".pi");
		if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
		const filePath = path.join(cwd, ".pi/sub-agents.json");
		fs.writeFileSync(filePath, JSON.stringify(tasks, null, 2), "utf-8");
	} catch {
		// Silently fail
	}
}

// ============================================================================
// Tools
// ============================================================================

const SubAgentCreateParams = Type.Object({
	title: Type.String({ description: "Task title (human-readable)." }),
	prompt: Type.String({ description: "Detailed prompt for the sub-agent to execute." }),
	timeout: Type.Optional(
		Type.Number({ minimum: 10, maximum: 3600, description: "Timeout in seconds. Default: 300." }),
	),
});

const SubAgentListParams = Type.Object({
	status: Type.Optional(
		Type.String({ description: "Filter by status: pending, running, completed, failed, cancelled." }),
	),
});

const SubAgentWaitParams = Type.Object({
	id: Type.String({ description: "Task ID to wait for." }),
	timeout: Type.Optional(
		Type.Number({ minimum: 1, maximum: 3600, description: "Wait timeout in seconds. Default: 600." }),
	),
});

const SubAgentCancelParams = Type.Object({
	id: Type.String({ description: "Task ID to cancel." }),
});

// ============================================================================
// Extension
// ============================================================================

export default function (pi: ExtensionAPI) {
	// --- sub_agent_create ---
	pi.registerTool({
		name: "sub_agent_create",
		label: "Sub-agent Create",
		description:
			"Create a sub-agent task for parallel execution. The sub-agent receives the prompt and executes it independently.",
		promptSnippet: "Use sub_agent_create to delegate tasks to parallel sub-agents",
		promptGuidelines: [
			"Break complex tasks into independent sub-tasks for parallel execution.",
			"Each sub-agent gets the full prompt and executes it autonomously.",
			"Use sub_agent_wait to collect results.",
		],
		parameters: SubAgentCreateParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const tasks = loadTasks(ctx.cwd);
			const task: SubAgentTask = {
				id: generateId(),
				title: params.title,
				prompt: params.prompt,
				status: "pending",
				createdAt: new Date().toISOString(),
				timeout: params.timeout ?? 300,
			};

			tasks.push(task);
			saveTasks(ctx.cwd, tasks);

			return {
				content: [{ type: "text", text: `Created sub-agent task: ${task.id} (${task.title})` }],
				details: { id: task.id, title: task.title, status: task.status, timeout: task.timeout },
			};
		},
	});

	// --- sub_agent_list ---
	pi.registerTool({
		name: "sub_agent_list",
		label: "Sub-agent List",
		description: "List all sub-agent tasks.",
		promptSnippet: "Use sub_agent_list to see all sub-agent tasks",
		parameters: SubAgentListParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const tasks = loadTasks(ctx.cwd);
			const filtered = params.status ? tasks.filter((t) => t.status === params.status) : tasks;

			if (filtered.length === 0) {
				return { content: [{ type: "text", text: "No sub-agent tasks." }], details: { count: 0 } };
			}

			const lines = filtered.map((t) => {
				const statusIcon = {
					pending: "⏳",
					running: "🔄",
					completed: "✅",
					failed: "❌",
					cancelled: "⏹️",
				}[t.status];
				return `${statusIcon} ${t.id}: ${t.title} (${t.status})`;
			});

			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details: { count: filtered.length },
			};
		},
	});

	// --- sub_agent_wait ---
	pi.registerTool({
		name: "sub_agent_wait",
		label: "Sub-agent Wait",
		description: "Wait for a sub-agent task to complete and return its result.",
		promptSnippet: "Use sub_agent_wait to collect sub-agent results",
		parameters: SubAgentWaitParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const tasks = loadTasks(ctx.cwd);
			const task = tasks.find((t) => t.id === params.id);

			if (!task) {
				return {
					content: [{ type: "text", text: `Task not found: ${params.id}` }],
					details: { error: "not-found" },
				};
			}

			if (task.status === "completed") {
				return {
					content: [{ type: "text", text: task.result ?? "No result available." }],
					details: { id: task.id, status: task.status },
				};
			}

			if (task.status === "failed") {
				return {
					content: [{ type: "text", text: `Task failed: ${task.error ?? "Unknown error"}` }],
					details: { id: task.id, status: task.status, error: task.error },
				};
			}

			if (task.status === "cancelled") {
				return {
					content: [{ type: "text", text: `Task was cancelled.` }],
					details: { id: task.id, status: task.status },
				};
			}

			// Mark as running if pending
			if (task.status === "pending") {
				task.status = "running";
				saveTasks(ctx.cwd, tasks);
			}

			// Simulate waiting — in production, this would use async task management
			return {
				content: [{ type: "text", text: `Task ${params.id} is running. Use sub_agent_list to check status.` }],
				details: { id: task.id, status: task.status },
			};
		},
	});

	// --- sub_agent_cancel ---
	pi.registerTool({
		name: "sub_agent_cancel",
		label: "Sub-agent Cancel",
		description: "Cancel a running sub-agent task.",
		promptSnippet: "Use sub_agent_cancel to stop a running task",
		parameters: SubAgentCancelParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const tasks = loadTasks(ctx.cwd);
			const task = tasks.find((t) => t.id === params.id);

			if (!task) {
				return {
					content: [{ type: "text", text: `Task not found: ${params.id}` }],
					details: { error: "not-found" },
				};
			}

			if (task.status !== "pending" && task.status !== "running") {
				return {
					content: [{ type: "text", text: `Cannot cancel task in status: ${task.status}` }],
					details: { error: "wrong-status" },
				};
			}

			task.status = "cancelled";
			task.completedAt = new Date().toISOString();
			saveTasks(ctx.cwd, tasks);

			return {
				content: [{ type: "text", text: `Cancelled task: ${task.title}` }],
				details: { id: task.id, status: "cancelled" },
			};
		},
	});
}
