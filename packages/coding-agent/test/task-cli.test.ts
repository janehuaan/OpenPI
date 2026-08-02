import { afterEach, describe, expect, it, vi } from "vitest";
import { handleTaskCommand, type TaskCliDependencies } from "../src/task-cli.ts";

function dependencies(responses: Array<unknown | Error>): TaskCliDependencies & { calls: string[][]; starts: number } {
	return {
		calls: [],
		starts: 0,
		async runOrchestrator(args) {
			this.calls.push(args);
			const response = responses.shift();
			if (response instanceof Error) throw response;
			return response as Awaited<ReturnType<TaskCliDependencies["runOrchestrator"]>>;
		},
		async startOrchestrator() {
			this.starts++;
		},
	};
}

describe("task CLI", () => {
	afterEach(() => vi.restoreAllMocks());

	it("does not handle unrelated commands", async () => {
		const deps = dependencies([]);
		expect(await handleTaskCommand(["--version"], deps)).toBe(false);
		expect(deps.calls).toEqual([]);
	});

	it("maps task creation to the orchestrator", async () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
		const deps = dependencies([
			{
				ok: true,
				task: {
					id: "task-1",
					title: "Review",
					prompt: "Review repo",
					status: "active",
					schedule: { kind: "once", runAt: "2026-07-20T09:00:00Z" },
					nextRunAt: "2026-07-20T09:00:00.000Z",
				},
			},
		]);

		expect(
			await handleTaskCommand(
				["task", "create", "--title", "Review", "--prompt", "Review repo", "--at", "2026-07-20T09:00:00Z"],
				deps,
			),
		).toBe(true);
		expect(deps.calls[0]).toEqual([
			"task",
			"create",
			"--title",
			"Review",
			"--prompt",
			"Review repo",
			"--at",
			"2026-07-20T09:00:00Z",
		]);
		expect(log).toHaveBeenCalled();
	});

	it("starts the daemon when the socket is unavailable", async () => {
		vi.spyOn(console, "log").mockImplementation(() => undefined);
		const deps = dependencies([new Error("connect ENOENT orchestrator.sock"), { ok: true, tasks: [] }]);

		await handleTaskCommand(["task", "list"], deps);
		expect(deps.starts).toBe(1);
		expect(deps.calls).toHaveLength(2);
	});

	it("maps cancellation to a run id", async () => {
		vi.spyOn(console, "log").mockImplementation(() => undefined);
		const deps = dependencies([
			{
				ok: true,
				run: {
					id: "run-1",
					taskId: "task-1",
					status: "cancelled",
					trigger: "manual",
					createdAt: "2026-07-19T12:00:00Z",
				},
			},
		]);

		await handleTaskCommand(["task", "cancel", "run-1"], deps);
		expect(deps.calls[0]).toEqual(["task", "cancel", "run-1"]);
	});
});
