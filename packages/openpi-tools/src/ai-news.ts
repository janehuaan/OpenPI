/**
 * AI 早报 (AI news digest) plugin.
 *
 * One `ai_news` tool with actions:
 *   fetch   — pull configured RSS sources into a local cache (~/.pi/agent/ai-news.json)
 *   digest  — render a markdown digest from the cache (auto-fetches when empty)
 *   send    — email the digest via Gmail SMTP (curl, zero npm deps)
 *   status  — show sources + cache state
 *
 * Sources are mainstream AI blogs/tech media RSS feeds. Keys live in
 * ~/.pi/agent/secrets.env: GMAIL_SMTP_USER, GMAIL_SMTP_PASSWORD, GMAIL_NEWS_TO.
 *
 * Pair with `scheduled_task` for a daily morning push, e.g.
 *   cron "0 22 * * *" (Asia/Shanghai) → prompt "调用 ai_news 生成今日 AI 早报并发送到邮箱"
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { type FeedItem, fetchFeedXml, loadStateFile, parseFeedXml, saveStateFile } from "./feed-utils.ts";
import { envOrSecret } from "./secrets.ts";

// ============================================================================
// Sources
// ============================================================================

export interface AiNewsSource {
	id: string;
	name: string;
	url: string;
}

export const AI_NEWS_SOURCES: AiNewsSource[] = [
	{ id: "openai", name: "OpenAI", url: "https://openai.com/news/rss.xml" },
	{ id: "deepmind", name: "Google DeepMind", url: "https://deepmind.google/blog/rss.xml" },
	{ id: "google", name: "Google AI", url: "https://blog.google/technology/ai/rss/" },
	{ id: "hf", name: "Hugging Face", url: "https://huggingface.co/blog/feed.xml" },
	{ id: "mistral", name: "Mistral AI", url: "https://mistral.ai/news/rss.xml" },
	{ id: "tc", name: "TechCrunch AI", url: "https://techcrunch.com/category/artificial-intelligence/feed/" },
	{ id: "verge", name: "The Verge AI", url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml" },
	{ id: "mit", name: "MIT Tech Review", url: "https://www.technologyreview.com/topic/artificial-intelligence/feed/" },
	{ id: "vb", name: "VentureBeat AI", url: "https://venturebeat.com/category/ai/feed/" },
	{ id: "ars", name: "Ars Technica AI", url: "https://arstechnica.com/ai/feed/" },
	{ id: "wired", name: "Wired AI", url: "https://www.wired.com/feed/tag/ai/latest/rss" },
	{ id: "mtp", name: "MarkTechPost", url: "https://www.marktechpost.com/feed/" },
	{ id: "ithome", name: "IT 之家", url: "https://www.ithome.com/rss/" },
];

const STATE_FILE = "ai-news.json";

interface AiNewsState {
	version: number;
	fetchedAt: string;
	items: FeedItem[];
}

function todayIso(): string {
	return new Date().toISOString();
}

function parseRssDate(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const time = Date.parse(value);
	return Number.isFinite(time) ? time : undefined;
}

/** Keep only items published within `days` days (uses pubDate when available). */
export function filterRecent(items: FeedItem[], days: number): FeedItem[] {
	if (days <= 0) return items;
	const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
	return items.filter((item) => {
		const published = parseRssDate(item.published);
		if (published === undefined) return true; // unknown date: keep
		return published >= cutoff;
	});
}

/** Build a markdown digest grouped by source. Pure, unit-testable. */
export function buildAiNewsDigest(sources: AiNewsSource[], items: FeedItem[], perSource: number): string {
	const bySource = new Map<string, FeedItem[]>();
	for (const item of items) {
		const key = item.source ?? "";
		if (!bySource.has(key)) bySource.set(key, []);
		bySource.get(key)!.push(item);
	}
	const lines: string[] = ["# AI 早报", "", `> 生成时间：${todayIso()}`, ""];
	let any = false;
	for (const source of sources) {
		const rows = bySource.get(source.id) ?? [];
		if (rows.length === 0) continue;
		any = true;
		lines.push(`## ${source.name}`);
		for (const item of rows.slice(0, perSource)) {
			lines.push(`- ${item.title}${item.url ? ` — ${item.url}` : ""}`);
		}
		lines.push("");
	}
	if (!any) lines.push("（今日暂无新条目）", "");
	return `${lines.join("\n").trimEnd()}\n`;
}

