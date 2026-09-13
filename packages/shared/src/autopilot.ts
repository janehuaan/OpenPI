/**
 * Auto-Pilot Autonomous Delivery & Self-Healing Loop.
 *
 * Provides shared types, pipeline definitions, test detection, and state machines
 * for background Git-worktree-isolated agent execution, automated testing,
 * error diagnosis & self-healing loops, and atomic pull-request / 1-click delivery.
 */

export type AutoPilotStatus =
	| "idle"
	| "creating_worktree"
	| "planning"
	| "executing"
	| "testing"
	| "diagnosing"
	| "ready_for_review"
	| "merged"
	| "discarded"
	| "failed";

export type AutoPilotStepStatus = "pending" | "running" | "passed" | "failed" | "skipped";

export interface AutoPilotStep {
	id: string;
	name: string;
	status: AutoPilotStepStatus;
	detail?: string;
	startedAt?: string;
	finishedAt?: string;
	error?: string;
}

export interface DiscoveredIssue {
	dimension: "typecheck" | "test" | "lint" | "build";
	command: string;
	exitCode: number;
	output: string;
	summary: string;
}

export interface VerificationPipeline {
	typecheckCommand?: string;
	testCommand?: string;
	lintCommand?: string;
	buildCommand?: string;
}

export interface AutoPilotTask {
	taskId: string;
	cwd: string;
	prompt: string;
	worktreePath: string;
	branch: string;
	baseBranch: string;
	status: AutoPilotStatus;
	currentIteration: number;
	maxIterations: number;
	steps: AutoPilotStep[];
	testCommand?: string;
	verificationPipeline?: VerificationPipeline;
	discoveredIssues?: DiscoveredIssue[];
	totalIssuesResolved?: number;
	diff?: string;
	changedFiles?: string[];
	sessionId?: string;
	logs?: string[];
	createdAt: string;
	updatedAt: string;
	error?: string;
	summary?: string;
}

export const DEFAULT_AUTOPILOT_STEPS: ReadonlyArray<Omit<AutoPilotStep, "startedAt" | "finishedAt">> = [
	{ id: "step-worktree", name: "创建独立 Git Worktree 隔离工作区", status: "pending" },
	{ id: "step-plan-code", name: "Agent 自主设计与代码实施", status: "pending" },
	{ id: "step-test", name: "全维问题主动发现雷达 (编译/类型/测试/构建)", status: "pending" },
	{ id: "step-heal", name: "持续发现与闭环自愈 (直至全部解决好)", status: "pending" },
	{ id: "step-delivery", name: "原子提交与一键合并审核", status: "pending" },
];

/**
 * Detects comprehensive multi-dimensional verification commands (Typecheck, Test, Lint, Build)
 * from project metadata or file lists.
 */
export function detectVerificationPipeline(options: {
	packageJson?: { scripts?: Record<string, string> } | null;
	fileList?: string[];
}): VerificationPipeline {
	const { packageJson, fileList = [] } = options;
	const filesSet = new Set(fileList.map((f) => f.toLowerCase()));
	const scripts = packageJson?.scripts || {};

	let typecheckCommand: string | undefined;
	let testCommand: string | undefined;
	let lintCommand: string | undefined;
	let buildCommand: string | undefined;

	// 1. Node / JavaScript / TypeScript package.json
	if (scripts.typecheck) {
		typecheckCommand = "npm run typecheck";
	} else if (scripts["check-types"]) {
		typecheckCommand = "npm run check-types";
	} else if (scripts.tsc) {
		typecheckCommand = "npm run tsc";
	} else if (filesSet.has("tsconfig.json")) {
		typecheckCommand = "npx tsc --noEmit";
	}

	if (scripts.test) {
		const script = scripts.test.trim();
		if (!script.includes("no test specified")) {
			testCommand = "npm test";
		}
	}

	if (scripts.lint) {
		lintCommand = "npm run lint";
	}

	if (scripts.build) {
		buildCommand = "npm run build";
	}

	// 2. Rust
	if (filesSet.has("cargo.toml")) {
		typecheckCommand = typecheckCommand || "cargo check";
		testCommand = testCommand || "cargo test";
		lintCommand = lintCommand || "cargo clippy";
		buildCommand = buildCommand || "cargo build";
	}

	// 3. Go
	if (filesSet.has("go.mod")) {
		typecheckCommand = typecheckCommand || "go vet ./...";
		testCommand = testCommand || "go test ./...";
		buildCommand = buildCommand || "go build ./...";
	}

	// 4. Python pytest / pyproject.toml
	if (
		filesSet.has("pytest.ini") ||
		filesSet.has("conftest.py") ||
		filesSet.has("pyproject.toml") ||
		fileList.some((f) => /(^|\/)(test_[^/]+\.py|[^/]+_test\.py)$/i.test(f))
	) {
		testCommand = testCommand || "pytest";
	}

	return {
		typecheckCommand,
		testCommand,
		lintCommand,
		buildCommand,
	};
}

/**
 * Automatically detects the test command from project metadata or file lists.
 */
export function detectTestCommand(options: {
	packageJson?: { scripts?: Record<string, string> } | null;
	fileList?: string[];
}): string | undefined {
	return detectVerificationPipeline(options).testCommand;
}

/**
 * Creates an initial AutoPilot task with the default 5-step pipeline.
 */
export function createInitialAutoPilotTask(params: {
	taskId: string;
	cwd: string;
	prompt: string;
	branch?: string;
	worktreePath: string;
	baseBranch?: string;
	testCommand?: string;
	maxIterations?: number;
}): AutoPilotTask {
	const now = new Date().toISOString();
	const branch = params.branch || `openpi/pilot-${params.taskId.slice(0, 8)}`;
	const baseBranch = params.baseBranch || "main";

	return {
		taskId: params.taskId,
		cwd: params.cwd,
		prompt: params.prompt,
		worktreePath: params.worktreePath,
		branch,
		baseBranch,
		status: "creating_worktree",
		currentIteration: 1,
		maxIterations: params.maxIterations ?? 3,
		steps: DEFAULT_AUTOPILOT_STEPS.map((s) => ({ ...s })),
		testCommand: params.testCommand,
		createdAt: now,
		updatedAt: now,
	};
}

/**
 * Immutably updates a specific step in an AutoPilot task.
 */
export function updateTaskStep(
	task: AutoPilotTask,
	stepId: string,
	update: Partial<AutoPilotStep>,
): AutoPilotTask {
	const now = new Date().toISOString();
	const newSteps = task.steps.map((step) => {
		if (step.id !== stepId) return step;
		return {
			...step,
			...update,
			startedAt: update.status === "running" && !step.startedAt ? now : (update.startedAt ?? step.startedAt),
			finishedAt:
				update.status && ["passed", "failed", "skipped"].includes(update.status)
					? (update.finishedAt ?? now)
					: (update.finishedAt ?? step.finishedAt),
		};
	});

	return {
		...task,
		steps: newSteps,
		updatedAt: now,
	};
}

/**
 * Immutably advances an AutoPilot task's global status.
 */
export function advanceTaskStatus(
	task: AutoPilotTask,
	status: AutoPilotStatus,
	error?: string,
): AutoPilotTask {
	return {
		...task,
		status,
		error: error ?? task.error,
		updatedAt: new Date().toISOString(),
	};
}
