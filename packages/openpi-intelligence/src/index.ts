/** Agent Intelligence Layer V1: dynamic context, capability registry, and structured planning.
 * Sub-agents use shared spawn-pi helper (`./spawn-pi.ts`).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { loadApprovalQueue, requestNodeApproval, resolveApproval } from "./approval.ts";
import { DEFAULT_INTELLIGENCE_CONFIG, loadIntelligenceConfig } from "./config.ts";
import {
	buildContextSnapshot,
	type ContextSnapshot,
	renderContextSnapshot,
	saveContextPreference,
} from "./context/engine.ts";
import type { IntelligenceRun } from "./contract.ts";
import { createAgentProfile, DynamicSubAgentManager } from "./dynamic-sub-agent.ts";
import { evaluateNode } from "./evaluator.ts";
import { analyzeEvolution } from "./evolution.ts";
import {
	correctMemory,
	createMemoryCandidate,
	loadManagedMemories,
	memoryCompactionInstructions,
	upsertMemory,
} from "./memory-manager.ts";
import { createIntentPlan, createModelDrivenPlan, createStartupPlan } from "./planner.ts";
import {
	assessReadiness,
	decideStartupPlanning,
	executionBlockReason,
	INVESTIGATION_TOOL_NAMES,
	inferTaskIntent,
	isReadOnlyBashCommand,
} from "./readiness.ts";
import { applyReflectionDecision, createReflectionState, decideReflection } from "./reflection.ts";
import { buildCapabilityRegistry, matchCapabilities } from "./registry.ts";
import { EventLedger } from "./storage/event-ledger.ts";
import { validateTaskPlan } from "./validate.ts";
import {
	claimWritePaths,
	createWorkflow,
	nodeState,
	readyNodes,
	refreshWorkflow,
	releaseWritePaths,
} from "./workflow.ts";

interface RuntimeState {
	latest?: IntelligenceRun;
	snapshot?: ContextSnapshot;
	investigationEvidence: string[];
}

function runId(): string {
	return `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function runDirectory(cwd: string, id: string): string {
	return path.join(cwd, ".pi", "intelligence", "runs", id);
}

function persistRun(cwd: string, run: IntelligenceRun): void {
	const directory = runDirectory(cwd, run.id);
	fs.mkdirSync(directory, { recursive: true });
	fs.writeFileSync(path.join(directory, "manifest.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
}

function loadLatestRun(cwd: string): IntelligenceRun | undefined {
	const runsDirectory = path.join(cwd, ".pi", "intelligence", "runs");
	try {
		const latest = fs
			.readdirSync(runsDirectory, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name)
			.sort()
			.at(-1);
		if (!latest) return undefined;
		const value: unknown = JSON.parse(fs.readFileSync(path.join(runsDirectory, latest, "manifest.json"), "utf8"));
		return value && typeof value === "object" && "version" in value ? (value as IntelligenceRun) : undefined;
	} catch {
		return undefined;
	}
}

export default function (pi: ExtensionAPI) {
	const state: RuntimeState = { investigationEvidence: [] };
	const subAgents = new DynamicSubAgentManager();
	let config = DEFAULT_INTELLIGENCE_CONFIG;

	pi.registerTool({
		name: "context_status",
		label: "Context Status",
		description: "Show the latest dynamic context selection, scores, sources, and token usage.",
		promptSnippet: "Use context_status to inspect why context was selected",
		parameters: Type.Object({}),
		async execute() {
			const snapshot = state.snapshot;
			if (!snapshot)
				return {
					content: [{ type: "text", text: "No dynamic context snapshot has been created yet." }],
					details: { runId: "", count: 0, tokens: 0 },
				};
			const lines = snapshot.selected.map(
				(item) =>
					`${item.candidate.source} ${item.candidate.uri} score=${item.score.total.toFixed(3)} tokens=${item.selectedTokens} mode=${item.mode}`,
			);
			return {
				content: [{ type: "text", text: lines.join("\n") || "No context selected." }],
				details: {
					runId: snapshot.runId,
					count: snapshot.selected.length,
					tokens: snapshot.selected.reduce((total, item) => total + item.selectedTokens, 0),
				},
			};
		},
	});

	pi.registerTool({
		name: "context_pin",
		label: "Context Pin",
		description: "Pin a context URI so it receives priority in future turns.",
		promptSnippet: "Use context_pin to prioritize a file or context URI",
		parameters: Type.Object({ uri: Type.String({ minLength: 1 }) }),
		async execute(_id, params, _signal, _update, ctx) {
			saveContextPreference(ctx.cwd, "pins", params.uri);
			return { content: [{ type: "text", text: `Pinned context: ${params.uri}` }], details: { uri: params.uri } };
		},
	});

	pi.registerTool({
		name: "context_exclude",
		label: "Context Exclude",
		description: "Exclude a path or URI from future dynamic context selection.",
		promptSnippet: "Use context_exclude to prevent a path from entering context",
		parameters: Type.Object({ pattern: Type.String({ minLength: 1 }) }),
		async execute(_id, params, _signal, _update, ctx) {
			saveContextPreference(ctx.cwd, "exclusions", params.pattern);
			return {
				content: [{ type: "text", text: `Excluded context pattern: ${params.pattern}` }],
				details: { pattern: params.pattern },
			};
		},
	});

	pi.registerTool({
		name: "skill_registry",
		label: "Skill Registry",
		description: "List or match dynamically registered tools, skills, and commands.",
		promptSnippet: "Use skill_registry to discover the best available capabilities",
		parameters: Type.Object({
			query: Type.Optional(Type.String()),
			limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 30 })),
		}),
		async execute(_id, params) {
			const registry = buildCapabilityRegistry(pi);
			const matches = params.query
				? matchCapabilities(registry, params.query, params.limit ?? 10)
				: registry.slice(0, params.limit ?? 30);
			return {
				content: [
					{
						type: "text",
						text: matches
							.map(
								(capability) =>
									`${capability.id} risk=${capability.risk} active=${capability.active}: ${capability.description}`,
							)
							.join("\n"),
					},
				],
				details: { count: matches.length },
			};
		},
	});

	pi.registerTool({
		name: "intelligence_plan",
		label: "Intelligence Plan",
		description: "Create and validate a bounded task plan using current context and available capabilities.",
		promptSnippet: "Use intelligence_plan for complex multi-step tasks",
		parameters: Type.Object({ objective: Type.Optional(Type.String()) }),
		async execute(_id, params, signal, _update, ctx) {
			const objective = params.objective ?? state.latest?.prompt ?? "Complete the current task.";
			const registry = buildCapabilityRegistry(pi);
			const matched = matchCapabilities(registry, objective, 12);
			const intent = state.latest?.intent?.prompt === objective ? state.latest.intent : inferTaskIntent(objective);
			const contextItemIds = state.snapshot?.selected.map((item) => item.candidate.id) ?? [];
			const generated = await createModelDrivenPlan(
				ctx,
				intent,
				matched,
				contextItemIds,
				config.contextBudget,
				signal,
			);
			let plan = generated.plan;
			let source = generated.source;
			let fallbackError = generated.error;
			let validation = validateTaskPlan(plan, new Set(registry.map((capability) => capability.id)), config.planner);
			if (!validation.valid && source === "model") {
				fallbackError = `Model plan validation failed: ${validation.errors.join("; ")}`;
				plan = createIntentPlan(intent, matched, contextItemIds, config.contextBudget);
				source = "fallback";
				validation = validateTaskPlan(plan, new Set(registry.map((capability) => capability.id)), config.planner);
			}
			if (!validation.valid)
				return {
					content: [{ type: "text", text: `Plan validation failed:\n${validation.errors.join("\n")}` }],
					details: { valid: false, errors: validation.errors },
				};
			state.latest = {
				...(state.latest ?? {
					version: 1 as const,
					id: runId(),
					startedAt: new Date().toISOString(),
					selectedContext: state.snapshot?.selected ?? [],
				}),
				prompt: objective,
				capabilities: registry,
				intent,
				plan,
			};
			state.latest.readiness = assessReadiness(
				intent,
				state.latest.selectedContext,
				plan,
				registry,
				config.planner,
				state.investigationEvidence,
			);
			persistRun(ctx.cwd, state.latest);
			new EventLedger(ctx.cwd, state.latest.id).append({
				version: 1,
				runId: state.latest.id,
				timestamp: new Date().toISOString(),
				event: "plan.generated",
				data: { planId: plan.id, source, nodes: plan.nodes.length, fallbackError },
			});
			return {
				content: [{ type: "text", text: JSON.stringify(plan, null, 2) }],
				details: { valid: true, mode: plan.mode, nodes: plan.nodes.length, source },
			};
		},
	});

	pi.registerTool({
		name: "intelligence_evaluate",
		label: "Intelligence Evaluate",
		description: "Evaluate a plan-node result against its success criteria using bounded deterministic scoring.",
		promptSnippet: "Use intelligence_evaluate after completing a planned node",
		parameters: Type.Object({
			nodeId: Type.String({ minLength: 1 }),
			output: Type.String(),
			evidence: Type.Optional(Type.Array(Type.String())),
		}),
		async execute(_id, params, _signal, _update, ctx) {
			const run = state.latest;
			const plan = run?.plan;
			const node =
				plan?.nodes.find((candidate) => candidate.id === params.nodeId) ??
				run?.revisions?.map((revision) => revision.revisedNode).find((candidate) => candidate.id === params.nodeId);
			if (!run || !plan || !node) {
				return {
					content: [{ type: "text", text: `Plan node not found: ${params.nodeId}` }],
					details: { found: false, nodeId: params.nodeId, passed: false, score: 0 },
				};
			}
			const previousAttempts = run.evaluations?.filter((evaluation) => evaluation.nodeId === node.id).length ?? 0;
			const evaluation = evaluateNode({
				runId: run.id,
				planId: plan.id,
				node,
				attempt: previousAttempts + 1,
				output: params.output,
				evidence: params.evidence,
			});
			run.evaluations = [...(run.evaluations ?? []), evaluation];
			run.reflectionState = run.reflectionState ?? createReflectionState();
			persistRun(ctx.cwd, run);
			new EventLedger(ctx.cwd, run.id).append({
				version: 1,
				runId: run.id,
				timestamp: new Date().toISOString(),
				event: "evaluation.completed",
				data: {
					nodeId: node.id,
					passed: evaluation.passed,
					score: evaluation.score,
					confidence: evaluation.confidence,
				},
			});
			return {
				content: [{ type: "text", text: JSON.stringify(evaluation, null, 2) }],
				details: { found: true, nodeId: node.id, passed: evaluation.passed, score: evaluation.score },
			};
		},
	});

	pi.registerTool({
		name: "intelligence_reflect",
		label: "Intelligence Reflect",
		description:
			"Apply one bounded reflection decision to the latest evaluation and optionally create a revised node.",
		promptSnippet: "Use intelligence_reflect only after intelligence_evaluate reports a failure",
		parameters: Type.Object({ nodeId: Type.String({ minLength: 1 }) }),
		async execute(_id, params, _signal, _update, ctx) {
			const run = state.latest;
			const plan = run?.plan;
			const node =
				plan?.nodes.find((candidate) => candidate.id === params.nodeId) ??
				run?.revisions?.map((revision) => revision.revisedNode).find((candidate) => candidate.id === params.nodeId);
			const evaluation = run?.evaluations?.filter((candidate) => candidate.nodeId === params.nodeId).at(-1);
			if (!run || !plan || !node || !evaluation) {
				return {
					content: [{ type: "text", text: `No evaluated plan node found: ${params.nodeId}` }],
					details: { found: false, nodeId: params.nodeId, decision: "stop", revisionId: "" },
				};
			}
			const reflectionState = run.reflectionState ?? createReflectionState();
			const decision = decideReflection(evaluation, reflectionState);
			const applied = applyReflectionDecision(node, evaluation, decision, reflectionState);
			run.reflectionState = applied.state;
			run.reflections = [...(run.reflections ?? []), decision];
			if (applied.revision) run.revisions = [...(run.revisions ?? []), applied.revision];
			persistRun(ctx.cwd, run);
			const ledger = new EventLedger(ctx.cwd, run.id);
			ledger.append({
				version: 1,
				runId: run.id,
				timestamp: new Date().toISOString(),
				event: "reflection.decided",
				data: { nodeId: node.id, decision: decision.decision, round: decision.round, reason: decision.reason },
			});
			if (applied.revision) {
				ledger.append({
					version: 1,
					runId: run.id,
					timestamp: new Date().toISOString(),
					event: "plan.revised",
					data: { revisionId: applied.revision.id, parentNodeId: node.id, round: applied.revision.round },
				});
			}
			return {
				content: [{ type: "text", text: JSON.stringify({ decision, revision: applied.revision }, null, 2) }],
				details: {
					found: true,
					nodeId: node.id,
					decision: decision.decision,
					revisionId: applied.revision?.id ?? "",
				},
			};
		},
	});

	pi.registerTool({
		name: "intelligence_delegate",
		label: "Intelligence Delegate",
		description: "Delegate one TaskPlan node to a minimal-permission dynamic sub-agent.",
		promptSnippet: "Use intelligence_delegate to execute an independent ready plan node",
		parameters: Type.Object({
			nodeId: Type.String({ minLength: 1 }),
			provider: Type.Optional(Type.String()),
			model: Type.Optional(Type.String()),
			writePaths: Type.Optional(Type.Array(Type.String())),
		}),
		async execute(_id, params, _signal, _update, ctx) {
			const run = state.latest;
			const plan = run?.plan;
			const node =
				plan?.nodes.find((candidate) => candidate.id === params.nodeId) ??
				run?.revisions?.map((revision) => revision.revisedNode).find((candidate) => candidate.id === params.nodeId);
			if (!run || !plan || !node)
				return {
					content: [{ type: "text", text: `Plan node not found: ${params.nodeId}` }],
					details: { started: false, taskId: "", status: "not-found" },
				};
			const approval = await requestNodeApproval(ctx, run.id, node, config.workflow.requireApprovalAt);
			run.approvals = [...(run.approvals ?? []), approval];
			new EventLedger(ctx.cwd, run.id).append({
				version: 1,
				runId: run.id,
				timestamp: approval.createdAt,
				event: "approval.decided",
				data: { nodeId: node.id, decision: approval.decision, risk: approval.risk, reason: approval.reason },
			});
			if (approval.decision !== "approved") {
				persistRun(ctx.cwd, run);
				return {
					content: [{ type: "text", text: `Delegation not approved (${approval.decision}): ${approval.reason}` }],
					details: { started: false, taskId: "", status: "denied" },
				};
			}
			const profile = createAgentProfile(node, state.snapshot?.selected ?? [], {
				provider: params.provider,
				model: params.model,
				timeoutMs: config.subAgents.defaultTimeoutMs,
				maxContextItems: config.subAgents.maxContextItems,
			});
			profile.writePaths = params.writePaths ?? [];
			const workflow = run.workflow ?? createWorkflow(run.id, plan);
			const claim = claimWritePaths(workflow, node.id, profile.writePaths);
			if (!claim.ok)
				return {
					content: [{ type: "text", text: claim.conflict ?? "Write ownership conflict." }],
					details: { started: false, taskId: "", status: "conflict" },
				};
			const task = subAgents.delegate({
				cwd: ctx.cwd,
				runId: run.id,
				planId: plan.id,
				node,
				profile,
				context: state.snapshot?.selected ?? [],
				maxConcurrent: config.subAgents.maxConcurrent,
			});
			run.delegatedTasks = subAgents.list();
			run.workflow = workflow;
			const workflowNode = nodeState(workflow, node.id);
			if (workflowNode) {
				workflowNode.status = "running";
				workflowNode.delegatedTaskId = task.id;
				workflowNode.attempts += 1;
			}
			persistRun(ctx.cwd, run);
			new EventLedger(ctx.cwd, run.id).append({
				version: 1,
				runId: run.id,
				timestamp: new Date().toISOString(),
				event: "subagent.started",
				data: { taskId: task.id, nodeId: node.id, profileId: profile.id },
			});
			return {
				content: [{ type: "text", text: `Started ${task.id} for node ${node.id}.` }],
				details: { started: true, taskId: task.id, status: task.status },
			};
		},
	});

	pi.registerTool({
		name: "intelligence_delegate_status",
		label: "Intelligence Delegate Status",
		description: "Inspect dynamic sub-agent task state and collect completed results.",
		promptSnippet: "Use intelligence_delegate_status to collect delegated task results",
		parameters: Type.Object({ taskId: Type.Optional(Type.String()) }),
		async execute(_id, params, _signal, _update, ctx) {
			const tasks = params.taskId
				? [subAgents.get(params.taskId)].filter((task): task is NonNullable<typeof task> => task !== undefined)
				: subAgents.list();
			const run = state.latest;
			if (run) {
				run.delegatedTasks = subAgents.list();
				for (const task of tasks) {
					if (!run.workflow || !["completed", "failed", "cancelled", "timed-out"].includes(task.status)) continue;
					const workflowNode = nodeState(run.workflow, task.nodeId);
					if (workflowNode) {
						workflowNode.status =
							task.status === "completed" ? "completed" : task.status === "cancelled" ? "cancelled" : "failed";
						workflowNode.result = task.result;
						workflowNode.error = task.error;
					}
					releaseWritePaths(run.workflow, task.nodeId);
				}
				if (run.workflow && run.plan) refreshWorkflow(run.workflow, run.plan);
				persistRun(ctx.cwd, run);
			}
			return { content: [{ type: "text", text: JSON.stringify(tasks, null, 2) }], details: { count: tasks.length } };
		},
	});

	pi.registerTool({
		name: "intelligence_delegate_cancel",
		label: "Intelligence Delegate Cancel",
		description: "Cancel a running dynamic sub-agent task.",
		promptSnippet: "Use intelligence_delegate_cancel to stop a delegated node",
		parameters: Type.Object({ taskId: Type.String({ minLength: 1 }) }),
		async execute(_id, params) {
			const cancelled = subAgents.cancel(params.taskId);
			return {
				content: [
					{ type: "text", text: cancelled ? `Cancelled ${params.taskId}.` : `Unable to cancel ${params.taskId}.` },
				],
				details: { taskId: params.taskId, cancelled },
			};
		},
	});

	pi.registerTool({
		name: "intelligence_memory_store",
		label: "Intelligence Memory Store",
		description: "Store a memory only when backed by a passing, high-confidence evaluation.",
		promptSnippet: "Use intelligence_memory_store for validated preferences, constraints, decisions, or lessons",
		parameters: Type.Object({
			evaluationId: Type.String({ minLength: 1 }),
			content: Type.String({ minLength: 20, maxLength: 2000 }),
			ttlDays: Type.Optional(Type.Integer({ minimum: 1, maximum: 3650 })),
		}),
		async execute(_id, params, _signal, _update, ctx) {
			const run = state.latest;
			const evaluation = run?.evaluations?.find((candidate) => candidate.id === params.evaluationId);
			if (!run || !evaluation)
				return {
					content: [{ type: "text", text: `Evaluation not found: ${params.evaluationId}` }],
					details: { stored: false, id: "", reason: "not-found" },
				};
			const record = createMemoryCandidate(evaluation, params.content, {
				minimumScore: config.memory.minimumScore,
				minimumConfidence: config.memory.minimumConfidence,
				ttlDays: params.ttlDays ?? config.memory.defaultTtlDays,
			});
			if (!record)
				return {
					content: [
						{ type: "text", text: "Memory rejected: evaluation or content did not meet quality thresholds." },
					],
					details: { stored: false, id: "", reason: "quality-threshold" },
				};
			upsertMemory(ctx.cwd, record);
			run.memories = [...(run.memories ?? []), record];
			persistRun(ctx.cwd, run);
			new EventLedger(ctx.cwd, run.id).append({
				version: 1,
				runId: run.id,
				timestamp: new Date().toISOString(),
				event: "memory.stored",
				data: { id: record.id, type: record.type, confidence: record.confidence },
			});
			return {
				content: [{ type: "text", text: JSON.stringify(record, null, 2) }],
				details: { stored: true, id: record.id, reason: "validated" },
			};
		},
	});

	pi.registerTool({
		name: "intelligence_memory_list",
		label: "Intelligence Memory List",
		description: "List validated managed memories and their confidence, status, and expiry.",
		promptSnippet: "Use intelligence_memory_list to inspect validated memory",
		parameters: Type.Object({ status: Type.Optional(Type.String()) }),
		async execute(_id, params, _signal, _update, ctx) {
			const records = loadManagedMemories(ctx.cwd).filter(
				(record) => !params.status || record.status === params.status,
			);
			return {
				content: [{ type: "text", text: JSON.stringify(records, null, 2) }],
				details: { count: records.length },
			};
		},
	});

	pi.registerTool({
		name: "intelligence_memory_correct",
		label: "Intelligence Memory Correct",
		description: "Mark a managed memory as corrected and preserve the correction audit trail.",
		promptSnippet: "Use intelligence_memory_correct when a stored memory is wrong or obsolete",
		parameters: Type.Object({ id: Type.String({ minLength: 1 }), correction: Type.String({ minLength: 1 }) }),
		async execute(_id, params, _signal, _update, ctx) {
			const record = correctMemory(ctx.cwd, params.id, params.correction);
			return {
				content: [
					{ type: "text", text: record ? JSON.stringify(record, null, 2) : `Memory not found: ${params.id}` },
				],
				details: { found: record !== undefined, id: params.id },
			};
		},
	});

	pi.registerTool({
		name: "intelligence_workflow_start",
		label: "Intelligence Workflow Start",
		description: "Create a recoverable workflow from the current validated TaskPlan.",
		promptSnippet: "Use intelligence_workflow_start after intelligence_plan",
		parameters: Type.Object({}),
		async execute(_id, _params, _signal, _update, ctx) {
			const run = state.latest;
			if (!run?.plan)
				return {
					content: [{ type: "text", text: "No current TaskPlan." }],
					details: { started: false, workflowId: "", nodes: 0 },
				};
			run.workflow = createWorkflow(run.id, run.plan);
			persistRun(ctx.cwd, run);
			return {
				content: [{ type: "text", text: JSON.stringify(run.workflow, null, 2) }],
				details: { started: true, workflowId: run.workflow.id, nodes: run.workflow.nodes.length },
			};
		},
	});

	pi.registerTool({
		name: "intelligence_workflow_step",
		label: "Intelligence Workflow Step",
		description:
			"Advance the workflow by starting ready nodes within concurrency, approval, and write-ownership limits.",
		promptSnippet: "Use intelligence_workflow_step to run ready DAG nodes",
		parameters: Type.Object({ provider: Type.Optional(Type.String()), model: Type.Optional(Type.String()) }),
		async execute(_id, params, _signal, _update, ctx) {
			const run = state.latest;
			if (!run?.plan || !run.workflow)
				return {
					content: [{ type: "text", text: "No active workflow." }],
					details: { advanced: false, started: 0, status: "missing" },
				};
			refreshWorkflow(run.workflow, run.plan);
			const ready = readyNodes(run.workflow, run.plan, config.workflow.maxConcurrent);
			let started = 0;
			for (const node of ready) {
				const approval = await requestNodeApproval(ctx, run.id, node, config.workflow.requireApprovalAt);
				run.approvals = [...(run.approvals ?? []), approval];
				new EventLedger(ctx.cwd, run.id).append({
					version: 1,
					runId: run.id,
					timestamp: approval.createdAt,
					event: "approval.decided",
					data: { nodeId: node.id, decision: approval.decision, risk: approval.risk, reason: approval.reason },
				});
				if (approval.decision !== "approved") {
					const stateNode = nodeState(run.workflow, node.id);
					if (stateNode) stateNode.status = "blocked";
					continue;
				}
				const profile = createAgentProfile(node, state.snapshot?.selected ?? [], {
					provider: params.provider,
					model: params.model,
					timeoutMs: config.subAgents.defaultTimeoutMs,
					maxContextItems: config.subAgents.maxContextItems,
				});
				const claim = claimWritePaths(run.workflow, node.id, profile.writePaths);
				if (!claim.ok) {
					const stateNode = nodeState(run.workflow, node.id);
					if (stateNode) {
						stateNode.status = "blocked";
						stateNode.error = claim.conflict;
					}
					continue;
				}
				try {
					const task = subAgents.delegate({
						cwd: ctx.cwd,
						runId: run.id,
						planId: run.plan.id,
						node,
						profile,
						context: state.snapshot?.selected ?? [],
						maxConcurrent: config.subAgents.maxConcurrent,
					});
					const stateNode = nodeState(run.workflow, node.id);
					if (stateNode) {
						stateNode.status = "running";
						stateNode.delegatedTaskId = task.id;
						stateNode.attempts += 1;
					}
					started += 1;
				} catch (error) {
					const stateNode = nodeState(run.workflow, node.id);
					if (stateNode) {
						stateNode.status = "failed";
						stateNode.error = error instanceof Error ? error.message : String(error);
					}
				}
			}
			run.delegatedTasks = subAgents.list();
			refreshWorkflow(run.workflow, run.plan);
			persistRun(ctx.cwd, run);
			return {
				content: [{ type: "text", text: JSON.stringify(run.workflow, null, 2) }],
				details: { advanced: true, started, status: run.workflow.status },
			};
		},
	});

	pi.registerTool({
		name: "intelligence_workflow_auto",
		label: "Intelligence Workflow Auto",
		description:
			"Automatically advance the workflow for up to maxRounds: collect finished delegates, step ready nodes, and stop when blocked/complete.",
		promptSnippet: "Use intelligence_workflow_auto to run the DAG without manual stepping each round",
		parameters: Type.Object({
			maxRounds: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
			provider: Type.Optional(Type.String()),
			model: Type.Optional(Type.String()),
		}),
		async execute(_id, params, signal, _update, ctx) {
			const maxRounds = params.maxRounds ?? 5;
			const run = state.latest;
			if (!run?.plan || !run.workflow) {
				return {
					content: [{ type: "text", text: "No active workflow. Call intelligence_workflow_start first." }],
					details: { rounds: 0, status: "missing" },
				};
			}
			let rounds = 0;
			while (rounds < maxRounds) {
				if (signal?.aborted) break;
				// Collect statuses
				run.delegatedTasks = subAgents.list();
				for (const task of run.delegatedTasks) {
					if (!run.workflow || !["completed", "failed", "cancelled", "timed-out"].includes(task.status)) continue;
					const workflowNode = nodeState(run.workflow, task.nodeId);
					if (workflowNode) {
						workflowNode.status =
							task.status === "completed" ? "completed" : task.status === "cancelled" ? "cancelled" : "failed";
						workflowNode.result = task.result;
						workflowNode.error = task.error;
					}
					releaseWritePaths(run.workflow, task.nodeId);
				}
				refreshWorkflow(run.workflow, run.plan);
				if (run.workflow.status === "completed" || run.workflow.status === "failed") break;
				const ready = readyNodes(run.workflow, run.plan, config.workflow.maxConcurrent);
				if (ready.length === 0) {
					// wait briefly for running nodes
					const running = run.workflow.nodes.some((node) => node.status === "running");
					if (!running) break;
					await new Promise((resolve) => setTimeout(resolve, config.workflow.pollIntervalMs));
					rounds += 1;
					continue;
				}
				for (const node of ready) {
					const approval = await requestNodeApproval(ctx, run.id, node, config.workflow.requireApprovalAt);
					run.approvals = [...(run.approvals ?? []), approval];
					if (approval.decision !== "approved") {
						const stateNode = nodeState(run.workflow, node.id);
						if (stateNode) stateNode.status = "blocked";
						continue;
					}
					const profile = createAgentProfile(node, state.snapshot?.selected ?? [], {
						provider: params.provider,
						model: params.model,
						timeoutMs: config.subAgents.defaultTimeoutMs,
						maxContextItems: config.subAgents.maxContextItems,
					});
					const claim = claimWritePaths(run.workflow, node.id, profile.writePaths);
					if (!claim.ok) continue;
					try {
						const task = subAgents.delegate({
							cwd: ctx.cwd,
							runId: run.id,
							planId: run.plan.id,
							node,
							profile,
							context: state.snapshot?.selected ?? [],
							maxConcurrent: config.subAgents.maxConcurrent,
						});
						const stateNode = nodeState(run.workflow, node.id);
						if (stateNode) {
							stateNode.status = "running";
							stateNode.delegatedTaskId = task.id;
							stateNode.attempts += 1;
						}
					} catch {
						// continue other nodes
					}
				}
				persistRun(ctx.cwd, run);
				rounds += 1;
				await new Promise((resolve) => setTimeout(resolve, config.workflow.pollIntervalMs));
			}
			run.delegatedTasks = subAgents.list();
			if (run.workflow && run.plan) refreshWorkflow(run.workflow, run.plan);
			persistRun(ctx.cwd, run);
			return {
				content: [{ type: "text", text: JSON.stringify({ rounds, workflow: run.workflow }, null, 2) }],
				details: { rounds, status: run.workflow?.status ?? "unknown" },
			};
		},
	});

	pi.registerTool({
		name: "intelligence_workflow_status",
		label: "Intelligence Workflow Status",
		description: "Refresh delegated results and show the recoverable DAG workflow state.",
		promptSnippet: "Use intelligence_workflow_status to monitor a workflow",
		parameters: Type.Object({}),
		async execute(_id, _params, _signal, _update, ctx) {
			const run = state.latest;
			if (!run?.plan || !run.workflow)
				return {
					content: [{ type: "text", text: "No active workflow." }],
					details: { found: false, status: "missing", completed: 0, total: 0 },
				};
			for (const task of subAgents.list()) {
				if (!["completed", "failed", "cancelled", "timed-out"].includes(task.status)) continue;
				const stateNode = nodeState(run.workflow, task.nodeId);
				if (!stateNode || ["completed", "failed", "cancelled", "blocked"].includes(stateNode.status)) continue;
				stateNode.result = task.result;
				stateNode.error = task.error;
				releaseWritePaths(run.workflow, task.nodeId);
				if (task.status !== "completed") {
					stateNode.status = task.status === "cancelled" ? "cancelled" : "failed";
					continue;
				}
				const planNode = run.plan.nodes.find((node) => node.id === task.nodeId);
				if (!planNode) {
					stateNode.status = "failed";
					stateNode.error = "Plan node missing during evaluation.";
					continue;
				}
				const attempt =
					(run.evaluations?.filter((evaluation) => evaluation.nodeId === planNode.id).length ?? 0) + 1;
				const evaluation = evaluateNode({
					runId: run.id,
					planId: run.plan.id,
					node: planNode,
					attempt,
					output: task.result ?? "",
					evidence: task.result ? [task.result.slice(0, 500)] : [],
				});
				run.evaluations = [...(run.evaluations ?? []), evaluation];
				run.reflectionState = run.reflectionState ?? createReflectionState();
				const decision = decideReflection(evaluation, run.reflectionState);
				const applied = applyReflectionDecision(planNode, evaluation, decision, run.reflectionState);
				run.reflectionState = applied.state;
				run.reflections = [...(run.reflections ?? []), decision];
				if (decision.decision === "accept") {
					stateNode.status = "completed";
				} else if (applied.revision) {
					const revision = applied.revision;
					stateNode.status = "failed";
					run.revisions = [...(run.revisions ?? []), revision];
					for (const downstream of run.plan.nodes) {
						downstream.dependencies = downstream.dependencies.map((dependency) =>
							dependency === planNode.id ? revision.revisedNode.id : dependency,
						);
					}
					run.plan.nodes.push(revision.revisedNode);
					run.workflow.nodes.push({
						nodeId: revision.revisedNode.id,
						status: revision.revisedNode.dependencies.length === 0 ? "ready" : "pending",
						attempts: 0,
					});
				} else {
					stateNode.status = "failed";
					stateNode.error = decision.reason;
				}
				new EventLedger(ctx.cwd, run.id).append({
					version: 1,
					runId: run.id,
					timestamp: new Date().toISOString(),
					event: "workflow.evaluated",
					data: {
						nodeId: planNode.id,
						score: evaluation.score,
						passed: evaluation.passed,
						decision: decision.decision,
						revisionId: applied.revision?.id,
					},
				});
			}
			run.delegatedTasks = subAgents.list();
			refreshWorkflow(run.workflow, run.plan);
			persistRun(ctx.cwd, run);
			const completed = run.workflow.nodes.filter((node) => node.status === "completed").length;
			return {
				content: [{ type: "text", text: JSON.stringify(run.workflow, null, 2) }],
				details: { found: true, status: run.workflow.status, completed, total: run.workflow.nodes.length },
			};
		},
	});

	pi.registerTool({
		name: "intelligence_evolution",
		label: "Intelligence Evolution",
		description: "Analyze historical runs and recommend proven capability combinations without bypassing gates.",
		promptSnippet: "Use intelligence_evolution to inspect evidence-backed workflow recommendations",
		parameters: Type.Object({ minimumRuns: Type.Optional(Type.Integer({ minimum: 2, maximum: 100 })) }),
		async execute(_id, params, _signal, _update, ctx) {
			const recommendations = analyzeEvolution(ctx.cwd, params.minimumRuns ?? 3);
			return {
				content: [{ type: "text", text: JSON.stringify(recommendations, null, 2) }],
				details: { count: recommendations.length },
			};
		},
	});

	pi.registerTool({
		name: "intelligence_approval_list",
		label: "Intelligence Approval List",
		description: "List pending, resolved, and expired Intelligence approval requests.",
		promptSnippet: "Use intelligence_approval_list to inspect queued high-risk work",
		parameters: Type.Object({ decision: Type.Optional(Type.String()) }),
		async execute(_id, params, _signal, _update, ctx) {
			const records = loadApprovalQueue(ctx.cwd).filter(
				(record) => !params.decision || record.decision === params.decision,
			);
			return {
				content: [{ type: "text", text: JSON.stringify(records, null, 2) }],
				details: { count: records.length },
			};
		},
	});

	pi.registerTool({
		name: "intelligence_approval_resolve",
		label: "Intelligence Approval Resolve",
		description: "Approve or deny one queued approval request by ID.",
		promptSnippet: "Use intelligence_approval_resolve only after the user explicitly decides",
		parameters: Type.Object({
			id: Type.String({ minLength: 1 }),
			approved: Type.Boolean(),
			reason: Type.String({ minLength: 1 }),
		}),
		async execute(_id, params, _signal, _update, ctx) {
			const record = resolveApproval(ctx.cwd, params.id, params.approved, params.reason);
			if (record && state.latest?.id === record.runId) {
				state.latest.approvals = (state.latest.approvals ?? []).map((item) =>
					item.id === record.id ? record : item,
				);
				if (state.latest.readiness?.status === "needs-approval" && record.decision === "approved")
					state.latest.readiness.status = "ready";
				persistRun(ctx.cwd, state.latest);
			}
			return {
				content: [
					{
						type: "text",
						text: record ? JSON.stringify(record, null, 2) : `Pending approval not found: ${params.id}`,
					},
				],
				details: { found: record !== undefined, decision: record?.decision ?? "missing" },
			};
		},
	});

	pi.registerTool({
		name: "intelligence_readiness",
		label: "Intelligence Readiness",
		description: "Show the inferred goal, deliverables, completion criteria, verification, and execution readiness.",
		promptSnippet: "Use intelligence_readiness before beginning any work task",
		parameters: Type.Object({}),
		async execute() {
			const run = state.latest;
			return {
				content: [
					{
						type: "text",
						text:
							run?.intent && run.readiness
								? JSON.stringify({ intent: run.intent, readiness: run.readiness }, null, 2)
								: "No task intent or readiness assessment exists yet.",
					},
				],
				details: { status: run?.readiness?.status ?? "missing", intentId: run?.intent?.id ?? "" },
			};
		},
	});

	pi.registerCommand("readiness", {
		description: "Show current task objective, deliverables, success criteria, and execution readiness",
		handler: async (_args, ctx) => {
			const run = state.latest;
			if (!run?.intent || !run.readiness) {
				ctx.ui.notify("No readiness assessment yet.", "warning");
				return;
			}
			ctx.ui.notify(
				`Readiness: ${run.readiness.status}\nGoal: ${run.intent.objective}\nDeliverable: ${run.intent.deliverables.join("; ")}\nSuccess: ${run.intent.successCriteria.join("; ")}`,
				run.readiness.status === "ready" ? "info" : "warning",
			);
		},
	});

	pi.registerCommand("intelligence", {
		description: "Show Agent Intelligence Layer status and latest run path",
		handler: async (_args, ctx) => {
			const latest = state.latest;
			ctx.ui.notify(
				latest
					? `Intelligence ${latest.id}: ${latest.selectedContext.length} context items, plan=${latest.plan?.mode ?? "none"}`
					: "No intelligence run yet.",
				"info",
			);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		config = loadIntelligenceConfig(ctx.cwd);
		const recovered = loadLatestRun(ctx.cwd);
		if (!recovered) return;
		let changed = false;
		for (const task of recovered.delegatedTasks ?? []) {
			if (task.status !== "running" && task.status !== "queued") continue;
			if (task.pid) {
				try {
					process.kill(task.pid, "SIGTERM");
				} catch {
					/* Process already exited. */
				}
			}
			task.status = "failed";
			task.error = "Recovered as an orphaned sub-agent after session restart.";
			task.completedAt = new Date().toISOString();
			const workflowNode = recovered.workflow ? nodeState(recovered.workflow, task.nodeId) : undefined;
			if (workflowNode) {
				workflowNode.status = "failed";
				workflowNode.error = task.error;
			}
			changed = true;
		}
		state.latest = recovered;
		state.snapshot =
			recovered.selectedContext.length > 0
				? {
						runId: recovered.id,
						prompt: recovered.prompt,
						createdAt: recovered.startedAt,
						candidates: recovered.selectedContext.map((item) => item.candidate),
						selected: recovered.selectedContext,
					}
				: undefined;
		if (changed) {
			persistRun(ctx.cwd, recovered);
			new EventLedger(ctx.cwd, recovered.id).append({
				version: 1,
				runId: recovered.id,
				timestamp: new Date().toISOString(),
				event: "workflow.recovered",
				data: { orphanedTasksMarkedFailed: true },
			});
		}
	});

	pi.on("tool_call", async (event, ctx) => {
		if (
			event.toolName === "bash" &&
			typeof event.input.command === "string" &&
			isReadOnlyBashCommand(event.input.command)
		)
			return;
		const approvalGateway =
			event.toolName === "intelligence_delegate" || event.toolName === "intelligence_workflow_step";
		if (approvalGateway && state.latest?.readiness?.status === "needs-approval") return;
		const reason = executionBlockReason(event.toolName, state.latest?.readiness);
		if (!reason) return;
		if (state.latest) {
			new EventLedger(ctx.cwd, state.latest.id).append({
				version: 1,
				runId: state.latest.id,
				timestamp: new Date().toISOString(),
				event: "execution.blocked",
				data: { toolName: event.toolName, readiness: state.latest.readiness?.status ?? "missing", reason },
			});
		}
		return { block: true, reason };
	});

	pi.on("tool_result", async (event, ctx) => {
		if (event.isError || !INVESTIGATION_TOOL_NAMES.has(event.toolName) || !state.latest?.intent || !state.latest.plan)
			return;
		const text = event.content
			.filter((part) => part.type === "text")
			.map((part) => part.text)
			.join("\n")
			.trim();
		if (!text) return;
		state.investigationEvidence.push(`${event.toolName}: ${text.slice(0, 500)}`);
		state.latest.readiness = assessReadiness(
			state.latest.intent,
			state.latest.selectedContext,
			state.latest.plan,
			state.latest.capabilities,
			config.planner,
			state.investigationEvidence,
		);
		persistRun(ctx.cwd, state.latest);
		new EventLedger(ctx.cwd, state.latest.id).append({
			version: 1,
			runId: state.latest.id,
			timestamp: new Date().toISOString(),
			event: "readiness.updated",
			data: {
				status: state.latest.readiness.status,
				evidenceTool: event.toolName,
				evidenceCount: state.investigationEvidence.length,
			},
		});
		return {
			content: [
				...event.content,
				{
					type: "text" as const,
					text: `Readiness updated after investigation: ${state.latest.readiness.status}. ${state.latest.readiness.status === "ready" ? "The validated plan may now proceed in dependency order." : "Continue read-only investigation or ask the listed clarification question."}`,
				},
			],
		};
	});

	pi.on("session_before_compact", async (_event, ctx) => {
		const instructions = memoryCompactionInstructions(ctx.cwd);
		if (!instructions) return;
		// Persist checkpoint for audit and re-inject instructions as a hidden message on next turn.
		pi.appendEntry("intelligence:memory-checkpoint", {
			createdAt: new Date().toISOString(),
			instructions,
		});
		pi.sendMessage(
			{
				customType: "intelligence:memory-flush",
				content: instructions,
				display: false,
				details: { kind: "compact-flush" },
			},
			{ deliverAs: "nextTurn" },
		);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		config = loadIntelligenceConfig(ctx.cwd);
		if (!config.enabled) return;
		const startupDecision = decideStartupPlanning(event.prompt, config.planning);
		if (startupDecision.mode === "direct") return;
		state.investigationEvidence = [];
		const id = runId();
		const ledger = new EventLedger(ctx.cwd, id);
		ledger.append({
			version: 1,
			runId: id,
			timestamp: new Date().toISOString(),
			event: "run.started",
			data: { prompt: event.prompt },
		});
		const snapshot = await buildContextSnapshot(pi, ctx.cwd, event.prompt, [], config, id);
		const capabilities = buildCapabilityRegistry(pi);
		const intent = inferTaskIntent(event.prompt);
		const matched = matchCapabilities(capabilities, event.prompt, 12);
		const contextItemIds = snapshot.selected.map((item) => item.candidate.id);
		const generated = await createStartupPlan({
			planning: config.planning,
			ctx,
			intent,
			capabilities: matched,
			contextItemIds,
			budget: config.contextBudget,
		});
		let plan = generated.plan;
		let planSource = generated.source;
		let planFallbackError = generated.error;
		let planValidation = validateTaskPlan(
			plan,
			new Set(capabilities.map((capability) => capability.id)),
			config.planner,
		);
		if (!planValidation.valid) {
			planFallbackError = `Automatic model plan validation failed: ${planValidation.errors.join("; ")}`;
			plan = createIntentPlan(intent, matched, contextItemIds, config.contextBudget);
			planSource = "fallback";
			planValidation = validateTaskPlan(
				plan,
				new Set(capabilities.map((capability) => capability.id)),
				config.planner,
			);
		}
		const readiness = assessReadiness(
			intent,
			snapshot.selected,
			plan,
			capabilities,
			config.planner,
			state.investigationEvidence,
		);
		state.snapshot = snapshot;
		state.latest = {
			version: 1,
			id,
			prompt: event.prompt,
			startedAt: snapshot.createdAt,
			selectedContext: snapshot.selected,
			capabilities,
			intent,
			plan,
			planSource,
			planFallbackError,
			readiness,
		};
		for (const item of snapshot.selected)
			ledger.append({
				version: 1,
				runId: id,
				timestamp: new Date().toISOString(),
				event: "context.selected",
				data: {
					id: item.candidate.id,
					uri: item.candidate.uri,
					source: item.candidate.source,
					score: item.score.total,
					tokens: item.selectedTokens,
				},
			});
		ledger.append({
			version: 1,
			runId: id,
			timestamp: new Date().toISOString(),
			event: "registry.snapshot",
			data: {
				capabilities: capabilities.map((capability) => ({
					id: capability.id,
					risk: capability.risk,
					active: capability.active,
				})),
			},
		});
		ledger.append({
			version: 1,
			runId: id,
			timestamp: new Date().toISOString(),
			event: "plan.generated",
			data: { planId: plan.id, source: planSource, nodes: plan.nodes.length, fallbackError: planFallbackError },
		});
		ledger.append({
			version: 1,
			runId: id,
			timestamp: new Date().toISOString(),
			event: "intent.inferred",
			data: {
				intentId: intent.id,
				kind: intent.kind,
				objective: intent.objective,
				deliverables: intent.deliverables,
				risk: intent.risk,
			},
		});
		ledger.append({
			version: 1,
			runId: id,
			timestamp: new Date().toISOString(),
			event: "readiness.assessed",
			data: {
				readinessId: readiness.id,
				status: readiness.status,
				blockers: readiness.blockers,
				missingContext: readiness.missingContext,
			},
		});
		persistRun(ctx.cwd, state.latest);
		const context = renderContextSnapshot(snapshot);
		const planning = `\n\n<task_readiness status="${readiness.status}">
<objective>${intent.objective}</objective>
<deliverables>${intent.deliverables.map((item) => `- ${item}`).join("\n")}</deliverables>
<success_criteria>${intent.successCriteria.map((item) => `- ${item}`).join("\n")}</success_criteria>
<verification>${intent.verification.map((item) => `- ${item}`).join("\n")}</verification>
<plan>${plan.nodes.map((node) => `${node.id}: ${node.objective} | verify=${node.verification.join("; ")}`).join("\n")}</plan>
<instruction>${readiness.status === "ready" ? "Follow the validated plan in dependency order. Do not skip verification." : "Do not execute state-changing tools. Resolve the readiness gaps first."}</instruction>
</task_readiness>`;
		return {
			message: {
				customType: "intelligence:context",
				content: context + planning,
				display: false,
				details: { runId: id, count: snapshot.selected.length },
			},
		};
	});
}
