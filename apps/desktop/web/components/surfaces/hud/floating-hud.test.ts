import { describe, expect, it } from "vitest";
import { navigateIndex, parseHudCommand } from "./floating-hud";

describe("floating-hud helper functions", () => {
	describe("parseHudCommand", () => {
		it("parses kill port commands in Chinese and English", () => {
			expect(parseHudCommand("释放 3000")).toEqual({ type: "kill_port", port: 3000 });
			expect(parseHudCommand("释放5173")).toEqual({ type: "kill_port", port: 5173 });
			expect(parseHudCommand("kill 8080")).toEqual({ type: "kill_port", port: 8080 });
			expect(parseHudCommand("KILL 8000")).toEqual({ type: "kill_port", port: 8000 });
		});

		it("parses screen capture shortcut requests", () => {
			expect(parseHudCommand("截屏")).toEqual({ type: "capture_screen" });
			expect(parseHudCommand("截图")).toEqual({ type: "capture_screen" });
			expect(parseHudCommand("看屏幕")).toEqual({ type: "capture_screen" });
			expect(parseHudCommand("帮我看下屏幕")).toEqual({ type: "capture_screen" });
		});

		it("parses git status shortcuts", () => {
			expect(parseHudCommand("git")).toEqual({ type: "git_status" });
			expect(parseHudCommand("git status")).toEqual({ type: "git_status" });
			expect(parseHudCommand("git 状态")).toEqual({ type: "git_status" });
		});

		it("falls back to general handoff for conversational prompts", () => {
			expect(parseHudCommand("优化这个 React 组件的性能")).toEqual({
				type: "handoff",
				text: "优化这个 React 组件的性能",
			});
			expect(parseHudCommand("  帮我重构 auth 逻辑  ")).toEqual({
				type: "handoff",
				text: "帮我重构 auth 逻辑",
			});
		});
	});

	describe("navigateIndex", () => {
		it("navigates down and wraps around", () => {
			expect(navigateIndex(0, 3, "down")).toBe(1);
			expect(navigateIndex(1, 3, "down")).toBe(2);
			expect(navigateIndex(2, 3, "down")).toBe(0);
		});

		it("navigates up and wraps around", () => {
			expect(navigateIndex(0, 3, "up")).toBe(2);
			expect(navigateIndex(2, 3, "up")).toBe(1);
			expect(navigateIndex(1, 3, "up")).toBe(0);
		});

		it("handles edge cases safely with empty or 0 count", () => {
			expect(navigateIndex(0, 0, "down")).toBe(0);
			expect(navigateIndex(0, 0, "up")).toBe(0);
		});
	});
});
