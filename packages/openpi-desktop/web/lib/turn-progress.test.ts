import { describe, expect, it } from "vitest";
import { initialTurnProgress, reduceTurnProgress, toolLabel } from "./turn-progress";

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
});
