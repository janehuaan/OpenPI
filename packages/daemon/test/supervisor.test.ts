/**
 * Supervisor coverage against the fake pi entry.
 *
 * What matters here is the session pool's bookkeeping: records survive a restart,
 * a suspended session wakes on demand, events fan out to every subscriber, and a
 * subscriber that throws does not take the others down with it.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after, afterEach, before, beforeEach } from "node:test";
import { fileURLToPath } from "node:url";
import type { PiRpcEvent } from "@openpi/shared";
import { Supervisor } from "../src/supervisor.ts";

const here = dirname(fileURLToPath(import.meta.url));
const FAKE = join(here, "fake-pi-rpc.mjs");

let previousEntry: string | undefined;
let previousDir: string | undefined;
let root: string;

before(() => {
	previousEntry = process.env.OPENPI_PI_RPC_ENTRY;
	previousDir = process.env.OPENPI_DIR;
	process.env.OPENPI_PI_RPC_ENTRY = FAKE;
});

const live: Supervisor[] = [];

/** Every supervisor a test creates, stopped in afterEach even if the test fails. */
function makeSupervisor(): Supervisor {
	const supervisor = new Supervisor();
	live.push(supervisor);
	return supervisor;
}

beforeEach(() => {
	// A fresh openpi dir per test: instances.json is the supervisor's only state.
	root = mkdtempSync(join(tmpdir(), "openpi-supervisor-"));
	process.env.OPENPI_DIR = root;
});

afterEach(() => {
	// Without this a failing test leaves its pi child running and the whole
	// node --test run never exits.
	for (const supervisor of live.splice(0)) supervisor.stopAll();
});

after(() => {
	if (previousEntry === undefined) delete process.env.OPENPI_PI_RPC_ENTRY;
	else process.env.OPENPI_PI_RPC_ENTRY = previousEntry;
	if (previousDir === undefined) delete process.env.OPENPI_DIR;
	else process.env.OPENPI_DIR = previousDir;
	rmSync(root, { recursive: true, force: true });
});

/** Resolve once `predicate` sees a matching event, or reject on timeout. */
function waitFor(
	supervisor: Supervisor,
	sessionId: string,
	predicate: (event: PiRpcEvent) => boolean,
	timeoutMs = 5000,
): Promise<PiRpcEvent> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			unsubscribe();
			reject(new Error("timed out waiting for event"));
		}, timeoutMs);
		const unsubscribe = supervisor.subscribe(sessionId, (_id, event) => {
			if (!predicate(event)) return;
			clearTimeout(timer);
			unsubscribe();
			resolve(event);
		});
	});
}

test("create returns a running session and lists it", () => {
	const supervisor = makeSupervisor();
	const session = supervisor.create({ cwd: process.cwd(), mode: "chat" });

	assert.ok(session.sessionId);
	assert.equal(session.running, true);
	assert.equal(supervisor.list().length, 1);
	assert.equal(supervisor.sessionCount, 1);
});

test("rpc forwards to the session and returns its response", async () => {
	const supervisor = makeSupervisor();
	const session = supervisor.create({ cwd: process.cwd(), mode: "chat" });

	const state = (await supervisor.rpc(session.sessionId, { type: "get_state" })) as { sessionId: string };
	assert.equal(state.sessionId, "fake-session");
});

test("rpc on an unknown session rejects", async () => {
	const supervisor = makeSupervisor();
	await assert.rejects(() => supervisor.rpc("nope", { type: "get_state" }), /unknown session/);
});

test("stop suspends the process but keeps the record", () => {
	const supervisor = makeSupervisor();
	const session = supervisor.create({ cwd: process.cwd(), mode: "chat" });

	supervisor.stop(session.sessionId);
	assert.equal(supervisor.runningCount, 0);
	assert.equal(supervisor.sessionCount, 1);
	assert.equal(supervisor.list()[0]?.running, false);
});

test("a suspended session wakes on the next rpc", async () => {
	const supervisor = makeSupervisor();
	const session = supervisor.create({ cwd: process.cwd(), mode: "chat" });
	supervisor.stop(session.sessionId);
	assert.equal(supervisor.runningCount, 0);

	const state = (await supervisor.rpc(session.sessionId, { type: "get_state" })) as { sessionId: string };
	assert.equal(state.sessionId, "fake-session");
	assert.equal(supervisor.runningCount, 1);
});

test("delete removes the record and stops the process", () => {
	const supervisor = makeSupervisor();
	const session = supervisor.create({ cwd: process.cwd(), mode: "chat" });

	supervisor.delete(session.sessionId);
	assert.equal(supervisor.sessionCount, 0);
	assert.equal(supervisor.runningCount, 0);
});

