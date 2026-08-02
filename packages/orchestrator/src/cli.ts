#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { createConnection } from "node:net";
import { dirname, join } from "node:path";
import { cwd } from "node:process";
import { fileURLToPath } from "node:url";
import type { RpcCommand, RpcExtensionUIResponse } from "@earendil-works/pi-coding-agent";
import { getSocketPath } from "./config.ts";
import { sendIpcRequest } from "./ipc/client.ts";
import { encodeMessage } from "./ipc/protocol.ts";
import { serve } from "./serve.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf-8")) as {
	version: string;
};

function printHelp(): void {
	console.log(
		`orchestrator v${packageJson.version}

Usage:
  orchestrator serve
  orchestrator health
  orchestrator shutdown
  orchestrator list
  orchestrator spawn [--cwd <path>] [--label <label>]
  orchestrator status <instance-id>
  orchestrator stop <instance-id>
  orchestrator task create --title <title> --prompt <prompt> (--at <rfc3339> | --cron <expression>)
                           [--timezone <iana>] [--cwd <path>] [--provider <id>] [--model <id>]
                           [--tools a,b] [--env KEY=VAL]... [--retry-max N] [--retry-backoff-ms N]
                           [--retry-on failed,interrupted]
  orchestrator task list
  orchestrator task show <task-id>
  orchestrator task run <task-id>
  orchestrator task runs [task-id]
  orchestrator task cancel <run-id>
  orchestrator task pause|resume|delete <task-id>
  orchestrator rpc <instance-id> <json-command>
  orchestrator rpc-stream <instance-id>
  orchestrator --help
  orchestrator --version

Cron schedules default to UTC. Pass --timezone with an IANA name for local wall-clock cron.`,
	);
}

function printResponse(response: unknown): void {
	console.log(JSON.stringify(response, null, 2));
}

function getFlagValue(args: string[], flag: string): string | undefined {
	const index = args.indexOf(flag);
	if (index === -1 || index + 1 >= args.length) {
		return undefined;
	}
	return args[index + 1];
}

function getRepeatableFlagValues(args: string[], flag: string): string[] {
	const values: string[] = [];
	for (let index = 0; index < args.length; index++) {
		if (args[index] === flag && index + 1 < args.length) {
			values.push(args[index + 1] as string);
			index++;
		}
	}
	return values;
}

function parseEnvFlags(args: string[]): Record<string, string> | undefined {
	const pairs = getRepeatableFlagValues(args, "--env");
	if (pairs.length === 0) return undefined;
	const env: Record<string, string> = {};
	for (const pair of pairs) {
		const separator = pair.indexOf("=");
		if (separator <= 0) throw new Error(`Invalid --env value: ${pair}`);
		env[pair.slice(0, separator)] = pair.slice(separator + 1);
	}
	return env;
}

function parseRetry(args: string[]):
	| {
			maxAttempts: number;
			backoffMs?: number;
			retryOn?: Array<"failed" | "interrupted">;
	  }
	| undefined {
	const maxRaw = getFlagValue(args, "--retry-max");
	if (maxRaw === undefined) return undefined;
	const maxAttempts = Number(maxRaw);
	if (!Number.isInteger(maxAttempts) || maxAttempts < 0)
		throw new Error("--retry-max must be a non-negative integer.");
	const backoffRaw = getFlagValue(args, "--retry-backoff-ms");
	const backoffMs = backoffRaw === undefined ? undefined : Number(backoffRaw);
	if (backoffMs !== undefined && (!Number.isFinite(backoffMs) || backoffMs < 0)) {
		throw new Error("--retry-backoff-ms must be a non-negative number.");
	}
	const retryOnRaw = getFlagValue(args, "--retry-on");
	const retryOn = retryOnRaw
		? retryOnRaw.split(",").map((entry) => {
				const value = entry.trim();
				if (value !== "failed" && value !== "interrupted") {
					throw new Error("--retry-on entries must be failed or interrupted.");
				}
				return value;
			})
		: undefined;
	return { maxAttempts, backoffMs, retryOn };
}

