/**
 * openpi session-state extension.
 *
 * Replaces the eight unrelated concerns the old fork wedged into
 * `coding-agent/src/core/agent-session.ts` (+578 lines) with one extension that
 * uses only published hooks:
 *
 *   context injection      on("context")            <- was _maybeInjectContext
 *   task state             registerTool("task")     <- was 5 runtime tools
 *   checkpoint persistence on("session_before_compact")
 *   event ledger           on("tool_call"/"tool_result"/"session_compact")
 *   desktop data channel   pi.appendEntry           <- was 4 custom RPC commands
 *
 * Nothing here patches upstream.
 */

import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { uuidv7 } from "@earendil-works/pi-ai";
import { buildCheckpointPrompt, checkpointFromSummary } from "./compaction.ts";
import {
	compactCheckpoint,
	type ContextCheckpoint,
	formatCheckpoint,
	loadCheckpoint,
	saveCheckpoint,
} from "./checkpoint.ts";
import {
	appendEvent,
	checkpointSaveEvent,
	compactionEvent,
	sessionEndEvent,
	sessionStartEvent,
	taskUpdateEvent,
	toolCallEvent,
	toolResultEvent,
} from "./event-ledger.ts";
import {
	compactTaskState,
	emptyTaskState,
	type EvidenceKind,
	formatTaskState,
	hasOpenWork,
	loadTaskState,
	saveTaskState,
	type StepStatus,
	type TaskState,
	type TaskStep,
} from "./task-state.ts";

const StepSchema = Type.Object({
	content: Type.String({ description: "What this step does" }),
	status: Type.Optional(Type.String({ description: "pending | in_progress | completed | blocked" })),
	activeForm: Type.Optional(Type.String({ description: "Present-tense form shown while running" })),
	result: Type.Optional(Type.String()),
	error: Type.Optional(Type.String()),
});

const TaskParams = Type.Object({
	action: Type.String({ description: "get | set_goal | set_steps | update_step | add_error | note | clear" }),
	goal: Type.Optional(Type.String()),
	status: Type.Optional(Type.String({ description: "idle | running | paused | completed | failed" })),
	steps: Type.Optional(Type.Array(StepSchema)),
	/** 1-based so the model can echo the numbering it sees in the rendering. */
	step: Type.Optional(Type.Number({ description: "1-based step index for update_step" })),
	stepStatus: Type.Optional(Type.String({ description: "pending | in_progress | completed | blocked" })),
	result: Type.Optional(Type.String()),
	error: Type.Optional(Type.String()),
	tool: Type.Optional(Type.String()),
	recovered: Type.Optional(Type.Boolean()),
	note: Type.Optional(Type.String()),
	nextSteps: Type.Optional(Type.Array(Type.String())),
	evidence: Type.Optional(
		Type.Object({
			kind: Type.String({ description: "verification | review | diff | files | manual" }),
			summary: Type.String(),
			command: Type.Optional(Type.String()),
			paths: Type.Optional(Type.Array(Type.String())),
		}),
	),
});

const STEP_STATUSES: StepStatus[] = ["pending", "in_progress", "completed", "blocked"];
const EVIDENCE_KINDS: EvidenceKind[] = ["verification", "review", "diff", "files", "manual"];

function coerceStepStatus(value: string | undefined, fallback: StepStatus): StepStatus {
	return STEP_STATUSES.includes(value as StepStatus) ? (value as StepStatus) : fallback;
}

/** The model supplies a free-form string; anything unrecognized is "manual". */
function coerceEvidenceKind(value: string): EvidenceKind {
	return EVIDENCE_KINDS.includes(value as EvidenceKind) ? (value as EvidenceKind) : "manual";
}

