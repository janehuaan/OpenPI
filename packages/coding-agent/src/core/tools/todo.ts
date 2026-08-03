/**
 * Task list tools (built-in).
 *
 * Give the agent a structured, persistent task list with completion
 * evidence — the same shape as host-side task boards:
 *
 * - `todo_write`: replace the whole task list (levels 0/1, status, activeForm)
 * - `todo_list`: show the current task list
 * - `complete_step`: mark one step done, requiring at least one evidence item
 *   (verification command, review, diff, files, or manual check). Without
 *   evidence the step is rejected.
 *
 * State lives in `<cwd>/.pi/todos/current.json` so it survives restarts and
 * is visible to the desktop UI. The list is injected into the system prompt
 * whenever it changes (see agent-session `_rebuildSystemPrompt`).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";

export type TodoStatus = "pending" | "in_progress" | "completed";

export interface TodoEvidence {
	kind: "verification" | "review" | "diff" | "files" | "manual";
	summary: string;
	command?: string;
	paths?: string[];
}

export interface TodoItem {
	content: string;
	status: TodoStatus;
	activeForm?: string;
	level?: 0 | 1;
	result?: string;
	evidence?: TodoEvidence[];
}

export interface TodoState {
	updatedAt: string;
	sessionId?: string;
	todos: TodoItem[];
}

export function todoFilePath(cwd: string): string {
	return join(cwd, ".pi", "todos", "current.json");
}

export function loadTodoState(cwd: string): TodoState | undefined {
	const file = todoFilePath(cwd);
	if (!existsSync(file)) return undefined;
	try {
		return JSON.parse(readFileSync(file, "utf8")) as TodoState;
	} catch {
		return undefined;
	}
}

export function saveTodoState(cwd: string, state: TodoState): void {
	const file = todoFilePath(cwd);
	mkdirSync(join(file, ".."), { recursive: true });
	writeFileSync(file, JSON.stringify(state, null, "\t"));
}

/** Format the task list for prompts and tool results (reasonix-style numbering). */
export function formatTodos(state: TodoState | undefined): string {
	if (!state || state.todos.length === 0) return "(no task list)";
	const lines: string[] = [];
	let topIndex = 0;
	for (let i = 0; i < state.todos.length; i++) {
		const item = state.todos[i];
		if (item.level === 1) {
			// Number as <parent top number>.<sub index within parent>.
			let parentTop = 0;
			let subIndex = 0;
			for (let j = 0; j <= i; j++) {
				if (state.todos[j].level !== 1) {
					parentTop += 1;
					subIndex = 0;
				} else {
					subIndex += 1;
				}
			}
			lines.push(`  ${parentTop}.${subIndex}. [${item.status}] ${item.content}`);
		} else {
			topIndex += 1;
			lines.push(`${topIndex}. [${item.status}] ${item.content}`);
		}
	}
	return lines.join("\n");
}

const EvidenceSchema = Type.Array(
	Type.Object({
		kind: Type.Union([
			Type.Literal("verification"),
			Type.Literal("review"),
			Type.Literal("diff"),
			Type.Literal("files"),
			Type.Literal("manual"),
		]),
		summary: Type.String({ description: "What the evidence proves" }),
		command: Type.Optional(Type.String({ description: "Command that actually ran (for verification)" })),
		paths: Type.Optional(
			Type.Array(Type.String(), { description: "Files this evidence refers to (for diff/files)" }),
		),
	}),
);

const TodoItemSchema = Type.Object({
	content: Type.String({ description: "Imperative description of the task" }),
	status: Type.Optional(Type.Union([Type.Literal("pending"), Type.Literal("in_progress"), Type.Literal("completed")])),
	activeForm: Type.Optional(Type.String({ description: "Present-continuous form shown while in progress" })),
	level: Type.Optional(Type.Union([Type.Literal(0), Type.Literal(1)], { description: "0 = phase, 1 = sub-step" })),
});

const TodoWriteParams = Type.Object({
	todos: Type.Array(TodoItemSchema, { description: "Complete new task list (replaces any previous list)" }),
});

const TodoListParams = Type.Object({});

const CompleteStepParams = Type.Object({
	step: Type.String({ description: 'Step to complete: its number ("2" or "2.1") or exact title' }),
	result: Type.String({ description: "What is now true as a result of finishing this step" }),
	evidence: EvidenceSchema,
	notes: Type.Optional(Type.String()),
});

function textResult(text: string): AgentToolResult<undefined> {
	return { content: [{ type: "text", text }], details: undefined };
}

