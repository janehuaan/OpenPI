import { describe, expect, it } from "vitest";
import type { ConversationMessage } from "../types";
import {
	computeTrajectorySummary,
	detectRepetitionLoop,
	formatActionItem,
	formatConversationTime,
	formatDuration,
	formatUptime,
	fmtCost,
	fmtTokens,
	getHighestThinkingLevel,
	groupConversationsByDate,
	isFlashTierModel,
	mergeConversationMessage,
	messageReasoning,
	modelSupportsReasoning,
	normalizeConversationModels,
	parseCommand,
	parseMemoryEntry,
	thinkingLevelsForModel,
} from "./helpers";

const BASE_LEVELS = ["off", "minimal", "low", "medium", "high"];

describe("desktop thinking levels", () => {
	it("keeps the base controls for models without reasoning metadata", () => {
		expect(thinkingLevelsForModel({ reasoning: false, thinkingLevels: ["off"] })).toEqual(BASE_LEVELS);
	});

	it("adds extended controls only when the model declares them", () => {
		expect(thinkingLevelsForModel({ reasoning: false, thinkingLevelMap: { xhigh: "xhigh", max: null } })).toEqual([
			...BASE_LEVELS,
			"xhigh",
		]);
	});

	it("normalizes custom provider models to the base controls", () => {
		const [model] = normalizeConversationModels([{ provider: "custom", id: "gpt-custom" }]);
		expect(model?.thinkingLevels).toEqual(BASE_LEVELS);
	});

	it("detects reasoning support correctly across models", () => {
		expect(modelSupportsReasoning({ reasoning: true })).toBe(true);
		expect(modelSupportsReasoning({ id: "deepseek-r1", provider: "deepseek" })).toBe(true);
		expect(modelSupportsReasoning({ id: "o1-preview", provider: "openai" })).toBe(true);
		expect(modelSupportsReasoning({ id: "o3-mini", provider: "openai" })).toBe(true);
		expect(modelSupportsReasoning({ id: "claude-3-7-sonnet-thought", provider: "anthropic" })).toBe(true);
		expect(modelSupportsReasoning({ id: "qwq-32b", provider: "qwen" })).toBe(true);
		expect(modelSupportsReasoning({ id: "agnes-2.5-flash", provider: "agnes-cn" })).toBe(true);
		expect(modelSupportsReasoning({ id: "agnes-2.0-flash", provider: "agnes-cn" })).toBe(true);
		expect(modelSupportsReasoning({ id: "custom-flash", provider: "agnes" })).toBe(true);
		expect(modelSupportsReasoning({ id: "sensenova-6.7-flash-lite", provider: "商汤" })).toBe(true);
		expect(modelSupportsReasoning({ id: "sensenova-u1-fast", provider: "商汤" })).toBe(true);
		expect(modelSupportsReasoning({ id: "deepseek-v4-flash", provider: "商汤" })).toBe(true);
		expect(modelSupportsReasoning({ id: "glm-5.2", provider: "商汤" })).toBe(true);
		expect(modelSupportsReasoning({ id: "kimi-k2.5", provider: "kimi" })).toBe(true);
		expect(modelSupportsReasoning({ id: "minimax-m2.7", provider: "minimax" })).toBe(true);
		expect(modelSupportsReasoning({ id: "qwen3.8-max", provider: "qwen" })).toBe(true);
		expect(modelSupportsReasoning({ id: "gpt-4o", provider: "openai", reasoning: false })).toBe(false);
		expect(modelSupportsReasoning({ id: "claude-3-5-sonnet", provider: "anthropic", reasoning: false })).toBe(false);
	});

	it("resolves highest thinking level defaulting to max > high for flagship models", () => {
		expect(getHighestThinkingLevel({ thinkingLevels: ["off", "low", "high", "max"] })).toBe("max");
		expect(getHighestThinkingLevel({ thinkingLevels: ["off", "low", "high"] })).toBe("high");
		expect(getHighestThinkingLevel(undefined)).toBe("high");
		expect(getHighestThinkingLevel({ name: "Claude 3.7 Sonnet", thinkingLevels: ["off", "low", "medium", "high", "max"] })).toBe("max");
	});

	it("intelligently caps Flash/Lite models at medium to avoid thinking collapse loops", () => {
		expect(isFlashTierModel("Agnes 2.5 Flash")).toBe(true);
		expect(isFlashTierModel("gpt-4o-mini")).toBe(true);
		expect(isFlashTierModel("claude-3-5-haiku")).toBe(true);
		expect(isFlashTierModel("qwen-2.5-coder-7b")).toBe(false);

		expect(
			getHighestThinkingLevel({
				name: "Agnes 2.5 Flash",
				thinkingLevels: ["off", "low", "medium", "high", "max"],
			}),
		).toBe("medium");

		expect(
			getHighestThinkingLevel({
				name: "gemini-2.5-flash-lite",
				thinkingLevels: ["off", "low", "high"],
			}),
		).toBe("low");
	});
});

