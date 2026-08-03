import type { MemoryConfig, MemoryIndexEntry, MemoryType } from "./types.ts";

/**
 * Build the per-turn inject set (proactive cross-session recall):
 * 1. Always pin user/feedback (or config.pinTypes)
 * 2. Prefer recent session-* digests when present
 * 3. Fill the rest in a stable order (type + key) so the injected prefix is
 *    byte-stable across turns — relevance ranking per prompt would break the
 *    provider prompt cache and lose earlier context in long sessions
 * 4. Cap at maxSnapshotEntries
 */
export function selectSnapshotEntries(
	entries: MemoryIndexEntry[],
	_prompt: string | undefined,
	config: MemoryConfig,
	_bodyResolver?: (entry: MemoryIndexEntry) => string,
	_memoryDirectory?: string,
): MemoryIndexEntry[] {
	if (entries.length === 0) return [];
	const pinSet = new Set<MemoryType>(config.pinTypes);
	const pinned = entries.filter((e) => pinSet.has(e.type));
	const digests = entries.filter((e) => e.type === "project" && e.key.startsWith("session-")).slice(-3);
	const rest = entries.filter((e) => !pinSet.has(e.type) && !(e.type === "project" && e.key.startsWith("session-")));
	const max = Math.max(config.pinTypes.length + 2, config.maxSnapshotEntries);

	const selected: MemoryIndexEntry[] = [];
	const seen = new Set<string>();
	const push = (entry: MemoryIndexEntry) => {
		const id = `${entry.type}:${entry.key}`;
		if (seen.has(id)) return;
		if (selected.length >= max) return;
		seen.add(id);
		selected.push(entry);
	};

	for (const entry of pinned) push(entry);
	// Newest session digests first (cross-chat “what we were doing”)
	for (const entry of [...digests].reverse()) push(entry);

	// Continuity questions are answered from the pinned digests above;
	// everything else uses a stable ordering (type + key) so the injected
	// prefix is byte-stable across turns — unstable relevance ranking breaks
	// the provider prompt cache and makes long sessions lose earlier context.
	if (selected.length < max) {
		const ordered = [...rest].sort((a, b) => {
			const byType = a.type.localeCompare(b.type);
			return byType !== 0 ? byType : a.key.localeCompare(b.key);
		});
		for (const entry of ordered) push(entry);
	}

	return selected;
}

/**
 * Format inject text. Session digests and continuity prompts include topic body
 * (not just the one-line index value) so the model can actually answer “上次聊到哪”.
 */
export function formatSelectiveSnapshot(
	selected: MemoryIndexEntry[],
	totalAvailable: number,
	prompt?: string,
	bodyResolver?: (entry: MemoryIndexEntry) => string,
): string {
	if (selected.length === 0) {
		return "No long-term memories loaded for this session.";
	}
	const continuity =
		Boolean(prompt?.trim()) &&
		/上次|上次聊|聊到哪|上次到哪|where did we leave|what were we|continue from|接着|继续上次|上次进度/i.test(
			prompt ?? "",
		);

	const lines = [
		"## Long-term memory (auto-loaded — use proactively)",
		"",
		"These notes come from prior conversations on this machine.",
		"Apply them without asking the user to restate preferences or past decisions.",
		"Do not claim ignorance of items listed below.",
		"When the user asks where you left off, answer from session digests and project notes below with concrete names/facts.",
		"Do not store information derivable from git/codebase.",
		`Showing ${selected.length} of ${totalAvailable} index entries.`,
		"",
	];

	const byType = new Map<string, MemoryIndexEntry[]>();
	for (const entry of selected) {
		const list = byType.get(entry.type) ?? [];
		list.push(entry);
		byType.set(entry.type, list);
	}

	for (const type of ["user", "feedback", "project", "lesson"]) {
		const list = byType.get(type);
		if (!list?.length) continue;
		lines.push(`## ${type}`);
		for (const entry of list) {
			const isDigest = entry.key.startsWith("session-");
			lines.push(`- [${entry.key}] ${entry.value.replace(/\n/g, " ").slice(0, 160)}`);
			const rawBody = bodyResolver?.(entry)?.trim();
			if (!rawBody) continue;
			// Always expand digests; expand others when user asks for continuity or body is short
			const shouldExpand = isDigest || continuity || (type === "project" && rawBody.length <= 1200);
			if (!shouldExpand) continue;
			const cleaned = stripTopicBoilerplate(rawBody).slice(0, isDigest || continuity ? 2500 : 600);
			if (cleaned.length < 8) continue;
			for (const bl of cleaned.split("\n")) {
				if (bl.trim()) lines.push(`  ${bl}`);
			}
		}
		lines.push("");
	}
	return lines.join("\n").trim();
}

function stripTopicBoilerplate(body: string): string {
	return body
		.split("\n")
		.filter((line) => {
			const t = line.trim();
			if (!t) return true;
			if (/^#\s+\w+\s*\/\s*/.test(t)) return false;
			if (/^Last updated:/i.test(t)) return false;
			return true;
		})
		.join("\n")
		.trim();
}
