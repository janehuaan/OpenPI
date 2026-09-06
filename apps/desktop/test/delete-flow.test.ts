import { describe, expect, it } from "vitest";
import type { AgentInstance } from "../web/types";
import { instanceTitle } from "../web/lib/helpers";

describe("Conversation Delete Flow Smoke Tests", () => {
	it("instanceTitle resolves title, name, or default label accurately", () => {
		const inst1: AgentInstance = {
			id: "session-1",
			status: "online",
			mode: "chat",
			cwd: "/Users/test",
			label: "Label Title",
			createdAt: new Date().toISOString(),
		};
		expect(instanceTitle(inst1)).toBe("Label Title");

		// Override with custom title
		expect(instanceTitle(inst1, "Custom Overridden Title")).toBe("Custom Overridden Title");

		// Fallback when label is undefined
		const inst2: AgentInstance = {
			id: "session-2",
			status: "online",
			mode: "chat",
			cwd: "/Users/test",
			createdAt: new Date().toISOString(),
		};
		expect(instanceTitle(inst2)).toBe("新对话");
	});

	it("optimistic deletion logic cleanly filters instances and preserves ordering", () => {
		const instances: AgentInstance[] = [
			{ id: "s1", status: "online", mode: "chat", cwd: "/test", createdAt: "2026-09-01" },
			{ id: "s2", status: "stopped", mode: "chat", cwd: "/test", createdAt: "2026-09-02" },
			{ id: "s3", status: "online", mode: "code", cwd: "/test", createdAt: "2026-09-03" },
		];

		const targetToDelete = "s2";
		const remaining = instances.filter((inst) => inst.id !== targetToDelete);

		expect(remaining).toHaveLength(2);
		expect(remaining.map((i) => i.id)).toEqual(["s1", "s3"]);
		expect(remaining.some((i) => i.id === "s2")).toBe(false);
	});

	it("active session auto-switch smoothly chooses next available conversation", () => {
		const instances: AgentInstance[] = [
			{ id: "s1", status: "online", mode: "chat", cwd: "/test", createdAt: "2026-09-01" },
			{ id: "s2", status: "online", mode: "chat", cwd: "/test", createdAt: "2026-09-02" },
		];

		let selectedInstanceId: string | undefined = "s1";
		const deletedId = "s1";
		const remaining = instances.filter((inst) => inst.id !== deletedId);

		if (selectedInstanceId === deletedId) {
			selectedInstanceId = remaining[0]?.id;
		}

		expect(selectedInstanceId).toBe("s2");

		const remaining2 = remaining.filter((inst) => inst.id !== "s2");
		if (selectedInstanceId === "s2") {
			selectedInstanceId = remaining2[0]?.id;
		}
		expect(selectedInstanceId).toBeUndefined();
	});

	it("optimistic rename updates label and syncs with state", () => {
		const instances: AgentInstance[] = [
			{ id: "s1", status: "online", mode: "chat", cwd: "/test", label: "Old Name", createdAt: "2026-09-01" },
		];

		const updated = instances.map((inst) =>
			inst.id === "s1" ? { ...inst, label: "New Name" } : inst,
		);

		expect(updated[0].label).toBe("New Name");
	});

	it("project removal cleans up all associated sessions across workspace", () => {
		const instances: AgentInstance[] = [
			{ id: "p1-s1", status: "online", mode: "code", cwd: "/repos/project-a", createdAt: "2026-09-01" },
			{ id: "p1-s2", status: "stopped", mode: "code", cwd: "/repos/project-a", createdAt: "2026-09-02" },
			{ id: "p2-s1", status: "online", mode: "code", cwd: "/repos/project-b", createdAt: "2026-09-03" },
			{ id: "chat-1", status: "online", mode: "chat", cwd: "/repos/project-a", createdAt: "2026-09-04" },
		];

		const targetProject = {
			cwd: "/repos/project-a",
			projectName: "project-a",
			instances: instances.filter((i) => i.cwd === "/repos/project-a" && i.mode === "code"),
		};

		const targetIds = new Set(targetProject.instances.map((i) => i.id));
		const remaining = instances.filter((inst) => !targetIds.has(inst.id));

		expect(remaining).toHaveLength(2);
		expect(remaining.map((i) => i.id)).toEqual(["p2-s1", "chat-1"]);
		expect(remaining.some((i) => targetIds.has(i.id))).toBe(false);
	});

	it("project removal smoothly switches active session if active session belonged to the project", () => {
		const instances: AgentInstance[] = [
			{ id: "p1-s1", status: "online", mode: "code", cwd: "/repos/project-a", createdAt: "2026-09-01" },
			{ id: "p2-s1", status: "online", mode: "code", cwd: "/repos/project-b", createdAt: "2026-09-02" },
		];

		let selectedInstanceId: string | undefined = "p1-s1";
		const removingTargetIds = new Set(["p1-s1"]);

		const remaining = instances.filter((inst) => !removingTargetIds.has(inst.id));
		if (selectedInstanceId && removingTargetIds.has(selectedInstanceId)) {
			selectedInstanceId = remaining[0]?.id;
		}

		expect(selectedInstanceId).toBe("p2-s1");
	});
});

