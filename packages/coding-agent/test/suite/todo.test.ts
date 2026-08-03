import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import type { ExtensionContext } from "../../src/core/extensions/types.ts";
import {
	createCompleteStepToolDefinition,
	createTodoListToolDefinition,
	createTodoWriteToolDefinition,
	formatTodos,
	loadTodoState,
} from "../../src/core/tools/todo.ts";

const tmpDirs: string[] = [];

function makeCtx(cwd: string): ExtensionContext {
	return {
		cwd,
		sessionManager: {
			getSessionId: () => "test-session",
		},
	} as unknown as ExtensionContext;
}

function makeTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "todo-test-"));
	tmpDirs.push(dir);
	return dir;
}

function findTool(name: "todo_write" | "todo_list" | "complete_step") {
	if (name === "todo_write") return createTodoWriteToolDefinition();
	if (name === "todo_list") return createTodoListToolDefinition();
	return createCompleteStepToolDefinition();
}

async function runTool(name: "todo_write" | "todo_list" | "complete_step", cwd: string, params: unknown) {
	const tool = findTool(name);
	return tool.execute("call-1", params as never, undefined, undefined, makeCtx(cwd));
}

afterEach(() => {
	for (const dir of tmpDirs) {
		rmSync(dir, { recursive: true, force: true });
	}
	tmpDirs.length = 0;
});

function textOf(result: Awaited<ReturnType<typeof runTool>>): string {
	const parts = result.content.filter((part) => part.type === "text");
	return parts.map((part) => part.text).join("\n");
}

describe("todo tools", () => {
	it("todo_write replaces the list and promotes the first pending item", async () => {
		const cwd = makeTempDir();
		const result = await runTool("todo_write", cwd, {
			todos: [
				{ content: "Phase one", level: 0 },
				{ content: "Sub step", level: 1 },
				{ content: "Phase two", level: 0, status: "completed" },
			],
		});

		const text = textOf(result);
		expect(text).toContain("Task list updated");
		expect(text).toContain("1. [in_progress] Phase one");

		const state = loadTodoState(cwd)!;
		expect(state.sessionId).toBe("test-session");
		expect(state.todos[0].status).toBe("in_progress");
		expect(state.todos[1].status).toBe("pending");
		expect(state.todos[2].status).toBe("completed");
	});

	it("todo_list returns the formatted list", async () => {
		const cwd = makeTempDir();
		await runTool("todo_write", cwd, {
			todos: [
				{ content: "A", level: 0 },
				{ content: "B", level: 0 },
			],
		});

		const result = await runTool("todo_list", cwd, {});
		expect(textOf(result)).toContain("1. [in_progress] A");
		expect(textOf(result)).toContain("2. [pending] B");
	});

	it("todo_list returns a marker when no list exists", async () => {
		const cwd = makeTempDir();
		const result = await runTool("todo_list", cwd, {});
		expect(textOf(result)).toContain("no task list");
	});

	it("complete_step rejects without evidence", async () => {
		const cwd = makeTempDir();
		await runTool("todo_write", cwd, { todos: [{ content: "Do thing", level: 0 }] });

		const result = await runTool("complete_step", cwd, {
			step: "1",
			result: "done",
			evidence: [],
		});
		expect(textOf(result)).toContain("Rejected");
		expect(loadTodoState(cwd)!.todos[0].status).toBe("in_progress");
	});

	it("complete_step marks done with evidence and advances the next pending", async () => {
		const cwd = makeTempDir();
		await runTool("todo_write", cwd, {
			todos: [
				{ content: "First", level: 0 },
				{ content: "Second", level: 0 },
			],
		});

		const result = await runTool("complete_step", cwd, {
			step: "1",
			result: "First is done",
			evidence: [{ kind: "verification", summary: "Ran the tests", command: "npm run check" }],
		});
		const text = textOf(result);
		expect(text).toContain("Completed: First");
		expect(text).toContain("Remaining: 1");

		const state = loadTodoState(cwd)!;
		expect(state.todos[0].status).toBe("completed");
		expect(state.todos[0].result).toBe("First is done");
		expect(state.todos[0].evidence).toHaveLength(1);
		expect(state.todos[1].status).toBe("in_progress");
	});

	it("complete_step matches numbered sub-steps (2.1)", async () => {
		const cwd = makeTempDir();
		await runTool("todo_write", cwd, {
			todos: [
				{ content: "Phase A", level: 0 },
				{ content: "Phase B", level: 0 },
				{ content: "Sub B1", level: 1 },
			],
		});

		const result = await runTool("complete_step", cwd, {
			step: "2.1",
			result: "Sub done",
			evidence: [{ kind: "manual", summary: "Checked by hand" }],
		});
		expect(textOf(result)).toContain("Completed: Sub B1");
		expect(loadTodoState(cwd)!.todos[2].status).toBe("completed");
	});

	it("complete_step reports no match for unknown steps", async () => {
		const cwd = makeTempDir();
		await runTool("todo_write", cwd, { todos: [{ content: "Only", level: 0 }] });

		const result = await runTool("complete_step", cwd, {
			step: "9",
			result: "nope",
			evidence: [{ kind: "manual", summary: "x" }],
		});
		expect(textOf(result)).toContain("No matching task step");
	});

	it("persists to <cwd>/.pi/todos/current.json", async () => {
		const cwd = makeTempDir();
		await runTool("todo_write", cwd, { todos: [{ content: "Persisted" }] });
		expect(existsSync(join(cwd, ".pi", "todos", "current.json"))).toBe(true);
		const raw = JSON.parse(readFileSync(join(cwd, ".pi", "todos", "current.json"), "utf8")) as {
			todos: Array<{ content: string }>;
		};
		expect(raw.todos[0].content).toBe("Persisted");
	});

	it("formatTodos renders level-1 items with parent numbering", async () => {
		const cwd = makeTempDir();
		await runTool("todo_write", cwd, {
			todos: [
				{ content: "Top", level: 0 },
				{ content: "Child", level: 1 },
				{ content: "Child2", level: 1 },
				{ content: "Top2", level: 0 },
			],
		});
		const state = loadTodoState(cwd)!;
		const text = formatTodos(state);
		expect(text).toContain("1. [in_progress] Top");
		expect(text).toContain("  1.1. [pending] Child");
		expect(text).toContain("  1.2. [pending] Child2");
		expect(text).toContain("2. [pending] Top2");
	});
});