// ============================================================================
// SMTP send (Gmail via curl — no npm deps)
// ============================================================================

interface EmailOptions {
	subject: string;
	body: string;
	to?: string;
	user?: string;
	password?: string;
}

function base64Utf8(value: string): string {
	return Buffer.from(value, "utf8").toString("base64");
}

function runCurl(args: string[]): Promise<number> {
	return new Promise((resolve, reject) => {
		const child = spawn("curl", args, { stdio: ["ignore", "inherit", "inherit"] });
		child.once("error", reject);
		child.once("close", (code) => resolve(code ?? 1));
	});
}

/** Send an email over Gmail SMTP using curl. Exported for tests/scripts. */
export async function sendEmailViaCurl(options: EmailOptions): Promise<{ sent: boolean; error?: string }> {
	const user = options.user ?? envOrSecret("GMAIL_SMTP_USER");
	const password = options.password ?? envOrSecret("GMAIL_SMTP_PASSWORD");
	const recipient = options.to ?? envOrSecret("GMAIL_NEWS_TO");
	if (!user || !password) {
		return { sent: false, error: "Missing GMAIL_SMTP_USER / GMAIL_SMTP_PASSWORD (secrets.env or env)" };
	}
	if (!recipient) {
		return { sent: false, error: "Missing recipient: pass --to or set GMAIL_NEWS_TO" };
	}
	const workdir = mkdtempSync(join(tmpdir(), "openpi-mail-"));
	try {
		const mailFile = join(workdir, "mail.txt");
		writeFileSync(
			mailFile,
			[
				`From: ${user}`,
				`To: ${recipient}`,
				`Subject: =?UTF-8?B?${base64Utf8(options.subject)}?=`,
				"MIME-Version: 1.0",
				"Content-Type: text/plain; charset=UTF-8",
				"Content-Transfer-Encoding: 8bit",
				"",
				options.body,
				"",
			].join("\r\n"),
			"utf8",
		);
		const code = await runCurl([
			"-s",
			"--url",
			"smtp://smtp.gmail.com:587",
			"--ssl-reqd",
			"--mail-from",
			user,
			"--mail-rcpt",
			recipient,
			"--user",
			`${user}:${password}`,
			"--upload-file",
			mailFile,
		]);
		if (code !== 0) return { sent: false, error: `SMTP send failed (curl exit ${code})` };
		return { sent: true };
	} finally {
		rmSync(workdir, { recursive: true, force: true });
	}
}

// ============================================================================
// Tool
// ============================================================================

const AiNewsParams = Type.Object({
	action: Type.String({
		description: "fetch | digest | send | status",
	}),
	days: Type.Optional(
		Type.Number({
			description: "Include items published within this many days (default 1, 0 = all)",
			minimum: 0,
			maximum: 30,
		}),
	),
	per_source: Type.Optional(
		Type.Number({ description: "Max items per source in the digest (default 5)", minimum: 1, maximum: 20 }),
	),
	to: Type.Optional(Type.String({ description: "Email recipient override for send (default GMAIL_NEWS_TO)" })),
	subject: Type.Optional(Type.String({ description: "Email subject override (default: AI 早报 <date>)" })),
	sources: Type.Optional(
		Type.Array(Type.String({ description: "Source ids to fetch/digest (default: all configured)" })),
	),
});

interface AiNewsDetails {
	action: string;
	sourceCounts?: Record<string, number>;
	digestChars?: number;
	email?: { to?: string; subject: string };
	error?: string;
}

async function fetchNews(
	sourceIds: string[],
	signal: AbortSignal | undefined,
): Promise<{ items: FeedItem[]; counts: Record<string, number>; errors: string[] }> {
	const items: FeedItem[] = [];
	const counts: Record<string, number> = {};
	const errors: string[] = [];
	const sources = AI_NEWS_SOURCES.filter((s) => sourceIds.includes(s.id));
	await Promise.all(
		sources.map(async (source) => {
			try {
				const xml = await fetchFeedXml(source.url, signal);
				const parsed = parseFeedXml(xml).map((item) => ({ ...item, source: source.id }));
				items.push(...parsed);
				counts[source.id] = parsed.length;
			} catch (error) {
				errors.push(`${source.id}: ${error instanceof Error ? error.message : String(error)}`);
				counts[source.id] = 0;
			}
		}),
	);
	return { items, counts, errors };
}

