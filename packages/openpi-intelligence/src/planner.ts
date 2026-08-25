import type { UserMessage } from "@earendil-works/pi-ai";
import { complete } from "@earendil-works/pi-ai/compat";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { CapabilityDescriptor, ContextBudget, PlanNode, RiskLevel, TaskIntent, TaskPlan } from "./contract.ts";

const complexSignals = [
	/\b(?:research|compare|investigate|migrate|refactor|implement|design|audit|plan)\b/i,
	/(?:调研|比较|迁移|重构|实现|设计|审计|规划|排查)/,
	/\b(?:and then|after that|multiple|parallel)\b/i,
];

export function shouldPlan(prompt: string, capabilityCount: number): boolean {
	if (prompt.length > 800 || capabilityCount > 2) return true;
	return complexSignals.some((pattern) => pattern.test(prompt));
}

function capabilityIds(capabilities: CapabilityDescriptor[], names: RegExp, limit: number): string[] {
	const matched = capabilities.filter((capability) => names.test(capability.name)).map((capability) => capability.id);
	return matched.length > 0
		? matched.slice(0, limit)
		: capabilities
				.filter((capability) => capability.risk !== "critical")
				.slice(0, limit)
				.map((capability) => capability.id);
}

function riskOf(capabilities: CapabilityDescriptor[], ids: string[]): RiskLevel {
	const selected = capabilities.filter((capability) => ids.includes(capability.id));
	if (selected.some((capability) => capability.risk === "critical")) return "critical";
	if (selected.some((capability) => capability.risk === "high")) return "high";
	if (selected.some((capability) => capability.risk === "medium")) return "medium";
	return "low";
}

function node(
	values: Omit<PlanNode, "status" | "maxAttempts" | "timeoutMs"> &
		Partial<Pick<PlanNode, "status" | "maxAttempts" | "timeoutMs">>,
): PlanNode {
	return {
		...values,
		status: values.status ?? (values.dependencies.length === 0 ? "ready" : "pending"),
		maxAttempts: values.maxAttempts ?? 2,
		timeoutMs: values.timeoutMs ?? 300_000,
	};
}

export function createIntentPlan(
	intent: TaskIntent,
	capabilities: CapabilityDescriptor[],
	contextItemIds: string[],
	budget: ContextBudget,
): TaskPlan {
	const inspectCapabilities = capabilityIds(
		capabilities,
		/^(read|ls|find|grep|code_search|git_status|git_log|memory_list|kb_query)$/,
		4,
	);
	const writeCapabilities = capabilityIds(capabilities, /^(edit|write|bash)$/, 3);
	const verifyCapabilities = capabilityIds(capabilities, /^(bash|read|git_status|code_search)$/, 3);
	const nodes: PlanNode[] =
		intent.kind === "read-only"
			? [
					node({
						id: "inspect-and-answer",
						title: "Inspect authoritative context and answer",
						objective: intent.objective,
						dependencies: [],
						capabilityIds: inspectCapabilities,
						contextQueries: [...intent.requiredContext, intent.objective],
						contextItemIds,
						inputs: [...intent.requiredContext],
						outputs: [...intent.deliverables],
						writePaths: [],
						verification: [...intent.verification],
						risk: riskOf(capabilities, inspectCapabilities),
						successCriteria: [...intent.successCriteria],
					}),
				]
			: [
					node({
						id: "inspect",
						title: "Inspect scope and current behavior",
						objective: `Determine the exact implementation scope and current behavior for: ${intent.objective}`,
						dependencies: [],
						capabilityIds: inspectCapabilities,
						contextQueries: [...intent.requiredContext, intent.objective],
						contextItemIds,
						inputs: [...intent.requiredContext],
						outputs: ["Confirmed scope, affected files, current behavior, and implementation constraints."],
						writePaths: [],
						verification: ["Cite inspected files, symbols, or runtime evidence."],
						risk: riskOf(capabilities, inspectCapabilities),
						successCriteria: [
							"Affected implementation scope is identified.",
							"Current behavior or failure condition is evidenced.",
							"Verification approach is explicit.",
						],
					}),
					node({
						id: "implement",
						title: "Implement the scoped change",
						objective: intent.objective,
						dependencies: ["inspect"],
						capabilityIds: writeCapabilities,
						contextQueries: [intent.objective],
						contextItemIds,
						inputs: ["Completed inspect-node result."],
						outputs: [...intent.deliverables],
						writePaths: ["<derive-from-inspect>"],
						verification: [...intent.verification],
						risk: intent.risk === "critical" ? "critical" : "high",
						successCriteria: [...intent.successCriteria],
					}),
					node({
						id: "verify",
						title: "Verify completion and regression safety",
						objective: `Verify the completed result for: ${intent.objective}`,
						dependencies: ["implement"],
						capabilityIds: verifyCapabilities,
						contextQueries: [intent.objective],
						contextItemIds,
						inputs: ["Implementation result and changed paths."],
						outputs: ["Concrete verification evidence and final completion status."],
						writePaths: [],
						verification: [...intent.verification],
						risk: riskOf(capabilities, verifyCapabilities),
						successCriteria: [
							"Relevant validation passes or failures are reported precisely.",
							"The final result satisfies the requested deliverable.",
							"No unrelated regression is observed.",
						],
					}),
				];
	return {
		version: 1,
		id: `plan-${Date.now()}`,
		goal: intent.objective,
		mode: intent.kind === "read-only" && !shouldPlan(intent.prompt, capabilities.length) ? "direct" : "planned",
		nodes,
		globalSuccessCriteria: [...intent.successCriteria],
		contextBudget: budget,
		createdAt: new Date().toISOString(),
	};
}

