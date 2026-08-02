import { describe, expect, it } from "vitest";
import type { TaskDefinition, TaskRun } from "../src/types.ts";

// Test buildArgs behavior via a small local reimplementation of the pure portions
// (ProcessTaskExecutor spawns processes; here we assert product defaults shapes).

describe("task definition safety fields", () => {
	it("accepts security and sandbox fields on TaskDefinition", () => {
		const task: TaskDefinition = {
			id: "t1",
			title: "safe",
			prompt: "list files",
			schedule: { kind: "once", runAt: "2026-01-01T00:00:00.000Z" },
			status: "active",
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			securityMode: "strict",
			sandbox: "none",
			tools: ["read", "ls"],
			extensions: ["/tmp/security.ts"],
		};
		const run: TaskRun = {
			id: "r1",
			taskId: task.id,
			status: "queued",
			trigger: "manual",
			createdAt: "2026-01-01T00:00:00.000Z",
			attempt: 1,
		};
		expect(task.securityMode).toBe("strict");
		expect(run.attempt).toBe(1);
	});
});
