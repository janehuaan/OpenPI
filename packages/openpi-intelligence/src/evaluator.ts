import type { EvaluationDimension, EvaluationResult, PlanNode } from "./contract.ts";

export interface EvaluationInput {
	runId: string;
	planId: string;
	node: PlanNode;
	attempt: number;
	output: string;
	evidence?: string[];
}

const failurePatterns = [
	/\b(?:failed|error|exception|unable|cannot|not found|timed out)\b/i,
	/(?:失败|错误|异常|无法|未找到|超时|没有完成)/,
];
const verificationPatterns = [
	/\b(?:verified|validated|passed|success|complete|fixed|tested)\b/i,
	/(?:验证|通过|成功|完成|修复|测试)/,
];

function terms(value: string): string[] {
	return [...new Set(value.toLowerCase().match(/[A-Za-z0-9_./-]{2,}|[\p{Script=Han}]{2,}/gu) ?? [])];
}

function criterionCoverage(criterion: string, output: string): number {
	const normalizedCriterion = criterion.toLowerCase();
	if (/completed and (?:the result is )?verified|完成.*验证/.test(normalizedCriterion)) {
		const completed =
			/\b(?:complete|completed|fixed|resolved|passed|success)\b/i.test(output) ||
			/(?:完成|修复|解决|通过|成功)/.test(output);
		const verified = verificationPatterns.some((pattern) => pattern.test(output));
		return completed && verified ? 1 : completed || verified ? 0.5 : 0;
	}
	const criterionTerms = terms(criterion).filter(
		(term) => !["the", "and", "is", "are", "user", "request"].includes(term),
	);
	if (criterionTerms.length === 0) return 0.5;
	const normalized = output.toLowerCase();
	return criterionTerms.filter((term) => normalized.includes(term)).length / criterionTerms.length;
}

function dimension(score: number, reason: string): EvaluationDimension {
	return { score: Math.max(0, Math.min(1, score)), reason };
}

export function evaluateNode(input: EvaluationInput): EvaluationResult {
	const output = input.output.trim();
	const failure = failurePatterns.some((pattern) => pattern.test(output));
	const verification = verificationPatterns.some((pattern) => pattern.test(output));
	const coverage = input.node.successCriteria.map((criterion) => criterionCoverage(criterion, output));
	const criteriaScore = coverage.length === 0 ? 0 : coverage.reduce((sum, score) => sum + score, 0) / coverage.length;
	const missingCriteria = input.node.successCriteria.filter((_criterion, index) => coverage[index] < 0.5);
	const evidenceItems = [
		...new Set([...(input.evidence ?? []), ...(output.match(/(?:[\w./-]+:\d+|https?:\/\/\S+|`[^`]+`)/g) ?? [])]),
	];
	const evidenceScore = Math.min(1, evidenceItems.length / Math.max(1, input.node.successCriteria.length));
	const completenessScore = output.length === 0 ? 0 : Math.min(1, output.length / 500);
	const reliabilityScore = failure ? 0.1 : verification ? 0.9 : 0.55;
	const dimensions = {
		criteria: dimension(
			criteriaScore,
			`${input.node.successCriteria.length - missingCriteria.length}/${input.node.successCriteria.length} success criteria covered.`,
		),
		evidence: dimension(evidenceScore, `${evidenceItems.length} evidence reference(s) found.`),
		completeness: dimension(completenessScore, `${output.length} output characters assessed.`),
		reliability: dimension(
			reliabilityScore,
			failure
				? "Failure signal found in output."
				: verification
					? "Verification signal found in output."
					: "No explicit verification signal.",
		),
	};
	const score =
		dimensions.criteria.score * 0.4 +
		dimensions.evidence.score * 0.2 +
		dimensions.completeness.score * 0.2 +
		dimensions.reliability.score * 0.2;
	const confidence = Math.min(
		1,
		0.45 + evidenceScore * 0.3 + (verification ? 0.2 : 0) + (output.length > 200 ? 0.05 : 0),
	);
	const passed = !failure && score >= 0.7 && missingCriteria.length === 0;
	return {
		version: 1,
		id: `evaluation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		runId: input.runId,
		planId: input.planId,
		nodeId: input.node.id,
		attempt: input.attempt,
		passed,
		score,
		confidence,
		dimensions,
		missingCriteria,
		evidence: evidenceItems,
		recommendations: passed
			? []
			: [
					...(missingCriteria.length > 0 ? [`Address missing criteria: ${missingCriteria.join("; ")}`] : []),
					...(evidenceItems.length === 0
						? ["Add concrete evidence such as file references, test output, or source URLs."]
						: []),
					...(failure ? ["Resolve the reported failure before retrying."] : []),
				],
		createdAt: new Date().toISOString(),
	};
}
