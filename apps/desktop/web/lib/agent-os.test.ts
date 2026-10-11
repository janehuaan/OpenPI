import { describe, expect, it } from "vitest";
import { actionCardPrompt, actionCardRepo, buildAgentActivity, buildCausalChain, formatClock } from "./agent-os";
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

describe("actionCardRepo", () => {
	it("reads the repo name from the payload cwd", () => {
		expect(actionCardRepo(card())).toBe("openpi-next");
	});

	it("tolerates a trailing slash and windows separators", () => {
		expect(actionCardRepo(card({ payload: JSON.stringify({ cwd: "/Users/huaan/macosvir/" }) }))).toBe(
			"macosvir",
		);
		expect(actionCardRepo(card({ payload: JSON.stringify({ cwd: "C:\\work\\demo" }) }))).toBe("demo");
	});

	it("returns an empty string when the payload has no usable cwd", () => {
		expect(actionCardRepo(card({ payload: JSON.stringify({ changedFiles: 3 }) }))).toBe("");
		expect(actionCardRepo(card({ payload: "not json" }))).toBe("");
	});
});

describe("formatClock", () => {
	it("renders HH:MM in the viewer's local time, not the raw UTC slice", () => {
		const iso = "2026-10-11T13:59:15.222266+00:00";
		// 卡片时间必须和「最近活动」时间线一致：都按浏览器本地时区渲染。
		// 此前卡片直接 `slice(11, 16)` 取 ISO 串 → 显示 UTC，和活动流差 8 小时。
		const d = new Date(iso);
		const expected = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
		expect(formatClock(iso)).toBe(expected);
		expect(formatClock(iso)).toMatch(/^\d{2}:\d{2}$/);
	});

	it("returns an empty string for missing or unparseable input", () => {
		expect(formatClock(undefined)).toBe("");
		expect(formatClock(null)).toBe("");
		expect(formatClock("not a date")).toBe("");
	});
});

describe("buildCausalChain", () => {
	it("builds the chain only from fields the system actually records", () => {
		const chain = buildCausalChain([card()], [run()]);
		expect(chain).toHaveLength(2);
		// 时间倒序：任务运行(13:05) 比卡片(12:12) 新
		expect(chain[0].id).toBe("run-run-1");
		expect(chain[1].id).toBe("card-card-git_uncommitted-abc");

		const fromRun = chain[0];
		expect(fromRun.observed).toBe("任务运行 · succeeded");
		expect(fromRun.understood).toContain("计划调度");
		expect(fromRun.action).toBe("启动执行进程（未记录 PID）");
		expect(fromRun.result).toBe("构建通过");

		const fromCard = chain[1];
		expect(fromCard.observed).toBe("检测到工作区存在未提交变动");
		expect(fromCard.understood).toContain("73 个文件");
		expect(fromCard.pending).toBe(true);
		expect(fromCard.learned).toBeUndefined();
	});

	it("reflects the card's real status instead of a fixed story", () => {
		const acted = buildCausalChain([card({ status: "acted" })])[0];
		expect(acted.pending).toBe(false);
		expect(acted.decision).toContain("统一网关");
		expect(acted.action).toContain("git_uncommitted");

		const dismissed = buildCausalChain([card({ status: "dismissed" })])[0];
		expect(dismissed.action).toBe("未执行任何动作");
		expect(dismissed.result).toContain("已忽略");
	});

	it("surfaces a failed run's error rather than its status", () => {
		const failed = buildCausalChain([], [run({ status: "failed", error: "exit code 1" })])[0];
		expect(failed.result).toBe("失败：exit code 1");
	});

	it("returns nothing when there is no real activity (no demo fallback)", () => {
		expect(buildCausalChain()).toEqual([]);
		expect(buildCausalChain([], [], 5)).toEqual([]);
	});

	it("honours the limit after sorting by recency", () => {
		const many = [1, 2, 3].map((i) =>
			card({ id: `c${i}`, createdAt: `2026-10-11T1${i}:00:00.000Z` }),
		);
		const chain = buildCausalChain(many, [], 2);
		expect(chain.map((e) => e.id)).toEqual(["card-c3", "card-c2"]);
	});
});
