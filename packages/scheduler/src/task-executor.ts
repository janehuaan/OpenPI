import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { taskLogsDir, taskSessionsDir } from "./config.ts";
import type { TaskDefinition, TaskRun } from "./types.ts";

export interface TaskExecutionResult {
	exitCode: number;
	result: string;
	error: string;
	pid?: number;
	sessionId?: string;
	sessionFile?: string;
}

export interface TaskExecution {
	pid?: number;
	stdoutPath: string;
	stderrPath: string;
	sessionDir: string;
	completion: Promise<TaskExecutionResult>;
	cancel(): void;
}

export interface TaskExecutor {
	execute(task: TaskDefinition, run: TaskRun): TaskExecution;
}

const DEFAULT_FORCE_KILL_MS = 5_000;
const DEFAULT_SAFE_TOOLS = ["read", "grep", "find", "ls", "bash"];

/**
 * Resolve the pi RPC-less print entry we spawn for unattended runs.
 *
 * Resolves the installed package rather than searching PATH, so a scheduled run
 * uses the same pinned version as an interactive session. The old code probed a
 * sibling `../coding-agent/cli.js`, which only existed inside the fork's
 * monorepo layout.
 */
function resolvePiEntry(): string {
	const configured = process.env.OPENPI_PI_CLI;
	if (configured) return resolve(configured);

	const here = dirname(fileURLToPath(import.meta.url));
	const entry = "@earendil-works/pi-coding-agent/dist/bundle/cli.js";
	const candidates = [
		join(here, "../../../node_modules", entry),
		// packaged: the daemon bundle (which embeds this) sits beside node_modules
		join(here, "node_modules", entry),
		join(here, "../node_modules", entry),
	];
	const found = candidates.find(existsSync);
	if (found) return found;
	throw new Error(
		`pi CLI not found. Looked in:\n  ${candidates.join("\n  ")}\n` +
			"Run `npm install` at the repo root, or set OPENPI_PI_CLI.",
	);
}

function forceKillMs(): number {
	const configured = Number(process.env.PI_TASK_FORCE_KILL_MS);
	if (Number.isFinite(configured) && configured >= 0) return configured;
	return DEFAULT_FORCE_KILL_MS;
}

function signalProcess(pid: number, signal: NodeJS.Signals): void {
	try {
		if (process.platform === "win32") {
			if (signal === "SIGKILL") {
				spawn("taskkill", ["/F", "/T", "/PID", String(pid)], { stdio: "ignore" });
				return;
			}
			process.kill(pid, signal);
			return;
		}
		process.kill(-pid, signal);
	} catch {
		// Process may have exited between status check and signal delivery.
	}
}

function stopProcess(pid: number | undefined, forceTimer: { current?: NodeJS.Timeout }): void {
	if (!pid) return;
	signalProcess(pid, "SIGTERM");
	const delay = forceKillMs();
	if (delay <= 0) {
		signalProcess(pid, "SIGKILL");
		return;
	}
	forceTimer.current = setTimeout(() => {
		signalProcess(pid, "SIGKILL");
	}, delay);
	forceTimer.current.unref?.();
}

interface TaskDefaults {
	defaultTaskTools?: string[];
	defaultTaskExtensions?: string[];
}

/**
 * Per-installation task defaults from `<agentDir>/openpi.json`.
 *
 * Reads openpi's own agent directory, never the user's `~/.pi/agent`. The old
 * version also probed three paths for a `packages/openpi-security` extension
 * that only existed inside the fork; unattended safety now comes from the tool
 * allowlist below plus the optional docker sandbox.
 */
function loadTaskDefaults(): TaskDefaults {
	try {
		const agentDir =
			process.env.PI_CODING_AGENT_DIR ?? join(process.env.OPENPI_DIR ?? join(homedir(), ".openpi"), "agent");
		const path = join(agentDir, "openpi.json");
		if (!existsSync(path)) return {};
		return JSON.parse(readFileSync(path, "utf8")) as TaskDefaults;
	} catch {
		return {};
	}
}

