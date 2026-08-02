import { describe, expect, it } from "vitest";
import type { TaskPlan } from "../src/contract.ts";
import { validateTaskPlan } from "../src/validate.ts";

function node(
	partial: Pick<TaskPlan["nodes"][number], "id" | "title" | "objective" | "dependencies" | "capabilityIds">,
): TaskPlan["nodes"][number] {
	return {
		...partial,
		contextQueries: [],
		contextItemIds: [],
		inputs: [],
		outputs: ["result"],
		writePaths: [],
		verification: ["check"],
		risk: "low",
		successCriteria: ["done"],
		status: "pending",
		maxAttempts: 2,
		timeoutMs: 1000,
	};
}

function plan(nodes: TaskPlan["nodes"]): TaskPlan {
	return {
		version: 1,
		id: "plan-1",
		goal: "test",
		mode: "planned",
		nodes,
		globalSuccessCriteria: ["done"],
		contextBudget: {
			totalTokens: 10000,
			reservedForConversation: 1000,
			reservedForCompletion: 1000,
			sourceLimits: {
				conversation: 1000,
				code: 1000,
				git: 500,
				memory: 500,
				knowledge: 500,
				web: 0,
			},
			maxItems: 10,
		},
		createdAt: new Date().toISOString(),
	};
}

describe("validateTaskPlan", () => {
	it("accepts a valid linear plan", () => {
		const result = validateTaskPlan(
			plan([
				node({
					id: "n1",
					title: "Scout",
					objective: "Find files",
					dependencies: [],
					capabilityIds: ["tool:read"],
				}),
				node({
					id: "n2",
					title: "Edit",
					objective: "Change code",
					dependencies: ["n1"],
					capabilityIds: ["tool:edit"],
				}),
			]),
			new Set(["tool:read", "tool:edit"]),
			{ maxNodes: 8, maxDepth: 4, maxCapabilitiesPerNode: 4 },
		);
		expect(result.valid).toBe(true);
	});

	it("rejects cycles and unknown capabilities", () => {
		const result = validateTaskPlan(
			plan([
				node({
					id: "a",
					title: "A",
					objective: "a",
					dependencies: ["b"],
					capabilityIds: ["tool:missing"],
				}),
				node({
					id: "b",
					title: "B",
					objective: "b",
					dependencies: ["a"],
					capabilityIds: ["tool:read"],
				}),
			]),
			new Set(["tool:read"]),
			{ maxNodes: 8, maxDepth: 4, maxCapabilitiesPerNode: 4 },
		);
		expect(result.valid).toBe(false);
		expect(result.errors.some((error) => /cycle/i.test(error))).toBe(true);
		expect(result.errors.some((error) => /unknown capability/i.test(error))).toBe(true);
	});
});
