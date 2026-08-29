/**
 * Hybrid search using Rust binary (pi-memsearch) as backend.
 * Falls back to TypeScript implementation if binary not found.
 */
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { MemoryIndexEntry } from "./types.ts";
import type { HybridHit } from "./vectors.ts";
import { hybridSearch as hybridSearchTs } from "./vectors.ts";

const RUST_BIN_PATHS = [
	join(new URL("../../pi-memsearch/target/release/pi-memsearch", import.meta.url).pathname),
	join(new URL("../pi-memsearch/target/release/pi-memsearch", import.meta.url).pathname),
	"/usr/local/bin/pi-memsearch",
];

function findRustBin(): string | null {
	for (const p of RUST_BIN_PATHS) {
		if (existsSync(p)) return p;
	}
	return null;
}

const RUST_BIN = findRustBin();

export interface RustSearchOptions {
	limit?: number;
	alpha?: number;
	bodyResolver?: (entry: MemoryIndexEntry) => string;
}

/**
 * Hybrid search using Rust binary if available, falls back to TS.
 */
export function hybridSearchRust(
	entries: MemoryIndexEntry[],
	query: string,
	memoryDirectory: string | undefined,
	options?: RustSearchOptions,
): HybridHit[] {
	if (!RUST_BIN) {
		// Fall back to TypeScript implementation
		return hybridSearchTs(entries, query, memoryDirectory, options);
	}

	const limit = options?.limit ?? 50;
	const alpha = options?.alpha ?? 0.55;

	// Build docs array for Rust binary
	const docs = entries.map((e) => ({
		id: `${e.type}:${e.key}`,
		type: e.type,
		key: e.key,
		value: e.value,
		body: options?.bodyResolver?.(e) ?? "",
	}));

	const input = JSON.stringify({ docs, query, limit, alpha });

	try {
		const output = execSync(`echo '${input.replace(/'/g, "'\\''")}' | ${RUST_BIN}`, {
			encoding: "utf8",
			timeout: 30_000,
		});
		const result = JSON.parse(output) as {
			hits: Array<{ id: string; score: number; vector_score: number; bm25_score: number }>;
		};

		// Build entry map for lookup
		const entryMap = new Map(entries.map((e) => [`${e.type}:${e.key}`, e]));
		return result.hits.map((h) => {
			const entry = entryMap.get(h.id);
			return {
				id: h.id,
				score: h.score,
				vectorScore: h.vector_score,
				bm25Score: h.bm25_score,
				entry: entry ?? { type: h.id.split(":")[0] ?? "", key: h.id.split(":")[1] ?? "", value: "" },
			};
		}) as HybridHit[];
	} catch {
		// Fall back to TypeScript
		return hybridSearchTs(entries, query, memoryDirectory, options);
	}
}

export { findRustBin };
