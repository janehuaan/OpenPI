import { describe, expect, it } from "vitest";
import { initialTurnProgress, reduceTurnProgress, toolLabel, type TurnProgress } from "./turn-progress";

describe("turn progress", () => {
	it("starts submitted and maps lifecycle", () => {
		let progress = initialTurnProgress("one", 10) as ReturnType<typeof initialTurnProgress> | undefined;
		progress = reduceTurnProgress(progress, { instanceId: "one", type: "agent_start" }, 20);
		expect(progress?.stage).toBe("starting");
		progress = reduceTurnProgress(progress, { instanceId: "one", type: "turn_start" }, 30);
		progress = reduceTurnProgress(
			progress,
			{
				instanceId: "one",
				type: "message_update",
				assistantMessageEvent: { type: "text_delta" },
			},
			40,
		);
		expect(progress).toMatchObject({ stage: "responding", label: "正在组织回复…" });
	});

	it("labels common tools and clears on settle", () => {
		const progress = reduceTurnProgress(initialTurnProgress("one"), {
			instanceId: "one",
			type: "tool_execution_start",
			toolName: "apply_patch",
		});
		expect(progress).toMatchObject({ stage: "tool", label: "应用补丁" });
		expect(reduceTurnProgress(progress, { instanceId: "one", type: "agent_settled" })).toBeUndefined();
	});

	it("ignores events from another instance", () => {
		const progress = initialTurnProgress("one");
		expect(reduceTurnProgress(progress, { instanceId: "two", type: "agent_start" })).toBe(progress);
	});

	it("has a readable fallback tool label", () => {
		expect(toolLabel("custom_tool")).toBe("使用 custom_tool");
	});

	it("provides contextual progress labels across multi-step tool execution", () => {
		let progress: TurnProgress | undefined = initialTurnProgress("test", 100);
		progress = reduceTurnProgress(progress, { instanceId: "test", type: "turn_start" }, 110);
		expect(progress?.label).toBe("正在思考…");

		// Tool 1 starts (bash)
		progress = reduceTurnProgress(progress, { instanceId: "test", type: "tool_execution_start", toolName: "bash" }, 120);
		expect(progress?.label).toBe("运行命令");

		// Tool 1 ends
		progress = reduceTurnProgress(progress, { instanceId: "test", type: "tool_execution_end" }, 130);
		expect(progress?.label).toBe("已完成运行命令，分析结果中…");

		// Model thinks about tool 1 results
		progress = reduceTurnProgress(progress, {
			instanceId: "test",
			type: "message_update",
			assistantMessageEvent: { type: "thinking_delta" },
		}, 140);
		expect(progress?.label).toBe("结合执行结果深入思考中…");

		// Prepares next tool
		progress = reduceTurnProgress(progress, {
			instanceId: "test",
			type: "message_update",
			assistantMessageEvent: { type: "toolcall_delta" },
		}, 150);
		expect(progress?.label).toBe("正在准备下一步操作…");
	});
});
