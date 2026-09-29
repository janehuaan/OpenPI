export interface DiffLine {
	type: "add" | "del" | "hunk" | "header" | "ctx";
	content: string;
	oldLineNo?: number;
	newLineNo?: number;
}

export function isDiffContent(text: string): boolean {
	if (!text || typeof text !== "string") return false;
	const lines = text.trim().split("\n");
	if (lines.length < 2) return false;
	let addCount = 0;
	let delCount = 0;
	let hasHunk = false;
	let hasDiffHeader = false;

	for (const line of lines) {
		if (line.startsWith("diff --git") || line.startsWith("--- a/") || line.startsWith("+++ b/")) hasDiffHeader = true;
		else if (line.startsWith("@@") && line.includes("@@")) hasHunk = true;
		else if (line.startsWith("+") && !line.startsWith("+++")) addCount++;
		else if (line.startsWith("-") && !line.startsWith("---")) delCount++;
	}

	return hasDiffHeader || hasHunk || (addCount > 0 && delCount > 0) || addCount >= 3 || delCount >= 3;
}

export function parseDiffLines(rawText: string): { lines: DiffLine[]; adds: number; dels: number } {
	const rawLines = rawText.split("\n");
	const lines: DiffLine[] = [];
	let adds = 0;
	let dels = 0;

	let oldCur = 1;
	let newCur = 1;

	for (const raw of rawLines) {
		if (raw.startsWith("@@") && raw.includes("@@")) {
			// e.g. @@ -12,4 +12,6 @@
			const match = raw.match(/@@\s*-(\d+)(?:,\d+)?\s*\+(\d+)(?:,\d+)?\s*@@/);
			if (match && match[1] && match[2]) {
				oldCur = parseInt(match[1], 10);
				newCur = parseInt(match[2], 10);
			}
			lines.push({ type: "hunk", content: raw });
		} else if (raw.startsWith("---") || raw.startsWith("+++") || raw.startsWith("diff --git") || raw.startsWith("index ")) {
			lines.push({ type: "header", content: raw });
		} else if (raw.startsWith("+") && !raw.startsWith("+++")) {
			adds++;
			lines.push({
				type: "add",
				content: raw.slice(1),
				newLineNo: newCur++,
			});
		} else if (raw.startsWith("-") && !raw.startsWith("---")) {
			dels++;
			lines.push({
				type: "del",
				content: raw.slice(1),
				oldLineNo: oldCur++,
			});
		} else {
			const content = raw.startsWith(" ") ? raw.slice(1) : raw;
			lines.push({
				type: "ctx",
				content,
				oldLineNo: oldCur++,
				newLineNo: newCur++,
			});
		}
	}

	return { lines, adds, dels };
}

export type HunkStatus = "pending" | "accepted" | "rejected";

export interface DiffHunk {
	id: string;
	header: string;
	oldStart: number;
	oldCount: number;
	newStart: number;
	newCount: number;
	lines: DiffLine[];
	adds: number;
	dels: number;
	status: HunkStatus;
	editedLines?: string[];
}

export interface ParsedDiff {
	headers: string[];
	hunks: DiffHunk[];
	totalAdds: number;
	totalDels: number;
}

export function parseDiffHunks(rawText: string): ParsedDiff {
	const rawLines = rawText.split("\n");
	const headers: string[] = [];
	const hunks: DiffHunk[] = [];
	let currentHunk: DiffHunk | null = null;
	let totalAdds = 0;
	let totalDels = 0;
	let hunkCounter = 0;

	let oldCur = 1;
	let newCur = 1;

	for (const raw of rawLines) {
		if (raw.startsWith("@@") && raw.includes("@@")) {
			if (currentHunk) {
				hunks.push(currentHunk);
			}
			hunkCounter++;
			const match = raw.match(/@@\s*-(\d+)(?:,(\d+))?\s*\+(\d+)(?:,(\d+))?\s*@@/);
			const oldStart = match?.[1] ? parseInt(match[1], 10) : 1;
			const oldCount = match?.[2] ? parseInt(match[2], 10) : 1;
			const newStart = match?.[3] ? parseInt(match[3], 10) : 1;
			const newCount = match?.[4] ? parseInt(match[4], 10) : 1;

			oldCur = oldStart;
			newCur = newStart;

			currentHunk = {
				id: `hunk-${hunkCounter}-${oldStart}-${newStart}`,
				header: raw,
				oldStart,
				oldCount,
				newStart,
				newCount,
				lines: [{ type: "hunk", content: raw }],
				adds: 0,
				dels: 0,
				status: "pending",
			};
		} else if (!currentHunk && (raw.startsWith("---") || raw.startsWith("+++") || raw.startsWith("diff --git") || raw.startsWith("index "))) {
			headers.push(raw);
		} else {
			if (!currentHunk) {
				// Naive diff without @@ line - create synthetic first hunk
				hunkCounter++;
				currentHunk = {
					id: `hunk-${hunkCounter}-1-1`,
					header: "@@ -1,1 +1,1 @@",
					oldStart: 1,
					oldCount: 1,
					newStart: 1,
					newCount: 1,
					lines: [],
					adds: 0,
					dels: 0,
					status: "pending",
				};
			}

			if (raw.startsWith("+") && !raw.startsWith("+++")) {
				totalAdds++;
				currentHunk.adds++;
				currentHunk.lines.push({
					type: "add",
					content: raw.slice(1),
					newLineNo: newCur++,
				});
			} else if (raw.startsWith("-") && !raw.startsWith("---")) {
				totalDels++;
				currentHunk.dels++;
				currentHunk.lines.push({
					type: "del",
					content: raw.slice(1),
					oldLineNo: oldCur++,
				});
			} else {
				const content = raw.startsWith(" ") ? raw.slice(1) : raw;
				currentHunk.lines.push({
					type: "ctx",
					content,
					oldLineNo: oldCur++,
					newLineNo: newCur++,
				});
			}
		}
	}

	if (currentHunk) {
		hunks.push(currentHunk);
	}

	return { headers, hunks, totalAdds, totalDels };
}

