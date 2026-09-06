import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after, afterEach, before, beforeEach } from "node:test";
import { fileURLToPath } from "node:url";
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

const liveSupervisors: Supervisor[] = [];

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "openpi-warm-supervisor-"));
	process.env.OPENPI_DIR = root;
});

afterEach(() => {
	for (const supervisor of liveSupervisors.splice(0)) {
		supervisor.stopAll();
	}
});

after(() => {
	if (previousEntry === undefined) delete process.env.OPENPI_PI_RPC_ENTRY;
	else process.env.OPENPI_PI_RPC_ENTRY = previousEntry;
	if (previousDir === undefined) delete process.env.OPENPI_DIR;
	else process.env.OPENPI_DIR = previousDir;
	rmSync(root, { recursive: true, force: true });
});

test("supervisor warm pool pre-spawns and accelerates session creation", async () => {
	const cwd = process.cwd();
	const supervisor = new Supervisor({ enableWarmPool: true });
	liveSupervisors.push(supervisor);

	// Synchronously trigger warm refill
	supervisor.refillWarmProcess(cwd, "chat");
	assert.equal(supervisor.isWarmReady(cwd), true);

	// Creating a matching session claims the warm process
	const session = supervisor.create({ cwd, mode: "chat", eager: true });
	assert.ok(session.sessionId);
	assert.equal(session.running, true);

	// The warm process was claimed, so warm pool is now unassigned until refilled
	assert.equal(supervisor.isWarmReady(cwd), false);

	// Session is alive and can answer RPC commands
	const state = (await supervisor.rpc(session.sessionId, { type: "get_state" })) as { sessionId: string };
	assert.equal(state.sessionId, "fake-session");
});
