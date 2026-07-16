/**
 * Tasks Extension - Structured task tracking with priorities, labels, and status.
 *
 * This extension:
 * - Registers a `tasks` tool for the LLM to manage structured tasks
 * - Registers a `/tasks` command for users to view the current task list
 * - Persists state via session entries for proper fork/branch support
 *
 * Usage:
 *   pi --extension examples/extensions/tasks.ts
 */

import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, Text, truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";

// ============================================================================
// Types
// ============================================================================

interface Task {
	id: number;
	title: string;
	description: string;
	priority: "high" | "medium" | "low";
	labels: string[];
	status: "pending" | "in_progress" | "done" | "cancelled";
	completed_note?: string;
}

interface TasksDetails {
	action: "list" | "create" | "update" | "complete" | "delete" | "clear";
	tasks: Task[];
	nextId: number;
	filter?: { priority?: string; status?: string; label?: string };
	error?: string;
}

// ============================================================================
// Schema
// ============================================================================

const TasksParams = Type.Object({
	action: StringEnum(["list", "create", "update", "complete", "delete", "clear"] as const),
	title: Type.Optional(Type.String({ description: "Task title (required for create)" })),
	description: Type.Optional(Type.String({ description: "Task description (optional for create/update)" })),
	id: Type.Optional(Type.Number({ description: "Task ID (required for update/complete/delete)" })),
	priority: Type.Optional(StringEnum(["high", "medium", "low"] as const)),
	labels: Type.Optional(
		Type.Array(Type.String(), { description: "Labels for the task (comma-separated, for create/update)" }),
	),
	status: Type.Optional(StringEnum(["pending", "in_progress", "done", "cancelled"] as const)),
	completed_note: Type.Optional(Type.String({ description: "Note when completing a task" })),
	filter_priority: Type.Optional(StringEnum(["high", "medium", "low"] as const)),
	filter_status: Type.Optional(StringEnum(["pending", "in_progress", "done", "cancelled"] as const)),
	filter_label: Type.Optional(Type.String()),
});

// ============================================================================
// UI Components
// ============================================================================

class TasksListComponent {
	private tasks: Task[];
	private theme: Theme;
	private onClose: () => void;
	private cachedWidth?: number;
	private cachedLines?: string[];

	constructor(tasks: Task[], theme: Theme, onClose: () => void) {
		this.tasks = tasks;
		this.theme = theme;
		this.onClose = onClose;
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
			this.onClose();
		}
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) {
			return this.cachedLines;
		}

		const lines: string[] = [];
		const th = this.theme;
		const pending = this.tasks.filter((t) => t.status !== "done" && t.status !== "cancelled");
		const done = this.tasks.filter((t) => t.status === "done");

		lines.push("");
		const title = th.fg("accent", " Tasks ");
		const headerLine =
			th.fg("borderMuted", "─".repeat(3)) + title + th.fg("borderMuted", "─".repeat(Math.max(0, width - 8)));
		lines.push(truncateToWidth(headerLine, width));
		lines.push("");

		if (this.tasks.length === 0) {
			lines.push(truncateToWidth(`  ${th.fg("dim", "No tasks yet. Use the tasks tool to create some.")}`, width));
		} else {
			if (pending.length > 0) {
				lines.push(th.fg("muted", "Pending:"));
				for (const task of pending) {
					const icon = task.status === "in_progress" ? th.fg("accent", "▶") : th.fg("dim", "○");
					const prio =
						task.priority === "high"
							? th.fg("error", "H")
							: task.priority === "medium"
								? th.fg("warning", "M")
								: th.fg("muted", "L");
					const statusText =
						task.status === "in_progress" ? th.fg("accent", "[in progress]") : th.fg("dim", "[pending]");
					lines.push(
						truncateToWidth(`  ${icon} ${prio} #${task.id} ${statusText} ${th.fg("text", task.title)}`, width),
					);
					if (task.labels.length > 0) {
						lines.push(truncateToWidth(`    ${th.fg("muted", `labels: ${task.labels.join(", ")}`)}`, width));
					}
				}
				lines.push("");
			}

			if (done.length > 0) {
				lines.push(th.fg("muted", "Completed:"));
				for (const task of done.slice(0, 5)) {
					lines.push(truncateToWidth(`  ${th.fg("success", "✓")} #${task.id} ${th.fg("dim", task.title)}`, width));
				}
				if (done.length > 5) {
					lines.push(truncateToWidth(`  ... ${done.length - 5} more`, width));
				}
				lines.push("");
			}
		}

		lines.push(truncateToWidth(`  ${th.fg("dim", "Press Escape to close")}`, width));
		lines.push("");

		this.cachedWidth = width;
		this.cachedLines = lines;
		return lines;
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}
}

// ============================================================================
// Extension
// ============================================================================

