import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after, afterEach, before, beforeEach } from "node:test";
import { fileURLToPath } from "node:url";
import { Supervisor, type SupervisorOptions } from "../src/supervisor.ts";

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

function makeSupervisor(options?: SupervisorOptions): Supervisor {
	const supervisor = new Supervisor(options);
	live.push(supervisor);
	return supervisor;
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "openpi-pool-"));
	process.env.OPENPI_DIR = root;
});

afterEach(() => {
	for (const supervisor of live.splice(0)) supervisor.stopAll();
});

after(() => {
	if (previousEntry === undefined) delete process.env.OPENPI_PI_RPC_ENTRY;
	else process.env.OPENPI_PI_RPC_ENTRY = previousEntry;
	if (previousDir === undefined) delete process.env.OPENPI_DIR;
	else process.env.OPENPI_DIR = previousDir;
	rmSync(root, { recursive: true, force: true });
});

test("LRU eviction caps live processes to maxLiveProcesses", async () => {
	const supervisor = makeSupervisor({ maxLiveProcesses: 2 });
	const s1 = supervisor.create({ cwd: process.cwd(), mode: "chat" });
	assert.equal(supervisor.runningCount, 1);

	const s2 = supervisor.create({ cwd: process.cwd(), mode: "chat" });
	assert.equal(supervisor.runningCount, 2);

	// Creating s3 should evict s1 (oldest idle process)
	const s3 = supervisor.create({ cwd: process.cwd(), mode: "chat" });
	assert.equal(supervisor.runningCount, 2);

	const list = supervisor.list();
	const s1Info = list.find((s) => s.sessionId === s1.sessionId);
	const s2Info = list.find((s) => s.sessionId === s2.sessionId);
	const s3Info = list.find((s) => s.sessionId === s3.sessionId);

	assert.equal(s1Info?.running, false, "s1 should be evicted/suspended");
	assert.equal(s2Info?.running, true, "s2 should remain running");
	assert.equal(s3Info?.running, true, "s3 should be running");

	// Interacting with s1 should wake it back up and evict s2 (oldest idle)
	await supervisor.rpc(s1.sessionId, { type: "get_state" });
	assert.equal(supervisor.runningCount, 2);

	const listAfter = supervisor.list();
	assert.equal(listAfter.find((s) => s.sessionId === s1.sessionId)?.running, true);
	assert.equal(listAfter.find((s) => s.sessionId === s2.sessionId)?.running, false);
	assert.equal(listAfter.find((s) => s.sessionId === s3.sessionId)?.running, true);
});

test("working sessions are protected from LRU eviction", async () => {
	const supervisor = makeSupervisor({ maxLiveProcesses: 2 });
	const s1 = supervisor.create({ cwd: process.cwd(), mode: "chat" });
	const s2 = supervisor.create({ cwd: process.cwd(), mode: "chat" });

	// Simulate s1 is actively working
	// @ts-expect-error accessing private field for precise test control
	supervisor.working.add(s1.sessionId);
	assert.equal(supervisor.isWorking(s1.sessionId), true);

	// Now create s3: since s1 is working, s2 MUST be evicted instead of s1
	const s3 = supervisor.create({ cwd: process.cwd(), mode: "chat" });
	assert.equal(supervisor.runningCount, 2);

	const list = supervisor.list();
	assert.equal(list.find((s) => s.sessionId === s1.sessionId)?.running, true, "working s1 must stay running");
	assert.equal(list.find((s) => s.sessionId === s2.sessionId)?.running, false, "idle s2 must be evicted");
	assert.equal(list.find((s) => s.sessionId === s3.sessionId)?.running, true, "s3 must be running");
});

test("idle reaper suspends inactive sessions after timeout", async () => {
	const supervisor = makeSupervisor({ idleTimeoutMs: 20 });
	const s1 = supervisor.create({ cwd: process.cwd(), mode: "chat" });
	assert.equal(supervisor.runningCount, 1);

	// Wait past idle timeout reliably on all environments based on actual lastActive
	while (Date.now() - (supervisor.getLastActive(s1.sessionId) ?? 0) < 30) {
		await new Promise((resolve) => setTimeout(resolve, 10));
	}

	const reaped = supervisor.reapIdleProcesses();
	assert.equal(reaped, 1, "should reap 1 idle session");
	assert.equal(supervisor.runningCount, 0);

	// Session file and record survive
	assert.equal(supervisor.sessionCount, 1);
	assert.equal(supervisor.list()[0]?.running, false);

	// Wakes smoothly on RPC
	await supervisor.rpc(s1.sessionId, { type: "get_state" });
	assert.equal(supervisor.runningCount, 1);
});

test("create with eager: false creates record without spawning process", async () => {
	const supervisor = makeSupervisor();
	const s1 = supervisor.create({ cwd: process.cwd(), mode: "chat", eager: false });

	assert.equal(s1.running, false);
	assert.equal(supervisor.runningCount, 0);
	assert.equal(supervisor.sessionCount, 1);

	// Wakes on first RPC
	const state = (await supervisor.rpc(s1.sessionId, { type: "get_state" })) as { sessionId: string };
	assert.equal(state.sessionId, "fake-session");
	assert.equal(supervisor.runningCount, 1);
});