export function buildArgs(task: TaskDefinition, run: TaskRun, sessionDir: string): string[] {
	const defaults = loadTaskDefaults();
	const args = [resolvePiEntry()];
	if (task.provider) args.push("--provider", task.provider);
	if (task.model) args.push("--model", task.model);
	const tools = task.tools && task.tools.length > 0 ? task.tools : (defaults.defaultTaskTools ?? DEFAULT_SAFE_TOOLS);
	if (tools.length > 0) args.push("--tools", tools.join(","));
	if (task.excludeTools && task.excludeTools.length > 0) {
		args.push("--exclude-tools", task.excludeTools.join(","));
	}
	const extensions = [...(task.extensions ?? []), ...(defaults.defaultTaskExtensions ?? [])];
	for (const extension of extensions) {
		args.push("--extension", extension);
	}
	// Upstream 0.84.4 has no --security-gate-mode flag; TaskDefinition.securityMode
	// is kept in the type for the desktop's UI but does not reach the CLI.
	args.push("--session-dir", sessionDir);
	args.push("--session-id", run.id);
	args.push("--print", task.prompt);
	return args;
}

function findSessionFile(
	sessionDir: string,
	sessionId: string,
): { sessionId: string; sessionFile: string } | undefined {
	if (!existsSync(sessionDir)) return undefined;
	const candidates: Array<{ path: string; mtime: number }> = [];
	for (const name of readdirSync(sessionDir)) {
		if (!name.endsWith(".jsonl")) continue;
		const path = join(sessionDir, name);
		try {
			const stat = statSync(path);
			if (!stat.isFile()) continue;
			candidates.push({ path, mtime: stat.mtimeMs });
		} catch {
			// Ignore unreadable entries.
		}
	}
	candidates.sort((a, b) => b.mtime - a.mtime);
	for (const candidate of candidates) {
		try {
			const firstLine = readFileSync(candidate.path, "utf8")
				.split("\n")
				.find((line) => line.trim().length > 0);
			if (!firstLine) continue;
			const header = JSON.parse(firstLine) as { type?: string; id?: string; sessionId?: string };
			const id = header.id ?? header.sessionId;
			if (id === sessionId || candidate.path.includes(sessionId)) {
				return { sessionId: id ?? sessionId, sessionFile: candidate.path };
			}
		} catch {
			// Keep scanning.
		}
	}
	if (candidates[0]) {
		return { sessionId, sessionFile: candidates[0].path };
	}
	return undefined;
}

export class ProcessTaskExecutor implements TaskExecutor {
	execute(task: TaskDefinition, run: TaskRun): TaskExecution {
		const cwd = task.cwd ?? process.cwd();
		if (!existsSync(cwd)) throw new Error(`Task working directory does not exist: ${cwd}`);
		const logsDir = taskLogsDir();
		mkdirSync(logsDir, { recursive: true });
		const sessionDir = join(taskSessionsDir(), run.id);
		mkdirSync(sessionDir, { recursive: true });
		const stdoutPath = join(logsDir, `${run.id}.stdout.log`);
		const stderrPath = join(logsDir, `${run.id}.stderr.log`);
		const stdout = openSync(stdoutPath, "a", 0o600);
		const stderr = openSync(stderrPath, "a", 0o600);
		const env: NodeJS.ProcessEnv = { ...process.env, ...(task.env ?? {}) };
		const piArgs = buildArgs(task, run, sessionDir);
		const useDocker = task.sandbox === "docker";
		const child = useDocker
			? spawn(
					"docker",
					[
						"run",
						"--rm",
						"-v",
						`${cwd}:/work`,
						"-w",
						"/work",
						task.dockerImage ?? "node:22-bookworm",
						process.execPath,
						...piArgs,
					],
					{
						cwd,
						detached: process.platform !== "win32",
						env,
						stdio: ["ignore", stdout, stderr],
					},
				)
			: spawn(process.execPath, piArgs, {
					cwd,
					detached: process.platform !== "win32",
					env,
					stdio: ["ignore", stdout, stderr],
				});
		const forceTimer: { current?: NodeJS.Timeout } = {};
		const completion = new Promise<TaskExecutionResult>((resolveResult, reject) => {
			child.once("error", reject);
			child.once("close", (code) => {
				if (forceTimer.current) clearTimeout(forceTimer.current);
				const session = findSessionFile(sessionDir, run.id);
				resolveResult({
					exitCode: code ?? 1,
					result: "",
					error: "",
					pid: child.pid,
					sessionId: session?.sessionId,
					sessionFile: session?.sessionFile,
				});
			});
		});
		return {
			pid: child.pid,
			stdoutPath,
			stderrPath,
			sessionDir,
			completion,
			cancel: () => stopProcess(child.pid, forceTimer),
		};
	}
}

export function taskLogDirectory(path: string): string {
	return dirname(path);
}