export default function sessionStateExtension(pi: ExtensionAPI) {
	// Injected text is remembered per session so an unchanged block is not
	// re-sent every turn; a byte-identical prefix keeps the provider's prompt
	// cache warm, which is why the compact renderings are deterministic.
	const lastInjectedTask = new Map<string, string>();
	const lastInjectedCheckpoint = new Map<string, string>();
	const sessionStartedAt = new Map<string, number>();
	const toolCallStartedAt = new Map<string, number>();

	pi.registerTool({
		name: "task",
		label: "Task state",
		description: `Track structured task state that survives compaction and restarts.

Actions:
- get: read the current state
- set_goal: set the goal (and optionally status)
- set_steps: replace the step list
- update_step: set one step's status/result/error, optionally attach evidence
- add_error: record an error and whether it was recovered
- note: append a context note and/or replace nextSteps
- clear: reset the state for this session

Use this for multi-step work. A step is only "completed" once its result is verified;
attach evidence (a command that passed, files changed) rather than asserting success.`,
		promptSnippet:
			"Track multi-step work with the task tool; its state is re-injected after compaction so progress is never lost.",
		promptGuidelines: [
			"For work with more than two steps, call task set_steps first, then update_step as each one lands.",
			"Mark a step completed only with evidence (a command that passed, a diff, files written).",
			"Record blockers with add_error so a resumed session knows what failed.",
		],
		parameters: TaskParams,
		async execute(_id, params, _signal, _update, ctx) {
			const sessionId = ctx.sessionManager.getSessionId();
			const action = (params.action ?? "get").toLowerCase();
			const state = loadTaskState(ctx.cwd, sessionId) ?? emptyTaskState(sessionId);

			const persist = (next: TaskState, text: string) => {
				saveTaskState(ctx.cwd, next);
				appendEvent(
					ctx.cwd,
					taskUpdateEvent(sessionId, {
						goal: next.goal,
						status: next.status,
						completed: next.steps.filter((step) => step.status === "completed").length,
						total: next.steps.length,
					}),
				);
				pi.appendEntry("openpi:task-state", {
					goal: next.goal,
					status: next.status,
					steps: next.steps,
					nextSteps: next.nextSteps,
					updatedAt: next.updatedAt,
				});
				return {
					content: [{ type: "text" as const, text }],
					details: { action, goal: next.goal, status: next.status, steps: next.steps.length },
				};
			};

			switch (action) {
				case "get":
					return {
						content: [{ type: "text", text: formatTaskState(state) }],
						details: { action, steps: state.steps.length },
					};

				case "set_goal": {
					if (!params.goal) {
						return {
							content: [{ type: "text", text: "set_goal requires goal." }],
							details: { action, error: "missing goal" },
						};
					}
					state.goal = params.goal;
					if (params.status) state.status = params.status as TaskState["status"];
					else if (state.status === "idle") state.status = "running";
					return persist(state, `Goal set: ${state.goal} (${state.status})`);
				}

				case "set_steps": {
					if (!params.steps || params.steps.length === 0) {
						return {
							content: [{ type: "text", text: "set_steps requires a non-empty steps array." }],
							details: { action, error: "missing steps" },
						};
					}
					state.steps = params.steps.map((step): TaskStep => {
						const next: TaskStep = {
							content: step.content,
							status: coerceStepStatus(step.status, "pending"),
						};
						if (step.activeForm) next.activeForm = step.activeForm;
						if (step.result) next.result = step.result;
						if (step.error) next.error = step.error;
						return next;
					});
					if (params.goal) state.goal = params.goal;
					if (state.status === "idle") state.status = "running";
					return persist(state, formatTaskState(state));
				}

				case "update_step": {
					const index = (params.step ?? 0) - 1;
					const target = state.steps[index];
					if (!target) {
						return {
							content: [
								{ type: "text", text: `update_step needs a 1-based step in 1..${state.steps.length}.` },
							],
							details: { action, error: "bad index" },
						};
					}
					target.status = coerceStepStatus(params.stepStatus, target.status);
					if (params.result) target.result = params.result;
					if (params.error) target.error = params.error;
					if (params.evidence) {
						target.evidence = [
							...(target.evidence ?? []),
							{
								kind: coerceEvidenceKind(params.evidence.kind),
								summary: params.evidence.summary,
								command: params.evidence.command,
								paths: params.evidence.paths,
							},
						];
					}
					if (state.steps.every((step) => step.status === "completed")) state.status = "completed";
					return persist(state, formatTaskState(state));
				}

				case "add_error": {
					if (!params.error) {
						return {
							content: [{ type: "text", text: "add_error requires error." }],
							details: { action, error: "missing error" },
						};
					}
					state.errors.push({
						message: params.error,
						tool: params.tool,
						recovered: params.recovered === true,
						createdAt: new Date().toISOString(),
					});
					if (params.recovered !== true) state.status = "failed";
					return persist(state, `Recorded error (${state.errors.length} total).`);
				}

				case "note": {
					if (params.note) state.contextNotes.push(params.note);
					if (params.nextSteps) state.nextSteps = params.nextSteps;
					if (!params.note && !params.nextSteps) {
						return {
							content: [{ type: "text", text: "note requires note and/or nextSteps." }],
							details: { action, error: "missing params" },
						};
					}
					return persist(state, formatTaskState(state));
				}

				case "clear": {
					const cleared = emptyTaskState(sessionId);
					lastInjectedTask.delete(sessionId);
					return persist(cleared, "Task state cleared.");
				}

				default:
					return {
						content: [{ type: "text", text: `Unknown action: ${action}` }],
						details: { action, error: "unknown action" },
					};
			}
		},
	});

	// Per-turn injection. Replaces the fork's private _maybeInjectContext, which
	// mutated the message array inside AgentSession.
	pi.on("context", async (event, ctx) => {
		if (event.messages.length === 0) return;
		const sessionId = ctx.sessionManager.getSessionId();
		const additions: string[] = [];

		const task = loadTaskState(ctx.cwd, sessionId);
		if (hasOpenWork(task)) {
			const text = compactTaskState(task);
			if (text && text !== lastInjectedTask.get(sessionId)) {
				lastInjectedTask.set(sessionId, text);
				additions.push(`## Task state\n\n${text}`);
			}
		}

		const checkpoint = loadCheckpoint(ctx.cwd, sessionId);
		if (checkpoint) {
			const text = compactCheckpoint(checkpoint);
			if (text && text !== lastInjectedCheckpoint.get(sessionId)) {
				lastInjectedCheckpoint.set(sessionId, text);
				additions.push(`## Context checkpoint\n\n${text}`);
			}
		}

		if (additions.length === 0) return;

		// Insert before the final message so the user's current turn stays last.
		const head = event.messages.slice(0, -1);
		const tail = event.messages[event.messages.length - 1];
		if (!tail) return;
		return {
			messages: [
				...head,
				...additions.map((content) => ({ role: "user" as const, content, timestamp: Date.now() })),
				tail,
			],
		};
	});

	// Structured compaction. Returning undefined anywhere here leaves upstream's
	// default compaction in charge.
	pi.on("session_before_compact", async (event, ctx) => {
		const sessionId = ctx.sessionManager.getSessionId();
		const { preparation, signal, reason } = event;
		const model = ctx.model;
		if (!model) return;

		const messages = [...preparation.messagesToSummarize, ...preparation.turnPrefixMessages];
		if (messages.length === 0) return;

		try {
			const response = await ctx.modelRegistry.complete(
				model,
				{
					messages: [
						{
							role: "user",
							content: [
								{
									type: "text",
									text: buildCheckpointPrompt({
										messages,
										previousSummary: preparation.previousSummary,
									}),
								},
							],
							timestamp: Date.now(),
						},
					],
				},
				{ maxTokens: 8192, signal, cacheRetention: "none", sessionId: uuidv7() },
			);

			const text = response.content
				.filter((part): part is { type: "text"; text: string } => part.type === "text")
				.map((part) => part.text)
				.join("\n");
			if (!text.trim()) return;

			const built = checkpointFromSummary(sessionId, text, {
				tokensBefore: preparation.tokensBefore,
				previous: loadCheckpoint(ctx.cwd, sessionId),
			});
			if (!built) return;

			saveCheckpoint(ctx.cwd, built.checkpoint);
			appendEvent(ctx.cwd, checkpointSaveEvent(sessionId, {
				goal: built.checkpoint.goal,
				steps: built.checkpoint.nextSteps.length,
			}));
			pi.appendEntry("openpi:checkpoint", {
				goal: built.checkpoint.goal,
				done: built.checkpoint.done,
				inProgress: built.checkpoint.inProgress,
				nextSteps: built.checkpoint.nextSteps,
				issues: built.checkpoint.issues,
				reason,
				at: built.checkpoint.updatedAt,
			});
			// Force re-injection: the checkpoint just changed.
			lastInjectedCheckpoint.delete(sessionId);

			return {
				compaction: {
					summary: built.summary,
					firstKeptEntryId: preparation.firstKeptEntryId,
					tokensBefore: preparation.tokensBefore,
					usage: response.usage,
					details: { openpi: "checkpoint", version: 1 },
				},
			};
		} catch {
			// Abort, provider error, malformed JSON: fall through to default.
			return;
		}
	});

	pi.on("session_compact", async (event, ctx) => {
		appendEvent(
			ctx.cwd,
			compactionEvent(ctx.sessionManager.getSessionId(), {
				reason: event.reason,
				tokensBefore: event.compactionEntry.tokensBefore,
				fromExtension: event.fromExtension,
			}),
		);
	});

	pi.on("session_start", async (_event, ctx) => {
		const sessionId = ctx.sessionManager.getSessionId();
		sessionStartedAt.set(sessionId, Date.now());
		appendEvent(ctx.cwd, sessionStartEvent(sessionId, ctx.cwd, ctx.model?.id));

		// Surface resumable state so the desktop can show it before the first turn.
		const task = loadTaskState(ctx.cwd, sessionId);
		const checkpoint = loadCheckpoint(ctx.cwd, sessionId);
		if (hasOpenWork(task) || checkpoint) {
			pi.appendEntry("openpi:session-state-resumed", {
				task: task ? { goal: task.goal, status: task.status, steps: task.steps.length } : undefined,
				checkpoint: checkpoint ? { goal: checkpoint.goal, nextSteps: checkpoint.nextSteps } : undefined,
				at: new Date().toISOString(),
			});
			if (ctx.hasUI) {
				const bits: string[] = [];
				if (hasOpenWork(task) && task) {
					const open = task.steps.filter((step) => step.status !== "completed").length;
					bits.push(`task: ${open} open step(s)`);
				}
				if (checkpoint) bits.push("checkpoint restored");
				if (bits.length > 0) ctx.ui.notify(`Session state: ${bits.join(" · ")}`, "info");
			}
		}
	});

	pi.on("tool_call", async (event, ctx) => {
		toolCallStartedAt.set(event.toolCallId, Date.now());
		appendEvent(ctx.cwd, toolCallEvent(ctx.sessionManager.getSessionId(), event.toolName, event.input));
	});

	pi.on("tool_result", async (event, ctx) => {
		const startedAt = toolCallStartedAt.get(event.toolCallId);
		toolCallStartedAt.delete(event.toolCallId);
		const resultBytes = event.content.reduce(
			(total, part) => total + (part.type === "text" ? part.text.length : 0),
			0,
		);
		appendEvent(
			ctx.cwd,
			toolResultEvent(ctx.sessionManager.getSessionId(), event.toolName, {
				durationMs: startedAt ? Date.now() - startedAt : undefined,
				isError: event.isError,
				resultBytes,
			}),
		);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		const sessionId = ctx.sessionManager.getSessionId();
		const startedAt = sessionStartedAt.get(sessionId);
		appendEvent(ctx.cwd, sessionEndEvent(sessionId, startedAt ? Date.now() - startedAt : 0));
		sessionStartedAt.delete(sessionId);
		lastInjectedTask.delete(sessionId);
		lastInjectedCheckpoint.delete(sessionId);
	});

	pi.registerCommand("task", {
		description: "Show structured task state and the context checkpoint",
		async handler(_args, ctx) {
			const sessionId = ctx.sessionManager.getSessionId();
			const task = loadTaskState(ctx.cwd, sessionId);
			const checkpoint: ContextCheckpoint | undefined = loadCheckpoint(ctx.cwd, sessionId);
			const parts = [formatTaskState(task)];
			if (checkpoint) parts.push("", formatCheckpoint(checkpoint));
			ctx.ui.notify(parts.join("\n"), "info");
		},
	});
}
