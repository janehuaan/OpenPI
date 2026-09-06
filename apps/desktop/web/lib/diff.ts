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
