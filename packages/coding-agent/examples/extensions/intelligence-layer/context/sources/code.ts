import * as fs from "node:fs";
import * as path from "node:path";
import type { ContextCandidate } from "../../contract.ts";
import { createCandidate, isExcluded, queryTerms } from "../utils.ts";

const textExtensions = new Set([
	".ts",
	".tsx",
	".js",
	".jsx",
	".json",
	".md",
	".vue",
	".py",
	".go",
	".rs",
	".java",
	".css",
	".html",
	".yaml",
	".yml",
]);

export function collectCodeCandidates(
	cwd: string,
	query: string,
	exclusions: string[],
	limit = 40,
): ContextCandidate[] {
	const terms = queryTerms(query);
	if (terms.length === 0) return [];
	const candidates: ContextCandidate[] = [];
	const visit = (directory: string) => {
		if (candidates.length >= limit) return;
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(directory, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (candidates.length >= limit) break;
			const absolute = path.join(directory, entry.name);
			const relative = path.relative(cwd, absolute);
			if (isExcluded(relative, exclusions)) continue;
			if (entry.isDirectory()) {
				visit(absolute);
				continue;
			}
			if (!entry.isFile() || !textExtensions.has(path.extname(entry.name).toLowerCase())) continue;
			let stat: fs.Stats;
			try {
				stat = fs.statSync(absolute);
			} catch {
				continue;
			}
			if (stat.size > 256_000) continue;
			let content: string;
			try {
				content = fs.readFileSync(absolute, "utf8");
			} catch {
				continue;
			}
			const searchable = `${relative}\n${content}`.toLowerCase();
			const matched = terms.filter((term) => searchable.includes(term));
			if (matched.length === 0) continue;
			candidates.push(
				createCandidate("code", relative, relative, content, "code", {
					attention: terms.some((term) => relative.toLowerCase().includes(term)),
					recency: Math.max(0, 1 - (Date.now() - stat.mtimeMs) / 2_592_000_000),
				}),
			);
		}
	};
	visit(cwd);
	return candidates;
}
