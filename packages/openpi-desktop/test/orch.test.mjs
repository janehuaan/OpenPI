import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sendIpcRequest } from "../electron/orch.mjs";

vi.mock("node:net", () => ({ createConnection: vi.fn() }));

import { createConnection } from "node:net";

const connectMock = vi.mocked(createConnection);

function fakeSocket() {
	const socket = new EventEmitter();
	socket.write = vi.fn();
	socket.destroy = vi.fn();
	return socket;
}

afterEach(() => {
	vi.clearAllMocks();
});

describe("sendIpcRequest", () => {
	it("writes a JSONL request and resolves the parsed response", async () => {
		const socket = fakeSocket();
		connectMock.mockReturnValue(socket);

		const promise = sendIpcRequest({ type: "list" }, 5_000);
		socket.emit("connect");
		socket.emit("data", Buffer.from('{"ok":true,"instances":[]}\n'));

		await expect(promise).resolves.toEqual({ ok: true, instances: [] });
		expect(socket.write).toHaveBeenCalledWith('{"type":"list"}\n');
	});

	it("handles multi-chunk payloads", async () => {
		const socket = fakeSocket();
		connectMock.mockReturnValue(socket);

		const promise = sendIpcRequest({ type: "list" }, 5_000);
		socket.emit("connect");
		socket.emit("data", Buffer.from('{"ok":true,'));
		socket.emit("data", Buffer.from('"done":1}\n'));
		await expect(promise).resolves.toEqual({ ok: true, done: 1 });
	});

	it("rejects on timeout", async () => {
		const socket = fakeSocket();
		connectMock.mockReturnValue(socket);

		const promise = sendIpcRequest({ type: "list" }, 50);
		socket.emit("connect");
		await expect(promise).rejects.toThrow(/timeout/i);
	});

	it("rejects on invalid JSON", async () => {
		const socket = fakeSocket();
		connectMock.mockReturnValue(socket);

		const promise = sendIpcRequest({ type: "list" }, 5_000);
		socket.emit("connect");
		socket.emit("data", Buffer.from("not-json\n"));
		await expect(promise).rejects.toThrow(/JSON parse failed/);
	});

	it("rejects on undefined responses", async () => {
		const socket = fakeSocket();
		connectMock.mockReturnValue(socket);

		const promise = sendIpcRequest({ type: "list" }, 5_000);
		socket.emit("connect");
		socket.emit("data", Buffer.from("undefined\n"));
		await expect(promise).rejects.toThrow(/invalid response/);
	});

	it("rejects when the socket closes without a response", async () => {
		const socket = fakeSocket();
		connectMock.mockReturnValue(socket);

		const promise = sendIpcRequest({ type: "list" }, 5_000);
		socket.emit("connect");
		socket.emit("end");
		await expect(promise).rejects.toThrow(/closed before response/);
	});
});
