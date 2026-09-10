import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { StreamMicroBatcher } from "../src/streaming-batcher.ts";
import type { PiRpcEvent } from "@openpi/shared";

describe("StreamMicroBatcher (60fps IPC Micro-Batching)", () => {
	it("passes non-streaming events through immediately", () => {
		const emitted: PiRpcEvent[] = [];
		const batcher = new StreamMicroBatcher((e) => emitted.push(e), { flushDelayMs: 20 });

		batcher.push({ type: "turn_start" });
		batcher.push({ type: "tool_execution_start", toolName: "read" });

		assert.equal(emitted.length, 2);
		assert.equal(emitted[0].type, "turn_start");
		assert.equal(emitted[1].type, "tool_execution_start");
		batcher.close();
	});

	it("coalesces consecutive text_delta chunks into a single batched event", async () => {
		const emitted: PiRpcEvent[] = [];
		const batcher = new StreamMicroBatcher((e) => emitted.push(e), { flushDelayMs: 20 });

		batcher.push({
			type: "message_update",
			assistantMessageEvent: { type: "text_delta", delta: "Hello ", contentIndex: 0 },
		});
		batcher.push({
			type: "message_update",
			assistantMessageEvent: { type: "text_delta", delta: "World", contentIndex: 0 },
		});
		batcher.push({
			type: "message_update",
			assistantMessageEvent: { type: "text_delta", delta: "!", contentIndex: 0 },
		});

		// Before timer fires, nothing emitted yet
		assert.equal(emitted.length, 0);

		// Wait for frame window to flush
		await new Promise((r) => setTimeout(r, 35));

		assert.equal(emitted.length, 1);
		const amEvent = (emitted[0] as any).assistantMessageEvent;
		assert.equal(amEvent.type, "text_delta");
		assert.equal(amEvent.delta, "Hello World!");
		batcher.close();
	});

	it("coalesces thinking_delta chunks into a single batched event", async () => {
		const emitted: PiRpcEvent[] = [];
		const batcher = new StreamMicroBatcher((e) => emitted.push(e), { flushDelayMs: 20 });

		batcher.push({
			type: "message_update",
			assistantMessageEvent: { type: "thinking_delta", delta: "Thinking step 1. ", contentIndex: 0 },
		});
		batcher.push({
			type: "message_update",
			assistantMessageEvent: { type: "thinking_delta", delta: "Thinking step 2.", contentIndex: 0 },
		});

		await new Promise((r) => setTimeout(r, 35));

		assert.equal(emitted.length, 1);
		const amEvent = (emitted[0] as any).assistantMessageEvent;
		assert.equal(amEvent.type, "thinking_delta");
		assert.equal(amEvent.delta, "Thinking step 1. Thinking step 2.");
		batcher.close();
	});

	it("flushes immediately when an incompatible event or turn boundary arrives", () => {
		const emitted: PiRpcEvent[] = [];
		const batcher = new StreamMicroBatcher((e) => emitted.push(e), { flushDelayMs: 100 });

		batcher.push({
			type: "message_update",
			assistantMessageEvent: { type: "text_delta", delta: "Computing...", contentIndex: 0 },
		});

		assert.equal(emitted.length, 0);

		// Now a tool execution arrives
		batcher.push({
			type: "tool_execution_start",
			toolName: "bash",
		});

		// Both the flushed text_delta and the tool execution should be emitted in order!
		assert.equal(emitted.length, 2);
		assert.equal((emitted[0] as any).assistantMessageEvent.delta, "Computing...");
		assert.equal(emitted[1].type, "tool_execution_start");

		batcher.close();
	});

	it("separates different content indices", () => {
		const emitted: PiRpcEvent[] = [];
		const batcher = new StreamMicroBatcher((e) => emitted.push(e), { flushDelayMs: 100 });

		batcher.push({
			type: "message_update",
			assistantMessageEvent: { type: "text_delta", delta: "First block", contentIndex: 0 },
		});
		batcher.push({
			type: "message_update",
			assistantMessageEvent: { type: "text_delta", delta: "Second block", contentIndex: 1 },
		});

		// Pushing index 1 immediately flushed index 0
		assert.equal(emitted.length, 1);
		assert.equal((emitted[0] as any).assistantMessageEvent.delta, "First block");

		batcher.flush();
		assert.equal(emitted.length, 2);
		assert.equal((emitted[1] as any).assistantMessageEvent.delta, "Second block");

		batcher.close();
	});
});
