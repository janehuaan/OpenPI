import type { AgentTool } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import type { SessionEntry } from "../../src/core/session-manager.ts";
import { buildContextEntries, sessionEntryToContextMessages } from "../../src/core/session-manager.ts";
import { createHarness } from "./harness.ts";

type Harness = Awaited<ReturnType<typeof createHarness>>;

const harnesses: Harness[] = [];

async function makeHarness(options: Parameters<typeof createHarness>[0] = {}) {
	const harness = await createHarness(options);
	harnesses.push(harness);
	return harness;
}

function makeMessageEntry(id: string, parentId: string | null, text: string, timestamp: string): SessionEntry {
	return {
		type: "message",
		id,
		parentId,
		timestamp,
		message: { role: "user", content: [{ type: "text", text }], timestamp: Date.parse(timestamp) },
	};
}

function makeSnapshotEntry(id: string, parentId: string, messages: unknown[]): SessionEntry {
	return {
		type: "snapshot",
		id,
		parentId,
		timestamp: "2026-01-01T00:00:05.000Z",
		messages: messages as never,
		toolNames: ["read", "bash"],
	};
}

afterEach(() => {
	for (const harness of harnesses) {
		harness.cleanup();
	}
	harnesses.length = 0;
});

describe("checkpoint snapshots", () => {
	it("trims entries before the snapshot and replays snapshot messages", () => {
		const e1 = makeMessageEntry("m1", null, "first", "2026-01-01T00:00:01.000Z");
		const e2 = makeMessageEntry("m2", "m1", "second", "2026-01-01T00:00:02.000Z");
		const e3 = makeMessageEntry("m3", "m2", "third", "2026-01-01T00:00:03.000Z");
		const snap = makeSnapshotEntry("s1", "m3", [
			{ role: "user", content: [{ type: "text", text: "first" }], timestamp: 1 },
			{ role: "user", content: [{ type: "text", text: "second" }], timestamp: 2 },
			{ role: "user", content: [{ type: "text", text: "third" }], timestamp: 3 },
		]);
		const e4 = makeMessageEntry("m4", "s1", "after snapshot", "2026-01-01T00:00:06.000Z");

		const entries = [e1, e2, e3, snap, e4];
		const contextEntries = buildContextEntries(entries, "m4");
		expect(contextEntries.map((entry) => entry.type)).toEqual(["snapshot", "message"]);

		const messages = contextEntries.flatMap(sessionEntryToContextMessages);
		const texts = messages.map((message) => {
			if (!("content" in message)) return "";
			const content = message.content;
			if (typeof content === "string") return content;
			if (Array.isArray(content)) {
				return content
					.filter((block) => typeof block === "object" && block !== null && "text" in block)
					.map((block) => String((block as { text: unknown }).text))
					.join("");
			}
			return "";
		});
		expect(texts).toEqual(["first", "second", "third", "after snapshot"]);
	});

	it("keeps the latest snapshot when multiple exist", () => {
		const e1 = makeMessageEntry("m1", null, "old", "2026-01-01T00:00:01.000Z");
		const snap1 = makeSnapshotEntry("s1", "m1", [
			{ role: "user", content: [{ type: "text", text: "old" }], timestamp: 1 },
		]);
		const e2 = makeMessageEntry("m2", "s1", "middle", "2026-01-01T00:00:03.000Z");
		const snap2 = makeSnapshotEntry("s2", "m2", [
			{ role: "user", content: [{ type: "text", text: "old" }], timestamp: 1 },
			{ role: "user", content: [{ type: "text", text: "middle" }], timestamp: 3 },
		]);
		const e3 = makeMessageEntry("m3", "s2", "new", "2026-01-01T00:00:05.000Z");

		const contextEntries = buildContextEntries([e1, snap1, e2, snap2, e3], "m3");
		expect(contextEntries.map((entry) => entry.type)).toEqual(["snapshot", "message"]);
		expect(contextEntries[0]?.id).toBe("s2");
	});

	it("does not change context without snapshots", () => {
		const e1 = makeMessageEntry("m1", null, "first", "2026-01-01T00:00:01.000Z");
		const e2 = makeMessageEntry("m2", "m1", "second", "2026-01-01T00:00:02.000Z");
		const contextEntries = buildContextEntries([e1, e2], "m2");
		expect(contextEntries.map((entry) => entry.type)).toEqual(["message", "message"]);
	});

	it("appends snapshots automatically every checkpointIntervalTurns turns", async () => {
		const echoTool: AgentTool = {
			name: "echo",
			label: "Echo",
			description: "Echo text",
			parameters: Type.Object({ text: Type.String() }),
			execute: async (_toolCallId, params) => {
				const text = typeof params === "object" && params !== null && "text" in params ? String(params.text) : "";
				return { content: [{ type: "text", text: `echoed:${text}` }], details: {} };
			},
		};
		const harness = await makeHarness({
			settings: { checkpointIntervalTurns: 2 },
			tools: [echoTool],
		});

		// Turn 1: tool call. Turn 2: final answer. Snapshot fires after turn 2.
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("echo", { text: "a" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("go");

		const snapshotEntries = harness.sessionManager.getEntries().filter((entry) => entry.type === "snapshot");
		expect(snapshotEntries).toHaveLength(1);
		const snapshot = snapshotEntries[0];
		expect(snapshot?.type).toBe("snapshot");
		if (snapshot?.type === "snapshot") {
			expect(snapshot.messages.length).toBeGreaterThan(0);
			expect(snapshot.toolNames).toBeTruthy();
		}
	});

	it("does not append snapshots when checkpointIntervalTurns is 0", async () => {
		const harness = await makeHarness({ settings: { checkpointIntervalTurns: 0 } });
		harness.setResponses([fauxAssistantMessage("turn 1"), fauxAssistantMessage("turn 2")]);
		await harness.session.prompt("go");
		const snapshotEntries = harness.sessionManager.getEntries().filter((entry) => entry.type === "snapshot");
		expect(snapshotEntries).toHaveLength(0);
	});
});
