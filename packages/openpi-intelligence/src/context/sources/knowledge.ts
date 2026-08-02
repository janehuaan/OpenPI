import * as fs from "node:fs";
import * as path from "node:path";
import type { ContextCandidate } from "../../contract.ts";
import { createCandidate, queryTerms } from "../utils.ts";

interface KnowledgeEntry {
	id: string;
	source: string;
	chunk: string;
	tokens?: number;
}

export function collectKnowledgeCandidates(cwd: string, query: string, limit = 20): ContextCandidate[] {
	const indexPath = path.join(cwd, ".pi", "knowledge-base", "index.json");
	if (!fs.existsSync(indexPath)) return [];
	let entries: KnowledgeEntry[];
	try {
		const parsed: unknown = JSON.parse(fs.readFileSync(indexPath, "utf8"));
		entries =
			parsed && typeof parsed === "object" && "entries" in parsed && Array.isArray(parsed.entries)
				? (parsed.entries as KnowledgeEntry[])
				: [];
	} catch {
		return [];
	}
	const terms = queryTerms(query);
	return entries
		.map((entry) => ({ entry, matches: terms.filter((term) => entry.chunk.toLowerCase().includes(term)).length }))
		.filter(({ matches }) => matches > 0)
		.sort((left, right) => right.matches - left.matches)
		.slice(0, limit)
		.map(({ entry, matches }) =>
			createCandidate("knowledge", `kb:${entry.source}#${entry.id}`, entry.source, entry.chunk, "knowledge", {
				matches,
			}),
		);
}