/**
 * Surgically applies only accepted hunks to the original file source.
 * Rejected hunks are discarded (original lines kept).
 * Applying bottom-up prevents line index drift across multiple hunks.
 */
export function applyHunksToSource(
	sourceText: string,
	hunks: DiffHunk[],
): { result: string; appliedCount: number; rejectedCount: number } {
	const lines = sourceText.split("\n");
	let appliedCount = 0;
	let rejectedCount = 0;

	// Sort hunks bottom-to-top by oldStart so replacements don't shift earlier line indices
	const sortedHunks = [...hunks].sort((a, b) => b.oldStart - a.oldStart);

	for (const hunk of sortedHunks) {
		if (hunk.status === "rejected") {
			rejectedCount++;
			continue;
		}

		appliedCount++;
		// Extract expected original lines (del + ctx) from hunk
		const originalExpected: string[] = [];
		const replacementLines: string[] = [];

		if (hunk.editedLines && hunk.editedLines.length > 0) {
			replacementLines.push(...hunk.editedLines);
		} else {
			for (const line of hunk.lines) {
				if (line.type === "ctx") {
					originalExpected.push(line.content);
					replacementLines.push(line.content);
				} else if (line.type === "del") {
					originalExpected.push(line.content);
				} else if (line.type === "add") {
					replacementLines.push(line.content);
				}
			}
		}

		// Find best target index around hunk.oldStart (1-based)
		let targetIdx = Math.max(0, hunk.oldStart - 1);

		// Fuzzy match if line numbers drifted slightly (+/- 15 lines)
		if (originalExpected.length > 0 && targetIdx < lines.length) {
			const expectedFirst = originalExpected[0];
			if (lines[targetIdx] !== expectedFirst) {
				const searchRadius = 15;
				let bestDist = Infinity;
				let foundIdx = -1;

				for (let offset = -searchRadius; offset <= searchRadius; offset++) {
					const testIdx = targetIdx + offset;
					if (testIdx >= 0 && testIdx < lines.length && lines[testIdx] === expectedFirst) {
						if (Math.abs(offset) < bestDist) {
							bestDist = Math.abs(offset);
							foundIdx = testIdx;
						}
					}
				}
				if (foundIdx !== -1) {
					targetIdx = foundIdx;
				}
			}
		}

		const deleteCount = originalExpected.length;
		lines.splice(targetIdx, deleteCount, ...replacementLines);
	}

	return {
		result: lines.join("\n"),
		appliedCount,
		rejectedCount,
	};
}

export interface SideBySideCell {
	type: "ctx" | "add" | "del" | "empty";
	content?: string;
	lineNo?: number;
}

export interface SideBySideRow {
	left: SideBySideCell;
	right: SideBySideCell;
}

/**
 * Builds aligned Side-by-Side rows for a given diff hunk.
 * Synchronizes context lines across left and right columns,
 * and groups consecutive deletion and addition clusters with empty cell padding.
 */
export function buildSideBySideRows(hunk: DiffHunk): SideBySideRow[] {
	const rows: SideBySideRow[] = [];
	const lines = hunk.lines.filter((l) => l.type !== "hunk" && l.type !== "header");

	let i = 0;
	while (i < lines.length) {
		const current = lines[i];
		if (current.type === "ctx") {
			rows.push({
				left: { type: "ctx", content: current.content, lineNo: current.oldLineNo },
				right: { type: "ctx", content: current.content, lineNo: current.newLineNo },
			});
			i++;
		} else {
			// Change cluster: collect consecutive deletions and additions
			const dels: DiffLine[] = [];
			const adds: DiffLine[] = [];
			while (i < lines.length && (lines[i].type === "del" || lines[i].type === "add")) {
				if (lines[i].type === "del") {
					dels.push(lines[i]);
				} else {
					adds.push(lines[i]);
				}
				i++;
			}

			const maxCount = Math.max(dels.length, adds.length);
			for (let k = 0; k < maxCount; k++) {
				const delLine = dels[k];
				const addLine = adds[k];
				rows.push({
					left: delLine
						? { type: "del", content: delLine.content, lineNo: delLine.oldLineNo }
						: { type: "empty" },
					right: addLine
						? { type: "add", content: addLine.content, lineNo: addLine.newLineNo }
						: { type: "empty" },
				});
			}
		}
	}

	return rows;
}

