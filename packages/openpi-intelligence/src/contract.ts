import { type Static, Type } from "typebox";

export const ContextSourceKindSchema = Type.Union([
	Type.Literal("conversation"),
	Type.Literal("code"),
	Type.Literal("git"),
	Type.Literal("memory"),
	Type.Literal("knowledge"),
	Type.Literal("web"),
]);
export type ContextSourceKind = Static<typeof ContextSourceKindSchema>;

export const RiskLevelSchema = Type.Union([
	Type.Literal("low"),
	Type.Literal("medium"),
	Type.Literal("high"),
	Type.Literal("critical"),
]);
export type RiskLevel = Static<typeof RiskLevelSchema>;

export interface ContextCandidate {
	id: string;
	source: ContextSourceKind;
	uri: string;
	title: string;
	content: string;
	contentHash: string;
	estimatedTokens: number;
	metadata: Record<string, string | number | boolean>;
	provenance: {
		adapter: string;
		observedAt: string;
		revision?: string;
		sourceId?: string;
		sourceRevision?: string;
		updatedAt?: string;
	};
}

export interface ContextScore {
	semantic: number;
	lexical: number;
	symbol: number;
	dependency: number;
	recency: number;
	attention: number;
	authority: number;
	tokenPenalty: number;
	total: number;
	reasons: string[];
}

export interface SelectedContext {
	candidate: ContextCandidate;
	score: ContextScore;
	mode: "full" | "excerpt" | "summary";
	selectedContent: string;
	selectedTokens: number;
	pinned: boolean;
}

export interface CapabilityDescriptor {
	id: string;
	kind: "tool" | "skill" | "command";
	name: string;
	description: string;
	source: string;
	active: boolean;
	tags: string[];
	risk: RiskLevel;
	estimatedCost: number;
	sideEffects: string[];
	inputSchema?: unknown;
}

export const ContextBudgetSchema = Type.Object({
	totalTokens: Type.Integer({ minimum: 1000 }),
	reservedForConversation: Type.Integer({ minimum: 0 }),
	reservedForCompletion: Type.Integer({ minimum: 0 }),
	sourceLimits: Type.Record(ContextSourceKindSchema, Type.Integer({ minimum: 0 })),
	maxItems: Type.Integer({ minimum: 1 }),
});
export type ContextBudget = Static<typeof ContextBudgetSchema>;

export const PlanNodeSchema = Type.Object({
	id: Type.String({ minLength: 1 }),
	title: Type.String({ minLength: 1 }),
	objective: Type.String({ minLength: 1 }),
	dependencies: Type.Array(Type.String()),
	capabilityIds: Type.Array(Type.String()),
	contextQueries: Type.Array(Type.String()),
	contextItemIds: Type.Array(Type.String()),
	inputs: Type.Array(Type.String()),
	outputs: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
	writePaths: Type.Array(Type.String()),
	verification: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
	risk: RiskLevelSchema,
	successCriteria: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
	status: Type.Union([
		Type.Literal("pending"),
		Type.Literal("ready"),
		Type.Literal("running"),
		Type.Literal("completed"),
		Type.Literal("failed"),
		Type.Literal("blocked"),
	]),
	maxAttempts: Type.Integer({ minimum: 1 }),
	timeoutMs: Type.Integer({ minimum: 1 }),
});
export type PlanNode = Static<typeof PlanNodeSchema>;

export const TaskPlanSchema = Type.Object({
	version: Type.Literal(1),
	id: Type.String({ minLength: 1 }),
	goal: Type.String({ minLength: 1 }),
	mode: Type.Union([Type.Literal("direct"), Type.Literal("planned")]),
	nodes: Type.Array(PlanNodeSchema),
	globalSuccessCriteria: Type.Array(Type.String({ minLength: 1 })),
	contextBudget: ContextBudgetSchema,
	createdAt: Type.String({ minLength: 1 }),
});
export type TaskPlan = Static<typeof TaskPlanSchema>;

export const EvaluationDimensionSchema = Type.Object({
	score: Type.Number({ minimum: 0, maximum: 1 }),
	reason: Type.String(),
});
export type EvaluationDimension = Static<typeof EvaluationDimensionSchema>;

export const EvaluationResultSchema = Type.Object({
	version: Type.Literal(1),
	id: Type.String({ minLength: 1 }),
	runId: Type.String({ minLength: 1 }),
	planId: Type.String({ minLength: 1 }),
	nodeId: Type.String({ minLength: 1 }),
	attempt: Type.Integer({ minimum: 1 }),
	passed: Type.Boolean(),
	score: Type.Number({ minimum: 0, maximum: 1 }),
	confidence: Type.Number({ minimum: 0, maximum: 1 }),
	dimensions: Type.Object({
		criteria: EvaluationDimensionSchema,
		evidence: EvaluationDimensionSchema,
		completeness: EvaluationDimensionSchema,
		reliability: EvaluationDimensionSchema,
	}),
	missingCriteria: Type.Array(Type.String()),
	evidence: Type.Array(Type.String()),
	recommendations: Type.Array(Type.String()),
	createdAt: Type.String({ minLength: 1 }),
});
export type EvaluationResult = Static<typeof EvaluationResultSchema>;

