/**
 * Prompt-cache simulation benchmark.
 *
 * Models the provider cache as longest-common-prefix alignment between
 * consecutive requests (Anthropic-style). Each request is a message list;
 * the prefix that matches the previous request counts as cacheRead, the tail
 * as cacheWrite. Measures how different injection strategies affect the
 * aggregate hit rate over a long simulated conversation.
 */
import { describe, expect, it } from "vitest";

interface SimMessage {
	kind: "user" | "assistant" | "tool" | "todo";
	content: string;
}

type Request = SimMessage[];

function tokens(message: SimMessage): number {
	return Math.max(1, Math.round(message.content.length / 4));
}

/** Length (tokens) of the longest common prefix of two requests. */
function lcpTokens(a: Request, b: Request): number {
	let total = 0;
	const n = Math.min(a.length, b.length);
	for (let i = 0; i < n; i++) {
		if (a[i].kind !== b[i].kind || a[i].content !== b[i].content) break;
		total += tokens(a[i]);
	}
	return total;
}

function simulate(requests: Request[]): { reads: number[]; writes: number[]; totals: number[] } {
	const reads: number[] = [];
	const writes: number[] = [];
	const totals: number[] = [];
	let previous: Request = [];
	for (const request of requests) {
		const read = lcpTokens(previous, request);
		const total = request.reduce((sum, m) => sum + tokens(m), 0);
		const write = Math.max(0, total - read);
		reads.push(read);
		writes.push(write);
		totals.push(total);
		previous = request;
	}
	return { reads, writes, totals };
}

function hitRate(reads: number[], writes: number[]): number {
	const total = reads.reduce((a, b) => a + b, 0) + writes.reduce((a, b) => a + b, 0);
	return total === 0 ? 0 : reads.reduce((a, b) => a + b, 0) / total;
}

/** Build a conversation: N plain turns with occasional tool/todo events. */
function buildConversation(options: {
	turns: number;
	toolEvery?: number;
	todoChanges?: number[];
	todoInSystemPrompt?: boolean;
}): Request[] {
	const { turns, toolEvery = 0, todoChanges = [], todoInSystemPrompt = false } = options;
	const requests: Request[] = [];
	const system = [{ kind: "user" as const, content: "SYSTEM PROMPT (static)" }];
	let todoIndex = 0;
	let lastTodo = `todo v${todoIndex}`;
	for (let turn = 1; turn <= turns; turn++) {
		// todo update happens before this turn?
		if (todoChanges.includes(turn)) {
			todoIndex += 1;
			lastTodo = `todo v${todoIndex}: ${"task list content ".repeat(20)}`;
		}
		const history: SimMessage[] = [...system];
		// Real interleaved history: user → assistant per prior turn, plus a
		// tool result when toolEvery is set and this turn falls on the step.
		for (let t = 1; t < turn; t++) {
			history.push({ kind: "user", content: `user question ${t}` });
			history.push({ kind: "assistant", content: `assistant reply ${t}: ${"text ".repeat(30)}` });
			if (toolEvery && t % toolEvery === 0) {
				history.push({ kind: "tool", content: `tool result ${t}: ${"data ".repeat(40)}` });
			}
		}
		if (todoInSystemPrompt) {
			// Old behavior: todo lives in the system prompt → any change rewrites it.
			history[0] = { kind: "user", content: `SYSTEM PROMPT (static) + ${lastTodo}` };
		} else if (todoChanges.includes(turn) || turn === 1) {
			// New behavior: todo is a message; only inserted when it changes.
			history.push({ kind: "todo", content: lastTodo });
		}
		// Current turn's user message.
		history.push({ kind: "user", content: `user question ${turn}` });
		requests.push(history);
	}
	return requests;
}

describe("prompt-cache simulation", () => {
	it("long plain conversations reach 99%+ in the stable tail segment", () => {
		const { reads, writes } = simulate(buildConversation({ turns: 120, todoChanges: [1] }));
		const rate = hitRate(reads.slice(100), writes.slice(100)); // stable long-session tail
		expect(rate).toBeGreaterThan(0.99);
	});

	it("todo in the system prompt collapses the cache on every update", () => {
		// 6 todo updates across 60 turns.
		const changes = [1, 11, 21, 31, 41, 51];
		const oldStyle = buildConversation({ turns: 60, todoChanges: changes, todoInSystemPrompt: true });
		const newStyle = buildConversation({ turns: 60, todoChanges: changes });
		const oldRate = hitRate(simulate(oldStyle).reads, simulate(oldStyle).writes);
		const newRate = hitRate(simulate(newStyle).reads, simulate(newStyle).writes);
		expect(newRate).toBeGreaterThan(oldRate + 0.05);
		expect(newRate).toBeGreaterThan(0.95);
	});

	it("tool-heavy sessions still hold a high stable-segment rate", () => {
		const { reads, writes } = simulate(buildConversation({ turns: 60, toolEvery: 1 }));
		const rate = hitRate(reads.slice(15), writes.slice(15));
		expect(rate).toBeGreaterThan(0.93);
	});

	it("message-based todo changes invalidate only the tail, not the prefix", () => {
		const requests = buildConversation({ turns: 30, todoChanges: [10] });
		const result = simulate(requests);
		// The update turn (index 9) carries a large write; normal turns far less.
		expect(result.writes[9]).toBeGreaterThan(result.writes[6]);
		// Recovery turns after the update keep the pre-update prefix cached:
		// their hit rate is dominated by reads of everything before the tail.
		const after = hitRate(result.reads.slice(11, 20), result.writes.slice(11, 20));
		const before = hitRate(result.reads.slice(2, 8), result.writes.slice(2, 8));
		expect(after).toBeGreaterThan(0.9);
		expect(after).toBeGreaterThan(before);
	});
});
