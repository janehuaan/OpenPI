import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import chalk from "chalk";

interface Task {
	id: string;
	title: string;
	prompt: string;
	cwd?: string;
	status: "active" | "paused";
	nextRunAt?: string;
	provider?: string;
	model?: string;
	tools?: string[];
	retry?: {
		maxAttempts: number;
		backoffMs?: number;
		retryOn?: Array<"failed" | "interrupted">;
	};
	schedule: { kind: "once"; runAt: string } | { kind: "cron"; expression: string; timezone?: string };
}

interface Run {
	id: string;
	taskId: string;
	status: string;
	trigger: string;
	createdAt: string;
	startedAt?: string;
	finishedAt?: string;
	exitCode?: number;
	result?: string;
	error?: string;
	stdoutPath?: string;
	stderrPath?: string;
	attempt?: number;
	sessionId?: string;
	sessionFile?: string;
}

interface Health {
	ok: true;
	version: string;
	uptimeMs: number;
	socketPath: string;
	tasksActive: number;
	tasksPaused: number;
	runsRunning: number;
	runsQueued: number;
	startedAt: string;
}

interface Response {
	ok: boolean;
	error?: string;
	task?: Task;
	tasks?: Task[];
	run?: Run;
	runs?: Run[];
	deleted?: boolean;
	health?: Health;
}

export interface TaskCliDependencies {
	runOrchestrator(args: string[]): Promise<Response>;
	startOrchestrator(): Promise<void>;
}

function getFlag(args: string[], name: string): string | undefined {
	const index = args.indexOf(name);
	return index >= 0 ? args[index + 1] : undefined;
}

function getRepeatableFlags(args: string[], name: string): string[] {
	const values: string[] = [];
	for (let index = 0; index < args.length; index++) {
		if (args[index] === name && index + 1 < args.length) {
			values.push(args[index + 1] as string);
			index++;
		}
	}
	return values;
}

function orchestratorCommand(): { command: string; prefix: string[] } {
	const configured = process.env.PI_ORCHESTRATOR_CLI;
	if (configured) return { command: process.execPath, prefix: [resolve(configured)] };
	const candidates = [
		resolve(dirname(process.argv[1] ?? ""), "../../orchestrator/dist/cli.js"),
		resolve(dirname(process.argv[1] ?? ""), "../../../orchestrator/dist/cli.js"),
		resolve(process.cwd(), "packages/orchestrator/dist/cli.js"),
	];
	const entry = candidates.find(existsSync);
	if (!entry) throw new Error("Orchestrator CLI not found. Build packages/orchestrator or set PI_ORCHESTRATOR_CLI.");
	return { command: process.execPath, prefix: [entry] };
}

function runProcess(args: string[], detached = false): Promise<{ stdout: string; stderr: string; code: number }> {
	const resolved = orchestratorCommand();
	return new Promise((resolveResult, reject) => {
		const child = spawn(resolved.command, [...resolved.prefix, ...args], {
			detached,
			env: process.env,
			stdio: detached ? "ignore" : ["ignore", "pipe", "pipe"],
		});
		if (detached) {
			child.unref();
			resolveResult({ stdout: "", stderr: "", code: 0 });
			return;
		}
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
		child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
		child.once("error", reject);
		child.once("close", (code) => {
			resolveResult({
				stdout: Buffer.concat(stdout).toString("utf8").trim(),
				stderr: Buffer.concat(stderr).toString("utf8").trim(),
				code: code ?? 1,
			});
		});
	});
}

const defaultDependencies: TaskCliDependencies = {
	async runOrchestrator(args) {
		const result = await runProcess(args);
		if (result.code !== 0) throw new Error(result.stderr || result.stdout || "Orchestrator command failed.");
		return JSON.parse(result.stdout) as Response;
	},
	async startOrchestrator() {
		await runProcess(["serve"], true);
	},
};

async function request(args: string[], dependencies: TaskCliDependencies): Promise<Response> {
	try {
		return await dependencies.runOrchestrator(args);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (!/ENOENT|ECONNREFUSED|socket|connect/i.test(message)) throw error;
		await dependencies.startOrchestrator();
		for (let attempt = 0; attempt < 20; attempt++) {
			await delay(100);
			try {
				return await dependencies.runOrchestrator(args);
			} catch (retryError) {
				if (attempt === 19) throw retryError;
			}
		}
		throw error;
	}
}

function scheduleText(task: Task): string {
	return task.schedule.kind === "once"
		? `once ${task.schedule.runAt}`
		: `cron ${task.schedule.expression} ${task.schedule.timezone ?? "UTC"}`;
}

function printTask(task: Task): void {
	console.log(`${chalk.bold(task.title)} (${task.id})`);
	console.log(`Status: ${task.status}`);
	console.log(`Schedule: ${scheduleText(task)}`);
	console.log(`Next run: ${task.nextRunAt ?? "-"}`);
	console.log(`Working directory: ${task.cwd ?? "-"}`);
	if (task.provider) console.log(`Provider: ${task.provider}`);
	if (task.model) console.log(`Model: ${task.model}`);
	if (task.tools?.length) console.log(`Tools: ${task.tools.join(",")}`);
	if (task.retry) {
		console.log(
			`Retry: max=${task.retry.maxAttempts} backoffMs=${task.retry.backoffMs ?? 1000} on=${(task.retry.retryOn ?? ["failed"]).join(",")}`,
		);
	}
	console.log(`Prompt: ${task.prompt}`);
}

