import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { ensureChatInstance, promptInstance, type UiResponder } from "./rpc-session.ts";

export interface PromptResult {
	exitCode: number;
	stdout: string;
	stderr: string;
	instanceId?: string;
	mode: "rpc" | "print";
}

function resolvePiEntry(configured?: string): string {
	if (configured && existsSync(configured)) return resolve(configured);
	const candidates = [
		resolve(process.cwd(), "packages/coding-agent/dist/cli.js"),
		resolve(process.cwd(), "node_modules/@earendil-works/pi-coding-agent/dist/cli.js"),
	];
	const found = candidates.find(existsSync);
	if (!found) throw new Error("Cannot resolve pi CLI. Set PI_CLI_PATH.");
	return found;
}

export async function runRpcPrompt(options: {
	prompt: string;
	cwd: string;
	chatId: string;
	label?: string;
	timeoutMs?: number;
	uiResponder?: UiResponder;
	onPartialText?: (delta: string) => void;
}): Promise<PromptResult> {
	try {
		const instanceId = await ensureChatInstance({
			chatId: options.chatId,
			cwd: options.cwd,
			label: options.label,
		});
		const text = await promptInstance({
			instanceId,
			message: options.prompt,
			timeoutMs: options.timeoutMs,
			uiResponder: options.uiResponder,
			onPartialText: options.onPartialText,
		});
		return { exitCode: 0, stdout: text, stderr: "", instanceId, mode: "rpc" };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { exitCode: 1, stdout: "", stderr: message, mode: "rpc" };
	}
}

export function runPrintPrompt(options: {
	prompt: string;
	cwd: string;
	piCliPath?: string;
	provider?: string;
	model?: string;
}): Promise<PromptResult> {
	const entry = resolvePiEntry(options.piCliPath);
	const args = [entry];
	if (options.provider) args.push("--provider", options.provider);
	if (options.model) args.push("--model", options.model);
	args.push("--print", options.prompt);
	return new Promise((resolveResult, reject) => {
		const child = spawn(process.execPath, args, {
			cwd: options.cwd,
			env: process.env,
			stdio: ["ignore", "pipe", "pipe"],
		});
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
		child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
		child.once("error", reject);
		child.once("close", (code) => {
			resolveResult({
				exitCode: code ?? 1,
				stdout: Buffer.concat(stdout).toString("utf8").trim(),
				stderr: Buffer.concat(stderr).toString("utf8").trim(),
				mode: "print",
			});
		});
	});
}
