import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TaskStore } from "../src/task-store.ts";

const tempDirs: string[] = [];
let previous: string | undefined;

beforeEach(() => {
	previous = process.env.PI_ORCHESTRATOR_DIR;
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-store-"));
	tempDirs.push(dir);
	process.env.PI_ORCHESTRATOR_DIR = dir;
});

afterEach(() => {
	if (previous === undefined) delete process.env.PI_ORCHESTRATOR_DIR;
	else process.env.PI_ORCHESTRATOR_DIR = previous;
	for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("TaskStore", () => {
	it("persists tasks with security and sandbox fields", () => {
		const store = new TaskStore();
		const task = store.createTask(
			{
				title: "Review",
				prompt: "Review repo",
				schedule: { kind: "once", runAt: "2026-08-01T09:00:00.000Z" },
				securityMode: "strict",
				sandbox: "none",
				tools: ["read", "ls"],
				extensions: ["/tmp/security.ts"],
			},
			"2026-08-01T09:00:00.000Z",
		);
		expect(task.securityMode).toBe("strict");
		const loaded = store.getTask(task.id);
		expect(loaded?.tools).toEqual(["read", "ls"]);
		expect(loaded?.extensions).toEqual(["/tmp/security.ts"]);
		const run = store.createRun(task.id, "manual", { attempt: 1 });
		expect(run.status).toBe("queued");
		expect(store.loadRuns()).toHaveLength(1);
		const interrupted = store.markInterruptedRuns();
		expect(interrupted).toHaveLength(1);
		expect(store.loadRuns().find((entry) => entry.id === run.id)?.status).toBe("interrupted");
	});
});
