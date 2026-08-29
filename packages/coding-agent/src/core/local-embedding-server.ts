/**
 * Local embedding server management (built-in).
 *
 * Spawns a llama.cpp `llama-server` (OpenAI-compatible /v1/embeddings) on the
 * local machine so embedding quality doesn't depend on a remote API key.
 * Enabled with `OPENPI_EMBEDDING_LOCAL=1`; the server binary and GGUF model
 * come from `OPENPI_EMBEDDING_BIN` / `OPENPI_EMBEDDING_MODEL_FILE`, or from
 * the desktop bundle's Resources/embedding directory. The server is spawned
 * once per process and kept alive; failures degrade silently.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export const LOCAL_EMBEDDING_PORT = 18080;
export const LOCAL_EMBEDDING_BASE_URL = `http://127.0.0.1:${LOCAL_EMBEDDING_PORT}/v1`;

let serverProcess: ChildProcess | undefined;
let starting: Promise<boolean> | undefined;

function resolveBundlePaths(env: NodeJS.ProcessEnv): { bin: string; model: string } | undefined {
	const bin = env.OPENPI_EMBEDDING_BIN;
	const model = env.OPENPI_EMBEDDING_MODEL_FILE;
	if (bin && model && existsSync(bin) && existsSync(model)) return { bin, model };
	// Desktop bundle: <app>/Contents/Resources/embedding/{llama-server, bge-small-zh-q8_0.gguf}
	const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
	for (const base of [resourcesPath, join(process.cwd(), "Resources"), join(process.cwd(), "embedding")]) {
		const candidate = base ? join(base, "embedding") : base;
		const candidateBin = candidate ? join(candidate, "llama-server") : undefined;
		const candidateModel = candidate ? join(candidate, "bge-small-zh-q8_0.gguf") : undefined;
		if (candidateBin && candidateModel && existsSync(candidateBin) && existsSync(candidateModel)) {
			return { bin: candidateBin, model: candidateModel };
		}
	}
	return undefined;
}

async function serverReady(timeoutMs: number): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			const response = await fetch(`${LOCAL_EMBEDDING_BASE_URL}/models`, { signal: AbortSignal.timeout(1500) });
			if (response.ok) return true;
		} catch {
			// Not up yet.
		}
		await new Promise((resolve) => setTimeout(resolve, 300));
	}
	return false;
}

/** True when a bundled local embedding server (binary + model) is available. */
export function localEmbeddingAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
	return resolveBundlePaths(env) !== undefined;
}

/**
 * Spawn the local llama-server when bundled resources exist (built-in) —
 * `OPENPI_EMBEDDING_LOCAL=0` disables it explicitly.
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
			const probe = await fetch(`${LOCAL_EMBEDDING_BASE_URL}/models`, { signal: AbortSignal.timeout(800) });
			if (probe.ok) return true; // Already running (e.g. started externally).
		} catch {
			// Not running — spawn it.
		}
		try {
			serverProcess = spawn(
				paths.bin,
				[
					"-m",
					paths.model,
					"--embeddings",
					"--port",
					String(LOCAL_EMBEDDING_PORT),
					"-c",
					"512",
					"--host",
					"127.0.0.1",
				],
				{ stdio: "ignore" },
			);
			serverProcess.on("exit", () => {
				serverProcess = undefined;
			});
			return await serverReady(30_000);
		} catch {
			return false;
		} finally {
			starting = undefined;
		}
	})();
	return starting;
}
