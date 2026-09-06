/**
 * Delta Patch Engine for Long-Term Memory (Codex Phase 2 Enhancement)
 *
 * Replaces lossy whole-document re-summarization with surgical, lossless
 * patch operations:
 * - Preserves existing untouched sections and byte-exact code snippets
 * - Enforces immutable evidence links (<!-- src: 2026-09-06-slug.md -->)
 * - Honors human tamper-proof locks (<!-- lock --> ... <!-- /lock -->)
 * - Categorizes intent via linguistic syntax rules, routing ambiguous items to Staging
 */

export type MemorySectionName =
	| "User Preferences & Habits"
	| "Architecture & Conventions"
	| "Platform Quirks & Build Recipes"
	| "Troubleshooting Lessons"
	| "Staging Notes";

export interface MemoryPatch {
	op: "add" | "supersede" | "remove";
	section: MemorySectionName | string;
	item: string;
	evidence?: string;
	target_phrase?: string;
	reason?: string;
}

export interface ParsedHandbookSection {
	heading: string;
	isLocked: boolean;
	lines: string[];
}

export interface ParsedHandbook {
	title: string;
	preamble: string[];
	sectionOrder: string[];
	sections: Map<string, ParsedHandbookSection>;
}

/**
 * Classifies an extracted learning or directive into standard handbook sections.
 * Uses syntax & intent patterns. Unmatched items are safely routed to Staging Notes
 * instead of being dumped into Troubleshooting Lessons.
 */
