import { describe, expect, it } from "vitest";
import { actionCardPrompt, buildAgentActivity } from "./agent-os";
import type { ActionCardRecord } from "./app-types";
import type { TaskRun } from "../types";

function card(overrides: Partial<ActionCardRecord> = {}): ActionCardRecord {
	return {
		id: "card-git_uncommitted-abc",
		title: "检测到工作区存在未提交变动",
		summary: "检测到 73 个文件有未提交改动，建议审查后再继续",
		actionType: "git_uncommitted",
		payload: JSON.stringify({ changedFiles: 73, cwd: "/Users/huaan/openpi-next" }),
		status: "open",
		createdAt: "2026-10-11T12:12:09.183275+00:00",
		...overrides,
	};
}

function run(overrides: Partial<TaskRun> = {}): TaskRun {
	return {
		id: "run-1",
		taskId: "task-1",
		status: "succeeded",
		trigger: "scheduled",
		createdAt: "2026-10-11T13:00:00.000Z",
		startedAt: "2026-10-11T13:00:01.000Z",
		finishedAt: "2026-10-11T13:05:00.000Z",
		result: "构建通过",
		...overrides,
	};
}

describe("buildAgentActivity", () => {
	it("merges action cards and task runs in reverse chronological order", () => {
		const activity = buildAgentActivity([card()], [run()]);
		expect(activity).toHaveLength(2);
		// 13:05 的运行晚于 12:12 的卡片，必须排在前面。
		expect(activity[0].kind).toBe("run");
		expect(activity[0].label).toBe("任务运行 · succeeded");
		expect(activity[1].kind).toBe("card");
		expect(activity[1].label).toBe("检测到工作区存在未提交变动");
	});

	it("keeps the newest `limit` items only", () => {
		const runs = Array.from({ length: 5 }, (_, index) =>
			run({
				id: `run-${index}`,
				createdAt: `2026-10-11T1${index}:00:00.000Z`,
				startedAt: `2026-10-11T1${index}:00:00.000Z`,
				finishedAt: `2026-10-11T1${index}:30:00.000Z`,
			}),
		);
		const activity = buildAgentActivity([card()], runs, 3);
		expect(activity).toHaveLength(3);
		expect(activity.map((item) => item.id)).toEqual(["run-run-4", "run-run-3", "run-run-2"]);
	});

	it("falls back to error text when a run has no result", () => {
		const activity = buildAgentActivity(
			[],
			[run({ id: "run-failed", status: "failed", result: undefined, error: "exit 101" })],
		);
		expect(activity[0].detail).toBe("exit 101");
	});

	it("returns an empty list for empty input (no demo data)", () => {
		expect(buildAgentActivity([], [])).toEqual([]);
	});
});

describe("actionCardPrompt", () => {
	it("prefers the explicit prompt inside the JSON payload", () => {
		expect(actionCardPrompt(card({ payload: JSON.stringify({ prompt: "审查未提交变更" }) }))).toBe(
			"审查未提交变更",
		);
	});

	it("falls back to the summary when the payload has no prompt", () => {
		expect(actionCardPrompt(card())).toBe("检测到 73 个文件有未提交改动，建议审查后再继续");
	});

	it("survives a non-JSON payload", () => {
		expect(actionCardPrompt(card({ payload: "not json" }))).toBe(
			"检测到 73 个文件有未提交改动，建议审查后再继续",
		);
	});
});
