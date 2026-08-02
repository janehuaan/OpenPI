import * as fs from "node:fs";
import * as path from "node:path";
import { globalMemoryDir } from "./config.ts";
import {
	dedupeEntries,
	loadIndex,
	loadIndexFile,
	readTopic,
	sanitizeKey,
	saveIndex,
	saveIndexAt,
	saveTopic,
	saveTopicAt,
	upsertEntry,
} from "./store.ts";
import type { MemoryConfig, MemoryIndexEntry, MemoryType } from "./types.ts";
import { MEMORY_TYPES } from "./types.ts";

export interface TranscriptTurn {
	role: "user" | "assistant";
	text: string;
}

export interface ExtractCandidate {
	type: MemoryType;
	key: string;
	summary: string;
	body: string;
	source: "structured" | "heuristic" | "pending" | "digest";
	/** Prefer writing to ~/.pi/memory (user prefs). */
	global?: boolean;
}

/**
 * Lightweight offline extract from `.pi/memory/pending-extract.md`.
 */
export function runBackgroundExtract(cwd: string, config: MemoryConfig): number {
	const pendingPath = path.join(cwd, ".pi", "memory", "pending-extract.md");
	if (!fs.existsSync(pendingPath)) return 0;
	const body = fs.readFileSync(pendingPath, "utf8").trim();
	if (!body) {
		fs.unlinkSync(pendingPath);
		return 0;
	}

	const structured = parseStructuredExtract(body);
	const candidates: ExtractCandidate[] =
		structured.length > 0
			? structured.map((item) => ({
					type: item.type,
					key: item.key,
					summary: item.summary,
					body: item.body || item.summary,
					source: "structured" as const,
					global: item.type === "user" || item.type === "feedback",
				}))
			: [
					{
						type: "lesson",
						key: `extract-${new Date().toISOString().slice(0, 10)}`,
						summary: body.slice(0, 100).replace(/\n/g, " "),
						body,
						source: "pending" as const,
					},
				];

	const saved = applyCandidates(cwd, candidates, config);
	fs.unlinkSync(pendingPath);
	return saved;
}

/**
 * Heuristic extract from recent conversation turns (no LLM call).
 * Broader than explicit “记住” so durable signals land without user rituals.
 */
export function extractFromTranscript(turns: TranscriptTurn[], existing: MemoryIndexEntry[]): ExtractCandidate[] {
	const out: ExtractCandidate[] = [];
	const seen = new Set(existing.map((e) => `${e.type}:${e.key}`));
	const recentUsers = turns
		.filter((t) => t.role === "user")
		.map((t) => t.text.trim())
		.filter((t) => t.length >= 8 && t.length <= 1200)
		.slice(-50);

	for (const text of recentUsers) {
		const candidates = classifyUserUtterance(text);
		for (const candidate of candidates) {
			const id = `${candidate.type}:${candidate.key}`;
			if (seen.has(id)) continue;
			if (existing.some((e) => similarText(e.value, candidate.summary))) continue;
			if (out.some((c) => c.key === candidate.key || similarText(c.summary, candidate.summary))) continue;
			seen.add(id);
			out.push(candidate);
		}
	}
	return out.slice(0, 12);
}

/**
 * Rich project digest for cross-session continuity.
 * Must capture assistant conclusions (names, scores, decisions) — not only the last user line.
 * Heuristic only (no LLM).
 */
