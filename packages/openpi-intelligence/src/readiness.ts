import type { CapabilityDescriptor, ReadinessAssessment, SelectedContext, TaskIntent, TaskPlan } from "./contract.ts";
import { shouldPlan } from "./planner.ts";
import { validateTaskPlan } from "./validate.ts";

const highRiskPattern = /\b(?:delete|remove|deploy|publish|production|reset|force|sudo|drop database)\b/i;
const highRiskPatternZh = /(?:删除|移除|部署|生产环境|发布|重置|强制|删库)/;
const workPattern = /\b(?:fix|implement|add|change|modify|edit|write|refactor|migrate|build|create|install|upgrade)\b/i;
const workPatternZh = /(?:修复|实现|增加|添加|修改|重构|迁移|构建|创建|安装|升级|开发)/;
const ambiguityPattern = /\b(?:something|whatever|somehow|make it better|improve it)\b/i;
const ambiguityPatternZh = /(?:随便|都行|优化一下|改好一点|做一下|弄一下)/;

export const INVESTIGATION_TOOL_NAMES = new Set([
	"read",
	"ls",
	"find",
	"grep",
	"code_search",
	"git_status",
	"git_log",
	"git_blame",
	"memory_list",
	"kb_query",
	"kb_list",
]);

export const READ_ONLY_TOOL_NAMES = new Set([
	"read",
	"ls",
	"find",
	"grep",
	"code_search",
	"git_status",
	"git_log",
	"git_blame",
	"memory_list",
	"kb_query",
	"kb_list",
	"context_status",
	"context_pin",
	"context_exclude",
	"skill_registry",
	"intelligence_plan",
	"intelligence_evaluate",
	"intelligence_reflect",
	"intelligence_memory_list",
	"intelligence_workflow_status",
	"intelligence_delegate_status",
]);

const executionToolNames = new Set([
	"write",
	"edit",
	"bash",
	"interactive_shell",
	"git_commit",
	"git_branch",
	"kb_add",
	"kb_remove",
	"schedule_create",
	"schedule_trigger",
	"schedule_delete",
	"sub_agent_create",
	"intelligence_delegate",
	"intelligence_workflow_start",
	"intelligence_workflow_step",
	"intelligence_memory_store",
]);

export type StartupPlanningDecision = {
	mode: "direct" | "internal-plan";
	reason: string;
};

const workspaceReferencePattern =
	/(?:\b(?:workspace|repo(?:sitory)?|project|file|files|folder|directory|package|test|tests|spec|error|exception|stack trace|fails? when|reproduce)\b|[\w./-]+\.[A-Za-z0-9]+(?::\d+)?)/i;
const workspaceReferencePatternZh = /(?:工作区|仓库|项目|文件|目录|测试|错误|异常|堆栈|复现|失败)/;

/**
 * Pure startup gate for avoiding intelligence overhead on conversational turns.
 * It deliberately uses no capability count: the full registry is always large,
 * which would turn every prompt into a plan through shouldPlan's count signal.
 */
export function decideStartupPlanning(
	prompt: string,
	planning: "auto" | "always" | "never" = "auto",
): StartupPlanningDecision {
	const intent = inferTaskIntent(prompt);
	if (planning === "always") return { mode: "internal-plan", reason: "Planning is explicitly required." };
	if (planning === "never") return { mode: "direct", reason: "Planning is disabled." };
	const referencesWorkspace = workspaceReferencePattern.test(prompt) || workspaceReferencePatternZh.test(prompt);
	const complex = shouldPlan(prompt, 0);
	const readinessRequiresPlanning =
		intent.kind !== "read-only" || intent.risk !== "low" || intent.ambiguities.length > 0;
	if (complex || referencesWorkspace || readinessRequiresPlanning) {
		return {
			mode: "internal-plan",
			reason: complex
				? "The prompt has multi-step or complex planning signals."
				: referencesWorkspace
					? "The prompt references workspace state, files, tests, or an error."
					: "The inferred task intent requires readiness assessment.",
		};
	}
	return { mode: "direct", reason: "Simple non-work conversational request." };
}

