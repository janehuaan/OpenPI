/**
 * Compaction into a structured checkpoint.
 *
 * `session_before_compact` lets an extension produce the compaction summary
 * itself. We ask the model for JSON matching the checkpoint schema, persist the
 * parsed result, and hand the same text back as the summary. So one LLM call
 * yields both what the conversation needs (a summary entry) and what a restart
 * needs (a machine-readable checkpoint).
 *
 * On any failure - bad JSON, empty response, aborted request - the handler
 * returns undefined and upstream's default compaction runs. Compaction must
 * never fail because our extra step did.
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { checkpointFromDraft, type ContextCheckpoint, parseCheckpointDraft } from "./checkpoint.ts";

/**
 * Self-contained conversation serializer for compaction prompt.
 * Completely eliminates transitive dependency on pi-coding-agent's CLI/chalk bundle.
 */
export function serializeConversation(messages: any[]): string {
	const parts: string[] = [];
	for (const msg of messages) {
		if (!msg) continue;
		if (msg.role === "user") {
			const text = typeof msg.content === "string" 
				? msg.content 
				: Array.isArray(msg.content) 
					? msg.content.filter((p: any) => p.type === "text").map((p: any) => p.text).join("\n") 
					: "";
			if (text) parts.push(`[User]: ${text}`);
		} else if (msg.role === "assistant") {
			if (Array.isArray(msg.content)) {
				const text = msg.content.filter((p: any) => p.type === "text").map((p: any) => p.text).join("\n");
				if (text) parts.push(`[Assistant]: ${text}`);
				const toolCalls = msg.content.filter((p: any) => p.type === "toolCall");
				if (toolCalls.length > 0) {
					const callsStr = toolCalls.map((tc: any) => `${tc.name}(${JSON.stringify(tc.arguments ?? {})})`).join("; ");
					parts.push(`[Assistant tool calls]: ${callsStr}`);
				}
			} else if (typeof msg.content === "string") {
				parts.push(`[Assistant]: ${msg.content}`);
			}
		} else if (msg.role === "toolResult" || msg.role === "tool") {
			const text = typeof msg.content === "string"
				? msg.content
				: Array.isArray(msg.content)
					? msg.content.filter((p: any) => p.type === "text").map((p: any) => p.text).join("\n")
					: "";
			if (text) {
				const truncated = text.length > 1500 ? `${text.slice(0, 1500)}\n\n[... truncated]` : text;
				parts.push(`[Tool result]: ${truncated}`);
			}
		}
	}
	return parts.join("\n\n");
}

export const CHECKPOINT_SCHEMA_PROMPT = `Summarize the conversation above as a context checkpoint another agent will use to continue the work.

Output ONLY valid JSON. No markdown fences, no commentary. Exactly this shape:

{
  "goal": "what the user is trying to accomplish",
  "done": ["completed work"],
  "inProgress": ["what is being worked on right now"],
  "nextSteps": ["ordered list of what should happen next"],
  "decisions": [{"what": "decision made", "why": "rationale"}],
  "issues": [{"message": "error or blocker", "recovered": false, "tool": "tool-name"}],
  "criticalContext": ["file paths, symbol names, error strings to preserve verbatim"],
  "constraints": ["requirements the user stated"]
}

Rules:
- Preserve file paths, function names and error messages exactly.
- "inProgress" holds at most two items: the current focus.
- "issues" lists unresolved problems; set recovered=true only for ones already fixed.
- Empty sections are [], never null or omitted.`;

export const CHECKPOINT_UPDATE_PROMPT = `The messages above are NEW turns to fold into the existing checkpoint given in <previous-checkpoint>.

Output the updated checkpoint as JSON in the same shape. Rules:
- Keep everything from the previous checkpoint that is still true.
- Move finished items from "inProgress" to "done".
- Re-order "nextSteps" to reflect what was just accomplished.
- Set recovered=true on issues that are now resolved.
- Drop anything no longer relevant.
- Preserve file paths, function names and error messages exactly.`;

export interface BuildPromptOptions {
	messages: AgentMessage[];
	previousSummary?: string;
}

/** Build the summarization prompt. Pure, so it can be tested without a model. */
export function buildCheckpointPrompt(options: BuildPromptOptions): string {
	const conversation = serializeConversation(options.messages);
	if (options.previousSummary) {
		return [
			`<previous-checkpoint>\n${options.previousSummary}\n</previous-checkpoint>`,
			`<conversation>\n${conversation}\n</conversation>`,
			CHECKPOINT_UPDATE_PROMPT,
		].join("\n\n");
	}
	return [`<conversation>\n${conversation}\n</conversation>`, CHECKPOINT_SCHEMA_PROMPT].join("\n\n");
}

export interface CheckpointFromSummary {
	checkpoint: ContextCheckpoint;
	/** Text to store as the compaction summary. */
	summary: string;
}

/**
 * Turn a model response into a checkpoint plus the summary text to persist.
 *
 * Returns undefined when the response holds no usable JSON, which is the signal
 * to fall back to default compaction.
 */
export function checkpointFromSummary(
	sessionId: string,
	response: string,
	options: { tokensBefore?: number; previous?: ContextCheckpoint } = {},
): CheckpointFromSummary | undefined {
	const draft = parseCheckpointDraft(response);
	if (!draft) return undefined;

	const checkpoint = checkpointFromDraft(sessionId, draft, {
		summary: response,
		tokensBefore: options.tokensBefore,
		previous: options.previous,
	});

	// A goal-less checkpoint with no content would inject noise into every later
	// turn, so treat it as a parse failure and let default compaction run.
	const hasContent =
		checkpoint.goal.length > 0 ||
		checkpoint.done.length > 0 ||
		checkpoint.inProgress.length > 0 ||
		checkpoint.nextSteps.length > 0;
	if (!hasContent) return undefined;

	return { checkpoint, summary: renderSummary(checkpoint) };
}

/**
 * Render the checkpoint as the compaction summary text.
 *
 * The stored summary is prose rather than the raw JSON: it is fed back to the
 * model as conversation history, where a JSON blob reads as data to be parsed
 * instead of context to be continued. The JSON lives in the checkpoint file.
 */
function renderSummary(checkpoint: ContextCheckpoint): string {
	const lines: string[] = [`Goal: ${checkpoint.goal}`];
	const section = (title: string, items: string[]) => {
		if (items.length === 0) return;
		lines.push("", `${title}:`);
		for (const item of items) lines.push(`- ${item}`);
	};

	section("Completed", checkpoint.done);
	section("In progress", checkpoint.inProgress);
	section("Next steps", checkpoint.nextSteps);

	if (checkpoint.decisions.length > 0) {
		lines.push("", "Decisions:");
		for (const decision of checkpoint.decisions) lines.push(`- ${decision.what} — ${decision.why}`);
	}

	const open = checkpoint.issues.filter((issue) => !issue.recovered);
	if (open.length > 0) {
		lines.push("", "Open issues:");
		for (const issue of open) lines.push(`- ${issue.message}${issue.tool ? ` [${issue.tool}]` : ""}`);
	}

	section("Critical context", checkpoint.criticalContext);
	section("Constraints", checkpoint.constraints);

	return lines.join("\n");
}