describe("detectRepetitionLoop", () => {
	it("detects degenerate token repetition loops", () => {
		const chineseLoop = "基于当前上下文，我们实现基于基于基于基于基于基于";
		expect(detectRepetitionLoop(chineseLoop).isLoop).toBe(true);
		expect(detectRepetitionLoop(chineseLoop).repeatedPattern).toBe("基于");

		const phraseLoop = "代码优化如下：成一个成一个成一个成一个成一个成一个";
		expect(detectRepetitionLoop(phraseLoop).isLoop).toBe(true);
		expect(detectRepetitionLoop(phraseLoop).repeatedPattern).toBe("成一个");

		const wordLoop = "This solution is very very very very very very";
		expect(detectRepetitionLoop(wordLoop).isLoop).toBe(true);
	});

	it("ignores normal text and markdown dividers", () => {
		expect(detectRepetitionLoop("基于当前的代码实现，我们把 WebView 简化成一个懒加载模块。").isLoop).toBe(false);
		expect(detectRepetitionLoop("Short text").isLoop).toBe(false);
		expect(detectRepetitionLoop("------------------------------------------------").isLoop).toBe(false);
		expect(detectRepetitionLoop("================================================").isLoop).toBe(false);
		expect(detectRepetitionLoop("................................................").isLoop).toBe(false);
	});
});

describe("mergeConversationMessage", () => {
	it("coalesces untimestamped streaming assistant updates", () => {
		const start: ConversationMessage = {
			role: "assistant",
			content: [{ type: "text", text: "" }],
		};
		const firstDelta: ConversationMessage = {
			role: "assistant",
			content: [{ type: "text", text: "hel" }],
		};
		const secondDelta: ConversationMessage = {
			role: "assistant",
			content: [{ type: "text", text: "hello" }],
		};

		const messages = [start, firstDelta, secondDelta].reduce<ConversationMessage[]>(
			(current, message) => mergeConversationMessage(current, message),
			[],
		);

		expect(messages).toEqual([secondDelta]);
	});

	it("replaces the untimestamped streaming shell when the final message arrives", () => {
		const partial: ConversationMessage = {
			role: "assistant",
			content: [{ type: "text", text: "hello" }],
		};
		const final: ConversationMessage = {
			role: "assistant",
			content: [{ type: "text", text: "hello" }],
			timestamp: 123,
		};

		const messages = [partial, final].reduce<ConversationMessage[]>(
			(current, message) => mergeConversationMessage(current, message),
			[],
		);

		expect(messages).toEqual([final]);
	});

	it("does not merge distinct user messages without timestamps", () => {
		const first: ConversationMessage = { role: "user", content: "one" };
		const second: ConversationMessage = { role: "user", content: "two" };

		expect(mergeConversationMessage([first], second)).toEqual([first, second]);
	});
});

describe("message reasoning", () => {
	it("joins thinking blocks so a reasoning-only shell still renders", () => {
		const message: ConversationMessage = {
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "first" },
				{ type: "text", text: "answer" },
				{ type: "thinking", thinking: "second" },
			],
		};

		expect(messageReasoning(message)).toBe("first\n\nsecond");
	});

	it("prefers the flat reasoning field carried by cached snapshots", () => {
		const message: ConversationMessage = {
			role: "assistant",
			content: [{ type: "thinking", thinking: "from blocks" }],
			reasoning: "from snapshot",
		};

		expect(messageReasoning(message)).toBe("from snapshot");
	});

	it("is empty for messages without thinking content", () => {
		expect(messageReasoning({ role: "assistant", content: [{ type: "text", text: "hi" }] })).toBe("");
		expect(messageReasoning({ role: "user", content: "hi" })).toBe("");
	});
});

