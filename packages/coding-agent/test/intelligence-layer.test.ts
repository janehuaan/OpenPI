import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	loadApprovalQueue,
	requiresApproval,
	resolveApproval,
	saveApprovalQueue,
} from "../examples/extensions/intelligence-layer/approval.ts";
import {
	DEFAULT_INTELLIGENCE_CONFIG,
	loadIntelligenceConfig,
} from "../examples/extensions/intelligence-layer/config.ts";
import { cosine, LocalHashEmbeddingProvider } from "../examples/extensions/intelligence-layer/context/embedding.ts";
import { dedupeCandidates, selectContext } from "../examples/extensions/intelligence-layer/context/ranker.ts";
import { createCandidate } from "../examples/extensions/intelligence-layer/context/utils.ts";
import type { TaskPlan } from "../examples/extensions/intelligence-layer/contract.ts";
import { createAgentProfile } from "../examples/extensions/intelligence-layer/dynamic-sub-agent.ts";
import { evaluateNode } from "../examples/extensions/intelligence-layer/evaluator.ts";
import { createMemoryCandidate, expireMemories } from "../examples/extensions/intelligence-layer/memory-manager.ts";
import { createDeterministicPlan, shouldPlan } from "../examples/extensions/intelligence-layer/planner.ts";
import {
	assessReadiness,
	executionBlockReason,
	inferTaskIntent,
	isReadOnlyBashCommand,
} from "../examples/extensions/intelligence-layer/readiness.ts";
import {
	applyReflectionDecision,
	createReflectionState,
	decideReflection,
} from "../examples/extensions/intelligence-layer/reflection.ts";
import { matchCapabilities } from "../examples/extensions/intelligence-layer/registry.ts";
import { EventLedger, redactSecrets } from "../examples/extensions/intelligence-layer/storage/event-ledger.ts";
import { validateContextBudget, validateTaskPlan } from "../examples/extensions/intelligence-layer/validate.ts";
import {
	claimWritePaths,
	createWorkflow,
	readyNodes,
	refreshWorkflow,
} from "../examples/extensions/intelligence-layer/workflow.ts";

