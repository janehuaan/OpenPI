import type { PlanNode, TaskPlan, WorkflowNodeState, WorkflowRun } from "./contract.ts";

export function createWorkflow(intelligenceRunId: string, plan: TaskPlan): WorkflowRun {
	return {
		version: 1,
		id: `workflow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		intelligenceRunId,
		planId: plan.id,
		status: "pending",
		nodes: plan.nodes.map((node) => ({
			nodeId: node.id,
			status: node.dependencies.length === 0 ? "ready" : "pending",
			attempts: 0,
		})),
		writeOwners: {},
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	};
}

export function refreshWorkflow(workflow: WorkflowRun, plan: TaskPlan): WorkflowRun {
	const states = new Map(workflow.nodes.map((state) => [state.nodeId, state]));
	for (const node of plan.nodes) {
		const state = states.get(node.id);
		if (!state || state.status !== "pending") continue;
		const dependencies = node.dependencies.map((id) => states.get(id));
		if (
			dependencies.some(
				(dependency) =>
					dependency?.status === "failed" ||
					dependency?.status === "blocked" ||
					dependency?.status === "cancelled",
			)
		)
			state.status = "blocked";
		else if (dependencies.every((dependency) => dependency?.status === "completed")) state.status = "ready";
	}
	const values = [...states.values()];
	workflow.status = values.every((state) => state.status === "completed")
		? "completed"
		: values.some((state) => ["ready", "running", "pending"].includes(state.status))
			? "running"
			: values.some((state) => state.status === "failed")
				? "failed"
				: workflow.status === "awaiting-approval"
					? "awaiting-approval"
					: "running";
	workflow.updatedAt = new Date().toISOString();
	return workflow;
}

export function readyNodes(workflow: WorkflowRun, plan: TaskPlan, maxConcurrent: number): PlanNode[] {
	const running = workflow.nodes.filter((state) => state.status === "running").length;
	const slots = Math.max(0, maxConcurrent - running);
	const readyIds = workflow.nodes
		.filter((state) => state.status === "ready")
		.slice(0, slots)
		.map((state) => state.nodeId);
	return readyIds
		.map((id) => plan.nodes.find((node) => node.id === id))
		.filter((node): node is PlanNode => node !== undefined);
}

function overlaps(left: string, right: string): boolean {
	const normalize = (value: string) => value.replace(/\\/g, "/").replace(/\/$/, "");
	const a = normalize(left);
	const b = normalize(right);
	return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

export function claimWritePaths(
	workflow: WorkflowRun,
	nodeId: string,
	paths: string[],
): { ok: boolean; conflict?: string } {
	for (const requested of paths) {
		for (const [owned, owner] of Object.entries(workflow.writeOwners)) {
			if (owner !== nodeId && overlaps(requested, owned))
				return { ok: false, conflict: `${requested} conflicts with ${owned} owned by ${owner}.` };
		}
	}
	for (const requested of paths) workflow.writeOwners[requested] = nodeId;
	return { ok: true };
}

export function releaseWritePaths(workflow: WorkflowRun, nodeId: string): void {
	for (const [owned, owner] of Object.entries(workflow.writeOwners))
		if (owner === nodeId) delete workflow.writeOwners[owned];
}

export function nodeState(workflow: WorkflowRun, nodeId: string): WorkflowNodeState | undefined {
	return workflow.nodes.find((state) => state.nodeId === nodeId);
}
