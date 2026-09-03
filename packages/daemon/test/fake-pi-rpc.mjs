#!/usr/bin/env node
/**
 * Fake `pi --mode rpc` for daemon tests.
 *
 * Speaks the same JSONL protocol as the real entry - responses correlated by id,
 * events with none - so the supervisor, framing, and event fan-out can be tested
 * without a provider or an API key.
 *
 * Recognized commands:
 *   get_state          -> a minimal state object
 *   prompt             -> acks, then emits agent_start / message_end / agent_end
 *   echo               -> returns whatever it was sent
 *   emit_event         -> pushes one unsolicited event
 *   ui_request         -> pushes an extension_ui_request and waits for the reply
 *   slow               -> never responds, for timeout tests
 *   crash              -> exits non-zero
 */

import { argv, exit, stdin, stdout } from "node:process";

const args = argv.slice(2);
const sessionArg = args.indexOf("--session");
const sessionFile = sessionArg >= 0 ? args[sessionArg + 1] : undefined;

function send(message) {
	stdout.write(`${JSON.stringify(message)}\n`);
}

function respond(id, command, data) {
	send({ id, type: "response", command, success: true, data });
}

let buffer = "";
stdin.setEncoding("utf8");
stdin.on("data", (chunk) => {
	buffer += chunk;
	const lines = buffer.split("\n");
	buffer = lines.pop() ?? "";
	for (const line of lines) {
		if (!line.trim()) continue;
		let command;
		try {
			command = JSON.parse(line);
		} catch {
			continue;
		}
		handle(command);
	}
});

function handle(command) {
	switch (command.type) {
		case "get_state":
			respond(command.id, command.type, {
				sessionId: "fake-session",
				model: { id: "fake-model" },
				messageCount: 0,
				args,
				sessionFile,
			});
			return;

		case "echo":
			respond(command.id, command.type, { echoed: command.payload ?? null });
			return;

		case "prompt":
			respond(command.id, command.type, null);
			send({ type: "agent_start" });
			send({
				type: "message_end",
				message: { role: "assistant", content: [{ type: "text", text: `echo: ${command.message}` }] },
			});
			send({ type: "agent_end" });
			send({ type: "agent_settled" });
			return;

		case "emit_event":
			respond(command.id, command.type, null);
			send({ type: "custom_event", note: command.note ?? "hello" });
			return;

		case "ui_request":
			respond(command.id, command.type, null);
			send({ type: "extension_ui_request", id: "ui-1", method: "setStatus", statusText: "working" });
			return;

		case "extension_ui_response":
			// Prove the reply reached us by re-emitting it as an event.
			send({ type: "ui_response_seen", value: command.value });
			return;

		case "slow":
			// Deliberately no response.
			return;

		case "crash":
			exit(3);
			return;

		case "bad_command":
			send({ id: command.id, type: "response", command: command.type, success: false, error: "nope" });
			return;

		default:
			respond(command.id, command.type, { unknown: true });
	}
}

// Emit one line of malformed JSON to prove a torn frame does not desync the reader.
if (args.includes("--emit-garbage")) {
	stdout.write("this is not json\n");
}

send({ type: "ready" });
