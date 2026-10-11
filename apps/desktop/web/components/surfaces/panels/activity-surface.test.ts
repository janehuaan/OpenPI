import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ActivitySurface } from "./activity-surface";
import type { TaskRun } from "../../../types";

const noop = () => {};

describe("ActivitySurface causal timeline", () => {
	it("renders the real chain, never the old hardcoded demo events", () => {
		const html = renderToStaticMarkup(createElement(ActivitySurface, { onRefresh: noop }));
		expect(html).toContain("Agent Causal Chain");
		// 旧演示数据（写死的三条因果事件）必须彻底消失
		expect(html).not.toContain("溯源完整");
		expect(html).not.toContain("第三方模型独立评审机制被调用");
		expect(html).not.toContain("22:45");
	});

	it("renders a real task run as a causal entry", () => {
		const run: TaskRun = {
			id: "r1",
			taskId: "task-9",
			status: "succeeded",
			trigger: "scheduled",
			createdAt: "2026-10-11T13:00:00.000Z",
			result: "构建通过",
		};
		const html = renderToStaticMarkup(
			createElement(ActivitySurface, { onRefresh: noop, taskRuns: [run] }),
		);
		expect(html).toContain("任务运行 · succeeded");
		expect(html).toContain("构建通过");
		expect(html).toContain("✓ 已记录");
		// 系统没有沉淀学习结论的那一步要如实标注，而不是编一句话
		expect(html).toContain("未记录（系统暂不按事件沉淀学习结论）");
	});
});