async function rpcStream(instanceId: string): Promise<void> {
	const socket = createConnection(getSocketPath());
	let stdinBuffer = "";
	process.stdin.setEncoding("utf8");

	await new Promise<void>((resolve, reject) => {
		socket.once("connect", () => {
			socket.write(encodeMessage({ type: "rpc_stream", instanceId }));
			resolve();
		});
		socket.once("error", reject);
	});

	socket.on("data", (chunk: Buffer | string) => {
		process.stdout.write(chunk.toString());
	});
	console.error(`connected to rpc stream ${instanceId}; send JSONL RpcCommand or extension_ui_response on stdin`);
	socket.on("error", (error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	});
	socket.on("end", () => {
		process.exit(0);
	});
	process.stdin.on("data", (chunk: string) => {
		stdinBuffer += chunk;
		while (true) {
			const newlineIndex = stdinBuffer.indexOf("\n");
			if (newlineIndex === -1) {
				return;
			}
			const line = stdinBuffer.slice(0, newlineIndex).trim();
			stdinBuffer = stdinBuffer.slice(newlineIndex + 1);
			if (!line) {
				continue;
			}
			const parsed = JSON.parse(line) as RpcCommand | RpcExtensionUIResponse;
			socket.write(encodeMessage(parsed));
		}
	});
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);

	if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
		printHelp();
		process.exit(0);
	}

	if (args[0] === "--version" || args[0] === "-v") {
		console.log(packageJson.version);
		process.exit(0);
	}

	if (args[0] === "serve") {
		await serve();
		return;
	}

	if (args[0] === "health") {
		printResponse(await sendIpcRequest({ type: "health" }));
		return;
	}

	if (args[0] === "shutdown") {
		printResponse(await sendIpcRequest({ type: "shutdown" }));
		return;
	}

	if (args[0] === "list") {
		printResponse(await sendIpcRequest({ type: "list" }));
		return;
	}

	if (args[0] === "spawn") {
		const spawnCwd = getFlagValue(args, "--cwd") ?? cwd();
		const label = getFlagValue(args, "--label");
		printResponse(await sendIpcRequest({ type: "spawn", cwd: spawnCwd, label }));
		return;
	}

	if (args[0] === "task") {
		const action = args[1];
		if (action === "create") {
			const title = getFlagValue(args, "--title");
			const prompt = getFlagValue(args, "--prompt");
			const runAt = getFlagValue(args, "--at");
			const cron = getFlagValue(args, "--cron");
			if (!title || !prompt || (!runAt && !cron) || (runAt && cron)) {
				throw new Error("Task create requires --title, --prompt, and exactly one of --at or --cron.");
			}
			const tools = getFlagValue(args, "--tools");
			const securityMode = getFlagValue(args, "--security-mode");
			const sandbox = getFlagValue(args, "--sandbox");
			printResponse(
				await sendIpcRequest({
					type: "task_create",
					title,
					prompt,
					cwd: getFlagValue(args, "--cwd"),
					provider: getFlagValue(args, "--provider"),
					model: getFlagValue(args, "--model"),
					tools: tools
						? tools
								.split(",")
								.map((entry) => entry.trim())
								.filter(Boolean)
						: undefined,
					extensions: getRepeatableFlagValues(args, "--extension"),
					securityMode:
						securityMode === "strict" || securityMode === "confirm" || securityMode === "permissive"
							? securityMode
							: undefined,
					sandbox: sandbox === "docker" || sandbox === "none" ? sandbox : undefined,
					dockerImage: getFlagValue(args, "--docker-image"),
					env: parseEnvFlags(args),
					retry: parseRetry(args),
					schedule: runAt
						? { kind: "once", runAt }
						: {
								kind: "cron",
								expression: cron as string,
								timezone: getFlagValue(args, "--timezone"),
							},
				}),
			);
			return;
		}
		if (action === "list") {
			printResponse(await sendIpcRequest({ type: "task_list" }));
			return;
		}
		const taskId = args[2];
		if (action === "show") {
			if (!taskId) throw new Error("Task show requires a task id.");
			printResponse(await sendIpcRequest({ type: "task_show", taskId }));
			return;
		}
		if (action === "cancel") {
			if (!taskId) throw new Error("Task cancel requires a run id.");
			printResponse(await sendIpcRequest({ type: "task_cancel", runId: taskId }));
			return;
		}
		if (action === "runs") {
			printResponse(await sendIpcRequest({ type: "task_runs", taskId }));
			return;
		}
		if (!taskId) throw new Error(`Task ${action ?? "command"} requires a task id.`);
		if (action === "run") printResponse(await sendIpcRequest({ type: "task_run", taskId }));
		else if (action === "pause" || action === "resume")
			printResponse(await sendIpcRequest({ type: "task_pause", taskId, paused: action === "pause" }));
		else if (action === "delete") printResponse(await sendIpcRequest({ type: "task_delete", taskId }));
		else throw new Error(`Unknown task command: ${action ?? ""}`);
		return;
	}

	if (args[0] === "status") {
		const instanceId = args[1];
		if (!instanceId) {
			console.error("Usage: orchestrator status <instance-id>");
			process.exit(1);
		}
		printResponse(await sendIpcRequest({ type: "status", instanceId }));
		return;
	}

	if (args[0] === "stop") {
		const instanceId = args[1];
		if (!instanceId) {
			console.error("Usage: orchestrator stop <instance-id>");
			process.exit(1);
		}
		printResponse(await sendIpcRequest({ type: "stop", instanceId }));
		return;
	}

	if (args[0] === "rpc") {
		const instanceId = args[1];
		const commandJson = args[2];
		if (!instanceId || !commandJson) {
			console.error("Usage: orchestrator rpc <instance-id> <json-command>");
			process.exit(1);
		}
		printResponse(
			await sendIpcRequest({
				type: "rpc",
				instanceId,
				command: JSON.parse(commandJson),
			}),
		);
		return;
	}

	if (args[0] === "rpc-stream") {
		const instanceId = args[1];
		if (!instanceId) {
			console.error("Usage: orchestrator rpc-stream <instance-id>");
			process.exit(1);
		}
		await rpcStream(instanceId);
		return;
	}

	console.error(`Unknown command: ${args[0]}`);
	printHelp();
	process.exit(1);
}

await main();
