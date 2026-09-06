/**
 * LLM Invocation helper for Stage 1 Extraction & Phase 2 Consolidation.
 *
 * Runs headless model completion using the daemon's configured CLI and credentials,
 * with graceful timeout, structured JSON extraction, and heuristic fallbacks.
 */

import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { agentDir } from "../config.ts";

function resolvePiCliEntry(): string | null {
	const configured = process.env.OPENPI_PI_CLI;
	if (configured && existsSync(configured)) return resolve(configured);

	const here = dirname(fileURLToPath(import.meta.url));
	const entry = "@earendil-works/pi-coding-agent/dist/bundle/cli.js";
	const candidates = [
		join(here, "../../../node_modules", entry),
		join(here, "../node_modules", entry),
		join(process.cwd(), "node_modules", entry),
	];
	return candidates.find(existsSync) ?? null;
}

export interface LlmCompletionOptions {
	timeoutMs?: number;
	model?: string;
	provider?: string;
}

/**
 * Cleanly extracts JSON from an LLM text response, even if surrounded by
 * markdown codeblocks ```json ... ``` or commentary.
 */
export function extractJsonFromResponse<T = unknown>(text: string): T | null {
	const trimmed = text.trim();
	if (!trimmed) return null;

	// Check if wrapped in markdown code fence
	const codeFenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
	const target = codeFenceMatch ? codeFenceMatch[1].trim() : trimmed;

	// Try direct parse
	try {
		return JSON.parse(target) as T;
	} catch {
		// Look for outermost { ... }
		const firstBrace = target.indexOf("{");
		const lastBrace = target.lastIndexOf("}");
		if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
			try {
				const substring = target.slice(firstBrace, lastBrace + 1);
				return JSON.parse(substring) as T;
			} catch {
				// continue to fallback
			}
		}
	}
	return null;
}

/**
 * Executes a headless completion with the specified prompt using the pi CLI.
 */
export async function executePrompt(
	prompt: string,
	options: LlmCompletionOptions = {},
): Promise<string> {
	const cliEntry = resolvePiCliEntry();
	if (!cliEntry) {
		throw new Error("pi CLI bundle not found");
	}

	const timeoutMs = options.timeoutMs ?? 35_000;
	const args = [cliEntry];
	if (options.provider) args.push("--provider", options.provider);
	if (options.model) args.push("--model", options.model);
	args.push("--print", prompt);

	return new Promise<string>((resolvePromise, rejectPromise) => {
		const child = spawn(process.execPath, args, {
			env: {
				...process.env,
				PI_CODING_AGENT_DIR: agentDir(),
			},
			stdio: ["ignore", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";
		let timedOut = false;

		const timer = setTimeout(() => {
			timedOut = true;
			try {
				child.kill("SIGKILL");
			} catch {}
			rejectPromise(new Error(`LLM completion timed out after ${timeoutMs}ms`));
		}, timeoutMs);

		child.stdout?.on("data", (chunk) => {
			stdout += chunk.toString("utf8");
		});

		child.stderr?.on("data", (chunk) => {
			stderr += chunk.toString("utf8");
		});

		child.on("close", (code) => {
			clearTimeout(timer);
			if (timedOut) return;
			if (code === 0) {
				resolvePromise(stdout.trim());
			} else {
				rejectPromise(
					new Error(`pi CLI exited with code ${code}: ${stderr || stdout || "unknown error"}`),
				);
			}
		});

		child.on("error", (err) => {
			clearTimeout(timer);
			if (timedOut) return;
			rejectPromise(err);
		});
	});
}
