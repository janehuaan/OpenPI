/**
 * buildArgs coverage: the exact CLI invocation an unattended run produces.
 *
 * The old file here asserted only that TaskDefinition accepted a couple of
 * fields - it never called the arg builder, so it could not have caught the
 * removal of `--security-gate-mode` in upstream 0.84.4. These tests call it.
 */

import { describe, expect, it } from "vitest";
import { buildArgs } from "../src/task-executor.ts";
import type { TaskDefinition, TaskRun } from "../src/types.ts";

function makeTask(overrides: Partial<TaskDefinition> = {}): TaskDefinition {
	return {
		id: "t1",
		title: "nightly review",
		prompt: "review the repo",
		schedule: { kind: "cron", expression: "7 9 * * *" },
		status: "active",
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		...overrides,
	};
}

const run: TaskRun = {
	id: "run-1",
	taskId: "t1",
	status: "queued",
	trigger: "scheduled",
	createdAt: "2026-01-01T00:00:00.000Z",
	attempt: 1,
};

/** Index of a flag's value, or undefined when the flag is absent. */
function flagValue(args: string[], flag: string): string | undefined {
	const index = args.indexOf(flag);
	return index >= 0 ? args[index + 1] : undefined;
}

describe("buildArgs", () => {
	it("resolves the pinned pi CLI as the first argument", () => {
		const args = buildArgs(makeTask(), run, "/tmp/sessions");
		expect(args[0]).toContain("@earendil-works/pi-coding-agent");
		expect(args[0]).toMatch(/cli\.js$/);
	});

	it("runs non-interactively with the task's prompt last", () => {
		const args = buildArgs(makeTask(), run, "/tmp/sessions");
		expect(args.at(-2)).toBe("--print");
		expect(args.at(-1)).toBe("review the repo");
	});

	it("pins the session id to the run id so logs and sessions correlate", () => {
		const args = buildArgs(makeTask(), run, "/tmp/sessions");
		expect(flagValue(args, "--session-id")).toBe("run-1");
		expect(flagValue(args, "--session-dir")).toBe("/tmp/sessions");
	});

	it("defaults to a read-mostly tool set for unattended runs", () => {
		// An unattended run has nobody to confirm a destructive action, so edit and
		// write are deliberately absent from the default.
		const tools = flagValue(buildArgs(makeTask(), run, "/tmp/s"), "--tools")?.split(",") ?? [];
		expect(tools).toContain("read");
		expect(tools).toContain("ls");
		expect(tools).not.toContain("edit");
		expect(tools).not.toContain("write");
	});

	it("lets a task override the tool list", () => {
		const args = buildArgs(makeTask({ tools: ["read", "grep"] }), run, "/tmp/s");
		expect(flagValue(args, "--tools")).toBe("read,grep");
	});

	it("passes provider, model and excluded tools when set", () => {
		const args = buildArgs(
			makeTask({ provider: "anthropic", model: "anthropic/claude-opus-5", excludeTools: ["bash"] }),
			run,
			"/tmp/s",
		);
		expect(flagValue(args, "--provider")).toBe("anthropic");
		expect(flagValue(args, "--model")).toBe("anthropic/claude-opus-5");
		expect(flagValue(args, "--exclude-tools")).toBe("bash");
	});

	it("omits provider and model flags when unset", () => {
		const args = buildArgs(makeTask(), run, "/tmp/s");
		expect(args).not.toContain("--provider");
		expect(args).not.toContain("--model");
	});

	it("passes one --extension flag per extension", () => {
		const args = buildArgs(makeTask({ extensions: ["/a.ts", "/b.ts"] }), run, "/tmp/s");
		expect(args.filter((arg) => arg === "--extension")).toHaveLength(2);
		expect(args).toContain("/a.ts");
		expect(args).toContain("/b.ts");
	});

	it("does not pass --security-gate-mode, which upstream 0.84.4 removed", () => {
		// securityMode stays on TaskDefinition for the desktop's UI, but passing it
		// would make pi exit with an unknown-flag error.
		const args = buildArgs(makeTask({ securityMode: "strict" }), run, "/tmp/s");
		expect(args).not.toContain("--security-gate-mode");
		expect(args).not.toContain("strict");
	});

	it("does not inject a security extension of its own", () => {
		// The old version probed three paths for packages/openpi-security and
		// appended it silently; that package only existed inside the fork.
		const args = buildArgs(makeTask(), run, "/tmp/s");
		expect(args.join(" ")).not.toContain("openpi-security");
	});
});