function printRun(run: Run): void {
	console.log(`${chalk.bold(run.status)} ${run.id}`);
	console.log(`Task: ${run.taskId}`);
	console.log(`Trigger: ${run.trigger}`);
	console.log(`Attempt: ${run.attempt ?? 1}`);
	console.log(`Started: ${run.startedAt ?? "-"}`);
	console.log(`Finished: ${run.finishedAt ?? "-"}`);
	console.log(`Exit code: ${run.exitCode ?? "-"}`);
	if (run.sessionId) console.log(`Session: ${run.sessionId}`);
	if (run.sessionFile) console.log(`Session file: ${run.sessionFile}`);
	if (run.stdoutPath) console.log(`Stdout: ${run.stdoutPath}`);
	if (run.stderrPath) console.log(`Stderr: ${run.stderrPath}`);
	if (run.result) console.log(`Result:\n${run.result}`);
	if (run.error) console.log(`Error:\n${run.error}`);
}

function printHelp(): void {
	console.log(`pi task - persistent scheduled Pi tasks

Usage:
  pi task create --title <title> --prompt <prompt> (--at <rfc3339> | --cron <expression>)
                 [--timezone <iana>] [--cwd <path>] [--provider <id>] [--model <id>]
                 [--tools a,b] [--env KEY=VAL]... [--retry-max N] [--retry-backoff-ms N]
                 [--retry-on failed,interrupted]
                 [--security-mode strict|confirm|permissive|bypass] [--sandbox none|docker]
                 [--docker-image <image>] [--extension <path>]...
  pi task list
  pi task show <task-id>
  pi task run <task-id>
  pi task runs [task-id]
  pi task pause|resume|delete <task-id>
  pi task cancel <run-id>
  pi task daemon status|start|stop

Cron defaults to UTC. Use --timezone with an IANA name for local wall-clock evaluation.
Unattended defaults: security-mode strict + openpi-security extension when openpi-enable was run.`);
}

export async function handleTaskCommand(
	args: string[],
	dependencies: TaskCliDependencies = defaultDependencies,
): Promise<boolean> {
	if (args[0] !== "task") return false;
	const action = args[1];
	if (!action || action === "--help" || action === "-h") {
		printHelp();
		return true;
	}
	if (action === "daemon") {
		if (args[2] === "start") {
			await dependencies.startOrchestrator();
			console.log("Orchestrator daemon started.");
			return true;
		}
		if (args[2] === "stop") {
			const response = await request(["shutdown"], dependencies);
			if (!response.ok) throw new Error(response.error);
			console.log("Orchestrator daemon shutdown requested.");
			return true;
		}
		const response = await request(["health"], dependencies);
		if (!response.ok || !response.health) throw new Error(response.error ?? "Health check failed.");
		const health = response.health;
		console.log("Orchestrator daemon is running.");
		console.log(`Version: ${health.version}`);
		console.log(`Uptime: ${Math.floor(health.uptimeMs / 1000)}s`);
		console.log(`Socket: ${health.socketPath}`);
		console.log(`Tasks: active=${health.tasksActive} paused=${health.tasksPaused}`);
		console.log(`Runs: running=${health.runsRunning} queued=${health.runsQueued}`);
		return true;
	}
	if (action === "create") {
		const title = getFlag(args, "--title");
		const prompt = getFlag(args, "--prompt");
		const at = getFlag(args, "--at");
		const cron = getFlag(args, "--cron");
		if (!title || !prompt || (!at && !cron) || (at && cron)) {
			throw new Error("create requires --title, --prompt, and exactly one of --at or --cron.");
		}
		const command = [
			"task",
			"create",
			"--title",
			title,
			"--prompt",
			prompt,
			at ? "--at" : "--cron",
			at ?? cron ?? "",
		];
		const optionalFlags = [
			"--cwd",
			"--timezone",
			"--provider",
			"--model",
			"--tools",
			"--retry-max",
			"--retry-backoff-ms",
			"--retry-on",
			"--security-mode",
			"--sandbox",
			"--docker-image",
		] as const;
		for (const flag of optionalFlags) {
			const value = getFlag(args, flag);
			if (value) command.push(flag, value);
		}
		for (const env of getRepeatableFlags(args, "--env")) {
			command.push("--env", env);
		}
		for (const extension of getRepeatableFlags(args, "--extension")) {
			command.push("--extension", extension);
		}
		const response = await request(command, dependencies);
		if (!response.ok || !response.task) throw new Error(response.error ?? "Task creation failed.");
		printTask(response.task);
		return true;
	}
	if (action === "list") {
		const response = await request(["task", "list"], dependencies);
		if (!response.ok) throw new Error(response.error);
		const tasks = response.tasks ?? [];
		if (tasks.length === 0) console.log("No tasks.");
		else
			for (const task of tasks)
				console.log(`${task.status.padEnd(7)} ${task.id}  ${task.title}  ${task.nextRunAt ?? "-"}`);
		return true;
	}
	const id = args[2];
	if (action === "runs") {
		const response = await request(id ? ["task", "runs", id] : ["task", "runs"], dependencies);
		if (!response.ok) throw new Error(response.error);
		const runs = response.runs ?? [];
		if (runs.length === 0) console.log("No runs.");
		else
			for (const run of runs)
				console.log(
					`${run.status.padEnd(11)} ${run.id}  ${run.taskId}  attempt=${run.attempt ?? 1}  ${run.startedAt ?? run.createdAt}`,
				);
		return true;
	}
	if (!id) throw new Error(`${action} requires an id.`);
	const command =
		action === "show"
			? ["task", "show", id]
			: action === "run"
				? ["task", "run", id]
				: action === "cancel"
					? ["task", "cancel", id]
					: ["task", action, id];
	const response = await request(command, dependencies);
	if (!response.ok) throw new Error(response.error);
	if (response.task) printTask(response.task);
	else if (response.run) printRun(response.run);
	else if (response.deleted) console.log(`Deleted task ${id}.`);
	return true;
}
