import assert from "node:assert/strict";
import test from "node:test";
import { decodeLines, encodeMessage, type ServerMessage } from "@openpi/shared";

test("encodeMessage produces a single JSON line", () => {
	const line = encodeMessage({ id: "1", type: "health" });
	assert.equal(line.endsWith("\n"), true);
	assert.deepEqual(JSON.parse(line), { id: "1", type: "health" });
});

test("decodeLines splits complete frames and carries the partial tail", () => {
	const first = decodeLines("", '{"id":"1","type":"health"}\n{"type":"event","sessionId":"s"');
	assert.equal(first.messages.length, 1);
	assert.equal(first.rest, '{"type":"event","sessionId":"s"');

	const second = decodeLines(first.rest, ',"event":{"type":"turn_start"}}\n');
	assert.equal(second.messages.length, 1);
	assert.deepEqual(second.rest, "");
});

test("decodeLines tolerates a chunk that coalesces several frames", () => {
	const chunks = [
		'{"id":"1","type":"health"}\n',
		'{"id":"2","type":"health"}\n{"id":"3","type":"health"}\n',
	];
	let buffer = "";
	const messages: unknown[] = [];
	for (const chunk of chunks) {
		const decoded = decodeLines(buffer, chunk);
		messages.push(...decoded.messages);
		buffer = decoded.rest;
	}
	assert.equal(messages.length, 3);
	assert.equal(buffer, "");
});

test("decodeLines ignores empty lines", () => {
	const decoded = decodeLines("", '\n\n{"id":"1","type":"health"}\n\n');
	assert.equal(decoded.messages.length, 1);
});

test("encode/decode round-trips an event", () => {
	const event = { type: "event", sessionId: "s1", event: { type: "turn_start" } } satisfies ServerMessage;
	const line = encodeMessage(event);
	const decoded = decodeLines("", line);
	assert.deepEqual(decoded.messages[0], event);
});

test("decodeLines skips an unparseable line and keeps the valid frames beside it", () => {
	// Line framing means one bad line should cost only that line. Throwing here
	// would lose every valid frame that arrived in the same chunk.
	const decoded = decodeLines("", '{"id":"1","type":"health"}\ngarbage\n{"id":"2","type":"health"}\n');
	assert.equal(decoded.messages.length, 2);
	assert.equal(decoded.errors.length, 1);
	assert.equal(decoded.rest, "");
});

test("decodeLines reports no errors for clean input", () => {
	assert.deepEqual(decodeLines("", '{"id":"1","type":"health"}\n').errors, []);
});

test("decodeLines does not treat a partial trailing line as an error", () => {
	const decoded = decodeLines("", '{"id":"1","type":"health"}\n{"id":"2"');
	assert.equal(decoded.messages.length, 1);
	assert.deepEqual(decoded.errors, []);
	assert.equal(decoded.rest, '{"id":"2"');
});
