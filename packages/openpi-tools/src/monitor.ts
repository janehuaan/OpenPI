/**
 * 订阅监控 / 每日摘要 (subscription monitor) plugin.
 *
 * One `monitor` tool with actions:
 *   add     — watch an RSS/Atom feed or a web page
 *   list    — show watched targets + last state
 *   remove  — stop watching a target
 *   check   — fetch targets, report NEW rss items / changed pages, update state
 *   summary — same detection, rendered as a compact markdown digest (每日摘要)
 *
 * State lives in ~/.pi/agent/monitor.json. RSS items are tracked by URL;
 * pages by a content hash, so any change triggers a "changed" report.
 */

import { createHash } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { type FeedItem, fetchFeedXml, loadStateFile, parseFeedXml, saveStateFile } from "./feed-utils.ts";

const STATE_FILE = "monitor.json";

export type WatchKind = "rss" | "page";

export interface MonitorWatch {
	id: string;
	name: string;
	url: string;
	kind: WatchKind;
	maxItems: number;
	addedAt: string;
	lastCheckedAt?: string;
	/** RSS: urls already seen. */
	seen: string[];
	/** Page: content hash of the last fetch. */
	lastHash?: string;
}

interface MonitorState {
	version: number;
	watches: MonitorWatch[];
}

function nowIso(): string {
	return new Date().toISOString();
}

function newId(): string {
	return `watch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function contentHash(text: string): string {
	return createHash("sha1").update(text).digest("hex").slice(0, 16);
}

/** HTML → plain text (strip tags/scripts/styles, collapse whitespace). */
export function htmlToText(html: string): string {
	return html
		.replace(/<script[\s\S]*?<\/script>/gi, " ")
		.replace(/<style[\s\S]*?<\/style>/gi, " ")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;|&apos;/g, "'")
		.replace(/\s+/g, " ")
		.trim();
}

/** New RSS items = current items whose URL was not seen before. */
export function diffRss(previousSeen: string[], current: FeedItem[]): FeedItem[] {
	const seen = new Set(previousSeen);
	return current.filter((item) => item.url && !seen.has(item.url));
}

/** Page change detection. Returns { changed, hash, previousHash }. */
export function diffPage(
	previousHash: string | undefined,
	content: string,
): { changed: boolean; hash: string; previousHash?: string } {
	const hash = contentHash(htmlToText(content));
	return { changed: previousHash !== undefined && previousHash !== hash, hash, previousHash };
}

async function fetchRss(watch: MonitorWatch, signal?: AbortSignal): Promise<FeedItem[]> {
	const xml = await fetchFeedXml(watch.url, signal);
	return parseFeedXml(xml);
}

async function fetchPage(url: string, signal?: AbortSignal): Promise<string> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 20_000);
	if (signal) signal.addEventListener("abort", () => controller.abort(), { once: true });
	try {
		const response = await fetch(url, {
			signal: controller.signal,
			headers: { "User-Agent": "openpi-agent/1.0 (monitor)" },
		});
		if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
		return await response.text();
	} finally {
		clearTimeout(timer);
	}
}

function loadState(): MonitorState {
	return (
		loadStateFile<MonitorState>(STATE_FILE) ?? {
			version: 1,
			watches: [],
		}
	);
}

function saveState(state: MonitorState): void {
	saveStateFile(STATE_FILE, state);
}

function formatWatch(watch: MonitorWatch): string {
	return [
		`[${watch.id}] ${watch.name} (${watch.kind})`,
		`  url: ${watch.url}`,
		`  seen: ${watch.seen.length} items${watch.lastCheckedAt ? `, last checked ${watch.lastCheckedAt}` : ""}`,
		watch.kind === "page" ? `  hash: ${watch.lastHash ?? "-"}` : "",
	]
		.filter(Boolean)
		.join("\n");
}

/** Build a compact daily summary of detected changes. Pure, unit-testable. */
export function buildMonitorSummary(
	watches: MonitorWatch[],
	newByWatch: Record<string, FeedItem[]>,
	changedByWatch: Record<string, string>,
): string {
	const lines: string[] = ["# 订阅监控日报", `> ${nowIso()}`, ""];
	let any = false;
	for (const watch of watches) {
		const rssNew = newByWatch[watch.id] ?? [];
		const pageChanged = changedByWatch[watch.id];
		if (rssNew.length === 0 && !pageChanged) continue;
		any = true;
		lines.push(`## ${watch.name}`);
		if (pageChanged) lines.push(`- 页面内容有更新（hash ${pageChanged}）`);
		for (const item of rssNew.slice(0, watch.maxItems)) {
			lines.push(`- ${item.title}${item.url ? ` — ${item.url}` : ""}`);
		}
		lines.push("");
	}
	if (!any) lines.push("（本轮无更新）", "");
	return `${lines.join("\n").trimEnd()}\n`;
}

const MonitorParams = Type.Object({
	action: Type.String({
		description: "add | list | remove | check | summary",
	}),
	name: Type.Optional(Type.String({ description: "Watch name (add)" })),
	url: Type.Optional(Type.String({ description: "Feed or page URL to watch (add)" })),
	kind: Type.Optional(Type.String({ description: "rss (default) | page (add)" })),
	max_items: Type.Optional(
		Type.Number({ description: "Max items to report per check (default 5)", minimum: 1, maximum: 50 }),
	),
	watchId: Type.Optional(Type.String({ description: "Watch id (remove/check/summary; default all)" })),
	days: Type.Optional(
		Type.Number({ description: "For summary: include items seen within N days (default 1, 0 = all)" }),
	),
});

interface MonitorDetails {
	action: string;
	watchId?: string;
	newItems?: number;
	changedPages?: number;
	error?: string;
}