export function createDeterministicPlan(
	prompt: string,
	capabilities: CapabilityDescriptor[],
	contextItemIds: string[],
	budget: ContextBudget,
): TaskPlan {
	const intent: TaskIntent = {
		version: 1,
		id: `intent-${Date.now()}`,
		prompt,
		kind: shouldPlan(prompt, capabilities.length) ? "work" : "read-only",
		objective: prompt,
		deliverables: [`Completed result for: ${prompt}`],
		constraints: [],
		assumptions: [],
		ambiguities: [],
		requiredContext: ["Relevant authoritative context."],
		successCriteria: ["The user request is completed and the result is verified."],
		verification: ["Inspect the result and provide concrete evidence."],
		risk: "low",
		createdAt: new Date().toISOString(),
	};
	return createIntentPlan(intent, capabilities, contextItemIds, budget);
}

export function plannerInstructions(capabilities: CapabilityDescriptor[]): string {
	const list = capabilities
		.map((capability) => `- ${capability.id}: ${capability.description} (risk=${capability.risk})`)
		.join("\n");
	return `Create a concrete JSON TaskPlan DAG. Use only these capability IDs:\n${list}\nEvery node must define inputs, outputs, writePaths, verification, and specific successCriteria. Inspect before modifying and verify after implementation.`;
}

function stringArray(value: unknown, fallback: string[] = []): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : fallback;
}

function normalizeModelPlan(
	value: unknown,
	intent: TaskIntent,
	contextItemIds: string[],
	budget: ContextBudget,
): TaskPlan {
	if (!value || typeof value !== "object") throw new Error("Planner did not return an object.");
	const record = value as Record<string, unknown>;
	const rawNodes = Array.isArray(record.nodes) ? record.nodes : [];
	if (rawNodes.length === 0) throw new Error("Planner returned no nodes.");
	const nodes: PlanNode[] = rawNodes.map((rawNode, index) => {
		if (!rawNode || typeof rawNode !== "object") throw new Error(`Planner node ${index} is invalid.`);
		const item = rawNode as Record<string, unknown>;
		const id = typeof item.id === "string" && item.id ? item.id : `node-${index + 1}`;
		const dependencies = stringArray(item.dependencies);
		return {
			id,
			title: typeof item.title === "string" && item.title ? item.title : id,
			objective: typeof item.objective === "string" && item.objective ? item.objective : intent.objective,
			dependencies,
			capabilityIds: stringArray(item.capabilityIds),
			contextQueries: stringArray(item.contextQueries, [intent.objective]),
			contextItemIds: stringArray(item.contextItemIds, contextItemIds),
			inputs: stringArray(item.inputs, [...intent.requiredContext]),
			outputs: stringArray(item.outputs, [...intent.deliverables]),
			writePaths: stringArray(item.writePaths),
			verification: stringArray(item.verification, [...intent.verification]),
			risk:
				item.risk === "low" || item.risk === "medium" || item.risk === "high" || item.risk === "critical"
					? item.risk
					: intent.risk,
			successCriteria: stringArray(item.successCriteria, [...intent.successCriteria]),
			status:
				item.status === "running" ||
				item.status === "completed" ||
				item.status === "failed" ||
				item.status === "blocked"
					? item.status
					: dependencies.length === 0
						? "ready"
						: "pending",
			maxAttempts: typeof item.maxAttempts === "number" && Number.isInteger(item.maxAttempts) ? item.maxAttempts : 2,
			timeoutMs: typeof item.timeoutMs === "number" && Number.isInteger(item.timeoutMs) ? item.timeoutMs : 300_000,
		};
	});
	return {
		version: 1,
		id: typeof record.id === "string" && record.id ? record.id : `plan-${Date.now()}`,
		goal: typeof record.goal === "string" && record.goal ? record.goal : intent.objective,
		mode: record.mode === "direct" ? "direct" : "planned",
		nodes,
		globalSuccessCriteria: stringArray(record.globalSuccessCriteria, [...intent.successCriteria]),
		contextBudget: budget,
		createdAt: typeof record.createdAt === "string" && record.createdAt ? record.createdAt : new Date().toISOString(),
	};
}

