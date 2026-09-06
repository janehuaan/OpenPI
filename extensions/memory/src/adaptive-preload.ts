/**
 * Dual-Track Adaptive Preloader for Long-Term Memory
 *
 * Solves the "Weak models fail to use Progressive Disclosure" problem:
 * - L0 (Direct Injection): Pinned user preferences and directives are ALWAYS injected (zero tool calls needed).
 * - L1 (Context Preloading): High-relevance handbook sections are automatically matched against the user prompt
 *   and preloaded into context before model execution.
 * - L2 (Cognitive Index): Compact routing index for deep-diving on demand.
 */

export interface PreloadedSection {
	heading: string;
	lines: string[];
}

/**
 * Extracts pinned user preferences and core directives from MEMORY.md.
 */
export function extractPinnedPreferences(handbookText: string): string[] {
	if (!handbookText) return [];
	const lines = handbookText.split("\n");
	const pinned: string[] = [];
	let inPrefsSection = false;

	for (const rawLine of lines) {
		const trimmed = rawLine.trim();
		if (trimmed.startsWith("## ")) {
			const heading = trimmed.replace(/^##\s+/, "").toLowerCase();
			inPrefsSection =
				heading.includes("preference") ||
				heading.includes("偏好") ||
				heading.includes("habit") ||
				heading.includes("习惯");
			continue;
		}

		if (trimmed.startsWith("- ")) {
			const clean = trimmed.replace(/<!--.*?-->/g, "").trim();
			if (inPrefsSection || trimmed.includes("[pinned]") || trimmed.includes("<!-- pin -->")) {
				if (!pinned.includes(clean)) {
					pinned.push(clean);
				}
			}
		}
	}

	pinned.sort((a, b) => a.localeCompare(b));
	return pinned.slice(0, 6);
}

/**
 * Finds matching handbook sections by analyzing keywords and tokens in user prompt.
 */
export function findMatchingHandbookSections(
	handbookText: string,
	userPrompt: string,
	maxSections = 2,
): PreloadedSection[] {
	if (!handbookText || !userPrompt || userPrompt.trim().length < 2) return [];

	const promptLower = userPrompt.toLowerCase();
	const tokens = new Set<string>();

	// English tokens
	const words = promptLower.match(/[a-z0-9_-]{2,}/g) ?? [];
	for (const w of words) {
		if (!["the", "and", "for", "with", "this", "that", "how", "what", "can", "you"].includes(w)) {
			tokens.add(w);
		}
	}

	// Chinese segments: 2-4 character phrases
	const chineseMatches = promptLower.match(/[\u4e00-\u9fa5]{2,4}/g) ?? [];
	for (const c of chineseMatches) {
		tokens.add(c);
	}

	if (tokens.size === 0) return [];

	// Parse sections
	const lines = handbookText.split("\n");
	const sections: Array<{ heading: string; lines: string[]; score: number }> = [];
	let currentHeading = "";
	let currentLines: string[] = [];

	const flush = () => {
		if (currentHeading && currentLines.length > 0) {
			const lowerHeading = currentHeading.toLowerCase();
			// Skip User Preferences as it is already handled by L0
			if (!lowerHeading.includes("preference") && !lowerHeading.includes("偏好")) {
				let score = 0;
				for (const token of tokens) {
					if (lowerHeading.includes(token)) score += 3;
					for (const line of currentLines) {
						if (line.toLowerCase().includes(token)) score += 1;
					}
				}
				if (score > 0) {
					sections.push({ heading: currentHeading, lines: currentLines, score });
				}
			}
		}
	};

	for (const rawLine of lines) {
		const trimmed = rawLine.trim();
		if (trimmed.startsWith("## ")) {
			flush();
			currentHeading = trimmed.replace(/^##\s+/, "").trim();
			currentLines = [];
		} else if (trimmed.startsWith("- ")) {
			currentLines.push(trimmed);
		}
	}
	flush();

	sections.sort((a, b) => b.score - a.score);

	return sections.slice(0, maxSections).map((s) => ({
		heading: s.heading,
		lines: s.lines.slice(0, 6),
	}));
}

/**
 * Detects whether the user utterance contains a permanent rule or explicit correction.
 */
export function isCorrectionUtterance(prompt: string): boolean {
	if (!prompt) return false;
	return /(\b(permanent|always from now on|never do this|correction|from now on)\b|纠正|以后都|别再|切勿|强制|从现在开始|永远不要|记住这个规则)/i.test(
		prompt,
	);
}

/**
 * Builds the Dual-Track memory injection payload.
 */
export function buildDualTrackMemoryInjection(options: {
	summaryText?: string;
	handbookText?: string;
	userPrompt?: string;
	privacyInstruction?: string;
}): string {
	const parts: string[] = [];

	const pinned = options.handbookText ? extractPinnedPreferences(options.handbookText) : [];
	const matchedSections =
		options.handbookText && options.userPrompt
			? findMatchingHandbookSections(options.handbookText, options.userPrompt)
			: [];

	parts.push("## Long-Term Memory (Dual-Track Progressive Disclosure)");

	// Boundary & Pin Guidance
	if (options.userPrompt && isCorrectionUtterance(options.userPrompt)) {
		parts.push(
			"",
			"> [Directive Promotion Guidance]: The user issued an explicit correction or permanent rule. Promote permanent directives to `MEMORY.md` under `## User Preferences & Habits` (tag with `[pinned]` to stay active in L0 context); save lightweight contextual notes separately.",
		);
	} else {
		parts.push(
			"",
			"> Boundary: Promote permanent rules to `MEMORY.md` (tag with `[pinned]` for L0 permanence); save lightweight preferences to session notes.",
		);
	}

	// L0: Pinned preferences
	if (pinned.length > 0) {
		parts.push(
			"",
			"### Active User Directives & Constraints (L0 Always Injected)",
			...pinned,
		);
	}

	// L1: Contextual handbook preloading based on current turn prompt
	if (matchedSections.length > 0) {
		const preview = (options.userPrompt ?? "").replace(/\n/g, " ").slice(0, 40);
		parts.push(
			"",
			`### Contextual Handbook Knowledge (L1 Preloaded for "${preview}")`,
		);
		for (const sec of matchedSections) {
			parts.push(`#### ${sec.heading}`, ...sec.lines);
		}
	}

	// L2: Cognitive index
	if (options.summaryText) {
		parts.push(
			"",
			"### Knowledge & Skills Index (L2 On-Demand Routing)",
			"To inspect full details of any topic or skill, view `MEMORY.md` or `skills/<name>/SKILL.md`:",
			options.summaryText,
		);
	}

	if (options.privacyInstruction) {
		parts.push("", options.privacyInstruction);
	}

	return parts.join("\n");
}
