/**
 * compaction.ts coverage.
 *
 * The contract that matters: a usable model response becomes a checkpoint plus
 * prose summary, and anything unusable returns undefined so upstream's default
 * compaction runs instead. A false positive here would silently replace a good
 * summary with an empty one.
 */

import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
	buildCheckpointPrompt,
	CHECKPOINT_SCHEMA_PROMPT,
	CHECKPOINT_UPDATE_PROMPT,
	checkpointFromSummary,
} from "../src/compaction.ts";
import { checkpointFromDraft } from "../src/checkpoint.ts";

const messages: AgentMessage[] = [
	{ role: "user", content: [{ type: "text", text: "port the memory extension" }], timestamp: 1 },
	{
		role: "assistant",
		content: [{ type: "text", text: "Copied vectors.ts and added tests." }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-opus-5",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		stopReason: "stop",
		timestamp: 2,
	} as AgentMessage,
];

const RESPONSE = JSON.stringify({
	goal: "port the memory extension",
	done: ["copied vectors.ts", "added 100 tests"],
	inProgress: ["wiring session-state"],
	nextSteps: ["port the tools extension"],
	decisions: [{ what: "drop the Rust backend", why: "its binary never shipped" }],
	issues: [{ message: "provider 401", recovered: true, tool: "pi" }],
	criticalContext: ["extensions/memory/src/vectors.ts"],
	constraints: ["desktop only"],
});

describe("buildCheckpointPrompt", () => {
	it("includes the conversation and the schema instructions", () => {
		const prompt = buildCheckpointPrompt({ messages });
		expect(prompt).toContain("port the memory extension");
		expect(prompt).toContain("Copied vectors.ts");
		expect(prompt).toContain(CHECKPOINT_SCHEMA_PROMPT);
	});

	it("switches to the update prompt when a previous summary exists", () => {
		const prompt = buildCheckpointPrompt({ messages, previousSummary: "Goal: earlier goal" });
		expect(prompt).toContain("<previous-checkpoint>");
		expect(prompt).toContain("earlier goal");
		expect(prompt).toContain(CHECKPOINT_UPDATE_PROMPT);
		expect(prompt).not.toContain(CHECKPOINT_SCHEMA_PROMPT);
	});

	it("is deterministic for the same input", () => {
		expect(buildCheckpointPrompt({ messages })).toBe(buildCheckpointPrompt({ messages }));
	});

	it("does not throw on an empty conversation", () => {
		expect(() => buildCheckpointPrompt({ messages: [] })).not.toThrow();
	});
});

describe("checkpointFromSummary", () => {
	it("builds a checkpoint and a prose summary from valid JSON", () => {
		const built = checkpointFromSummary("s1", RESPONSE, { tokensBefore: 120_000 });
		expect(built).toBeDefined();
		expect(built?.checkpoint.goal).toBe("port the memory extension");
		expect(built?.checkpoint.tokensBefore).toBe(120_000);
		expect(built?.summary).toContain("Goal: port the memory extension");
		expect(built?.summary).toContain("Completed:");
		expect(built?.summary).toContain("drop the Rust backend");
	});

	it("renders prose, not raw JSON, as the summary", () => {
		// The summary is replayed to the model as conversation history, where a
		// JSON blob reads as data to parse rather than context to continue.
		const built = checkpointFromSummary("s1", RESPONSE);
		expect(built?.summary.trimStart().startsWith("{")).toBe(false);
		expect(built?.summary).not.toContain('"nextSteps"');
	});

	it("recovers JSON wrapped in fences and prose", () => {
		const wrapped = `Sure:\n\`\`\`json\n${RESPONSE}\n\`\`\``;
		expect(checkpointFromSummary("s1", wrapped)?.checkpoint.goal).toBe("port the memory extension");
	});

	it("omits recovered issues from the summary's open-issues section", () => {
		const built = checkpointFromSummary("s1", RESPONSE);
		expect(built?.summary).not.toContain("provider 401");
	});

	it("lists unresolved issues in the summary", () => {
		const response = JSON.stringify({
			goal: "g",
			nextSteps: ["retry"],
			issues: [{ message: "socket refused", recovered: false, tool: "daemon" }],
		});
		const built = checkpointFromSummary("s1", response);
		expect(built?.summary).toContain("Open issues:");
		expect(built?.summary).toContain("socket refused");
		expect(built?.summary).toContain("[daemon]");
	});

	it("returns undefined when the response has no JSON", () => {
		expect(checkpointFromSummary("s1", "The user asked me to port some code.")).toBeUndefined();
	});

	it("returns undefined for JSON with no usable content", () => {
		// An all-empty checkpoint would inject noise into every later turn, so it
		// is treated as a parse failure.
		expect(checkpointFromSummary("s1", JSON.stringify({ goal: "", done: [], nextSteps: [] }))).toBeUndefined();
		expect(checkpointFromSummary("s1", "{}")).toBeUndefined();
	});

	it("accepts a checkpoint that has only a goal", () => {
		expect(checkpointFromSummary("s1", JSON.stringify({ goal: "just a goal" }))).toBeDefined();
	});

	it("accepts a checkpoint that has only next steps", () => {
		expect(checkpointFromSummary("s1", JSON.stringify({ nextSteps: ["do the thing"] }))).toBeDefined();
	});

	it("keeps the previous createdAt when updating an existing checkpoint", () => {
		const previous = checkpointFromDraft("s1", { goal: "old goal" });
		const built = checkpointFromSummary("s1", RESPONSE, { previous });
		expect(built?.checkpoint.createdAt).toBe(previous.createdAt);
	});

	it("stores the raw response as the history summary", () => {
		const built = checkpointFromSummary("s1", RESPONSE);
		expect(built?.checkpoint.historySummary).toContain('"goal"');
	});
});