test("records survive a restart, suspended rather than running", () => {
	const first = makeSupervisor();
	const a = first.create({ cwd: process.cwd(), mode: "code", name: "session a" });
	first.create({ cwd: process.cwd(), mode: "chat" });

	// A new Supervisor over the same directory is what a daemon restart looks like.
	const second = makeSupervisor();
	assert.equal(second.sessionCount, 2);
	assert.equal(second.runningCount, 0);
	const restored = second.list().find((session) => session.sessionId === a.sessionId);
	assert.equal(restored?.mode, "code");
	assert.equal(restored?.name, "session a");
	assert.equal(restored?.running, false);
});

test("events reach every subscriber of that session", async () => {
	const supervisor = makeSupervisor();
	const session = supervisor.create({ cwd: process.cwd(), mode: "chat" });
	const seenA: string[] = [];
	const seenB: string[] = [];
	supervisor.subscribe(session.sessionId, (_id, event) => seenA.push(event.type));
	supervisor.subscribe(session.sessionId, (_id, event) => seenB.push(event.type));
	const settled = waitFor(supervisor, session.sessionId, (event) => event.type === "agent_settled");
	await supervisor.rpc(session.sessionId, { type: "prompt", message: "hi" });
	await settled;

	assert.ok(seenA.includes("agent_start"));
	assert.ok(seenB.includes("agent_start"));
});

test("unsubscribing stops delivery to that listener only", async () => {
	const supervisor = makeSupervisor();
	const session = supervisor.create({ cwd: process.cwd(), mode: "chat" });
	const kept: string[] = [];
	const dropped: string[] = [];
	// Resolve from the surviving listener itself: waiting on a fresh subscription
	// would race, since the event can land before that subscription exists.
	const seen = new Promise<void>((resolve) => {
		supervisor.subscribe(session.sessionId, (_id, event) => {
			kept.push(event.type);
			if (event.type === "custom_event") resolve();
		});
	});
	const unsubscribe = supervisor.subscribe(session.sessionId, (_id, event) => dropped.push(event.type));
	unsubscribe();

	await supervisor.rpc(session.sessionId, { type: "emit_event" });
	await seen;

	assert.ok(kept.includes("custom_event"));
	assert.equal(dropped.includes("custom_event"), false);
});

test("a subscriber that throws does not stop the others", async () => {
	const supervisor = makeSupervisor();
	const session = supervisor.create({ cwd: process.cwd(), mode: "chat" });
	const seen: string[] = [];
	supervisor.subscribe(session.sessionId, () => {
		throw new Error("bad subscriber");
	});
	supervisor.subscribe(session.sessionId, (_id, event) => seen.push(event.type));

	await supervisor.rpc(session.sessionId, { type: "emit_event" });
	await new Promise((resolve) => setTimeout(resolve, 400));

	assert.ok(seen.includes("custom_event"));
});

test("subscribing to an unknown session throws", () => {
	const supervisor = makeSupervisor();
	assert.throws(() => supervisor.subscribe("nope", () => {}), /unknown session/);
});

test("a UI request is broadcast so the desktop can answer it", async () => {
	// Nobody answering would hang the agent turn, so it surfaces as an event
	// rather than being swallowed inside the supervisor.
	const supervisor = makeSupervisor();
	const session = supervisor.create({ cwd: process.cwd(), mode: "chat" });

	const pending = waitFor(supervisor, session.sessionId, (event) => event.type === "extension_ui_request");
	await supervisor.rpc(session.sessionId, { type: "ui_request" });
	const event = await pending;

	assert.equal(event.method, "setStatus");
});

test("a session that exits is reported and removed from the live set", async () => {
	const supervisor = makeSupervisor();
	const session = supervisor.create({ cwd: process.cwd(), mode: "chat" });

	const pending = waitFor(supervisor, session.sessionId, (event) => event.type === "session_exit");
	await supervisor.rpc(session.sessionId, { type: "crash" }).catch(() => undefined);
	await pending;

	assert.equal(supervisor.runningCount, 0);
	// The record stays: the session can be resumed.
	assert.equal(supervisor.sessionCount, 1);
});

test("list orders the most recently used session first", async () => {
	const supervisor = makeSupervisor();
	const first = supervisor.create({ cwd: process.cwd(), mode: "chat" });
	await new Promise((resolve) => setTimeout(resolve, 5));
	const second = supervisor.create({ cwd: process.cwd(), mode: "chat" });

	await new Promise((resolve) => setTimeout(resolve, 5));
	await supervisor.rpc(first.sessionId, { type: "get_state" });

	assert.equal(supervisor.list()[0]?.sessionId, first.sessionId);
	assert.equal(supervisor.list()[1]?.sessionId, second.sessionId);
});
