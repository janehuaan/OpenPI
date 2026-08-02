import { describe, expect, it } from "vitest";
import type { CapabilityDescriptor, ContextBudget, PlanNode, TaskPlan } from "../src/contract.ts";
import { createDeterministicPlan, shouldPlan } from "../src/planner.ts";
import { claimWritePaths, createWorkflow, readyNodes, refreshWorkflow, releaseWritePaths } from "../src/workflow.ts";

const budget: ContextBudget = {
	totalTokens: 100_000,
	reservedForConversation: 20_000,
	reservedForCompletion: 10_000,
	sourceLimits: { memory: 5, knowledge: 5, code: 5, git: 3, conversation: 10, web: 0 },
	maxItems: 50,
};

const capabilities: CapabilityDescriptor[] = [
	{
		id: "read",
		kind: "tool",
		name: "read",
		risk: "low",
		description: "Read files",
		source: "builtin",
		active: true,
		tags: [],
		estimatedCost: 1,
		sideEffects: [],
	},
	{
		id: "bash",
		kind: "tool",
		name: "bash",
		risk: "high",
		description: "Run commands",
		source: "builtin",
		active: true,
		tags: [],
		estimatedCost: 2,
		sideEffects: [],
	},
	{
		id: "edit",
		kind: "tool",
		name: "edit",
		risk: "medium",
		description: "Edit files",
		source: "builtin",
		active: true,
		tags: [],
		estimatedCost: 1,
		sideEffects: [],
	},
	{
		id: "code_search",
		kind: "tool",
		name: "code_search",
		risk: "low",
		description: "Search code",
		source: "builtin",
		active: true,
		tags: [],
		estimatedCost: 1,
		sideEffects: [],
	},
];

function makeNode(overrides: Partial<PlanNode>): PlanNode {
	return {
		id: "n1",
		title: "Node",
		objective: "Objective",
		dependencies: [],
		capabilityIds: ["read"],
		contextQueries: [],
		contextItemIds: [],
		inputs: [],
		outputs: ["out"],
		writePaths: [],
		verification: ["verify"],
		risk: "low",
		successCriteria: ["done"],
		status: "pending",
		maxAttempts: 2,
		timeoutMs: 300_000,
		...overrides,
	};
}

function makePlan(nodes: PlanNode[]): TaskPlan {
	return {
		version: 1,
		id: "plan-1",
		goal: "goal",
		mode: "planned",
		nodes,
		globalSuccessCriteria: [],
		contextBudget: budget,
		createdAt: "2026-01-01T00:00:00.000Z",
	};
}

describe("shouldPlan", () => {
	it("triggers on complex signals", () => {
		expect(shouldPlan("Research and compare the two approaches", 1)).toBe(true);
		expect(shouldPlan("Migrate the database then update the API", 1)).toBe(true);
		expect(shouldPlan("实现一个登录功能", 1)).toBe(true);
	});

	it("does not trigger for simple prompts", () => {
		expect(shouldPlan("Fix the typo in main.ts", 1)).toBe(false);
		expect(shouldPlan("What does this function do?", 1)).toBe(false);
	});

	it("triggers for long prompts or many capabilities", () => {
		expect(shouldPlan("x".repeat(801), 1)).toBe(true);
		expect(shouldPlan("hi", 3)).toBe(true);
	});
});

describe("createDeterministicPlan", () => {
	it("builds an inspect -> implement -> verify DAG", () => {
		const plan = createDeterministicPlan("Refactor the parser", capabilities, [], budget);
		expect(plan.nodes.length).toBeGreaterThanOrEqual(3);
		const [first, second, ...rest] = plan.nodes;
		// First node has no dependencies and is ready.
		expect(first!.dependencies).toEqual([]);
		expect(first!.status).toBe("ready");
		// Middle node depends on the first.
		expect(second!.dependencies).toContain(first!.id);
		// Final node depends on the previous one.
		expect(rest.at(-1)!.dependencies).toContain(second!.id);
	});

	it("flags high-risk capability use", () => {
		const plan = createDeterministicPlan("Refactor the parser", capabilities, [], budget);
		const bashNode = plan.nodes.find((node) => node.capabilityIds.includes("bash"));
		expect(bashNode?.risk).toBe("high");
	});
});

describe("workflow state machine", () => {
	it("creates a workflow with ready root nodes", () => {
		const plan = makePlan([makeNode({ id: "a", dependencies: [] }), makeNode({ id: "b", dependencies: ["a"] })]);
		const workflow = createWorkflow("run-1", plan);
		expect(workflow.nodes.find((s) => s.nodeId === "a")?.status).toBe("ready");
		expect(workflow.nodes.find((s) => s.nodeId === "b")?.status).toBe("pending");
	});

	it("marks pending nodes ready when dependencies complete", () => {
		const plan = makePlan([makeNode({ id: "a" }), makeNode({ id: "b", dependencies: ["a"] })]);
		const workflow = createWorkflow("run-1", plan);
		const a = workflow.nodes.find((s) => s.nodeId === "a");
		a!.status = "completed";
		refreshWorkflow(workflow, plan);
		expect(workflow.nodes.find((s) => s.nodeId === "b")?.status).toBe("ready");
	});

	it("blocks nodes whose dependencies failed", () => {
		const plan = makePlan([makeNode({ id: "a" }), makeNode({ id: "b", dependencies: ["a"] })]);
		const workflow = createWorkflow("run-1", plan);
		const a = workflow.nodes.find((s) => s.nodeId === "a");
		a!.status = "failed";
		refreshWorkflow(workflow, plan);
		expect(workflow.nodes.find((s) => s.nodeId === "b")?.status).toBe("blocked");
	});

	it("respects the max-concurrent slot limit", () => {
		const plan = makePlan([makeNode({ id: "a" }), makeNode({ id: "b" }), makeNode({ id: "c" })]);
		const workflow = createWorkflow("run-1", plan);
		expect(readyNodes(workflow, plan, 2)).toHaveLength(2);
		const first = workflow.nodes.find((s) => s.nodeId === "a");
		first!.status = "running";
		expect(readyNodes(workflow, plan, 2)).toHaveLength(1);
	});
});

describe("write path conflicts", () => {
	it("rejects overlapping write paths owned by another node", () => {
		const workflow = createWorkflow("run-1", {
			version: 1,
			id: "plan-1",
			goal: "g",
			mode: "planned",
			nodes: [makeNode({ id: "a" }), makeNode({ id: "b" })],
			globalSuccessCriteria: [],
			contextBudget: budget,
			createdAt: "2026-01-01T00:00:00.000Z",
		});
		expect(claimWritePaths(workflow, "a", ["src/parser.ts"]).ok).toBe(true);
		const conflict = claimWritePaths(workflow, "b", ["src/parser.ts"]);
		expect(conflict.ok).toBe(false);
		expect(conflict.conflict).toContain("conflicts");
		// Releasing frees the path.
		releaseWritePaths(workflow, "a");
		expect(claimWritePaths(workflow, "b", ["src/parser.ts"]).ok).toBe(true);
	});

	it("treats directory prefixes as overlapping", () => {
		const workflow = createWorkflow("run-1", {
			version: 1,
			id: "plan-1",
			goal: "g",
			mode: "planned",
			nodes: [makeNode({ id: "a" }), makeNode({ id: "b" })],
			globalSuccessCriteria: [],
			contextBudget: budget,
			createdAt: "2026-01-01T00:00:00.000Z",
		});
		expect(claimWritePaths(workflow, "a", ["src/"]).ok).toBe(true);
		expect(claimWritePaths(workflow, "b", ["src/parser.ts"]).ok).toBe(false);
	});
});
