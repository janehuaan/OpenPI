import type { EvaluationResult, PlanNode, PlanRevision, ReflectionDecision, ReflectionState } from "./contract.ts";

export interface ReflectionPolicy {
	maxRounds: number;
	maxTotalEvaluations: number;
	minimumRetryScore: number;
}

export const DEFAULT_REFLECTION_POLICY: ReflectionPolicy = {
	maxRounds: 2,
	maxTotalEvaluations: 12,
	minimumRetryScore: 0.25,
};

export function createReflectionState(policy = DEFAULT_REFLECTION_POLICY): ReflectionState {
	return { maxRounds: policy.maxRounds, roundsByNode: {}, totalEvaluations: 0, stopped: false };
}

export function decideReflection(
	evaluation: EvaluationResult,
	state: ReflectionState,
	policy = DEFAULT_REFLECTION_POLICY,
): ReflectionDecision {
	const round = state.roundsByNode[evaluation.nodeId] ?? 0;
	let decision: ReflectionDecision["decision"];
	let reason: string;
	if (evaluation.passed) {
		decision = "accept";
		reason = `Evaluation passed with score ${evaluation.score.toFixed(3)}.`;
	} else if (state.stopped || state.totalEvaluations >= policy.maxTotalEvaluations) {
		decision = "stop";
		reason = "Global reflection budget exhausted.";
	} else if (round >= policy.maxRounds) {
		decision = "stop";
		reason = `Maximum ${policy.maxRounds} reflection rounds reached for node ${evaluation.nodeId}.`;
	} else if (evaluation.score < policy.minimumRetryScore) {
		decision = "stop";
		reason = `Score ${evaluation.score.toFixed(3)} is below the safe retry threshold.`;
	} else {
		decision = "retry";
		reason = evaluation.recommendations.join(" ") || "Evaluation did not meet the acceptance threshold.";
	}
	const decisionRound = decision === "retry" ? round + 1 : round;
	return {
		version: 1,
		id: `reflection-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		runId: evaluation.runId,
		planId: evaluation.planId,
		nodeId: evaluation.nodeId,
		decision,
		reason,
		round: decisionRound,
		remainingRounds: Math.max(0, policy.maxRounds - decisionRound),
		createdAt: new Date().toISOString(),
	};
}

export function applyReflectionDecision(
	node: PlanNode,
	evaluation: EvaluationResult,
	decision: ReflectionDecision,
	state: ReflectionState,
): { state: ReflectionState; revision?: PlanRevision } {
	const totalEvaluations = state.totalEvaluations + 1;
	if (decision.decision !== "retry") {
		return { state: { ...state, totalEvaluations, stopped: state.stopped || decision.decision === "stop" } };
	}
	const round = (state.roundsByNode[node.id] ?? 0) + 1;
	const revisedNode: PlanNode = {
		...node,
		id: `${node.id}-revision-${round}`,
		title: `${node.title} (revision ${round})`,
		objective: `${node.objective}\n\nRevision requirements:\n${evaluation.recommendations.map((item) => `- ${item}`).join("\n")}`,
		dependencies: [...node.dependencies],
		contextQueries: [...new Set([...node.contextQueries, ...evaluation.missingCriteria])],
		status: "ready",
		maxAttempts: Math.max(node.maxAttempts, round + 1),
	};
	return {
		state: { ...state, roundsByNode: { ...state.roundsByNode, [node.id]: round }, totalEvaluations },
		revision: {
			version: 1,
			id: `revision-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			planId: evaluation.planId,
			parentNodeId: node.id,
			round,
			revisedNode,
			reason: decision.reason,
			createdAt: new Date().toISOString(),
		},
	};
}