export function extractSessionDigest(turns: TranscriptTurn[]): ExtractCandidate | undefined {
	const recent = turns.slice(-30);
	const users = recent
		.filter((t) => t.role === "user")
		.map((t) => t.text.trim())
		.filter((t) => t.length >= 8 && t.length <= 2000);
	const assistants = recent
		.filter((t) => t.role === "assistant")
		.map((t) => t.text.trim())
		.filter((t) => t.length >= 40);

	if (users.length === 0 && assistants.length === 0) return undefined;

	const userPick = users.slice(-5);
	const assistantPick = assistants.slice(-2);
	const lastUser = userPick[userPick.length - 1] ?? "";
	const headline = cleanSummary(lastUser.split("\n")[0] ?? lastUser);
	if (headline.length < 4 && assistantPick.length === 0) return undefined;
	if (/^(hi|hello|hey|ok|okay|thanks|thank you|你好|谢谢|好的|嗯)$/i.test(headline) && assistantPick.length === 0) {
		return undefined;
	}

	const combined = [...userPick, ...assistantPick].join("\n");
	const entities = extractSalientEntities(combined);
	const tableLines = extractTableishLines(combined);

	const summaryBits: string[] = [];
	if (entities.length > 0) summaryBits.push(entities.slice(0, 8).join(", "));
	if (headline.length >= 8 && !/^(ok|okay|好的|嗯|继续)/i.test(headline)) {
		summaryBits.push(headline.slice(0, 80));
	} else if (assistantPick[0]) {
		const firstAssist = cleanSummary(assistantPick[0]!.split("\n").find((l) => l.trim().length > 12) ?? "");
		if (firstAssist) summaryBits.push(firstAssist.slice(0, 80));
	}
	const summary = `Last session: ${summaryBits.join(" — ").slice(0, 140) || "work in progress"}`;

	const bodyParts: string[] = [
		"## Continuity digest (auto — use when user asks where we left off)",
		"",
		`### Focus`,
		headline || "(see assistant notes below)",
	];
	if (entities.length > 0) {
		bodyParts.push("", "### Named topics / projects", entities.map((e) => `- ${e}`).join("\n"));
	}
	if (tableLines.length > 0) {
		bodyParts.push("", "### Structured notes from last replies", ...tableLines.slice(0, 40));
	}
	if (userPick.length > 0) {
		bodyParts.push("", "### Recent user turns");
		for (let i = 0; i < userPick.length; i++) {
			bodyParts.push(`${i + 1}. ${userPick[i]!.slice(0, 400).replace(/\n/g, " ")}`);
		}
	}
	if (assistantPick.length > 0) {
		bodyParts.push("", "### Assistant conclusions (excerpt)");
		for (const a of assistantPick) {
			// Prefer conclusion / table / bullet lines; fall back to head of reply
			const excerpt = pickAssistantExcerpt(a, 1800);
			bodyParts.push(excerpt, "");
		}
	}

	const day = new Date().toISOString().slice(0, 10);
	return {
		type: "project",
		key: `session-${day}`,
		summary,
		body: bodyParts.join("\n").slice(0, 8000),
		source: "digest",
		global: false,
	};
}

/** Pull project-like names, backtick ids, and path segments for continuity. */
export function extractSalientEntities(text: string): string[] {
	const found: string[] = [];
	const seen = new Set<string>();
	const junk =
		/^(the|and|for|with|from|this|that|last|session|project|user|node_modules|target|dist|build|src|lib\.rs|vault\.rs|app\.tsx|index\.ts|package\.json|changelog|readme)$/i;
	const push = (raw: string) => {
		const s = raw.trim().replace(/^[*`]+|[*`]+$/g, "");
		if (s.length < 2 || s.length > 64) return;
		if (junk.test(s)) return;
		if (/^(ts|js|tsx|jsx|rs|md|json)$/i.test(s)) return;
		const key = s.toLowerCase();
		if (seen.has(key)) return;
		seen.add(key);
		found.push(s);
	};

	for (const m of text.matchAll(/`([^`\n]{2,48})`/g)) push(m[1]!);
	// Table cells that look like names: | OpenPI | or | pi-main |
	for (const m of text.matchAll(/\|\s*([A-Za-z][\w./-]{1,40})\s*\|/g)) push(m[1]!);
	// Camel/Pascal or dotted product names
	for (const m of text.matchAll(/\b([A-Z][a-zA-Z0-9]+(?:[A-Z][a-zA-Z0-9]+)+)\b/g)) push(m[1]!);
	// kebab / known monorepo style
	for (const m of text.matchAll(/\b([a-z][a-z0-9]+(?:-[a-z0-9]+){1,4})\b/g)) {
		const v = m[1]!;
		if (v.includes("-") && v.length >= 5) push(v);
	}
	return found.slice(0, 24);
}

function extractTableishLines(text: string): string[] {
	const lines = text.split("\n");
	const out: string[] = [];
	for (const line of lines) {
		const t = line.trim();
		if (!t) continue;
		if (t.includes("|") && t.split("|").length >= 3) {
			out.push(t.slice(0, 200));
			continue;
		}
		if (/^[-*•]\s+\S+/.test(t) && t.length >= 12 && t.length <= 200) {
			out.push(t);
		}
		if (/^结论[:：]/.test(t) || /^优先/.test(t) || /^\d+\.\s+\*\*/.test(t)) {
			out.push(t.slice(0, 200));
		}
	}
	return out.slice(0, 50);
}

function pickAssistantExcerpt(text: string, maxLen: number): string {
	const lines = text.split("\n");
	const preferred = lines.filter((l) => {
		const t = l.trim();
		return (
			t.includes("|") ||
			/^#{1,3}\s/.test(t) ||
			/^[-*•]\s/.test(t) ||
			/^结论/.test(t) ||
			/^优先/.test(t) ||
			/\d+\/10/.test(t) ||
			/`[^`]+`/.test(t)
		);
	});
	const source = preferred.length >= 3 ? preferred.join("\n") : text;
	return source.slice(0, maxLen).trim();
}