export function inferTaskIntent(prompt: string): TaskIntent {
	const normalized = prompt.trim();
	const highRisk = highRiskPattern.test(normalized) || highRiskPatternZh.test(normalized);
	const work = highRisk || workPattern.test(normalized) || workPatternZh.test(normalized);
	const ambiguous = ambiguityPattern.test(normalized) || ambiguityPatternZh.test(normalized) || normalized.length < 4;
	const kind: TaskIntent["kind"] = highRisk ? "high-risk" : work ? "work" : "read-only";
	const objective = normalized.replace(/^(?:please|请|帮我|麻烦)\s*/i, "") || "Clarify the requested task.";
	const deliverable =
		kind === "read-only"
			? `A direct, evidence-based answer to: ${objective}`
			: `A verified implementation result for: ${objective}`;
	const successCriteria =
		kind === "read-only"
			? ["The answer directly addresses the request.", "Claims are grounded in inspected sources or tool output."]
			: [
					"The requested behavior is implemented within the confirmed scope.",
					"The result is verified with concrete evidence.",
					"No unrelated functionality is removed or changed.",
				];
	const verification =
		kind === "read-only"
			? ["Inspect the authoritative source and report the exact result."]
			: ["Inspect the changed files or resulting state.", "Run the narrowest relevant validation or test."];
	return {
		version: 1,
		id: `intent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		prompt: normalized,
		kind,
		objective,
		deliverables: [deliverable],
		constraints:
			kind === "read-only"
				? ["Do not modify project state."]
				: ["Keep changes scoped to the objective.", "Preserve intentional functionality."],
		assumptions: [],
		ambiguities: ambiguous ? ["The requested outcome or scope is not specific enough to execute safely."] : [],
		requiredContext:
			kind === "read-only"
				? ["Authoritative source for the requested fact."]
				: ["Relevant implementation files.", "Current behavior or failure evidence.", "Verification method."],
		successCriteria,
		verification,
		risk: highRisk ? "critical" : work ? "high" : "low",
		createdAt: new Date().toISOString(),
	};
}

export function assessReadiness(
	intent: TaskIntent,
	context: SelectedContext[],
	plan: TaskPlan | undefined,
	capabilities: CapabilityDescriptor[],
	plannerLimits: { maxNodes: number; maxDepth: number; maxCapabilitiesPerNode: number },
	investigationEvidence: string[] = [],
): ReadinessAssessment {
	const planValidation = plan
		? validateTaskPlan(plan, new Set(capabilities.map((capability) => capability.id)), plannerLimits)
		: { valid: false, errors: ["No validated plan exists."] };
	const promptHasConcreteReference =
		/(?:[\w./-]+\.[A-Za-z0-9]+(?::\d+)?|\b(?:error|exception|stack trace|reproduce|fails? when)\b)/i.test(
			intent.prompt,
		) || /(?:错误|异常|堆栈|复现|失败时)/.test(intent.prompt);
	const strongContext = context.some((item) => item.score.total >= 0.7 || item.pinned);
	const actionableContext = promptHasConcreteReference || strongContext || investigationEvidence.length > 0;
	const missingContext = intent.kind === "read-only" || actionableContext ? [] : [...intent.requiredContext];
	const blockers = [...(!planValidation.valid && intent.kind !== "read-only" ? planValidation.errors : [])];
	let status: ReadinessAssessment["status"];
	if (intent.ambiguities.length > 0) status = "needs-user-input";
	else if (missingContext.length > 0) status = "needs-context";
	else if (intent.kind === "high-risk") status = "needs-approval";
	else if (intent.kind === "work" && !planValidation.valid) status = "analyzing";
	else status = "ready";
	const clarifyingQuestions =
		intent.ambiguities.length > 0 ? ["What exact outcome, scope, and deliverable should be produced?"] : [];
	return {
		version: 1,
		id: `readiness-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		intentId: intent.id,
		status,
		goalDefined: intent.objective.length > 0,
		deliverablesDefined: intent.deliverables.length > 0,
		successCriteriaDefined: intent.successCriteria.length > 0,
		verificationDefined: intent.verification.length > 0,
		planValidated: planValidation.valid,
		missingContext,
		clarifyingQuestions,
		blockers,
		allowedToolNames: status === "ready" ? [] : [...READ_ONLY_TOOL_NAMES],
		createdAt: new Date().toISOString(),
	};
}

export function isReadOnlyBashCommand(command: string): boolean {
	if (/[;&|><`$()]/.test(command)) return false;
	return /^(?:pwd|ls\b|find\b|grep\b|rg\b|cat\b|head\b|tail\b|wc\b|sed\s+-n\b|git\s+(?:status|log|diff|show|branch\s+(?:--list|-a))\b)/.test(
		command.trim(),
	);
}

export function isExecutionTool(toolName: string): boolean {
	return executionToolNames.has(toolName);
}

export function executionBlockReason(toolName: string, readiness: ReadinessAssessment | undefined): string | undefined {
	if (!isExecutionTool(toolName)) return undefined;
	if (!readiness)
		return `Execution blocked: task readiness has not been assessed. Use read-only investigation and intelligence_plan first.`;
	if (readiness.status === "ready") return undefined;
	return `Execution blocked for ${toolName}: readiness=${readiness.status}. ${[
		...readiness.blockers,
		...readiness.missingContext.map((item) => `Missing context: ${item}`),
		...readiness.clarifyingQuestions,
	].join(" ")}`;
}
