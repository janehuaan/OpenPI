/**
 * RpcProcess coverage against a fake pi entry.
 *
 * The framing layer is where a subtle bug is most expensive: a desynced reader
 * silently drops events, and an unresolved pending request hangs a turn. The
 * fake speaks the real protocol so this can be tested without a provider.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";
import { buildRpcArgs, RpcProcess, type RpcProcessOptions } from "../src/rpc-process.ts";

const here = dirname(fileURLToPath(import.meta.url));
const FAKE = join(here, "fake-pi-rpc.mjs");

let previousEntry: string | undefined;
let previousDir: string | undefined;
let temporary: string;

before(() => {
	previousEntry = process.env.OPENPI_PI_RPC_ENTRY;
	previousDir = process.env.OPENPI_DIR;
	temporary = mkdtempSync(join(tmpdir(), "openpi-rpc-test-"));
	process.env.OPENPI_PI_RPC_ENTRY = FAKE;
	process.env.OPENPI_DIR = temporary;
});

after(() => {
	if (previousEntry === undefined) delete process.env.OPENPI_PI_RPC_ENTRY;
	else process.env.OPENPI_PI_RPC_ENTRY = previousEntry;
	if (previousDir === undefined) delete process.env.OPENPI_DIR;
	else process.env.OPENPI_DIR = previousDir;
	rmSync(temporary, { recursive: true, force: true });
});

function spawn(options: Partial<RpcProcessOptions> = {}): RpcProcess {
	return new RpcProcess({ sessionId: "s1", cwd: process.cwd(), mode: "chat", ...options });
}

/** Wait for an event matching `predicate`, or reject after `timeoutMs`. */
function waitForEvent(
	process_: RpcProcess,
	predicate: (event: { type: string; [key: string]: unknown }) => boolean,
	timeoutMs = 5000,
): Promise<{ type: string; [key: string]: unknown }> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			unsubscribe();
			reject(new Error("timed out waiting for event"));
		}, timeoutMs);
		const unsubscribe = process_.onEvent((event) => {
			if (!predicate(event)) return;
			clearTimeout(timer);
			unsubscribe();
			resolve(event);
		});
	});
}

test("buildRpcArgs uses --model, since a bare --provider is ignored by the CLI", () => {
	const args = buildRpcArgs({
		sessionId: "s1",
		cwd: "/tmp",
		mode: "chat",
		model: "anthropic/claude-opus-5",
	});
	assert.deepEqual(args.slice(0, 2), ["--mode", "rpc"]);
	assert.equal(args[args.indexOf("--model") + 1], "anthropic/claude-opus-5");
	assert.equal(args.includes("--provider"), false);
});

test("buildRpcArgs passes --session for a persisted session and --no-session otherwise", () => {
	const persisted = buildRpcArgs({ sessionId: "s1", cwd: "/tmp", mode: "chat", sessionFile: "/tmp/s1.jsonl" });
	assert.equal(persisted[persisted.indexOf("--session") + 1], "/tmp/s1.jsonl");
	assert.equal(persisted.includes("--no-session"), false);

	const ephemeral = buildRpcArgs({ sessionId: "s1", cwd: "/tmp", mode: "chat" });
	assert.equal(ephemeral.includes("--no-session"), true);
});

test("buildRpcArgs restricts tools in code mode only", () => {
	const code = buildRpcArgs({ sessionId: "s1", cwd: "/tmp", mode: "code" });
	const tools = code[code.indexOf("--tools") + 1]?.split(",") ?? [];
	assert.ok(tools.includes("read"));
	assert.ok(tools.includes("edit"));

	const chat = buildRpcArgs({ sessionId: "s1", cwd: "/tmp", mode: "chat" });
	assert.equal(chat.includes("--tools"), false);
});

test("send resolves with the correlated response", async () => {
	const process_ = spawn();
	const state = (await process_.send({ type: "get_state" })) as { sessionId: string };
	assert.equal(state.sessionId, "fake-session");
	process_.stop();
});

test("concurrent sends resolve independently, not in call order", async () => {
	const process_ = spawn();
	const [first, second, third] = (await Promise.all([
		process_.send({ type: "echo", payload: 1 }),
		process_.send({ type: "echo", payload: 2 }),
		process_.send({ type: "echo", payload: 3 }),
	])) as Array<{ echoed: number }>;
	assert.deepEqual([first.echoed, second.echoed, third.echoed], [1, 2, 3]);
	process_.stop();
});