function findStepIndex(state: TodoState, step: string): number {
	// Number form: "2" or "2.1" (level-1 numbering is parentTop.subIndex).
	const numberMatch = step.match(/^(\d+)(?:\.(\d+))?$/);
	if (numberMatch) {
		const targetTop = Number(numberMatch[1]);
		const targetSub = numberMatch[2] === undefined ? undefined : Number(numberMatch[2]);
		let topIndex = 0;
		let subIndex = 0;
		for (let i = 0; i < state.todos.length; i++) {
			const item = state.todos[i];
			if (item.level === 1) {
				subIndex += 1;
				if (targetSub !== undefined && topIndex === targetTop && subIndex === targetSub) return i;
			} else {
				topIndex += 1;
				subIndex = 0;
				if (targetSub === undefined && topIndex === targetTop) return i;
			}
		}
		return -1;
	}
	// Exact title match, then prefix match.
	const exact = state.todos.findIndex((item) => item.content === step);
	if (exact !== -1) return exact;
	return state.todos.findIndex((item) => item.content.startsWith(step));
}

/** After completing `index`, promote the next pending item at the same level. */
function advanceNextPending(state: TodoState, index: number): void {
	const completedLevel = state.todos[index].level ?? 0;
	for (let i = index + 1; i < state.todos.length; i++) {
		const item = state.todos[i];
		if ((item.level ?? 0) !== completedLevel) continue;
		if (item.status === "pending") {
			item.status = "in_progress";
			return;
		}
	}
}

export function createTodoWriteToolDefinition(): ToolDefinition<typeof TodoWriteParams, undefined> {
	return {
		name: "todo_write",
		label: "Task List",
		description:
			"Replace the entire task list with a new structured list. Use levels 0 (phase) and 1 (sub-step), keep exactly one item in_progress, and flip items to completed as they finish. Returns the formatted list.",
		promptSnippet: "Maintain a structured task list",
		promptGuidelines: [
			"Plan multi-step work with todo_write before starting: phases (level 0) with concrete sub-steps (level 1).",
			"Keep exactly one item in_progress; send the complete list on every update.",
		],
		parameters: TodoWriteParams,
		execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
			const todos: TodoItem[] = params.todos.map((item) => ({
				content: item.content,
				status: item.status ?? "pending",
				activeForm: item.activeForm,
				level: item.level,
			}));
			const state: TodoState = {
				updatedAt: new Date().toISOString(),
				sessionId: ctx.sessionManager.getSessionId(),
				todos,
			};
			if (todos.filter((item) => item.status === "in_progress").length === 0) {
				const first = todos.find((item) => item.status === "pending");
				if (first) first.status = "in_progress";
			}
			saveTodoState(ctx.cwd, state);
			return textResult(`Task list updated.\n\n${formatTodos(state)}`);
		},
	};
}

export function createTodoListToolDefinition(): ToolDefinition<typeof TodoListParams, undefined> {
	return {
		name: "todo_list",
		label: "Task List",
		description: "Show the current task list with statuses.",
		promptSnippet: "Show the current task list",
		parameters: TodoListParams,
		execute: async (_toolCallId, _params, _signal, _onUpdate, ctx) => {
			return textResult(formatTodos(loadTodoState(ctx.cwd)));
		},
	};
}

export function createCompleteStepToolDefinition(): ToolDefinition<typeof CompleteStepParams, undefined> {
	return {
		name: "complete_step",
		label: "Complete Step",
		description:
			"Mark one step of the task list as completed. Requires at least one evidence item proving the step is done (verification = a command that ran, review = a completed review, diff = code changes, files = files created/edited, manual = a manual check). Without evidence the step is rejected.",
		promptSnippet: "Complete a task step with evidence",
		promptGuidelines: [
			"complete_step requires evidence: cite the verification command you ran, the diff you made, or a manual check. Never mark a step completed without proof.",
			"After completing a step, the next pending item automatically becomes in_progress.",
		],
		parameters: CompleteStepParams,
		execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
			const state = loadTodoState(ctx.cwd);
			if (!state || state.todos.length === 0) {
				return textResult("No task list exists. Create one with todo_write first.");
			}
			if (params.evidence.length === 0) {
				return textResult(
					"Rejected: complete_step requires at least one evidence item (kind + summary). Provide the verification command, diff, review, files, or manual check that proves this step is done.",
				);
			}
			const index = findStepIndex(state, params.step);
			if (index === -1) {
				return textResult(`No matching task step for "${params.step}". Current list:\n\n${formatTodos(state)}`);
			}
			const item = state.todos[index];
			item.status = "completed";
			item.result = params.result;
			item.evidence = params.evidence;
			advanceNextPending(state, index);
			state.updatedAt = new Date().toISOString();
			saveTodoState(ctx.cwd, state);
			const remaining = state.todos.filter((todo) => todo.status !== "completed").length;
			return textResult(
				`Completed: ${item.content}\nRemaining: ${remaining} item(s) not completed.\n\n${formatTodos(state)}`,
			);
		},
	};
}
