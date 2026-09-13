import assert from "node:assert/strict";
import test from "node:test";
import {
	advanceTaskStatus,
	createInitialAutoPilotTask,
	detectTestCommand,
	detectVerificationPipeline,
	updateTaskStep,
} from "@openpi/shared";

test("detectTestCommand detects npm test from package.json scripts", () => {
	const cmd = detectTestCommand({
		packageJson: {
			scripts: {
				test: "vitest run",
			},
		},
	});
	assert.equal(cmd, "npm test");
});

test("detectTestCommand ignores placeholder echo error in package.json", () => {
	const cmd = detectTestCommand({
		packageJson: {
			scripts: {
				test: 'echo "Error: no test specified" && exit 1',
			},
		},
	});
	assert.equal(cmd, undefined);
});

test("detectTestCommand detects cargo test for Rust projects", () => {
	const cmd = detectTestCommand({
		fileList: ["src/main.rs", "Cargo.toml", "README.md"],
	});
	assert.equal(cmd, "cargo test");
});

test("detectTestCommand detects go test for Go projects", () => {
	const cmd = detectTestCommand({
		fileList: ["main.go", "go.mod", "pkg/util.go"],
	});
	assert.equal(cmd, "go test ./...");
});

test("detectTestCommand detects pytest for Python projects", () => {
	assert.equal(detectTestCommand({ fileList: ["pytest.ini", "main.py"] }), "pytest");
	assert.equal(detectTestCommand({ fileList: ["pyproject.toml", "app.py"] }), "pytest");
	assert.equal(detectTestCommand({ fileList: ["tests/test_api.py", "app.py"] }), "pytest");
});

test("detectVerificationPipeline detects comprehensive radar commands from package.json", () => {
	const res = detectVerificationPipeline({
		packageJson: {
			scripts: {
				typecheck: "tsc --noEmit",
				test: "vitest run",
				lint: "eslint .",
				build: "vite build",
			},
		},
	});
	assert.equal(res.typecheckCommand, "npm run typecheck");
	assert.equal(res.testCommand, "npm test");
	assert.equal(res.lintCommand, "npm run lint");
	assert.equal(res.buildCommand, "npm run build");
});

test("detectVerificationPipeline falls back to npx tsc --noEmit when tsconfig.json is present", () => {
	const res = detectVerificationPipeline({
		fileList: ["tsconfig.json", "src/index.ts"],
	});
	assert.equal(res.typecheckCommand, "npx tsc --noEmit");
});

test("detectTestCommand returns undefined when no recognizable test configuration exists", () => {
	assert.equal(detectTestCommand({ fileList: ["index.html", "style.css"] }), undefined);
});

test("createInitialAutoPilotTask initializes a task with default 5-step pipeline", () => {
	const task = createInitialAutoPilotTask({
		taskId: "task-12345678",
		cwd: "/Users/test/project",
		prompt: "Add login auth flow",
		worktreePath: "/Users/test/project/.openpi/worktrees/pilot-task-123",
		testCommand: "npm test",
	});

	assert.equal(task.taskId, "task-12345678");
	assert.equal(task.status, "creating_worktree");
	assert.equal(task.branch, "openpi/pilot-task-123");
	assert.equal(task.steps.length, 5);
	assert.equal(task.steps[0].id, "step-worktree");
	assert.equal(task.steps[1].id, "step-plan-code");
	assert.equal(task.steps[2].id, "step-test");
	assert.equal(task.steps[3].id, "step-heal");
	assert.equal(task.steps[4].id, "step-delivery");
	assert.equal(task.currentIteration, 1);
	assert.equal(task.maxIterations, 3);
	assert.equal(task.testCommand, "npm test");
});

test("updateTaskStep and advanceTaskStatus update task cleanly", () => {
	const task = createInitialAutoPilotTask({
		taskId: "task-abc",
		cwd: "/workspace",
		prompt: "Fix bug",
		worktreePath: "/workspace/.openpi/worktrees/pilot-task-abc",
	});

	const runningTask = updateTaskStep(task, "step-worktree", {
		status: "running",
		detail: "Creating git worktree...",
	});
	assert.equal(runningTask.steps[0].status, "running");
	assert.ok(runningTask.steps[0].startedAt);

	const passedTask = updateTaskStep(runningTask, "step-worktree", {
		status: "passed",
		detail: "Worktree ready",
	});
	assert.equal(passedTask.steps[0].status, "passed");
	assert.ok(passedTask.steps[0].finishedAt);

	const readyTask = advanceTaskStatus(task, "ready_for_review");
	assert.equal(readyTask.status, "ready_for_review");
});
