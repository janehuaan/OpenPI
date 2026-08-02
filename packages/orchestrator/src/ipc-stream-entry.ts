#!/usr/bin/env node
import { createConnection } from "node:net";
import { getSocketPath } from "./config.ts";
import { encodeMessage } from "./ipc/protocol.ts";

const instanceId = process.argv[2];
if (!instanceId) {
	throw new Error("Usage: ipc-stream-entry <instance-id>");
}

const socket = createConnection(getSocketPath());
process.stdin.resume();
process.stdin.on("data", (chunk: Buffer | string) => {
	socket.write(chunk);
});
process.stdin.on("end", () => {
	socket.destroy();
	process.exit(0);
});
socket.on("data", (chunk: Buffer | string) => {
	process.stdout.write(chunk.toString());
});
socket.on("end", () => process.exit(0));
socket.on("error", (error) => {
	process.stdout.write(`${JSON.stringify({ type: "stream_error", error: error.message })}\n`);
	process.exit(1);
});
socket.on("connect", () => {
	socket.write(encodeMessage({ type: "rpc_stream", instanceId }));
});