export async function createStartupPlan(options: {
	planning: "auto" | "always" | "never";
	ctx: ExtensionContext;
	intent: TaskIntent;
	capabilities: CapabilityDescriptor[];
	contextItemIds: string[];
	budget: ContextBudget;
	signal?: AbortSignal;
}): Promise<{ plan: TaskPlan; source: "model" | "fallback"; error?: string }> {
	const fallback = createIntentPlan(options.intent, options.capabilities, options.contextItemIds, options.budget);
	if (options.planning !== "always") return { plan: fallback, source: "fallback" };
	return createModelDrivenPlan(
		options.ctx,
		options.intent,
		options.capabilities,
		options.contextItemIds,
		options.budget,
		options.signal,
	);
}

export async function createModelDrivenPlan(
	ctx: ExtensionContext,
	intent: TaskIntent,
	capabilities: CapabilityDescriptor[],
	contextItemIds: string[],
	budget: ContextBudget,
	signal?: AbortSignal,
): Promise<{ plan: TaskPlan; source: "model" | "fallback"; error?: string }> {
	const fallback = createIntentPlan(intent, capabilities, contextItemIds, budget);
	if (!ctx.model) return { plan: fallback, source: "fallback", error: "No active model." };
	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
	if (!auth.ok || !auth.apiKey) {
		return { plan: fallback, source: "fallback", error: auth.ok ? "No model API key." : auth.error };
	}
	const capabilityList = capabilities.slice(0, 30).map((capability) => ({
		id: capability.id,
		description: capability.description,
		risk: capability.risk,
		sideEffects: capability.sideEffects,
	}));
	const prompt = `Produce only valid JSON for a TaskPlan. Do not include markdown fences.

Intent:
${JSON.stringify(intent, null, 2)}

Available capabilities:
${JSON.stringify(capabilityList, null, 2)}

Context item IDs:
${JSON.stringify(contextItemIds)}

Requirements:
- version must be 1
- mode must be direct or planned
- maximum 8 nodes and dependency depth 4
- use only listed capability IDs
- graph must be acyclic
- every node requires id, title, objective, dependencies, capabilityIds, contextQueries, contextItemIds, inputs, outputs, writePaths, verification, risk, successCriteria, status, maxAttempts, timeoutMs
- inspect before state-changing work
- implementation nodes depend on inspection
- verification nodes depend on implementation
- writePaths must be concrete when known; otherwise use [] and require inspection output
- successCriteria and verification must be specific to the objective
- contextBudget must equal the supplied budget

Budget:
${JSON.stringify(budget, null, 2)}`;
	const message: UserMessage = {
		role: "user",
		content: [{ type: "text", text: prompt }],
		timestamp: Date.now(),
	};
	try {
		const response = await complete(
			ctx.model,
			{
				systemPrompt: "You are a task planning compiler. Return one strict JSON object and no prose.",
				messages: [message],
			},
			{ apiKey: auth.apiKey, headers: auth.headers, env: auth.env, signal },
		);
		const text = response.content
			.filter((part): part is { type: "text"; text: string } => part.type === "text")
			.map((part) => part.text)
			.join("\n")
			.trim();
		const normalized = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
		const parsed: unknown = JSON.parse(normalized);
		return { plan: normalizeModelPlan(parsed, intent, contextItemIds, budget), source: "model" };
	} catch (error) {
		return { plan: fallback, source: "fallback", error: error instanceof Error ? error.message : String(error) };
	}
}