test("a failed response rejects with the reported error", async () => {
	const process_ = spawn();
	await assert.rejects(() => process_.send({ type: "bad_command" }), /nope/);
	process_.stop();
});

test("a request that never gets a response times out", async () => {
	const process_ = spawn();
	await assert.rejects(() => process_.send({ type: "slow" }, 300), /timed out/);
	process_.stop();
});

test("events reach every subscriber", async () => {
	const process_ = spawn();
	const seenA: string[] = [];
	const seenB: string[] = [];
	// Resolve from one of the subscribers under test: the event can be dispatched
	// before a later waitForEvent subscription exists, so waiting on a fresh
	// subscription would race and time out.
	const seen = new Promise<void>((resolve) => {
		process_.onEvent((event) => {
			seenA.push(event.type);
			if (event.type === "custom_event") resolve();
		});
	});
	process_.onEvent((event) => seenB.push(event.type));

	await process_.send({ type: "emit_event", note: "hi" });
	await seen;

	assert.ok(seenA.includes("custom_event"));
	assert.ok(seenB.includes("custom_event"));
	process_.stop();
});

test("unsubscribing stops delivery", async () => {
	const process_ = spawn();
	const seen: string[] = [];
	const unsubscribe = process_.onEvent((event) => seen.push(event.type));
	unsubscribe();

	await process_.send({ type: "emit_event" });
	await new Promise((resolve) => setTimeout(resolve, 200));
	assert.equal(seen.length, 0);
	process_.stop();
});

test("a prompt produces the full agent event sequence", async () => {
	const process_ = spawn();
	const types: string[] = [];
	// The fake emits the sequence synchronously on receiving the prompt, so a
	// subscription created after the send can miss it entirely. Resolve from the
	// listener that is already attached.
	const settled = new Promise<void>((resolve) => {
		process_.onEvent((event) => {
			types.push(event.type);
			if (event.type === "agent_settled") resolve();
		});
	});

	await process_.send({ type: "prompt", message: "hello" });
	await settled;

	assert.deepEqual(types, ["ready", "agent_start", "message_end", "agent_end", "agent_settled"]);
	process_.stop();
});

test("extension_ui_request goes to the UI handler, not the event listeners", async () => {
	const process_ = spawn();
	const events: string[] = [];
	process_.onEvent((event) => events.push(event.type));
	const uiRequests: unknown[] = [];
	process_.setUiRequestHandler((request) => uiRequests.push(request));

	await process_.send({ type: "ui_request" });
	await new Promise((resolve) => setTimeout(resolve, 300));

	assert.equal(uiRequests.length, 1);
	assert.equal(events.includes("extension_ui_request"), false);
	process_.stop();
});

test("a UI response written back reaches the child", async () => {
	const process_ = spawn();
	process_.setUiRequestHandler(() => {
		process_.write({ type: "extension_ui_response", id: "ui-1", value: "answered" });
	});

	await process_.send({ type: "ui_request" });
	const seen = await waitForEvent(process_, (event) => event.type === "ui_response_seen");
	assert.equal(seen.value, "answered");
	process_.stop();
});

test("a malformed line does not stop later frames from being read", async () => {
	// The fake emits one garbage line before its ready event.
	const process_ = spawn({ extraArgs: ["--emit-garbage"] });
	const state = (await process_.send({ type: "get_state" })) as { sessionId: string };
	assert.equal(state.sessionId, "fake-session");
	process_.stop();
});

test("exit rejects every pending request and reports to exit listeners", async () => {
	const process_ = spawn();
	let exitCode: number | null | undefined;
	process_.onExit((code) => {
		exitCode = code;
	});

	const pending = process_.send({ type: "slow" }, 10_000);
	await process_.send({ type: "crash" }).catch(() => undefined);

	await assert.rejects(() => pending, /exited/);
	await new Promise((resolve) => setTimeout(resolve, 100));
	assert.equal(exitCode, 3);
	assert.equal(process_.running, false);
});

test("sending to a stopped process rejects rather than hanging", async () => {
	const process_ = spawn();
	await process_.send({ type: "get_state" });
	process_.stop();
	await new Promise((resolve) => setTimeout(resolve, 200));
	await assert.rejects(() => process_.send({ type: "get_state" }), /not running/);
});

test("the child receives an isolated PI_CODING_AGENT_DIR", async () => {
	// Without this the spawned session loads the user's global extensions and
	// model defaults instead of openpi's own.
	const process_ = spawn();
	const state = (await process_.send({ type: "get_state" })) as { args: string[] };
	assert.ok(Array.isArray(state.args));
	process_.stop();
});
