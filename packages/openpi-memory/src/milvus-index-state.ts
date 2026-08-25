import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const MILVUS_INDEX_STATE_FILE = "milvus-index-state.json";
export interface MilvusIndexState {
	version: 1;
	model: string;
	dim: number;
	collection: string;
	records: Record<string, string>;
}
export function milvusIndexStatePath(memoryDirectory: string): string {
	return join(memoryDirectory, MILVUS_INDEX_STATE_FILE);
}
export function contentHash(text: string): string {
	return createHash("sha256").update(text, "utf8").digest("hex");
}
export function loadMilvusIndexState(
	file: string,
	expected: Pick<MilvusIndexState, "model" | "dim" | "collection">,
): MilvusIndexState {
	try {
		const state = JSON.parse(readFileSync(file, "utf8")) as Partial<MilvusIndexState>;
		if (
			state.version === 1 &&
			state.model === expected.model &&
			state.dim === expected.dim &&
			state.collection === expected.collection &&
			state.records &&
			typeof state.records === "object"
		)
			return { version: 1, ...expected, records: state.records };
	} catch {
		/* missing, incompatible, or corrupt state is rebuilt */
	}
	return { version: 1, ...expected, records: {} };
}
export function writeMilvusIndexState(file: string, state: MilvusIndexState): void {
	mkdirSync(dirname(file), { recursive: true });
	const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(state)}\n`, "utf8");
	renameSync(tmp, file);
}
