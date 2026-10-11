import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TurnProgressRow } from "./turn-progress-row";
import { initialTurnProgress } from "../../../lib/turn-progress";

/**
 * 进度条是「用户判断 Agent 是不是卡住了」的唯一界面，所以这里不只测 reducer，
 * 还真的把它渲染一遍（`react-dom/server`，无需 jsdom / 新依赖），
 * 确保工具调用次数、无响应时长、护栏提示三块都真的出现在 DOM 里。
 */
describe("TurnProgressRow", () => {
	it("shows the tool-call count and the last-activity age", () => {
		const progress = {
			...initialTurnProgress("one", Date.now() - 30_000),
			stage: "tool" as const,
			toolName: "bash",
			toolCount: 8,
			lastEventAt: Date.now() - 12_000,
		};
		const html = renderToStaticMarkup(createElement(TurnProgressRow, { progress, isWorking: true }));
		expect(html).toContain("Executing...");
		expect(html).toContain("第 8 次工具调用");
		expect(html).toMatch(/\d+s 无响应/);
	});

	it("renders the engine guard notice when the budget is burning down", () => {
		const progress = {
			...initialTurnProgress("one"),
			toolCount: 40,
			lastEventAt: Date.now(),
			guardMessage: "本轮已执行 40 次工具调用，Agent 正在收敛",
		};
		const html = renderToStaticMarkup(createElement(TurnProgressRow, { progress, isWorking: true }));
		expect(html).toContain("agent-runtime-guard");
		expect(html).toContain("本轮已执行 40 次工具调用，Agent 正在收敛");
	});

	it("renders nothing when there is no turn in flight", () => {
		expect(renderToStaticMarkup(createElement(TurnProgressRow, {}))).toBe("");
	});
});