describe("trajectory helpers", () => {
	it("formats bash actions with verb Ran and command target", () => {
		const res = formatActionItem("bash", { command: "npm test -w @openpi/desktop" }, "All passed", false);
		expect(res.actionType).toBe("bash");
		expect(res.verb).toBe("Ran");
		expect(res.target).toBe("npm test -w @openpi/desktop");
		expect(res.badge).toBe("✓");
	});

	it("formats file read actions with verb Analyzed and line numbers", () => {
		const res = formatActionItem("read_file", { path: "/Users/huaan/openpi-next/apps/desktop/web/App.tsx", startLine: 580, endLine: 610 }, "code", false);
		expect(res.actionType).toBe("read");
		expect(res.verb).toBe("Analyzed");
		expect(res.target).toBe("apps/desktop/web/App.tsx #L580-610");
		expect(res.badge).toBe("✓");
	});

	it("cleans paths for any workspace cleanly", () => {
		const res = formatActionItem("write", { path: "/Users/huaan/deepseek-harness-master/apps/desktop/src-tauri/src/health_check.rs" }, "ok", false);
		expect(res.target).toBe("apps/desktop/src-tauri/src/health_check.rs");
	});

	it("formats search actions with verb Searched and line counts", () => {
		const res = formatActionItem("grep", { query: "assistantMessageEvent" }, "line1\nline2\nline3", false);
		expect(res.actionType).toBe("search");
		expect(res.verb).toBe("Searched");
		expect(res.target).toBe('"assistantMessageEvent"');
		expect(res.badge).toBe("3 results");
	});

	it("marks error actions with failed badge", () => {
		const res = formatActionItem("bash", { command: "false" }, "failed", true);
		expect(res.badge).toBe("failed");
	});

	it("computes trajectory summary header correctly", () => {
		const actions = [
			{ id: "1", name: "read", summary: "", iconName: "", actionType: "read" as const },
			{ id: "2", name: "read", summary: "", iconName: "", actionType: "read" as const },
			{ id: "3", name: "grep", summary: "", iconName: "", actionType: "search" as const },
			{ id: "4", name: "bash", summary: "", iconName: "", actionType: "bash" as const },
		];
		expect(computeTrajectorySummary(actions, false)).toBe("Explored 2 files, 1 search, 1 command");
		expect(computeTrajectorySummary(actions, true, "bash")).toBe("Running bash command...");
	});

	it("formats duration strings accurately", () => {
		expect(formatDuration(undefined)).toBe("");
		expect(formatDuration(0)).toBe("0ms");
		expect(formatDuration(42)).toBe("42ms");
		expect(formatDuration(999)).toBe("999ms");
		expect(formatDuration(1000)).toBe("1.0s");
		expect(formatDuration(1420)).toBe("1.4s");
		expect(formatDuration(65000)).toBe("1m 5s");
	});

	it("parses memory entries", () => {
		expect(parseMemoryEntry("[user] theme: dark")).toEqual({
			type: "user",
			key: "theme",
			value: "dark",
			raw: "[user] theme: dark",
			parsed: true,
		});
		expect(parseMemoryEntry("invalid entry")).toEqual({
			type: "unknown",
			key: "Unrecognized entry",
			value: "invalid entry",
			raw: "invalid entry",
			parsed: false,
		});
	});

	it("formats tokens and cost", () => {
		expect(fmtTokens(500)).toBe("500");
		expect(fmtTokens(1500)).toBe("1.5k");
		expect(fmtTokens(2500000)).toBe("2.5M");
		expect(fmtCost(0.005)).toBe("$0.0050");
		expect(fmtCost(1.25)).toBe("$1.25");
	});

	it("parses commands", () => {
		expect(parseCommand({ name: "test", description: "desc" })).toEqual({ name: "test", description: "desc" });
		expect(parseCommand("/help — show help")).toEqual({ name: "/help", description: "show help" });
	});

	it("formats uptime", () => {
		expect(formatUptime(undefined)).toBe("Unavailable");
		expect(formatUptime(60000)).toBe("1m");
		expect(formatUptime(3600000)).toBe("1h 0m");
		expect(formatUptime(86400000)).toBe("1d 0h");
	});

	it("formats conversation timestamp nicely", () => {
		expect(formatConversationTime(undefined)).toBe("");
		expect(formatConversationTime("invalid")).toBe("");
		const todayIso = new Date().toISOString();
		expect(formatConversationTime(todayIso)).toMatch(/\d{1,2}:\d{2}/);
		const oldIso = new Date("2025-01-15T10:00:00Z").toISOString();
		expect(formatConversationTime(oldIso)).toMatch(/\d+/);
	});

	it("groups conversations by date intervals", () => {
		const now = Date.now();
		const mockInstances = [
			{ id: "1", status: "online" as const, mode: "code" as const, cwd: "/a", lastSeenAt: new Date(now).toISOString() },
			{ id: "2", status: "stopped" as const, mode: "work" as const, cwd: "/b", lastSeenAt: new Date(now - 86400000 * 1.5).toISOString() },
			{ id: "3", status: "stopped" as const, mode: "code" as const, cwd: "/c", lastSeenAt: new Date(now - 86400000 * 20).toISOString() },
		];
		const groups = groupConversationsByDate(mockInstances);
		expect(groups.length).toBeGreaterThanOrEqual(2);
		expect(groups[0]?.key).toBe("today");
		expect(groups[0]?.items[0]?.id).toBe("1");
	});
});