/** Apply candidates to project memory; user/feedback may also go global. */
export function applyCandidates(cwd: string, candidates: ExtractCandidate[], config: MemoryConfig): number {
	if (candidates.length === 0) return 0;
	let entries = loadIndex(cwd);
	let globalEntries = loadIndexFile(globalMemoryDir());
	let saved = 0;
	let globalSaved = 0;

	for (const item of candidates) {
		const key = sanitizeKey(item.key);
		if (!key) continue;
		const summary = item.summary.trim().slice(0, 160);
		if (!summary) continue;
		const body = item.body.trim() || summary;
		// Session digests always overwrite same-day key (body must grow during the session)
		const force = item.source === "digest" || key.startsWith("session-");

		const writeGlobal =
			config.promoteUserToGlobal && (item.global === true || item.type === "user" || item.type === "feedback");

		const exact = entries.some((e) => e.type === item.type && e.key === key && e.value === summary);
		const nearDup = !force && entries.some((e) => e.key !== key && similarText(e.value, summary));
		if (force || (!exact && !nearDup)) {
			// For digests, skip downgrade if existing body is substantially richer
			if (force && key.startsWith("session-")) {
				const prev = readTopic(cwd, item.type, key) ?? "";
				if (prev.length > body.length + 200 && prev.includes("### Assistant conclusions")) {
					// keep richer previous unless new also has assistant section and more entities
					const prevScore = (prev.match(/### /g) ?? []).length + prev.length / 500;
					const nextScore = (body.match(/### /g) ?? []).length + body.length / 500;
					if (nextScore + 0.5 < prevScore) {
						continue;
					}
				}
			}
			entries = upsertEntry(entries, item.type, key, summary);
			saveTopic(cwd, item.type, key, body);
			saved += 1;
		}

		if (writeGlobal) {
			const gExact = globalEntries.some((e) => e.type === item.type && e.key === key && e.value === summary);
			const gNear = !force && globalEntries.some((e) => e.key !== key && similarText(e.value, summary));
			if (force || (!gExact && !gNear)) {
				globalEntries = upsertEntry(globalEntries, item.type, key, summary);
				saveTopicAt(globalMemoryDir(), item.type, key, body);
				globalSaved += 1;
			}
		}
	}

	if (saved > 0) {
		entries = dedupeEntries(entries);
		saveIndex(cwd, entries, config.maxIndexEntries);
	}
	if (globalSaved > 0) {
		globalEntries = dedupeEntries(globalEntries);
		saveIndexAt(globalMemoryDir(), globalEntries, config.maxIndexEntries);
	}
	return saved + globalSaved;
}

/** Write/refresh today's continuity digest from turns. */
export function refreshSessionDigest(
	cwd: string,
	turns: TranscriptTurn[],
	config: MemoryConfig,
): { saved: boolean; summary?: string; bodyLen?: number } {
	if (!config.autoSessionDigest) return { saved: false };
	const digest = extractSessionDigest(turns);
	if (!digest) return { saved: false };
	const n = applyCandidates(cwd, [digest], config);
	return { saved: n > 0, summary: digest.summary, bodyLen: digest.body.length };
}

export function parseStructuredExtract(
	body: string,
): Array<{ type: MemoryType; key: string; summary: string; body?: string }> {
	const out: Array<{ type: MemoryType; key: string; summary: string; body?: string }> = [];
	for (const raw of body.split("\n")) {
		const line = raw.trim();
		if (!line || line.startsWith("#")) continue;

		const colon = line.match(/^-?\s*(user|feedback|project|lesson)\s*:\s*([a-z0-9_-]+)\s*:\s*(.+)$/i);
		if (colon) {
			const type = colon[1]!.toLowerCase() as MemoryType;
			if ((MEMORY_TYPES as readonly string[]).includes(type)) {
				out.push({ type, key: colon[2]!, summary: colon[3]!.trim(), body: colon[3]!.trim() });
			}
			continue;
		}

		const bracket = line.match(/^-?\s*\[(user|feedback|project|lesson)\s*\/\s*([a-z0-9_-]+)\]\s*(.+)$/i);
		if (bracket) {
			const type = bracket[1]!.toLowerCase() as MemoryType;
			if ((MEMORY_TYPES as readonly string[]).includes(type)) {
				out.push({ type, key: bracket[2]!, summary: bracket[3]!.trim(), body: bracket[3]!.trim() });
			}
		}
	}
	return out;
}

/**
 * Classify one user utterance into zero or more durable memories.
 * Order: explicit remember → hard rules → preferences → project facts → lessons → soft work-focus.
 */
export function classifyUserUtterance(text: string): ExtractCandidate[] {
	const lower = text.toLowerCase();
	const firstLine = text.split("\n")[0]?.trim() ?? text;
	const out: ExtractCandidate[] = [];

	const push = (c: ExtractCandidate | undefined) => {
		if (!c) return;
		if (out.some((x) => x.key === c.key || similarText(x.summary, c.summary))) return;
		out.push(c);
	};

	// Explicit remember (highest confidence) → user + global
	if (
		/请记住|记住这|记下来|记一下|帮我记|以后都|从现在起|from now on|please remember|always remember|don't forget|note that i|for future sessions|记着|别忘了/i.test(
			text,
		)
	) {
		const summary = cleanSummary(firstLine);
		if (summary.length >= 6) {
			push({
				type: "user",
				key: keyFromText(summary, "pref"),
				summary,
				body: text.slice(0, 1200),
				source: "heuristic",
				global: true,
			});
		}
	}

	// Corrections / hard rules → feedback + global
	if (
		/\b(never use|don't use|do not use|stop suggesting|wrong approach|incorrect|must not|do not ever)\b/i.test(
			lower,
		) ||
		/(不要用|别用|禁止|不要再建议|错了|不是这样|千万别|以后别)/.test(text)
	) {
		const summary = cleanSummary(firstLine);
		if (summary.length >= 8) {
			push({
				type: "feedback",
				key: keyFromText(summary, "rule"),
				summary,
				body: text.slice(0, 1200),
				source: "heuristic",
				global: true,
			});
		}
	}

	// Preferences → feedback + global
	if (
		/\b(prefer|always|never|don't|do not|i like|i hate|i want you to|i need you to|from now)\b/i.test(lower) ||
		/(我喜欢|我不喜欢|不要再|永远不要|总是用|务必|请用|请不要|默认用|习惯)/.test(text)
	) {
		const summary = cleanSummary(firstLine);
		if (summary.length >= 10) {
			push({
				type: "feedback",
				key: keyFromText(summary, "pref"),
				summary,
				body: text.slice(0, 1200),
				source: "heuristic",
				global: true,
			});
		}
	}

	// Project facts / decisions / stack
	if (
		/\b(deadline|due|ship by|launch|milestone|we use|we decided|decided to|stack is|switch to|migrate to|using )\b/i.test(
			lower,
		) ||
		/(截止日期|上线|交付|里程碑|本周五|下周一|我们用|决定用|技术栈|改用|切换到|配置成)/.test(text)
	) {
		const summary = cleanSummary(firstLine);
		if (summary.length >= 8) {
			push({
				type: "project",
				key: keyFromText(summary, "fact"),
				summary,
				body: text.slice(0, 1200),
				source: "heuristic",
			});
		}
	}

	// Lessons
	if (
		/\b(lesson|next time|don't do|avoid|mistakenly|wrong to|gotcha|pitfall|root cause)\b/i.test(lower) ||
		/(下次|教训|别再|坑|踩坑|记取|注意了|根因)/.test(text)
	) {
		const summary = cleanSummary(firstLine);
		if (summary.length >= 10) {
			push({
				type: "lesson",
				key: keyFromText(summary, "lesson"),
				summary,
				body: text.slice(0, 1200),
				source: "heuristic",
			});
		}
	}

	// Soft work-focus: “继续做X / 我在弄 / working on” — project continuity without “记住”
	if (out.length === 0) {
		if (
			/\b(working on|continue|continuing|next step|implement|fix|debug|fix|build)\b/i.test(lower) ||
			/(继续|接着|我在做|正在做|先做|接下来|实现|修一下|排查|打包|发布)/.test(text)
		) {
			const summary = cleanSummary(firstLine);
			// Require some substance; skip ultra-short commands
			if (summary.length >= 14 && summary.length <= 140) {
				push({
					type: "project",
					key: keyFromText(summary, "wip"),
					summary: `WIP: ${summary.slice(0, 120)}`,
					body: text.slice(0, 1200),
					source: "heuristic",
				});
			}
		}
	}

	return out;
}

/**
 * True if text looks like a high-confidence durable signal (for aggressive mid-session save).
 */
export function isHighConfidenceMemoryUtterance(text: string): boolean {
	return /请记住|记住这|记下来|帮我记|from now on|please remember|always remember|\bprefer\b|\balways\b|\bnever\b|不要再|永远不要|千万别|禁止|决定用|we decided|don't use|do not use/i.test(
		text,
	);
}

/**
 * True if soft mid-turn extract is worth running (broader than high-confidence).
 */
export function isSoftMemoryUtterance(text: string): boolean {
	if (isHighConfidenceMemoryUtterance(text)) return true;
	return (
		/\b(prefer|always|never|deadline|decided|working on|continue|implement|fix)\b/i.test(text) ||
		/(继续|接着|我在做|决定|默认|习惯|截止日期|技术栈|改用|修复|打包|发布|不要|务必)/.test(text)
	);
}

function cleanSummary(text: string): string {
	return text
		.replace(
			/^(请记住|记住这?|记下来|记一下|帮我记|从现在起|from now on[,:]?\s*|please remember[,:]?\s*|note that\s*)/i,
			"",
		)
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 140);
}

function keyFromText(text: string, prefix: string): string {
	const slug = text
		.toLowerCase()
		.replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 40);
	return sanitizeKey(slug || `${prefix}-${Date.now().toString(36)}`);
}

export function similarText(a: string, b: string): boolean {
	const na = normalize(a);
	const nb = normalize(b);
	if (!na || !nb) return false;
	if (na === nb) return true;
	const shorter = na.length <= nb.length ? na : nb;
	const longer = na.length <= nb.length ? nb : na;
	if (shorter.length >= 16 && longer.includes(shorter)) return true;
	const ta = new Set(na.split(" ").filter((t) => t.length > 2));
	const tb = new Set(nb.split(" ").filter((t) => t.length > 2));
	if (ta.size < 3 || tb.size < 3) return false;
	let inter = 0;
	for (const t of ta) if (tb.has(t)) inter += 1;
	const union = ta.size + tb.size - inter;
	return union > 0 && inter >= 3 && inter / union >= 0.8;
}

function normalize(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s]/gu, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/** Pull plain text from session message-like objects. */
export function textFromSessionMessage(message: unknown): string {
	if (!message || typeof message !== "object") return "";
	const record = message as Record<string, unknown>;
	if (typeof record.content === "string") return record.content;
	if (!Array.isArray(record.content)) return "";
	return record.content
		.map((block) => {
			if (!block || typeof block !== "object") return "";
			const b = block as Record<string, unknown>;
			if (b.type === "text" || b.type === "output_text") {
				return typeof b.text === "string" ? b.text : "";
			}
			return "";
		})
		.filter(Boolean)
		.join("\n")
		.trim();
}
