import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AutoPilotManager, checkLoopOscillation, computeIssuesFingerprint, execGit } from "../electron/autopilot-manager";

async function waitForTaskStatus(
	manager: AutoPilotManager,
	taskId: string,
	targetStatus: string,
	timeoutMs = 8000,
) {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		const t = manager.getTask(taskId);
		if (t?.status === targetStatus || t?.status === "failed") return t;
		await new Promise((r) => setTimeout(r, 80));
	}
	return manager.getTask(taskId);
}

describe("AutoPilotManager", () => {
	it("rejects non-git directories with a friendly error", async () => {
		const tempDir = mkdtempSync(join(tmpdir(), "openpi-pilot-nongit-"));
		const manager = new AutoPilotManager();

		try {
			await expect(
				manager.startTask({
					cwd: tempDir,
					prompt: "Build feature",
				}),
			).rejects.toThrow("有效");
		} finally {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("executes full worktree isolation, tests, and merges into main branch", async () => {
		const tempDir = mkdtempSync(join(tmpdir(), "openpi-pilot-git-"));
		let notifiedCount = 0;
		const manager = new AutoPilotManager((channel, payload) => {
			if (channel === "autopilot-event") {
				notifiedCount++;
			}
		});

		try {
			// Initialize a real git repo
			await execGit(tempDir, ["init"]);
			await execGit(tempDir, ["config", "user.name", "OpenPI Test"]);
			await execGit(tempDir, ["config", "user.email", "test@openpi.dev"]);
			await execGit(tempDir, ["config", "commit.gpgsign", "false"]);

			writeFileSync(join(tempDir, "README.md"), "# Test Repo\n", "utf8");
			await execGit(tempDir, ["add", "README.md"]);
			await execGit(tempDir, ["commit", "-m", "initial commit"]);

			// Start task with a passing test command
			const task = await manager.startTask({
				cwd: tempDir,
				prompt: "Add feature flag",
				testCommand: "exit 0",
			});

			expect(task.status).toBe("creating_worktree");
			expect(task.steps.length).toBe(5);

			// Wait deterministically for ready_for_review
			const completedTask = await waitForTaskStatus(manager, task.taskId, "ready_for_review");
			expect(completedTask).toBeDefined();
			expect(completedTask?.status).toBe("ready_for_review");
			expect(completedTask?.steps.find((s) => s.id === "step-worktree")?.status).toBe("passed");
			expect(completedTask?.steps.find((s) => s.id === "step-plan-code")?.status).toBe("passed");
			expect(completedTask?.steps.find((s) => s.id === "step-test")?.status).toBe("passed");
			expect(completedTask?.steps.find((s) => s.id === "step-heal")?.status).toBe("skipped");
			expect(completedTask?.steps.find((s) => s.id === "step-delivery")?.status).toBe("passed");
			expect(notifiedCount).toBeGreaterThan(0);

			// Merge task
			const mergeRes = await manager.mergeTask(task.taskId);
			expect(mergeRes.success).toBe(true);

			const mergedTask = manager.getTask(task.taskId);
			expect(mergedTask?.status).toBe("merged");
		} finally {
			rmSync(tempDir, { recursive: true, force: true });
		}
	}, 15000);

	it("handles self-healing loop when test initially fails and auto-heals", async () => {
		const tempDir = mkdtempSync(join(tmpdir(), "openpi-pilot-heal-"));
		const manager = new AutoPilotManager();

		try {
			await execGit(tempDir, ["init"]);
			await execGit(tempDir, ["config", "user.name", "OpenPI Test"]);
			await execGit(tempDir, ["config", "user.email", "test@openpi.dev"]);
			await execGit(tempDir, ["config", "commit.gpgsign", "false"]);

			writeFileSync(join(tempDir, "status.txt"), "failing\n", "utf8");
			await execGit(tempDir, ["add", "status.txt"]);
			await execGit(tempDir, ["commit", "-m", "init"]);

			// Test checks if status.txt contains "passed"
			const testCmd = "grep -q 'passed' status.txt";

			const task = await manager.startTask({
				cwd: tempDir,
				prompt: "Fix status check",
				testCommand: testCmd,
				maxIterations: 2,
				autoExecuteHeal: async ({ worktreePath, iteration }) => {
					if (iteration === 1) {
						// Self-heal: fix file
						writeFileSync(join(worktreePath, "status.txt"), "passed\n", "utf8");
						return true;
					}
					return false;
				},
			});

			const healedTask = await waitForTaskStatus(manager, task.taskId, "ready_for_review");
			expect(healedTask).toBeDefined();
			expect(healedTask?.status).toBe("ready_for_review");
			expect(healedTask?.steps.find((s) => s.id === "step-heal")?.status).toBe("passed");

			// Discard task
			const discardRes = await manager.discardTask(task.taskId);
			expect(discardRes.success).toBe(true);

			const discardedTask = manager.getTask(task.taskId);
			expect(discardedTask?.status).toBe("discarded");
		} finally {
			rmSync(tempDir, { recursive: true, force: true });
		}
	}, 15000);

	it("executes multi-dimensional problem discovery radar and continuously converges to 0 issues", async () => {
		const tempDir = mkdtempSync(join(tmpdir(), "openpi-pilot-radar-"));
		const manager = new AutoPilotManager();

		try {
			await execGit(tempDir, ["init"]);
			await execGit(tempDir, ["config", "user.name", "OpenPI Test"]);
			await execGit(tempDir, ["config", "user.email", "test@openpi.dev"]);
			await execGit(tempDir, ["config", "commit.gpgsign", "false"]);

			writeFileSync(join(tempDir, "typecheck_status.txt"), "error\n", "utf8");
			writeFileSync(join(tempDir, "test_status.txt"), "error\n", "utf8");
			await execGit(tempDir, ["add", "*_status.txt"]);
			await execGit(tempDir, ["commit", "-m", "init checks"]);

			const task = await manager.startTask({
				cwd: tempDir,
				prompt: "Resolve all issues until healthy",
				typecheckCommand: "grep -q 'ok' typecheck_status.txt",
				testCommand: "grep -q 'ok' test_status.txt",
				maxIterations: 3,
				autoExecuteHeal: async ({ worktreePath, iteration }) => {
					if (iteration === 1) {
						writeFileSync(join(worktreePath, "typecheck_status.txt"), "ok\n", "utf8");
					}
					if (iteration === 2) {
						writeFileSync(join(worktreePath, "test_status.txt"), "ok\n", "utf8");
					}
					return true;
				},
			});

			const completed = await waitForTaskStatus(manager, task.taskId, "ready_for_review");
			expect(completed).toBeDefined();
			expect(completed?.status).toBe("ready_for_review");
			expect(completed?.currentIteration).toBe(2);
			expect(completed?.discoveredIssues?.length).toBe(0);
			expect(completed?.steps.find((s) => s.id === "step-heal")?.status).toBe("passed");
		} finally {
			rmSync(tempDir, { recursive: true, force: true });
		}
	}, 15000);

	it("allows continuing healing when iterations cap is reached with remaining issues", async () => {
		const tempDir = mkdtempSync(join(tmpdir(), "openpi-pilot-continue-"));
		const manager = new AutoPilotManager();

		try {
			await execGit(tempDir, ["init"]);
			await execGit(tempDir, ["config", "user.name", "OpenPI Test"]);
			await execGit(tempDir, ["config", "user.email", "test@openpi.dev"]);
			await execGit(tempDir, ["config", "commit.gpgsign", "false"]);

			writeFileSync(join(tempDir, "status.txt"), "failing\n", "utf8");
			await execGit(tempDir, ["add", "status.txt"]);
			await execGit(tempDir, ["commit", "-m", "init"]);

			// Run task with maxIterations = 1, will pause with remaining issues after 1 round
			const task = await manager.startTask({
				cwd: tempDir,
				prompt: "Need multiple rounds to fix",
				testCommand: "grep -q 'fixed' status.txt",
				maxIterations: 1,
				autoExecuteHeal: async () => false,
			});

			const pausedTask = await waitForTaskStatus(manager, task.taskId, "ready_for_review");
			expect(pausedTask?.steps.find((s) => s.id === "step-heal")?.status).toBe("failed");
			expect(pausedTask?.discoveredIssues?.length).toBe(1);

			// Now user clicks '继续自愈', fixing the issue
			writeFileSync(join(pausedTask!.worktreePath, "status.txt"), "fixed\n", "utf8");
			await manager.continueHealing(task.taskId, 2);

			const healedTask = await waitForTaskStatus(manager, task.taskId, "ready_for_review");
			expect(healedTask?.discoveredIssues?.length).toBe(0);
			expect(healedTask?.steps.find((s) => s.id === "step-heal")?.status).toBe("passed");
		} finally {
			rmSync(tempDir, { recursive: true, force: true });
		}
	}, 15000);

	it("accurately detects stagnation and ping-pong oscillation in error fingerprints", () => {
		const fpA = computeIssuesFingerprint([
			{ dimension: "test", command: "npm test", exitCode: 1, output: "err A", summary: "test A failed" },
		]);
		const fpB = computeIssuesFingerprint([
			{ dimension: "typecheck", command: "tsc", exitCode: 2, output: "err B", summary: "type B failed" },
		]);

		const history: string[] = [];
		// Round 1: first error
		const check1 = checkLoopOscillation(history, fpA);
		expect(check1.isStagnant).toBe(false);
		expect(check1.isOscillating).toBe(false);
		history.push(fpA);

		// Round 2: exact same error repeats -> stagnation!
		const check2 = checkLoopOscillation(history, fpA);
		expect(check2.isStagnant).toBe(true);
		expect(check2.isOscillating).toBe(false);
		expect(check2.message).toContain("停滞告警");
		history.push(fpB); // Suppose it moved to B

		// Round 3: A -> B -> A -> ping-pong oscillation!
		const check3 = checkLoopOscillation(history, fpA);
		expect(check3.isOscillating).toBe(true);
		expect(check3.isStagnant).toBe(false);
		expect(check3.message).toContain("循环振荡告警");
	});
});
