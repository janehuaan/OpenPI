/**
 * Hybrid search using Rust binary (pi-memsearch) as backend.
 * Uses persistent server mode for maximum performance.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import { join } from "node:path";
import type { MemoryIndexEntry } from "./types.ts";
import type { HybridHit } from "./vectors.ts";
import { hybridSearch as hybridSearchTs } from "./vectors.ts";

const RUST_BIN_PATHS = [
	join(import.meta.dirname ?? ".", "../../../pi-memsearch/target/release/pi-memsearch"),
	join(import.meta.dirname ?? ".", "../pi-memsearch/target/release/pi-memsearch"),
	"/usr/local/bin/pi-memsearch",
];

function findRustBin(): string | null {
	for (const p of RUST_BIN_PATHS) {
		if (existsSync(p)) return p;
	}
	return null;
}

const RUST_BIN = findRustBin();

// Server state
let serverProcess: ChildProcess | null = null;
const serverPort = 8767;
let isServerRunning = false;

interface ServerQuery {
	query: string;
	limit?: number;
	alpha?: number;
}

interface ServerResponse {
	hits: Array<{ id: string; score: number; vector_score: number; bm25_score: number }>;
	elapsed_ms: number;
	hit_count: number;
}

/**
 * Send query to Rust server and receive response.
 */
function queryServer(query: ServerQuery): Promise<ServerResponse> {
	return new Promise((resolve, reject) => {
		const client = new net.Socket();
		const timeout = setTimeout(() => {
			client.destroy();
			reject(new Error("Server query timeout"));
		}, 5000);

		client.connect(serverPort, "127.0.0.1", () => {
			client.write(JSON.stringify(query));
		});

		let data = "";
		client.on("data", (chunk) => {
			data += chunk.toString();
		});

		client.on("end", () => {
			clearTimeout(timeout);
			try {
				resolve(JSON.parse(data) as ServerResponse);
			} catch (e) {
				reject(new Error(`Failed to parse server response: ${e}`));
			}
		});

		client.on("error", (e) => {
			clearTimeout(timeout);
			reject(e);
		});
	});
}

/**
 * Start the Rust server if not already running.
 */
async function ensureServer(): Promise<void> {
	if (!RUST_BIN) return;
	if (isServerRunning) return;

	try {
		// Try connecting first
		await queryServer({ query: "test", limit: 1 });
		isServerRunning = true;
		return;
	} catch {
		// Server not running, try to start it
	}

	// Start server process
	serverProcess = spawn(RUST_BIN, ["--server", "--port", String(serverPort)], {
		detached: true,
		stdio: "ignore",
	});

	serverProcess.unref();
	isServerRunning = true;

	// Wait for server to be ready
	await new Promise<void>((resolve) => setTimeout(resolve, 100));
}

export interface RustSearchOptions {
	limit?: number;
	alpha?: number;
	bodyResolver?: (entry: MemoryIndexEntry) => string;
}

/**
 * Hybrid search using Rust server if available, falls back to TS.
 */
export async function hybridSearchRust(
	entries: MemoryIndexEntry[],
	query: string,
	memoryDirectory: string | undefined,
	options?: RustSearchOptions,
): Promise<HybridHit[]> {
	if (!RUST_BIN) {
		return hybridSearchTs(entries, query, memoryDirectory, options);
	}

	try {
		await ensureServer();

		const limit = options?.limit ?? 50;
		const alpha = options?.alpha ?? 0.55;

		const response = await queryServer({ query, limit, alpha });

		// Build entry map for lookup
		const entryMap = new Map(entries.map((e) => [`${e.type}:${e.key}`, e]));
		return response.hits.map((h) => ({
			id: h.id,
			score: h.score,
			vectorScore: h.vector_score,
			bm25Score: h.bm25_score,
			entry: entryMap.get(h.id) ?? {
				type: h.id.split(":")[0] ?? "",
				key: h.id.split(":")[1] ?? "",
				value: "",
			},
		})) as HybridHit[];
	} catch {
		// Fall back to TypeScript
		return hybridSearchTs(entries, query, memoryDirectory, options);
	}
}

export { findRustBin };