export default function (pi: ExtensionAPI) {
	let tasks: Task[] = [];
	let nextId = 1;

	const reconstructState = (ctx: ExtensionContext) => {
		tasks = [];
		nextId = 1;

		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "message") continue;
			const msg = entry.message;
			if (msg.role !== "toolResult" || msg.toolName !== "tasks") continue;

			const details = msg.details as TasksDetails | undefined;
			if (details?.tasks) {
				tasks = details.tasks;
				nextId = details.nextId;
			}
		}
	};

	pi.on("session_start", async (_event, ctx) => reconstructState(ctx));
	pi.on("session_tree", async (_event, ctx) => reconstructState(ctx));

	pi.registerTool({
		name: "tasks",
		label: "Tasks",
		description:
			"Manage structured tasks with priorities (high/medium/low), labels, and status tracking. Actions: list, create, update, complete, delete, clear.",
		promptGuidelines: [
			"Use tasks to track multi-step work. Create tasks before starting complex operations.",
			"Mark tasks as in_progress when you start working on them, done when finished.",
			"Use labels to group related tasks (e.g., 'bugfix', 'feature', 'refactor').",
		],
		parameters: TasksParams,

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			switch (params.action) {
				case "list": {
					let filtered = [...tasks];
					if (params.filter_priority) {
						filtered = filtered.filter((t) => t.priority === params.filter_priority);
					}
					if (params.filter_status) {
						filtered = filtered.filter((t) => t.status === params.filter_status);
					}
					if (params.filter_label) {
						filtered = filtered.filter((t) => t.labels.includes(params.filter_label!));
					}

					if (filtered.length === 0) {
						return {
							content: [
								{
									type: "text",
									text: tasks.length === 0 ? "No tasks created yet." : "No tasks match the given filters.",
								},
							],
							details: {
								action: "list",
								tasks: [],
								nextId,
								filter:
									params.filter_priority || params.filter_status || params.filter_label
										? {
												priority: params.filter_priority,
												status: params.filter_status,
												label: params.filter_label,
											}
										: undefined,
							} satisfies TasksDetails,
						};
					}

					const lines = filtered
						.map((t) => {
							const prio = t.priority === "high" ? "H" : t.priority === "medium" ? "M" : "L";
							const status = t.status === "in_progress" ? "[in progress]" : "[pending]";
							return `#${t.id} [${prio}] ${status} ${t.title}${t.labels.length > 0 ? ` (${t.labels.join(", ")})` : ""}`;
						})
						.join("\n");

					return {
						content: [{ type: "text", text: lines }],
						details: {
							action: "list",
							tasks: filtered,
							nextId,
							filter:
								params.filter_priority || params.filter_status || params.filter_label
									? {
											priority: params.filter_priority,
											status: params.filter_status,
											label: params.filter_label,
										}
									: undefined,
						} satisfies TasksDetails,
					};
				}

				case "create": {
					if (!params.title) {
						return {
							content: [{ type: "text", text: "Error: title is required for create action." }],
							details: {
								action: "create",
								tasks: [...tasks],
								nextId,
								error: "title required",
							} satisfies TasksDetails,
						};
					}

					const newTask: Task = {
						id: nextId++,
						title: params.title,
						description: params.description ?? "",
						priority: params.priority ?? "medium",
						labels: params.labels ?? [],
						status: "pending",
					};
					tasks.push(newTask);

					return {
						content: [
							{ type: "text", text: `Created task #${newTask.id}: ${newTask.title} [${newTask.priority}]` },
						],
						details: { action: "create", tasks: [...tasks], nextId } satisfies TasksDetails,
					};
				}

				case "update": {
					if (params.id === undefined) {
						return {
							content: [{ type: "text", text: "Error: id is required for update action." }],
							details: {
								action: "update",
								tasks: [...tasks],
								nextId,
								error: "id required",
							} satisfies TasksDetails,
						};
					}

					const task = tasks.find((t) => t.id === params.id);
					if (!task) {
						return {
							content: [{ type: "text", text: `Task #${params.id} not found.` }],
							details: {
								action: "update",
								tasks: [...tasks],
								nextId,
								error: `#${params.id} not found`,
							} satisfies TasksDetails,
						};
					}

					const changes: string[] = [];
					if (params.title) {
						task.title = params.title;
						changes.push(`title -> ${params.title}`);
					}
					if (params.description) {
						task.description = params.description;
						changes.push("description updated");
					}
					if (params.priority) {
						task.priority = params.priority;
						changes.push(`priority -> ${params.priority}`);
					}
					if (params.labels) {
						task.labels = params.labels;
						changes.push(`labels -> ${params.labels.join(", ")}`);
					}

					return {
						content: [{ type: "text", text: `Updated task #${task.id}: ${changes.join("; ")}` }],
						details: { action: "update", tasks: [...tasks], nextId } satisfies TasksDetails,
					};
				}

				case "complete": {
					if (params.id === undefined) {
						return {
							content: [{ type: "text", text: "Error: id is required for complete action." }],
							details: {
								action: "complete",
								tasks: [...tasks],
								nextId,
								error: "id required",
							} satisfies TasksDetails,
						};
					}

					const task = tasks.find((t) => t.id === params.id);
					if (!task) {
						return {
							content: [{ type: "text", text: `Task #${params.id} not found.` }],
							details: {
								action: "complete",
								tasks: [...tasks],
								nextId,
								error: `#${params.id} not found`,
							} satisfies TasksDetails,
						};
					}

					task.status = "done";
					task.completed_note = params.completed_note;

					return {
						content: [
							{
								type: "text",
								text: `Completed task #${task.id}: ${task.title}${params.completed_note ? ` (${params.completed_note})` : ""}`,
							},
						],
						details: { action: "complete", tasks: [...tasks], nextId } satisfies TasksDetails,
					};
				}

				case "delete": {
					if (params.id === undefined) {
						return {
							content: [{ type: "text", text: "Error: id is required for delete action." }],
							details: {
								action: "delete",
								tasks: [...tasks],
								nextId,
								error: "id required",
							} satisfies TasksDetails,
						};
					}

					const idx = tasks.findIndex((t) => t.id === params.id);
					if (idx === -1) {
						return {
							content: [{ type: "text", text: `Task #${params.id} not found.` }],
							details: {
								action: "delete",
								tasks: [...tasks],
								nextId,
								error: `#${params.id} not found`,
							} satisfies TasksDetails,
						};
					}

					const removed = tasks.splice(idx, 1)[0];
					return {
						content: [{ type: "text", text: `Deleted task #${removed.id}: ${removed.title}` }],
						details: { action: "delete", tasks: [...tasks], nextId } satisfies TasksDetails,
					};
				}

				case "clear": {
					const count = tasks.length;
					tasks = [];
					nextId = 1;
					return {
						content: [{ type: "text", text: `Cleared all ${count} tasks.` }],
						details: { action: "clear", tasks: [], nextId: 1 } satisfies TasksDetails,
					};
				}

				default:
					return {
						content: [{ type: "text", text: `Unknown action: ${params.action}` }],
						details: {
							action: "list",
							tasks: [...tasks],
							nextId,
							error: `unknown action: ${params.action}`,
						} satisfies TasksDetails,
					};
			}
		},

		renderCall(args, theme, _context) {
			let text = theme.fg("toolTitle", theme.bold("tasks ")) + theme.fg("muted", args.action);
			if (args.title) text += ` ${theme.fg("dim", `"${args.title}"`)}`;
			if (args.id !== undefined) text += ` ${theme.fg("accent", `#${args.id}`)}`;
			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded }, theme, _context) {
			const details = result.details as TasksDetails | undefined;
			if (!details) {
				const text = result.content[0];
				return new Text(text?.type === "text" ? text.text : "", 0, 0);
			}

			if (details.error) {
				return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);
			}

			switch (details.action) {
				case "list": {
					if (details.tasks.length === 0) {
						return new Text(theme.fg("dim", "No tasks"), 0, 0);
					}
					const display = expanded ? details.tasks : details.tasks.slice(0, 5);
					let listText = theme.fg("muted", `${details.tasks.length} task(s):`);
					for (const t of display) {
						const prio =
							t.priority === "high"
								? theme.fg("error", "H")
								: t.priority === "medium"
									? theme.fg("warning", "M")
									: theme.fg("muted", "L");
						const status =
							t.status === "done"
								? theme.fg("success", "✓")
								: t.status === "in_progress"
									? theme.fg("accent", "▶")
									: theme.fg("dim", "○");
						const titleText = t.status === "done" ? theme.fg("dim", t.title) : theme.fg("text", t.title);
						listText += `\n${status} ${prio} #${t.id} ${titleText}`;
					}
					if (!expanded && details.tasks.length > 5) {
						listText += `\n${theme.fg("dim", `... ${details.tasks.length - 5} more`)}`;
					}
					return new Text(listText, 0, 0);
				}

				case "create": {
					const added = details.tasks[details.tasks.length - 1];
					return new Text(
						theme.fg("success", "✓ Created ") +
							theme.fg("accent", `#${added.id}`) +
							" " +
							theme.fg("text", added.title),
						0,
						0,
					);
				}

				case "update":
				case "complete": {
					const text = result.content[0];
					return new Text(
						theme.fg("success", "✓ ") + theme.fg("muted", text?.type === "text" ? text.text : ""),
						0,
						0,
					);
				}

				case "delete": {
					const text = result.content[0];
					return new Text(theme.fg("muted", text?.type === "text" ? text.text : ""), 0, 0);
				}

				case "clear":
					return new Text(theme.fg("success", "✓ Cleared all tasks"), 0, 0);
			}
		},
	});

	// Register /tasks command
	pi.registerCommand("tasks", {
		description: "Show all tasks in a list view",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/tasks requires interactive mode", "error");
				return;
			}

			await ctx.ui.custom<void>((_tui, theme, _kb, done) => {
				return new TasksListComponent(tasks, theme, () => done());
			});
		},
	});
}