const tempDirs: string[] = [];
afterEach(() => {
	for (const directory of tempDirs.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function validPlan(): TaskPlan {
	return {
		version: 1,
		id: "plan-1",
		goal: "Fix login",
		mode: "planned",
		nodes: [
			{
				id: "inspect",
				title: "Inspect",
				objective: "Find the bug",
				dependencies: [],
				capabilityIds: ["tool:read"],
				contextQueries: ["login"],
				contextItemIds: [],
				inputs: ["Login implementation"],
				outputs: ["Root cause report"],
				writePaths: [],
				verification: ["Cite the failing branch."],
				risk: "low",
				successCriteria: ["Root cause identified"],
				status: "ready",
				maxAttempts: 1,
				timeoutMs: 30_000,
			},
		],
		globalSuccessCriteria: ["Tests pass"],
		contextBudget: DEFAULT_INTELLIGENCE_CONFIG.contextBudget,
		createdAt: new Date().toISOString(),
	};
}

describe("intelligence contract validation", () => {
	it("accepts the default context budget", () => {
		expect(validateContextBudget(DEFAULT_INTELLIGENCE_CONFIG.contextBudget)).toEqual({ valid: true, errors: [] });
	});

	it("rejects a budget with no dynamic context capacity", () => {
		const result = validateContextBudget({
			...DEFAULT_INTELLIGENCE_CONFIG.contextBudget,
			totalTokens: 10_000,
			reservedForConversation: 6000,
			reservedForCompletion: 4000,
		});
		expect(result.valid).toBe(false);
	});

	it("accepts a valid plan and rejects cycles and unknown capabilities", () => {
		const limits = DEFAULT_INTELLIGENCE_CONFIG.planner;
		expect(validateTaskPlan(validPlan(), new Set(["tool:read"]), limits).valid).toBe(true);
		const invalid = validPlan();
		invalid.nodes[0].dependencies = ["inspect"];
		invalid.nodes[0].capabilityIds = ["tool:missing"];
		const result = validateTaskPlan(invalid, new Set(["tool:read"]), limits);
		expect(result.valid).toBe(false);
		expect(result.errors.join("\n")).toContain("cycle");
		expect(result.errors.join("\n")).toContain("unknown capability");
	});
});

describe("context ranking and registry", () => {
	it("deduplicates identical content and ranks exact paths first", () => {
		const exact = createCandidate("code", "src/login.ts", "login", "export function login() {}", "test");
		const duplicate = createCandidate("code", "src/copy.ts", "copy", exact.content, "test");
		const unrelated = createCandidate("code", "src/theme.ts", "theme", "export const theme = 'dark'", "test");
		expect(dedupeCandidates([exact, duplicate, unrelated])).toHaveLength(2);
		const selected = selectContext(
			[unrelated, exact],
			"fix src/login.ts login",
			DEFAULT_INTELLIGENCE_CONFIG.contextBudget,
		);
		expect(selected[0].candidate.uri).toBe("src/login.ts");
	});

	it("honors source and total token budgets", () => {
		const candidates = Array.from({ length: 10 }, (_, index) =>
			createCandidate("code", `src/file-${index}.ts`, `file ${index}`, "login ".repeat(2000), "test"),
		);
		const selected = selectContext(candidates, "login", {
			...DEFAULT_INTELLIGENCE_CONFIG.contextBudget,
			totalTokens: 5000,
			reservedForConversation: 1000,
			reservedForCompletion: 1000,
			sourceLimits: { ...DEFAULT_INTELLIGENCE_CONFIG.contextBudget.sourceLimits, code: 1500 },
		});
		expect(selected.reduce((sum, item) => sum + item.selectedTokens, 0)).toBeLessThanOrEqual(1500);
	});

	it("matches capabilities deterministically", () => {
		const capabilities = [
			{
				id: "tool:web_fetch",
				kind: "tool" as const,
				name: "web_fetch",
				description: "Fetch a web page",
				source: "extension",
				active: true,
				tags: ["web"],
				risk: "medium" as const,
				estimatedCost: 2,
				sideEffects: ["network"],
			},
			{
				id: "tool:read",
				kind: "tool" as const,
				name: "read",
				description: "Read files",
				source: "builtin",
				active: true,
				tags: ["file"],
				risk: "low" as const,
				estimatedCost: 1,
				sideEffects: [],
			},
		];
		expect(matchCapabilities(capabilities, "fetch web documentation")[0].id).toBe("tool:web_fetch");
	});
});

describe("dynamic planner", () => {
	it("skips planning for simple work and plans complex work", () => {
		expect(shouldPlan("Read package.json", 1)).toBe(false);
		expect(shouldPlan("调研并比较两个框架，然后输出迁移规划", 3)).toBe(true);
	});

	it("creates a valid deterministic plan", () => {
		const capability = {
			id: "tool:read",
			kind: "tool" as const,
			name: "read",
			description: "Read files",
			source: "builtin",
			active: true,
			tags: ["file"],
			risk: "low" as const,
			estimatedCost: 1,
			sideEffects: [],
		};
		const plan = createDeterministicPlan(
			"Read package.json",
			[capability],
			[],
			DEFAULT_INTELLIGENCE_CONFIG.contextBudget,
		);
		expect(plan.mode).toBe("direct");
		expect(validateTaskPlan(plan, new Set(["tool:read"]), DEFAULT_INTELLIGENCE_CONFIG.planner).valid).toBe(true);
	});
});

describe("evaluator and bounded reflection", () => {
	it("passes verified output with complete criteria and evidence", () => {
		const node = validPlan().nodes[0];
		const evaluation = evaluateNode({
			runId: "run-1",
			planId: "plan-1",
			node,
			attempt: 1,
			output: "Root cause identified and verified in `src/login.ts:42`. Tests passed successfully.",
		});
		expect(evaluation.passed).toBe(true);
		expect(evaluation.score).toBeGreaterThanOrEqual(0.7);
		expect(decideReflection(evaluation, createReflectionState()).decision).toBe("accept");
	});

	it("creates a revision for an incomplete but retryable result", () => {
		const node = validPlan().nodes[0];
		const evaluation = evaluateNode({
			runId: "run-1",
			planId: "plan-1",
			node,
			attempt: 1,
			output: "I inspected the login implementation, but more verification is needed before identifying the cause.",
		});
		const initial = createReflectionState();
		const decision = decideReflection(evaluation, initial);
		expect(decision.decision).toBe("retry");
		expect(decision.round).toBe(1);
		expect(decision.remainingRounds).toBe(1);
		const applied = applyReflectionDecision(node, evaluation, decision, initial);
		expect(applied.revision?.revisedNode.id).toBe("inspect-revision-1");
		expect(node.id).toBe("inspect");
		expect(applied.state.roundsByNode.inspect).toBe(1);
	});

	it("stops after two reflection rounds", () => {
		const node = validPlan().nodes[0];
		const evaluation = evaluateNode({
			runId: "run-1",
			planId: "plan-1",
			node,
			attempt: 3,
			output: "Some inspection completed without enough evidence.",
		});
		const state = { ...createReflectionState(), roundsByNode: { inspect: 2 }, totalEvaluations: 2 };
		const decision = decideReflection(evaluation, state);
		expect(decision.decision).toBe("stop");
		expect(decision.reason).toContain("Maximum 2");
	});

	it("stops instead of retrying an empty or catastrophic result", () => {
		const node = validPlan().nodes[0];
		const evaluation = evaluateNode({ runId: "run-1", planId: "plan-1", node, attempt: 1, output: "Error: failed." });
		expect(evaluation.passed).toBe(false);
		expect(decideReflection(evaluation, createReflectionState()).decision).toBe("stop");
	});
});

describe("dynamic sub-agent profiles", () => {
	it("creates a minimal profile with bounded context", () => {
		const node = validPlan().nodes[0];
		const context = Array.from({ length: 5 }, (_, index) => ({
			candidate: createCandidate("code", `src/${index}.ts`, `${index}`, "content", "test"),
			score: {
				semantic: 0,
				lexical: 1,
				symbol: 0,
				dependency: 0,
				recency: 0,
				attention: 0,
				authority: 0.9,
				tokenPenalty: 0,
				total: 0.8,
				reasons: [],
			},
			mode: "full" as const,
			selectedContent: "content",
			selectedTokens: 2,
			pinned: false,
		}));
		const profile = createAgentProfile(node, context, {
			provider: "agnes",
			model: "agnes-1.5-flash",
			timeoutMs: 1000,
			maxContextItems: 2,
		});
		expect(profile.allowedCapabilityIds).toEqual(["tool:read"]);
		expect(profile.contextItemIds).toHaveLength(2);
		expect(profile.model).toBe("agnes-1.5-flash");
	});
});

describe("validated memory manager", () => {
	it("accepts only passing high-confidence evaluations and expires records", () => {
		const node = validPlan().nodes[0];
		const passing = evaluateNode({
			runId: "run-1",
			planId: "plan-1",
			node,
			attempt: 1,
			output: "Root cause identified and verified in `src/login.ts:42`. Tests passed successfully.",
		});
		const record = createMemoryCandidate(passing, "The project must use strict TypeScript settings.", {
			minimumScore: 0.75,
			minimumConfidence: 0.7,
			ttlDays: 1,
		});
		expect(record?.type).toBe("constraint");
		const expired = expireMemories([{ ...record!, expiresAt: "2000-01-01T00:00:00.000Z" }]);
		expect(expired[0].status).toBe("expired");
		const failing = { ...passing, passed: false, score: 0.4 };
		expect(
			createMemoryCandidate(failing, "This should never be saved as memory.", {
				minimumScore: 0.75,
				minimumConfidence: 0.7,
				ttlDays: 1,
			}),
		).toBeUndefined();
	});
});

describe("workflow scheduling and approval", () => {
	it("unblocks dependencies and enforces write ownership", () => {
		const plan = validPlan();
		plan.nodes.push({ ...plan.nodes[0], id: "verify", title: "Verify", dependencies: ["inspect"] });
		const workflow = createWorkflow("run-1", plan);
		expect(readyNodes(workflow, plan, 3).map((node) => node.id)).toEqual(["inspect"]);
		workflow.nodes[0].status = "completed";
		refreshWorkflow(workflow, plan);
		expect(readyNodes(workflow, plan, 3).map((node) => node.id)).toEqual(["verify"]);
		expect(claimWritePaths(workflow, "inspect", ["src/auth"]).ok).toBe(true);
		const conflict = claimWritePaths(workflow, "verify", ["src/auth/login.ts"]);
		expect(conflict.ok).toBe(false);
	});

	it("requires approval at and above the configured threshold", () => {
		expect(requiresApproval("medium", "high")).toBe(false);
		expect(requiresApproval("high", "high")).toBe(true);
		expect(requiresApproval("critical", "high")).toBe(true);
	});
});

describe("intent, readiness, and execution gate", () => {
	it("infers an internal goal and completion standard without user prompting", () => {
		const intent = inferTaskIntent("修复登录 bug");
		expect(intent.kind).toBe("work");
		expect(intent.objective).toContain("修复登录 bug");
		expect(intent.deliverables.length).toBeGreaterThan(0);
		expect(intent.successCriteria.length).toBeGreaterThan(0);
		expect(intent.verification.length).toBeGreaterThan(0);
	});

	it("requires user input for an ambiguous request even when it names an output file", () => {
		const intent = inferTaskIntent("优化一下，直接创建 result.txt，内容随便");
		const readiness = assessReadiness(intent, [], undefined, [], DEFAULT_INTELLIGENCE_CONFIG.planner);
		expect(readiness.status).toBe("needs-user-input");
		expect(executionBlockReason("write", readiness)).toContain("needs-user-input");
	});

	it("keeps simple read-only requests ready without a work plan", () => {
		const intent = inferTaskIntent("读取 package.json 的版本");
		const readiness = assessReadiness(intent, [], undefined, [], DEFAULT_INTELLIGENCE_CONFIG.planner);
		expect(intent.kind).toBe("read-only");
		expect(readiness.status).toBe("ready");
		expect(executionBlockReason("read", readiness)).toBeUndefined();
	});

	it("blocks state-changing tools until work readiness is established", () => {
		const intent = inferTaskIntent("修复登录 bug");
		const analyzing = assessReadiness(intent, [], undefined, [], DEFAULT_INTELLIGENCE_CONFIG.planner);
		expect(analyzing.status).toBe("needs-context");
		expect(executionBlockReason("edit", analyzing)).toContain("Execution blocked");
		expect(executionBlockReason("code_search", analyzing)).toBeUndefined();
	});

	it("allows only structurally read-only bash during investigation", () => {
		expect(isReadOnlyBashCommand("git status")).toBe(true);
		expect(isReadOnlyBashCommand("rg login src")).toBe(true);
		expect(isReadOnlyBashCommand("cat package.json")).toBe(true);
		expect(isReadOnlyBashCommand("cat file > output")).toBe(false);
		expect(isReadOnlyBashCommand("rm -rf dist")).toBe(false);
		expect(isReadOnlyBashCommand("git status && rm file")).toBe(false);
	});

	it("produces a concrete inspect-implement-verify work plan", () => {
		const intent = inferTaskIntent("修复登录 bug");
		const capabilities = [
			{
				id: "tool:read",
				kind: "tool" as const,
				name: "read",
				description: "Read",
				source: "builtin",
				active: true,
				tags: ["file"],
				risk: "low" as const,
				estimatedCost: 1,
				sideEffects: [],
			},
			{
				id: "tool:edit",
				kind: "tool" as const,
				name: "edit",
				description: "Edit",
				source: "builtin",
				active: true,
				tags: ["file"],
				risk: "high" as const,
				estimatedCost: 1,
				sideEffects: ["state-change"],
			},
			{
				id: "tool:bash",
				kind: "tool" as const,
				name: "bash",
				description: "Test",
				source: "builtin",
				active: true,
				tags: ["shell"],
				risk: "high" as const,
				estimatedCost: 1,
				sideEffects: ["state-change"],
			},
		];
		const plan = createDeterministicPlan(intent.prompt, capabilities, [], DEFAULT_INTELLIGENCE_CONFIG.contextBudget);
		expect(plan.nodes.map((node) => node.id)).toEqual(["inspect", "implement", "verify"]);
		expect(plan.nodes.every((node) => node.outputs.length > 0 && node.verification.length > 0)).toBe(true);
	});
});

describe("configuration, embeddings, and approval recovery", () => {
	it("loads project configuration overrides with bounded concurrency", () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-intelligence-config-"));
		tempDirs.push(cwd);
		fs.mkdirSync(path.join(cwd, ".pi/intelligence"), { recursive: true });
		fs.writeFileSync(
			path.join(cwd, ".pi/intelligence/config.json"),
			JSON.stringify({ subAgents: { maxConcurrent: 99 }, planning: "always" }),
		);
		const config = loadIntelligenceConfig(cwd);
		expect(config.subAgents.maxConcurrent).toBe(8);
		expect(config.planning).toBe("always");
	});

	it("provides semantic similarity with a local embedding fallback", async () => {
		const provider = new LocalHashEmbeddingProvider(128);
		const [query, related, unrelated] = await provider.embed([
			"login authentication",
			"authentication login",
			"css colors",
		]);
		expect(cosine(query, related)).toBeGreaterThan(cosine(query, unrelated));
	});

	it("expires and resolves persisted approval requests", () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-intelligence-approval-"));
		tempDirs.push(cwd);
		saveApprovalQueue(cwd, [
			{
				version: 1,
				id: "approval-1",
				runId: "run-1",
				nodeId: "deploy",
				risk: "critical",
				decision: "pending",
				reason: "Waiting",
				createdAt: "2000-01-01T00:00:00.000Z",
				expiresAt: "2000-01-02T00:00:00.000Z",
			},
		]);
		expect(loadApprovalQueue(cwd)[0].decision).toBe("expired");
		saveApprovalQueue(cwd, [
			{
				version: 1,
				id: "approval-2",
				runId: "run-1",
				nodeId: "edit",
				risk: "high",
				decision: "pending",
				reason: "Waiting",
				createdAt: new Date().toISOString(),
				expiresAt: new Date(Date.now() + 60_000).toISOString(),
			},
		]);
		expect(resolveApproval(cwd, "approval-2", true, "Approved by user")?.decision).toBe("approved");
	});
});

describe("intelligence event ledger", () => {
	it("redacts secrets and writes one JSONL event", () => {
		const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-intelligence-"));
		tempDirs.push(cwd);
		const ledger = new EventLedger(cwd, "run-1");
		ledger.append({
			version: 1,
			runId: "run-1",
			timestamp: new Date().toISOString(),
			event: "run.started",
			data: { key: "api_key=cpk-1234567890abcdefghijklmnop" },
		});
		const content = fs.readFileSync(path.join(cwd, ".pi/intelligence/runs/run-1/events.jsonl"), "utf8");
		expect(content).toContain("[REDACTED]");
		expect(content).not.toContain("cpk-");
		expect(content.trim().split("\n")).toHaveLength(1);
	});

	it("redacts provider-style keys", () => {
		expect(redactSecrets("token: secret-value")).toBe("[REDACTED]");
	});
});
