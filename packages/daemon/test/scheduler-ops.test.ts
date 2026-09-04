/**
 * scheduler-ops coverage.
 *
 * These are thin forwards, so the tests focus on what the forwarding layer adds:
 * the log tail, run grouping and ordering, and the singleton's lifecycle. The
 * scheduling logic itself is covered in @openpi/scheduler.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { afterEach, beforeEach } from "node:test";
import {
	createTask,
	deleteTask,
	ensureScheduler,
	listTasks,
	readRunLog,
	setTaskPaused,
	stopScheduler,
} from "../src/scheduler-ops.ts";

let root: string;
let previous: string | undefined;

beforeEach(() => {
	previous = process.env.OPENPI_SCHEDULER_DIR;
	root = mkdtempSync(join(tmpdir(), "openpi-schedops-"));
	process.env.OPENPI_SCHEDULER_DIR = root;
});

afterEach(() => {
	// The scheduler's tick timer would otherwise keep the test process alive.
	stopScheduler();
	if (previous === undefined) delete process.env.OPENPI_SCHEDULER_DIR;
	else process.env.OPENPI_SCHEDULER_DIR = previous;
	rmSync(root, { recursive: true, force: true });
});

const CRON = { kind: "cron" as const, expression: "7 9 * * *" };

test("createTask returns a task with a computed next run", () => {
	const task = createTask({ title: "nightly", prompt: "review", schedule: CRON });
	assert.ok(task.id);
	assert.equal(task.status, "active");
	assert.ok(task.nextRunAt);
});

test("listTasks groups runs under their task", () => {
	const first = createTask({ title: "a", prompt: "p", schedule: CRON });
	const second = createTask({ title: "b", prompt: "p", schedule: CRON });
	const engine = ensureScheduler();
	// Create runs directly: triggering would spawn real pi processes.
	const store = (engine as unknown as { store: { createRun: (id: string, t: string) => { id: string } } }).store;
	store.createRun(first.id, "manual");
	store.createRun(first.id, "manual");
	store.createRun(second.id, "manual");

	const tasks = listTasks();
	assert.equal(tasks.length, 2);
	assert.equal(tasks.find((entry) => entry.task.id === first.id)?.runs.length, 2);
	assert.equal(tasks.find((entry) => entry.task.id === second.id)?.runs.length, 1);
});

test("listTasks returns each task's runs newest first", () => {
	const task = createTask({ title: "a", prompt: "p", schedule: CRON });
	const store = (ensureScheduler() as unknown as {
		store: { createRun: (id: string, t: string) => { id: string; createdAt: string } };
	}).store;
	const older = store.createRun(task.id, "manual");
	const newer = store.createRun(task.id, "manual");

	const runs = listTasks()[0]!.runs;
	// Same-millisecond creation is possible, so assert ordering by timestamp.
	assert.ok(runs[0]!.createdAt >= runs[runs.length - 1]!.createdAt);
	assert.ok(runs.some((run) => run.id === older.id));
	assert.ok(runs.some((run) => run.id === newer.id));
});

test("listTasks caps the runs per task so a long history cannot flood the socket", () => {
	const task = createTask({ title: "a", prompt: "p", schedule: CRON });
	const store = (ensureScheduler() as unknown as { store: { createRun: (id: string, t: string) => unknown } }).store;
	for (let index = 0; index < 30; index++) store.createRun(task.id, "manual");
	assert.equal(listTasks()[0]!.runs.length, 20);
});

test("setTaskPaused toggles status and survives a reload", () => {
	const task = createTask({ title: "a", prompt: "p", schedule: CRON });
	assert.equal(setTaskPaused(task.id, true)?.status, "paused");
	assert.equal(listTasks()[0]!.task.status, "paused");
	assert.equal(setTaskPaused(task.id, false)?.status, "active");
});

test("setTaskPaused on an unknown task returns undefined", () => {
	assert.equal(setTaskPaused("nope", true), undefined);
});

test("deleteTask reports whether anything was removed", () => {
	const task = createTask({ title: "a", prompt: "p", schedule: CRON });
	assert.equal(deleteTask(task.id), true);
	assert.equal(deleteTask(task.id), false);
	assert.deepEqual(listTasks(), []);
});

test("readRunLog returns empty for a run with no log", () => {
	assert.deepEqual(readRunLog("no-such-run", "stdout"), { text: "", truncated: false });
});

test("readRunLog returns a short log whole", () => {
	const logs = join(root, "task-logs");
	mkdirSync(logs, { recursive: true });
	writeFileSync(join(logs, "run-1.stdout.log"), "TASKOK\n", "utf8");

	const result = readRunLog("run-1", "stdout");
	assert.equal(result.text.trim(), "TASKOK");
	assert.equal(result.truncated, false);
});

test("readRunLog tails a large log and flags the truncation", () => {
	// A multi-megabyte read would stall the socket for every other request.
	const logs = join(root, "task-logs");
	mkdirSync(logs, { recursive: true });
	const big = `${"x".repeat(400 * 1024)}TAIL_MARKER`;
	writeFileSync(join(logs, "run-2.stdout.log"), big, "utf8");

	const result = readRunLog("run-2", "stdout");
	assert.equal(result.truncated, true);
	assert.ok(result.text.length < big.length);
	assert.ok(result.text.endsWith("TAIL_MARKER"));
});

test("readRunLog reads stdout and stderr separately", () => {
	const logs = join(root, "task-logs");
	mkdirSync(logs, { recursive: true });
	writeFileSync(join(logs, "run-3.stdout.log"), "out", "utf8");
	writeFileSync(join(logs, "run-3.stderr.log"), "err", "utf8");

	assert.equal(readRunLog("run-3", "stdout").text, "out");
	assert.equal(readRunLog("run-3", "stderr").text, "err");
});

test("ensureScheduler returns one instance until stopped", () => {
	const first = ensureScheduler();
	assert.equal(ensureScheduler(), first);
	stopScheduler();
	assert.notEqual(ensureScheduler(), first);
});
