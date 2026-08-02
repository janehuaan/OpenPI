/**
 * Shared Pi subprocess spawn helper for sub-agents / delegated work.
 * Used by intelligence-layer; available for other first-party packages.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import * as path from "node:path";

export interface SpawnPiOptions {
	cwd: string;
	prompt: string;
	/** Explicit pi CLI entry. Defaults to process.argv[1] then common monorepo paths. */
	piEntry?: string;
	provider?: string;
	model?: string;
	tools?: string[];
	/** Default true for isolated workers. */
	noSession?: boolean;
	env?: NodeJS.ProcessEnv;
	timeoutMs?: number;
	onStdout?: (chunk: string) => void;
	onStderr?: (chunk: string) => void;
}

export interface SpawnPiHandle {
	pid?: number;
	child: ChildProcess;
	completion: Promise<{ exitCode: number; stdout: string; stderr: string }>;
	cancel(): void;
}

export function resolvePiEntry(explicit?: string): string {
	if (explicit && existsSync(explicit)) return path.resolve(explicit);
	if (process.env.PI_CLI_PATH && existsSync(process.env.PI_CLI_PATH)) {
		return path.resolve(process.env.PI_CLI_PATH);
	}
	if (process.argv[1] && existsSync(process.argv[1])) return path.resolve(process.argv[1]);
	const candidates = [
		path.resolve(process.cwd(), "packages/coding-agent/dist/cli.js"),
		path.resolve(process.cwd(), "node_modules/@earendil-works/pi-coding-agent/dist/cli.js"),
	];
	const found = candidates.find(existsSync);
	if (!found) throw new Error("Cannot resolve pi CLI entry. Set PI_CLI_PATH.");
	return found;
}

export function spawnPiPrint(options: SpawnPiOptions): SpawnPiHandle {
	const entry = resolvePiEntry(options.piEntry);
	const args = [entry];
	if (options.noSession !== false) args.push("--no-session");
	if (options.provider) args.push("--provider", options.provider);
	if (options.model) args.push("--model", options.model);
	if (options.tools && options.tools.length > 0) args.push("--tools", options.tools.join(","));
	args.push("--print", options.prompt);

	const child = spawn(process.execPath, args, {
		cwd: options.cwd,
		env: { ...process.env, ...options.env },
		stdio: ["ignore", "pipe", "pipe"],
	});

	const stdout: Buffer[] = [];
	const stderr: Buffer[] = [];
	child.stdout?.on("data", (chunk: Buffer) => {
		stdout.push(chunk);
		options.onStdout?.(chunk.toString("utf8"));
	});
	child.stderr?.on("data", (chunk: Buffer) => {
		stderr.push(chunk);
		options.onStderr?.(chunk.toString("utf8"));
	});

	let timeout: NodeJS.Timeout | undefined;
	const completion = new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolve, reject) => {
		if (options.timeoutMs && options.timeoutMs > 0) {
			timeout = setTimeout(() => {
				try {
					child.kill("SIGTERM");
				} catch {
					// ignore
				}
			}, options.timeoutMs);
			timeout.unref?.();
		}
		child.once("error", (error) => {
			if (timeout) clearTimeout(timeout);
			reject(error);
		});
		child.once("close", (code) => {
			if (timeout) clearTimeout(timeout);
			resolve({
				exitCode: code ?? 1,
				stdout: Buffer.concat(stdout).toString("utf8").trim(),
				stderr: Buffer.concat(stderr).toString("utf8").trim(),
			});
		});
	});

	return {
		pid: child.pid,
		child,
		completion,
		cancel: () => {
			try {
				child.kill("SIGTERM");
			} catch {
				// ignore
			}
		},
	};
}