function readCache(): AiNewsState | undefined {
	return loadStateFile<AiNewsState>(STATE_FILE);
}

export default function (pi: ExtensionAPI): void {
	pi.registerTool({
		name: "ai_news",
		label: "AI 早报",
		description:
			"AI news digest: fetch RSS sources into a local cache, render a markdown digest, and email it. Actions: fetch | digest | send | status. Keys: GMAIL_SMTP_USER/GMAIL_SMTP_PASSWORD/GMAIL_NEWS_TO in ~/.pi/agent/secrets.env. Pair with scheduled_task cron for a daily morning push.",
		promptSnippet: "Use ai_news to fetch the latest AI news, render a daily digest, or email it (AI 早报).",
		parameters: AiNewsParams,
		async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
			const action = String(params.action ?? "status").toLowerCase();
			const sourceIds =
				params.sources && params.sources.length > 0
					? params.sources.map((id) => String(id))
					: AI_NEWS_SOURCES.map((s) => s.id);
			const days = params.days ?? 1;
			const perSource = params.per_source ?? 5;

			try {
				if (action === "status") {
					const cache = readCache();
					const lines = [
						`AI 早报 sources: ${AI_NEWS_SOURCES.length}`,
						...AI_NEWS_SOURCES.map((s) => `  ${s.id} — ${s.name} (${s.url})`),
						"",
						cache
							? `Cache: ${cache.items.length} items, fetched ${cache.fetchedAt} (${STATE_FILE})`
							: `Cache: empty — run "ai_news fetch" first`,
					];
					return {
						content: [{ type: "text", text: lines.join("\n") }],
						details: { action, sourceCounts: {} } satisfies AiNewsDetails,
					};
				}

				if (action === "fetch") {
					const { items, counts, errors } = await fetchNews(sourceIds, signal);
					const state: AiNewsState = { version: 1, fetchedAt: todayIso(), items };
					saveStateFile(STATE_FILE, state);
					const errorNote = errors.length ? `\nFailed sources: ${errors.join("; ")}` : "";
					return {
						content: [
							{
								type: "text",
								text: `Fetched ${items.length} items from ${Object.keys(counts).length} sources.${errorNote}`,
							},
						],
						details: { action, sourceCounts: counts } satisfies AiNewsDetails,
					};
				}

				if (action === "digest" || action === "send") {
					let state = readCache();
					if (!state || state.items.length === 0) {
						const { items, errors } = await fetchNews(sourceIds, signal);
						state = { version: 1, fetchedAt: todayIso(), items };
						saveStateFile(STATE_FILE, state);
						if (errors.length && items.length === 0) {
							throw new Error(`All feeds failed: ${errors.join("; ")}`);
						}
					}
					const filtered = filterRecent(
						state.items.filter((item) => sourceIds.includes(item.source ?? "")),
						days,
					);
					const digest = buildAiNewsDigest(AI_NEWS_SOURCES, filtered, perSource);

					if (action === "send") {
						const subject = params.subject ?? `AI 早报 ${todayIso().slice(0, 10)}`;
						const result = await sendEmailViaCurl({ subject, body: digest, to: params.to });
						if (!result.sent) throw new Error(result.error ?? "send failed");
						return {
							content: [
								{
									type: "text",
									text: `Sent AI 早报 (${filtered.length} items) to ${params.to ?? envOrSecret("GMAIL_NEWS_TO") ?? "default"}.`,
								},
							],
							details: {
								action,
								digestChars: digest.length,
								email: { subject, to: params.to },
							} satisfies AiNewsDetails,
						};
					}

					return {
						content: [{ type: "text", text: digest }],
						details: { action, digestChars: digest.length } satisfies AiNewsDetails,
					};
				}

				return {
					content: [{ type: "text", text: `Unknown ai_news action: ${action}` }],
					details: { action: "invalid" } satisfies AiNewsDetails,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `ai_news ${action} failed: ${message}` }],
					details: { action, error: message } satisfies AiNewsDetails,
				};
			}
		},
	});
}
