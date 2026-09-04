/**
 * turn.ts coverage: the reducer that turns pi's event stream into chat state.
 *
 * This is where a subtle bug shows up as visibly wrong UI — doubled text, a
 * spinner that never stops, a lost error — so the sequences here mirror what the
 * real stream produced in the Phase 0 spike.
 */

import { describe, expect, it } from "vitest";
import { emptyTurnState, reduceAll, reduceTurn, textOf } from "../lib/turn.ts";

const userMessage = (text: string) => ({
	type: "message_end",
	message: { role: "user", content: [{ type: "text", text }] },
});

const assistantMessage = (text: string, extra: Record<string, unknown> = {}) => ({
	type: "message_end",
	message: { role: "assistant", content: [{ type: "text", text }], stopReason: "stop", ...extra },
});

describe("textOf", () => {
	it("concatenates text parts and ignores other content", () => {
		const message = {
			content: [
				{ type: "text", text: "hello " },
				{ type: "toolCall", name: "read", id: "c1" },
				{ type: "text", text: "world" },
			],
		};
		expect(textOf(message)).toBe("hello world");
	});

	it("accepts a plain string content", () => {
		expect(textOf({ content: "just text" })).toBe("just text");
	});

	it("returns empty for missing or malformed input", () => {
		expect(textOf(undefined)).toBe("");
		expect(textOf({})).toBe("");
		expect(textOf({ content: 42 })).toBe("");
	});
});

describe("a complete turn", () => {
	it("produces one user and one assistant message", () => {
		const state = reduceAll([
			{ type: "agent_start" },
			userMessage("hi"),
			{ type: "message_start", message: { role: "assistant" } },
			{ type: "message_update", delta: "he" },
			{ type: "message_update", delta: "llo" },
			assistantMessage("hello"),
			{ type: "agent_end" },
			{ type: "agent_settled" },
		]);

		expect(state.messages).toHaveLength(2);
		expect(state.messages[0]).toMatchObject({ role: "user", text: "hi" });
		expect(state.messages[1]).toMatchObject({ role: "assistant", text: "hello", streaming: false });
		expect(state.active).toBe(false);
	});

	it("does not double text when deltas and a final message both arrive", () => {
		// message_end carries the full text; appending it to accumulated deltas is
		// the obvious bug here, and it renders as visibly duplicated output.
		const state = reduceAll([
			{ type: "agent_start" },
			{ type: "message_start", message: { role: "assistant" } },
			{ type: "message_update", delta: "SCHEDULED" },
			assistantMessage("SCHEDULED"),
			{ type: "agent_settled" },
		]);
		expect(state.messages[0]?.text).toBe("SCHEDULED");
	});

	it("marks the assistant message streaming until it ends", () => {
		let state = reduceTurn(emptyTurnState(), { type: "agent_start" });
		state = reduceTurn(state, { type: "message_start", message: { role: "assistant" } });
		expect(state.messages[0]?.streaming).toBe(true);

		state = reduceTurn(state, assistantMessage("done"));
		expect(state.messages[0]?.streaming).toBe(false);
	});

	it("is active between agent_start and agent_settled", () => {
		let state = reduceTurn(emptyTurnState(), { type: "agent_start" });
		expect(state.active).toBe(true);
		state = reduceTurn(state, { type: "agent_settled" });
		expect(state.active).toBe(false);
	});

	it("handles a final message with no preceding message_start", () => {
		// Non-streaming providers skip message_start entirely.
		const state = reduceAll([{ type: "agent_start" }, assistantMessage("one shot")]);
		expect(state.messages).toHaveLength(1);
		expect(state.messages[0]?.text).toBe("one shot");
	});
});