export const ReflectionDecisionSchema = Type.Object({
	version: Type.Literal(1),
	id: Type.String({ minLength: 1 }),
	runId: Type.String({ minLength: 1 }),
	planId: Type.String({ minLength: 1 }),
	nodeId: Type.String({ minLength: 1 }),
	decision: Type.Union([Type.Literal("accept"), Type.Literal("retry"), Type.Literal("stop")]),
	reason: Type.String(),
	round: Type.Integer({ minimum: 0 }),
	remainingRounds: Type.Integer({ minimum: 0 }),
	createdAt: Type.String({ minLength: 1 }),
});
export type ReflectionDecision = Static<typeof ReflectionDecisionSchema>;

export const PlanRevisionSchema = Type.Object({
	version: Type.Literal(1),
	id: Type.String({ minLength: 1 }),
	planId: Type.String({ minLength: 1 }),
	parentNodeId: Type.String({ minLength: 1 }),
	round: Type.Integer({ minimum: 1 }),
	revisedNode: PlanNodeSchema,
	reason: Type.String(),
	createdAt: Type.String({ minLength: 1 }),
});
export type PlanRevision = Static<typeof PlanRevisionSchema>;

export interface ReflectionState {
	maxRounds: number;
	roundsByNode: Record<string, number>;
	totalEvaluations: number;
	stopped: boolean;
}

export const TaskIntentSchema = Type.Object({
	version: Type.Literal(1),
	id: Type.String({ minLength: 1 }),
	prompt: Type.String({ minLength: 1 }),
	kind: Type.Union([Type.Literal("read-only"), Type.Literal("work"), Type.Literal("high-risk")]),
	objective: Type.String({ minLength: 1 }),
	deliverables: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
	constraints: Type.Array(Type.String()),
	assumptions: Type.Array(Type.String()),
	ambiguities: Type.Array(Type.String()),
	requiredContext: Type.Array(Type.String()),
	successCriteria: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
	verification: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
	risk: RiskLevelSchema,
	createdAt: Type.String({ minLength: 1 }),
});
export type TaskIntent = Static<typeof TaskIntentSchema>;

export const ReadinessAssessmentSchema = Type.Object({
	version: Type.Literal(1),
	id: Type.String({ minLength: 1 }),
	intentId: Type.String({ minLength: 1 }),
	status: Type.Union([
		Type.Literal("analyzing"),
		Type.Literal("needs-context"),
		Type.Literal("needs-user-input"),
		Type.Literal("needs-approval"),
		Type.Literal("ready"),
		Type.Literal("blocked"),
	]),
	goalDefined: Type.Boolean(),
	deliverablesDefined: Type.Boolean(),
	successCriteriaDefined: Type.Boolean(),
	verificationDefined: Type.Boolean(),
	planValidated: Type.Boolean(),
	missingContext: Type.Array(Type.String()),
	clarifyingQuestions: Type.Array(Type.String()),
	blockers: Type.Array(Type.String()),
	allowedToolNames: Type.Array(Type.String()),
	createdAt: Type.String({ minLength: 1 }),
});
export type ReadinessAssessment = Static<typeof ReadinessAssessmentSchema>;

export interface AgentProfile {
	version: 1;
	id: string;
	role: string;
	objective: string;
	allowedCapabilityIds: string[];
	contextItemIds: string[];
	provider?: string;
	model?: string;
	maxTurns: number;
	timeoutMs: number;
	writePaths: string[];
	risk: RiskLevel;
}

export interface DelegatedTask {
	version: 1;
	id: string;
	runId: string;
	planId: string;
	nodeId: string;
	profile: AgentProfile;
	status: "queued" | "running" | "completed" | "failed" | "cancelled" | "timed-out";
	pid?: number;
	result?: string;
	error?: string;
	createdAt: string;
	startedAt?: string;
	completedAt?: string;
}

export interface WorkflowNodeState {
	nodeId: string;
	status: "pending" | "ready" | "running" | "completed" | "failed" | "blocked" | "cancelled";
	delegatedTaskId?: string;
	attempts: number;
	result?: string;
	error?: string;
}

export interface WorkflowRun {
	version: 1;
	id: string;
	intelligenceRunId: string;
	planId: string;
	status: "pending" | "running" | "completed" | "failed" | "cancelled" | "awaiting-approval";
	nodes: WorkflowNodeState[];
	writeOwners: Record<string, string>;
	createdAt: string;
	updatedAt: string;
}

export interface MemoryRecord {
	version: 1;
	id: string;
	type: "preference" | "constraint" | "decision" | "lesson";
	content: string;
	confidence: number;
	sourceRunId: string;
	sourceEvaluationId: string;
	createdAt: string;
	expiresAt?: string;
	status: "active" | "corrected" | "expired";
	correction?: string;
}

export interface ApprovalRecord {
	version: 1;
	id: string;
	runId: string;
	nodeId: string;
	risk: RiskLevel;
	decision: "pending" | "approved" | "denied" | "expired";
	reason: string;
	createdAt: string;
	expiresAt?: string;
	resolvedAt?: string;
}

export interface IntelligenceRun {
	version: 1;
	id: string;
	prompt: string;
	startedAt: string;
	selectedContext: SelectedContext[];
	capabilities: CapabilityDescriptor[];
	plan?: TaskPlan;
	planSource?: "model" | "fallback";
	planFallbackError?: string;
	evaluations?: EvaluationResult[];
	reflections?: ReflectionDecision[];
	revisions?: PlanRevision[];
	reflectionState?: ReflectionState;
	delegatedTasks?: DelegatedTask[];
	workflow?: WorkflowRun;
	memories?: MemoryRecord[];
	approvals?: ApprovalRecord[];
	intent?: TaskIntent;
	readiness?: ReadinessAssessment;
}
