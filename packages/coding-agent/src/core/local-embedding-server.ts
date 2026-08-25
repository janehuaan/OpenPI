/**
 * Local Qwen embedding server management (built-in).
 *
 * Spawns a llama.cpp `llama-server` (OpenAI-compatible /v1/embeddings) on the
 * local machine. The binary and Qwen3-Embedding-0.6B GGUF model come from
 * explicit environment variables or the desktop bundle. One server is kept
 * alive per process; callers decide whether unavailable service is fatal.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export const DEFAULT_LOCAL_EMBEDDING_PORT = 18080;

export function localEmbeddingPort(env: NodeJS.ProcessEnv = process.env): number {
	const parsed = Number.parseInt(env.OPENPI_EMBEDDING_PORT ?? "", 10);
	return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : DEFAULT_LOCAL_EMBEDDING_PORT;
}

export function localEmbeddingBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
	return `http://127.0.0.1:${localEmbeddingPort(env)}/v1`;
}

let serverProcess: ChildProcess | undefined;
let starting: Promise<boolean> | undefined;

function resolveBundlePaths(env: NodeJS.ProcessEnv): { bin: string; model: string } | undefined {
	const bin = env.OPENPI_EMBEDDING_BIN;
	const model = env.OPENPI_EMBEDDING_MODEL_FILE;
	if (bin && model && existsSync(bin) && existsSync(model)) return { bin, model };

	const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
	for (const base of [resourcesPath, join(process.cwd(), "Resources"), join(process.cwd(), "embedding")]) {
		const candidate = base ? join(base, "embedding") : base;
		const candidateBin = candidate ? join(candidate, "llama-server") : undefined;
		const candidateModel = candidate ? join(candidate, "qwen3-embedding-0.6b-q8_0.gguf") : undefined;
		if (candidateBin && candidateModel && existsSync(candidateBin) && existsSync(candidateModel)) {
			return { bin: candidateBin, model: candidateModel };
		}
	}
	return undefined;
}

async function serverReady(timeoutMs: number, env: NodeJS.ProcessEnv): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	const baseUrl = localEmbeddingBaseUrl(env);
	while (Date.now() < deadline) {
		try {
			const response = await fetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(1500) });
			if (response.ok) return true;
		} catch {
			// Not up yet.
		}
		await new Promise((resolve) => setTimeout(resolve, 300));
	}
	return false;
}

/** True when a bundled local Qwen embedding server is available. */
export function localEmbeddingAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
	return resolveBundlePaths(env) !== undefined;
}

/**
 * Spawn Qwen3-Embedding through llama-server when bundled resources exist.
 * `OPENPI_EMBEDDING_LOCAL=0` disables automatic startup explicitly.
 */
export function ensureLocalEmbeddingServer(env: NodeJS.ProcessEnv = process.env): Promise<boolean> | undefined {
	if (env.OPENPI_EMBEDDING_LOCAL === "0") return undefined;
	if (!localEmbeddingAvailable(env) && env.OPENPI_EMBEDDING_LOCAL === undefined) return undefined;
	if (serverProcess) return Promise.resolve(true);
	if (starting) return starting;
	const paths = resolveBundlePaths(env);
	if (!paths) return undefined;
	starting = (async () => {
		try {
			const probe = await fetch(`${localEmbeddingBaseUrl(env)}/models`, { signal: AbortSignal.timeout(800) });
			if (probe.ok) return true;
		} catch {
			// Not running — spawn it.
		}
		try {
			serverProcess = spawn(
				paths.bin,
				[
					"-m",
					paths.model,
					"--embedding",
					"--pooling",
					"last",
					"--port",
					String(localEmbeddingPort(env)),
					"-c",
					"32768",
					"--host",
					"127.0.0.1",
				],
				{ stdio: "ignore" },
			);
			serverProcess.on("exit", () => {
				serverProcess = undefined;
			});
			return await serverReady(30_000, env);
		} catch {
			return false;
		} finally {
			starting = undefined;
		}
	})();
	return starting;
}
