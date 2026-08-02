import { Value } from "typebox/value";
import type { ContextBudget, TaskPlan } from "./contract.ts";
import { ContextBudgetSchema, TaskPlanSchema } from "./contract.ts";

export interface ValidationResult {
	valid: boolean;
	errors: string[];
}

export function validateContextBudget(budget: ContextBudget): ValidationResult {
	const errors = [...Value.Errors(ContextBudgetSchema, budget)].map((error) => error.message);
	if (budget.reservedForConversation + budget.reservedForCompletion >= budget.totalTokens) {
		errors.push("Reserved conversation and completion tokens must leave room for dynamic context.");
	}
	return { valid: errors.length === 0, errors };
}

export function validateTaskPlan(
	plan: TaskPlan,
	knownCapabilityIds: ReadonlySet<string>,
	limits: { maxNodes: number; maxDepth: number; maxCapabilitiesPerNode: number },
): ValidationResult {
	const errors = [...Value.Errors(TaskPlanSchema, plan)].map((error) => error.message);
	if (plan.nodes.length > limits.maxNodes)
		errors.push(`Plan has ${plan.nodes.length} nodes; maximum is ${limits.maxNodes}.`);

	const byId = new Map<string, TaskPlan["nodes"][number]>();
	for (const node of plan.nodes) {
		if (byId.has(node.id)) errors.push(`Duplicate node id: ${node.id}.`);
		byId.set(node.id, node);
		if (node.capabilityIds.length > limits.maxCapabilitiesPerNode) {
			errors.push(`Node ${node.id} has too many capabilities.`);
		}
		for (const capabilityId of node.capabilityIds) {
			if (!knownCapabilityIds.has(capabilityId))
				errors.push(`Node ${node.id} references unknown capability ${capabilityId}.`);
		}
	}

	for (const node of plan.nodes) {
		for (const dependency of node.dependencies) {
			if (!byId.has(dependency)) errors.push(`Node ${node.id} references missing dependency ${dependency}.`);
			if (dependency === node.id) errors.push(`Node ${node.id} depends on itself.`);
		}
	}

	const visiting = new Set<string>();
	const visited = new Set<string>();
	const depthById = new Map<string, number>();
	const visit = (id: string): number => {
		if (visiting.has(id)) {
			errors.push(`Plan contains a dependency cycle involving ${id}.`);
			return limits.maxDepth + 1;
		}
		if (visited.has(id)) return depthById.get(id) ?? 1;
		visiting.add(id);
		const node = byId.get(id);
		const depth = node ? 1 + Math.max(0, ...node.dependencies.map((dependency) => visit(dependency))) : 1;
		visiting.delete(id);
		visited.add(id);
		depthById.set(id, depth);
		return depth;
	};
	for (const id of byId.keys()) {
		const depth = visit(id);
		if (depth > limits.maxDepth) errors.push(`Plan depth ${depth} exceeds maximum ${limits.maxDepth}.`);
	}

	return { valid: errors.length === 0, errors: [...new Set(errors)] };
}
