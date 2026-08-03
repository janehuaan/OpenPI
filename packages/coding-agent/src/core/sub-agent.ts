/**
 * In-process sub-agent execution.
 *
 * A sub-agent is an isolated Agent instance sharing the parent's model,
 * stream function, and auth, but with its own transcript and a restricted
 * tool set. It runs entirely inside the parent process (no subprocess).
 */
import { Agent, type AgentTool, type ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { BuiltinSecurity } from "./security/builtin-security.ts";

export const SUB_AGENT_TOOL_NAME = "sub_agent";

export const SUB_AGENT_SYSTEM_PROMPT = `You are a sub-agent. Complete the delegated task using the available tools.
Work autonomously: gather the information you need, perform the steps, and report back a concise final answer.
Do not ask the parent agent for help; you only have this single task.`;

export interface RunSubAgentTaskOptions {
	/** Restrict the sub-agent to these tool names (default: all tools except sub_agent). */
	tools?: string[];
	/** Maximum number of turns before the sub-agent is stopped (default: 20). */
	maxSteps?: number;
	/** Thinking level for the sub-agent (default: same as parent). */
	thinkingLevel?: ThinkingLevel;
}

export interface RunSubAgentDependencies {
	parent: Agent;
	tools: AgentTool[];
	security?: BuiltinSecurity;
	/** Interactive confirmation callback for medium/high operations (UI). When absent, confirmations block. */
	confirm?: (reason: string) => Promise<boolean>;
}

export interface SubAgentResult {
	/** The sub-agent's final answer text (may be partial when stopped early). */
	answer: string;
	/** Number of turns executed. */
	turns: number;
	/** True when the sub-agent hit the turn limit. */
	stoppedEarly: boolean;
}

export interface ParallelSubAgentTask {
	/** Short label shown in the result list. */
	description: string;
	/** The task prompt the sub-agent receives. */
	prompt: string;
	/** Maximum turns for this sub-agent (default: 20). */
	maxSteps?: number;
	/** Restrict this sub-agent to these tool names. */
	tools?: string[];
}

export interface ParallelSubAgentTaskResult {
	description: string;
	result: SubAgentResult;
}

function createSubAgent(deps: RunSubAgentDependencies, options: RunSubAgentTaskOptions): Agent {
	const parent = deps.parent;
	const maxSteps = options.maxSteps ?? 20;
	const thinkingLevel = options.thinkingLevel ?? parent.state.thinkingLevel;

	const subAgent = new Agent({
		initialState: {
			systemPrompt: SUB_AGENT_SYSTEM_PROMPT,
			model: parent.state.model,
			thinkingLevel,
			tools: deps.tools,
			messages: [],
		},
		streamFn: parent.streamFn,
		convertToLlm: parent.convertToLlm,
		getApiKey: parent.getApiKey,
		sessionId: parent.sessionId,
		transport: parent.transport,
		thinkingBudgets: parent.thinkingBudgets,
		maxRetryDelayMs: parent.maxRetryDelayMs,
	});

	if (maxSteps > 0) {
		subAgent.shouldStopAfterTurn = () =>
			subAgent.state.messages.filter((message) => message.role === "assistant").length >= maxSteps;
	}

	if (deps.security) {
		const security = deps.security;
		subAgent.beforeToolCall = async ({ toolCall, args }) => {
			const input = (args ?? {}) as Record<string, unknown>;
			const target = String(input.command ?? input.filePath ?? input.path ?? "");
			const result = security.check(toolCall.name, target);
			if (result.decision === "block") {
				security.appendAudit({
					tool: toolCall.name,
					target,
					level: result.level,
					decision: "block",
					reason: result.reason,
					mode: security.mode,
				});
				return { block: true, reason: result.reason ?? "Blocked by builtin security policy" };
			}
			if (result.decision === "confirm") {
				const reason = `${result.reason ?? "Operation"} requires confirmation`;
				const allowed = deps.confirm ? await deps.confirm(reason) : false;
				security.recordDecision(toolCall.name, target, result, allowed);
				if (!allowed) {
					return { block: true, reason: `${reason} (denied or no confirmation available)` };
				}
				return undefined;
			}
			return undefined;
		};
	}

	return subAgent;
}

/**
 * Run one sub-agent task to completion (or the turn limit) and return its
 * final answer. Never throws for agent-loop errors; those are returned as
 * error text so the parent model can react.
 */
export async function runSubAgentTask(
	deps: RunSubAgentDependencies,
	task: string,
	options: RunSubAgentTaskOptions = {},
): Promise<SubAgentResult> {
	const subAgent = createSubAgent(deps, options);

	let answer = "";
	try {
		await subAgent.prompt(task);
		const messages = subAgent.state.messages;
		const last = messages[messages.length - 1];
		if (last && last.role === "assistant") {
			answer = messageText(last);
		} else {
			answer = messages
				.filter((message) => message.role === "assistant")
				.map((message) => messageText(message))
				.join("\n");
		}
	} catch (error) {
		answer = `Sub-agent failed: ${error instanceof Error ? error.message : String(error)}`;
	}

	const turns = subAgent.state.messages.filter((message) => message.role === "assistant").length;
	const stoppedEarly = turns >= (options.maxSteps ?? 20);
	return { answer: answer || "(sub-agent produced no output)", turns, stoppedEarly };
}

/**
 * Run several sub-agent tasks in parallel (bounded by `maxParallel`) and
 * collect each result. Each sub-agent is independent: own transcript, own
 * turn budget, isolated tool state. A failure in one task does not cancel
 * the others; the failed task's result carries the error text.
 */
export async function runSubAgentTasks(
	deps: RunSubAgentDependencies,
	tasks: ParallelSubAgentTask[],
	options: { maxParallel?: number } = {},
): Promise<ParallelSubAgentTaskResult[]> {
	const maxParallel = Math.max(1, Math.min(options.maxParallel ?? 4, 8));
	const results: ParallelSubAgentTaskResult[] = [];
	for (let i = 0; i < tasks.length; i += maxParallel) {
		const chunk = tasks.slice(i, i + maxParallel);
		const chunkResults = await Promise.all(
			chunk.map(async (task) => ({
				description: task.description,
				result: await runSubAgentTask(deps, task.prompt, { maxSteps: task.maxSteps, tools: task.tools }),
			})),
		);
		results.push(...chunkResults);
	}
	return results;
}

function messageText(message: { content: unknown }): string {
	const content = message.content;
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.filter((block): block is { type: string; text?: string } => typeof block === "object" && block !== null)
			.map((block) => (block.type === "text" && typeof block.text === "string" ? block.text : ""))
			.join("\n")
			.trim();
	}
	return "";
}
