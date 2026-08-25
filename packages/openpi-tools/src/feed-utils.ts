/**
 * Shared feed utilities for OpenPI tools: RSS/Atom parsing, feed fetching,
 * and small JSON persistence helpers (agent-dir state files).
 *
 * No runtime dependencies: XML is parsed with a small regex scanner that
 * handles RSS 2.0 `<item>` and Atom `<entry>` shapes used by mainstream feeds.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface FeedItem {
	title: string;
	url: string;
	published?: string;
	/** Source id the item came from (e.g. "openai"), set by callers when grouping. */
	source?: string;
}

const USER_AGENT = "openpi-agent/1.0 (RSS monitor; contact: local)";

/** Directory that OpenPI agent state lives in (~/.pi/agent). */
export function agentDir(): string {
	return process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}

function decodeXmlEntities(text: string): string {
	return text
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, "&")
		.replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
		.replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
		.replace(/\s+/g, " ")
		.trim();
}

function firstMatch(text: string, pattern: RegExp): string {
	const match = text.match(pattern);
	if (!match) return "";
	const value = (match[1] ?? match[2] ?? "").trim();
	return decodeXmlEntities(value);
}

function stripTags(value: string): string {
	return value.replace(/<[^>]+>/g, "");
}

function unwrapCdata(value: string): string {
	return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

function cdataAware(text: string, pattern: RegExp): string {
	// Some feeds wrap text in CDATA; unwrap before stripping leftover markup.
	return stripTags(unwrapCdata(firstMatch(text, pattern)));
}

/**
 * Parse an RSS 2.0 or Atom feed document into flat items.
 *
 * Supports:
 * - RSS: <item><title>..</title><link>..</link><pubDate>..</pubDate>
 * - Atom: <entry><title>..</title><link href=".."/><updated>..</updated>
 */
export function parseFeedXml(xml: string): FeedItem[] {
	if (!xml || xml.length < 20) return [];
	const items: FeedItem[] = [];
	const itemRegex = /<(?:item|entry)\b[^>]*>[\s\S]*?<\/(?:item|entry)>/gi;
	for (const block of xml.match(itemRegex) ?? []) {
		const isAtom = /^<entry/i.test(block);
		let title = "";
		let url = "";
		if (isAtom) {
			title = cdataAware(block, /<title[^>]*>([\s\S]*?)<\/title>/i);
			const linkMatch = block.match(/<link\b[^>]*href="([^"]+)"/i);
			url = linkMatch ? decodeXmlEntities(linkMatch[1]!.trim()) : "";
		} else {
			title = cdataAware(block, /<title[^>]*>([\s\S]*?)<\/title>/i);
			url = cdataAware(block, /<link[^>]*>([\s\S]*?)<\/link>/i);
		}
		if (!title && !url) continue;
		const published =
			firstMatch(block, /<(?:pubDate|updated|published)[^>]*>([\s\S]*?)<\/(?:pubDate|updated|published)>/i) ||
			undefined;
		if (url && !/^https?:\/\//i.test(url)) url = "";
		items.push({ title: title || url, url, published });
	}
	// Dedupe by url (or title when url missing), keep first occurrence.
	const seen = new Set<string>();
	const out: FeedItem[] = [];
	for (const item of items) {
		const key = item.url || item.title;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(item);
	}
	return out;
}

/** Fetch a feed URL and return its raw XML text (with a timeout). */
export async function fetchFeedXml(url: string, signal?: AbortSignal, timeoutMs = 20_000): Promise<string> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	if (signal) signal.addEventListener("abort", () => controller.abort(), { once: true });
	try {
		const response = await fetch(url, {
			signal: controller.signal,
			headers: {
				"User-Agent": USER_AGENT,
				Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
			},
		});
		if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText} for ${url}`);
		return await response.text();
	} finally {
		clearTimeout(timer);
	}
}

// ============================================================================
// JSON persistence (state files under the agent dir)
// ============================================================================

export function stateFilePath(name: string): string {
	return join(agentDir(), name);
}

export function loadStateFile<T>(name: string): T | undefined {
	try {
		const raw = readFileSync(stateFilePath(name), "utf8");
		return JSON.parse(raw) as T;
	} catch {
		return undefined;
	}
}

export function saveStateFile(name: string, value: unknown): string {
	const file = stateFilePath(name);
	mkdirSync(dirname(file), { recursive: true });
	const tmp = `${file}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
	renameSync(tmp, file);
	return file;
}
