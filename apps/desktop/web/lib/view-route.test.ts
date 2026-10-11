import { describe, expect, it } from "vitest";
import { initialView, viewFromHash } from "./view-route";

describe("initialView", () => {
	it("lands on the Agent OS home (today) on a cold start", () => {
		expect(initialView("", null)).toBe("today");
	});

	it("never restores chat as the landing view (hash or localStorage)", () => {
		// Chat 已降级为面板：冷启动第一屏必须是 Now，而不是对话记录。
		expect(initialView("#/chat", null)).toBe("today");
		expect(initialView("", "chat")).toBe("today");
		expect(initialView("#/chat", "chat")).toBe("today");
	});

	it("still restores non-chat views from the hash or localStorage", () => {
		expect(initialView("#/goals", null)).toBe("goals");
		expect(initialView("", "memory")).toBe("memory");
	});

	it("falls back to today for an unknown route", () => {
		expect(initialView("#/nope", null)).toBe("today");
	});
});

describe("viewFromHash", () => {
	it("parses the view segment and rejects unknown routes", () => {
		expect(viewFromHash("#/activity")).toBe("activity");
		expect(viewFromHash("#/nope")).toBeUndefined();
	});
});