export default function (pi: ExtensionAPI): void {
	pi.registerTool({
		name: "monitor",
		label: "订阅监控",
		description:
			"Watch RSS/Atom feeds and web pages for updates: add | list | remove | check | summary. check reports new feed items and changed pages since the last run; summary renders them as a markdown digest (每日摘要). State in ~/.pi/agent/monitor.json.",
		promptSnippet: "Use monitor to track feeds/pages for changes; check/summary for a daily digest of what's new.",
		parameters: MonitorParams,
		async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
			const action = String(params.action ?? "list").toLowerCase();
			const state = loadState();
			try {
				if (action === "add") {
					const name = String(params.name ?? "").trim();
					const url = String(params.url ?? "").trim();
					if (!name || !url) {
						return {
							content: [{ type: "text", text: "monitor add requires name and url." }],
							details: { action, error: "missing name/url" } satisfies MonitorDetails,
						};
					}
					const kind: WatchKind = params.kind === "page" ? "page" : "rss";
					const watch: MonitorWatch = {
						id: newId(),
						name,
						url,
						kind,
						maxItems: params.max_items ?? 5,
						addedAt: nowIso(),
						seen: [],
					};
					state.watches.push(watch);
					saveState(state);
					return {
						content: [
							{
								type: "text",
								text: `Watching ${watch.name} (${watch.kind}): ${watch.url}\n${formatWatch(watch)}`,
							},
						],
						details: { action, watchId: watch.id } satisfies MonitorDetails,
					};
				}

				if (action === "list") {
					const text =
						state.watches.length === 0
							? "No watches. Use monitor add <name> <url> [kind=rss|page]."
							: state.watches.map(formatWatch).join("\n\n");
					return {
						content: [{ type: "text", text }],
						details: { action, watchId: params.watchId } satisfies MonitorDetails,
					};
				}

				if (action === "remove") {
					const watchId = String(params.watchId ?? "").trim();
					if (!watchId) {
						return {
							content: [{ type: "text", text: "monitor remove requires watchId." }],
							details: { action, error: "missing watchId" } satisfies MonitorDetails,
						};
					}
					const before = state.watches.length;
					state.watches = state.watches.filter((w) => w.id !== watchId);
					const removed = state.watches.length < before;
					if (removed) saveState(state);
					return {
						content: [
							{ type: "text", text: removed ? `Removed watch ${watchId}.` : `No watch with id ${watchId}.` },
						],
						details: { action, watchId } satisfies MonitorDetails,
					};
				}

				if (action === "check" || action === "summary") {
					const watchId = String(params.watchId ?? "").trim();
					const targets = watchId ? state.watches.filter((w) => w.id === watchId) : state.watches;
					if (targets.length === 0) {
						return {
							content: [{ type: "text", text: "No watches to check. Add one with monitor add first." }],
							details: { action, error: "no watches" } satisfies MonitorDetails,
						};
					}
					const newByWatch: Record<string, FeedItem[]> = {};
					const changedByWatch: Record<string, string> = {};
					const errors: string[] = [];

					await Promise.all(
						targets.map(async (watch) => {
							try {
								if (watch.kind === "page") {
									const content = await fetchPage(watch.url, signal);
									const diff = diffPage(watch.lastHash, content);
									if (diff.changed) changedByWatch[watch.id] = diff.hash;
									watch.lastHash = diff.hash;
								} else {
									const items = (await fetchRss(watch, signal)).slice(0, watch.maxItems * 4);
									const fresh = diffRss(watch.seen, items);
									if (fresh.length > 0) newByWatch[watch.id] = fresh;
									for (const item of items) {
										if (item.url && !watch.seen.includes(item.url)) watch.seen.push(item.url);
									}
									watch.seen = watch.seen.slice(-200);
								}
								watch.lastCheckedAt = nowIso();
							} catch (error) {
								errors.push(`${watch.name}: ${error instanceof Error ? error.message : String(error)}`);
							}
						}),
					);
					saveState(state);

					const newCount = Object.values(newByWatch).reduce((sum, list) => sum + list.length, 0);
					const changedCount = Object.keys(changedByWatch).length;
					const errorNote = errors.length ? `\nErrors: ${errors.join("; ")}` : "";

					if (action === "summary") {
						const summary = buildMonitorSummary(targets, newByWatch, changedByWatch);
						return {
							content: [{ type: "text", text: `${summary}${errorNote}` }],
							details: { action, newItems: newCount, changedPages: changedCount } satisfies MonitorDetails,
						};
					}

					const lines: string[] = [];
					for (const watch of targets) {
						const fresh = newByWatch[watch.id] ?? [];
						const changed = changedByWatch[watch.id];
						if (fresh.length === 0 && !changed) continue;
						lines.push(`## ${watch.name}`);
						if (changed) lines.push(`- 页面内容更新 (hash ${changed})`);
						for (const item of fresh.slice(0, watch.maxItems)) {
							lines.push(`- ${item.title}${item.url ? ` — ${item.url}` : ""}`);
						}
						lines.push("");
					}
					if (lines.length === 0) lines.push("No new items or page changes since the last check.");
					return {
						content: [{ type: "text", text: `${lines.join("\n")}${errorNote}` }],
						details: { action, newItems: newCount, changedPages: changedCount } satisfies MonitorDetails,
					};
				}

				return {
					content: [{ type: "text", text: `Unknown monitor action: ${action}` }],
					details: { action: "invalid" } satisfies MonitorDetails,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `monitor ${action} failed: ${message}` }],
					details: { action, error: message } satisfies MonitorDetails,
				};
			}
		},
	});
}