describe("errors", () => {
	it("keeps a provider error carried on the assistant message", () => {
		// A 401 arrives as a normal message_end with errorMessage set and empty
		// content, not as a thrown error - so dropping it shows a blank reply.
		const state = reduceAll([
			{ type: "agent_start" },
			{ type: "message_start", message: { role: "assistant" } },
			{
				type: "message_end",
				message: { role: "assistant", content: [], stopReason: "error", errorMessage: "401 invalid x-api-key" },
			},
			{ type: "agent_settled" },
		]);

		expect(state.messages[0]?.error).toContain("401");
		expect(state.error).toContain("401");
		expect(state.active).toBe(false);
	});

	it("reports a session exit and stops being active", () => {
		let state = reduceTurn(emptyTurnState(), { type: "agent_start" });
		state = reduceTurn(state, { type: "session_exit", sessionId: "s1", code: 3 });
		expect(state.active).toBe(false);
		expect(state.error).toBe("session exited");
	});

	it("clears a previous error when a new turn starts", () => {
		let state = reduceTurn(emptyTurnState(), { type: "session_exit", sessionId: "s1" });
		expect(state.error).toBeTruthy();
		state = reduceTurn(state, { type: "agent_start" });
		expect(state.error).toBeUndefined();
	});
});

describe("tool activity", () => {
	it("tracks running tools and clears them as they finish", () => {
		let state = reduceTurn(emptyTurnState(), { type: "agent_start" });
		state = reduceTurn(state, { type: "tool_execution_start", toolCallId: "c1", toolName: "read" });
		state = reduceTurn(state, { type: "tool_execution_start", toolCallId: "c2", toolName: "bash" });
		expect(state.runningTools.map((tool) => tool.name)).toEqual(["read", "bash"]);

		state = reduceTurn(state, { type: "tool_execution_end", toolCallId: "c1" });
		expect(state.runningTools.map((tool) => tool.name)).toEqual(["bash"]);
	});

	it("ignores a duplicate start for the same call id", () => {
		let state = reduceTurn(emptyTurnState(), { type: "tool_execution_start", toolCallId: "c1", toolName: "read" });
		state = reduceTurn(state, { type: "tool_execution_start", toolCallId: "c1", toolName: "read" });
		expect(state.runningTools).toHaveLength(1);
	});

	it("clears running tools when the turn settles", () => {
		// A tool whose end event never arrives would otherwise spin forever.
		let state = reduceTurn(emptyTurnState(), { type: "tool_execution_start", toolCallId: "c1", toolName: "read" });
		state = reduceTurn(state, { type: "agent_settled" });
		expect(state.runningTools).toEqual([]);
	});

	it("records tool calls named in the assistant message", () => {
		const state = reduceAll([
			{ type: "agent_start" },
			{
				type: "message_end",
				message: {
					role: "assistant",
					content: [
						{ type: "text", text: "looking" },
						{ type: "toolCall", id: "c1", name: "memory" },
					],
					stopReason: "toolUse",
				},
			},
		]);
		expect(state.messages[0]?.tools.map((tool) => tool.name)).toEqual(["memory"]);
	});
});

describe("robustness", () => {
	it("returns the same state for an unknown event", () => {
		// The daemon forwards upstream's stream verbatim, and upstream adds event
		// types between releases; an unknown one must not throw.
		const state = emptyTurnState();
		expect(reduceTurn(state, { type: "some_future_event", payload: 1 })).toBe(state);
	});

	it("ignores a delta with no message in progress", () => {
		const state = emptyTurnState();
		expect(reduceTurn(state, { type: "message_update", delta: "orphan" })).toBe(state);
	});

	it("ignores an empty user message", () => {
		const state = emptyTurnState();
		expect(reduceTurn(state, userMessage("")).messages).toHaveLength(0);
	});

	it("ignores a message with an unexpected role", () => {
		const state = emptyTurnState();
		const next = reduceTurn(state, { type: "message_end", message: { role: "toolResult", content: [] } });
		expect(next.messages).toHaveLength(0);
	});

	it("survives two turns in a row, appending to the transcript", () => {
		let state = reduceAll([{ type: "agent_start" }, userMessage("first"), assistantMessage("one"), { type: "agent_settled" }]);
		state = reduceAll([{ type: "agent_start" }, userMessage("second"), assistantMessage("two"), { type: "agent_settled" }], state);
		expect(state.messages.map((message) => message.text)).toEqual(["first", "one", "second", "two"]);
	});
});