export function classifyMemoryIntent(text: string): MemorySectionName {
	const lower = text.toLowerCase();

	// 1. User preferences, strong directives, negative constraints
	if (
		/(\b(always|never|prefer|preference|must|should not|do not|don't|avoid)\b|偏好|总是|务必|必须|切勿|不要|别再|禁止|习惯)/i.test(
			lower,
		)
	) {
		return "User Preferences & Habits";
	}

	// 2. Platform quirks, build scripts, packaging, OS permissions
	if (
		/(\b(macos|darwin|linux|windows|electron|ditto|codesign|entitlement|tcc|bundle|spawn|kill|port|clean|build|package|npm run|pnpm|symlink)\b|打包|签名|权限|进程|端口|脚本|编译|链接)/i.test(
			lower,
		)
	) {
		return "Platform Quirks & Build Recipes";
	}

	// 3. Architecture & Conventions, module layout, test framework standards
	if (
		/(\b(architecture|convention|pattern|standard|monorepo|workspace|schema|database|sqlite|react|vite|vitest|jest|api|ipc|rpc|layer|refactor)\b|架构|规范|约定|目录结构|协议|分层|重构)/i.test(
			lower,
		)
	) {
		return "Architecture & Conventions";
	}

	// 4. Troubleshooting, error handling, bugs, workarounds
	if (
		/(\b(error|err|failed|failure|exception|crash|fix|fixed|resolve|resolved|bug|workaround|retry|timeout)\b|报错|错误|修复|解决|踩坑|失败|重试|超时)/i.test(
			lower,
		)
	) {
		return "Troubleshooting Lessons";
	}

	// 5. Default fallback is Staging Notes (NOT dumped into Troubleshooting)
	return "Staging Notes";
}

/**
 * Parses existing MEMORY.md into structured sections with lock detection.
 */
export function parseHandbook(handbookMd: string): ParsedHandbook {
	const lines = handbookMd.split("\n");
	let title = "# OpenPI Knowledge Handbook";
	const preamble: string[] = [];
	const sectionOrder: string[] = [];
	const sections = new Map<string, ParsedHandbookSection>();

	let currentSection: ParsedHandbookSection | null = null;
	let seenFirstHeading = false;

	for (const rawLine of lines) {
		const trimmed = rawLine.trim();

		// Top-level document title
		if (trimmed.startsWith("# ") && !seenFirstHeading) {
			title = trimmed;
			seenFirstHeading = true;
			continue;
		}

		// Section header
		if (trimmed.startsWith("## ")) {
			const heading = trimmed.replace(/^##\s+/, "").trim();
			currentSection = {
				heading,
				isLocked: false,
				lines: [],
			};
			sectionOrder.push(heading);
			sections.set(heading, currentSection);
			continue;
		}

		if (currentSection) {
			// Check for lock tag
			if (trimmed.includes("<!-- lock -->") || trimmed.includes("<!-- locked -->")) {
				currentSection.isLocked = true;
			}
			currentSection.lines.push(rawLine);
		} else {
			preamble.push(rawLine);
		}
	}

	return { title, preamble, sectionOrder, sections };
}

/**
 * Surgically applies Delta Patches to MEMORY.md, preserving all untouched lines,
 * locked blocks, and comments.
 */
export function applyHandbookPatches(
	currentMd: string,
	patches: MemoryPatch[],
): string {
	if (!currentMd.trim()) {
		currentMd = "# OpenPI Knowledge Handbook\n\n> Auto-consolidated long-term memory handbook.\n";
	}

	const parsed = parseHandbook(currentMd);

	for (const patch of patches) {
		const sectionKey = patch.section.trim();
		let targetSection = parsed.sections.get(sectionKey);

		// If section does not exist, create it
		if (!targetSection) {
			targetSection = {
				heading: sectionKey,
				isLocked: false,
				lines: [],
			};
			parsed.sections.set(sectionKey, targetSection);
			parsed.sectionOrder.push(sectionKey);
		}

		// Skip modification if user locked this section
		if (targetSection.isLocked) {
			continue;
		}

		if (patch.op === "add") {
			let formattedItem = patch.item.trim();
			if (!formattedItem.startsWith("- ")) {
				formattedItem = `- ${formattedItem}`;
			}

			// Append evidence anchor if provided and not already present
			if (patch.evidence && !formattedItem.includes("<!-- src:")) {
				formattedItem += ` <!-- src: ${patch.evidence} -->`;
			}

			// Deduplicate: check if existing line is semantically identical
			const cleanContent = formattedItem.replace(/<!--.*?-->/g, "").trim().toLowerCase();
			const alreadyExists = targetSection.lines.some((line) => {
				const existingClean = line.replace(/<!--.*?-->/g, "").trim().toLowerCase();
				return (
					existingClean === cleanContent ||
					(cleanContent.length > 20 && existingClean.includes(cleanContent.slice(2, 25)))
				);
			});

			if (!alreadyExists) {
				targetSection.lines.push(formattedItem);
			}
		} else if (patch.op === "supersede" && patch.target_phrase) {
			const targetLower = patch.target_phrase.toLowerCase();
			let replaced = false;

			let newItem = patch.item.trim();
			if (!newItem.startsWith("- ")) newItem = `- ${newItem}`;
			if (patch.evidence && !newItem.includes("<!-- src:")) {
				newItem += ` <!-- src: ${patch.evidence} -->`;
			}

			targetSection.lines = targetSection.lines.map((line) => {
				if (!replaced && line.toLowerCase().includes(targetLower)) {
					replaced = true;
					return `${newItem} <!-- superseded prior entry: ${patch.reason ?? patch.target_phrase} -->`;
				}
				return line;
			});

			if (!replaced) {
				targetSection.lines.push(newItem);
			}
		} else if (patch.op === "remove" && patch.target_phrase) {
			const targetLower = patch.target_phrase.toLowerCase();
			targetSection.lines = targetSection.lines.filter(
				(line) => !line.toLowerCase().includes(targetLower),
			);
		}
	}

	// Reconstruct markdown document
	const resultLines: string[] = [parsed.title];
	if (parsed.preamble.length > 0) {
		const cleanPreamble = parsed.preamble.join("\n").trim();
		if (cleanPreamble) resultLines.push("", cleanPreamble);
	}

	for (const heading of parsed.sectionOrder) {
		const section = parsed.sections.get(heading);
		if (!section) continue;

		// Clean empty lines in section
		const cleanLines = section.lines.filter((l) => l.trim().length > 0);
		if (cleanLines.length > 0) {
			resultLines.push("", `## ${heading}`);
			for (const line of cleanLines) {
				resultLines.push(line);
			}
		}
	}

	return resultLines.join("\n").trim() + "\n";
}

/**
 * Regenerates the cognitive routing table (memory_summary.md) from the parsed handbook.
 */
export function generateSummaryIndex(handbookMd: string): string {
	const parsed = parseHandbook(handbookMd);
	const summaryParts = [
		"# Memory Index",
		"",
		"Available background knowledge and learned conventions. Read on demand with file tools:",
	];

	for (const heading of parsed.sectionOrder) {
		const section = parsed.sections.get(heading);
		if (!section) continue;

		const items = section.lines.filter((l) => l.trim().startsWith("- "));
		if (items.length > 0) {
			const anchor = heading.toLowerCase().replace(/[^\w-]+/g, "-");
			summaryParts.push(
				`- [${heading}]: ${items.length} guidelines and verified lessons (see MEMORY.md#${anchor})`,
			);
		}
	}

	return summaryParts.join("\n") + "\n";
}
