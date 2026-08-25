/**
 * Built-in status-bar segments for the desktop status bar / usage card.
 *
 * The desktop polls these via the `get_status_segments` RPC command. Segments
 * registered by extensions (`pi.registerStatusSegment`) are merged in alongside
 * the built-ins. Adding a new indicator here (or in an extension) no longer
 * requires repackaging the desktop app — only a coding-agent rebuild / daemon
 * restart, or an extension source change + daemon restart.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getAgentDir } from "../config.ts";
import type { AgentSession } from "./agent-session.ts";
import type { StatusSegmentProvider, StatusSegmentValue } from "./extensions/types.ts";

/** Serialized segment sent over RPC (order is resolved server-side). */
export interface StatusSegment {
	id: string;
	label: string;
	value: string;
	hint?: string;
	progress?: number;
	tone?: "normal" | "warn" | "error";
}

// ── 账户类数据抓取（从 desktop bridge 迁入，加 60s 缓存） ────────────────────

const ACCOUNT_CACHE_TTL_MS = 60_000;
const accountCache = new Map<string, { at: number; value: Promise<StatusSegmentValue | undefined> }>();

function cached<T extends StatusSegmentValue>(
	key: string,
	compute: () => Promise<T | undefined>,
): Promise<StatusSegmentValue | undefined> {
	const now = Date.now();
	const hit = accountCache.get(key);
	if (hit && now - hit.at < ACCOUNT_CACHE_TTL_MS) return hit.value;
	const value = compute().catch(() => undefined);
	accountCache.set(key, { at: now, value });
	return value;
}

async function fetchProviderBalance(provider: string): Promise<StatusSegmentValue | undefined> {
	const modelsPath = join(getAgentDir(), "models.json");
	if (!existsSync(modelsPath)) return undefined;
	const providers = JSON.parse(readFileSync(modelsPath, "utf8"))?.providers ?? {};
	const config = providers[provider];
	if (!config || typeof config !== "object") return undefined;
	const baseUrl = config.baseUrl;
	const apiKey = config.apiKey;
	if (typeof baseUrl !== "string" || typeof apiKey !== "string") return undefined;
	const url = `${baseUrl.replace(/\/+$/, "")}/user/balance`;
	const response = await fetch(url, {
		headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
		signal: AbortSignal.timeout(10_000),
	});
	if (!response.ok) return undefined;
	const data: unknown = await response.json();
	if (!data || typeof data !== "object") return undefined;
	const record = data as Record<string, unknown>;
	const infos = Array.isArray(record.balance_infos) ? (record.balance_infos as Array<Record<string, unknown>>) : [];
	const entry = infos.find((i) => i?.currency === "USD") ?? infos[0];
	if (!entry) return undefined;
	const amount = Number(entry.total_balance ?? 0);
	return { value: `${amount.toFixed(2)} ${String(entry.currency ?? "USD")}` };
}

async function fetchOpencodeUsage(): Promise<StatusSegmentValue | undefined> {
	const authPath = join(homedir(), ".local", "share", "opencode", "auth.json");
	if (!existsSync(authPath)) return undefined;
	const auth = JSON.parse(readFileSync(authPath, "utf8"));
	const key = auth["opencode-go"]?.key ?? auth.opencodeGo?.key;
	if (typeof key !== "string" || !key) return undefined;
	const response = await fetch("https://opencode.ai/zen/go/v1/usage", {
		headers: { authorization: `Bearer ${key}`, accept: "application/json" },
		signal: AbortSignal.timeout(10_000),
	});
	if (!response.ok) return undefined;
	const data: unknown = await response.json();
	if (!data || typeof data !== "object") return undefined;
	const usage = (data as Record<string, unknown>).usage as Record<string, unknown> | undefined;
	if (!usage || typeof usage !== "object") return undefined;
	const percent = (window: unknown): number | undefined =>
		window && typeof window === "object" ? Number((window as { percent?: unknown }).percent ?? 0) : undefined;
	const rolling = percent(usage.rolling);
	const weekly = percent(usage.weekly);
	const monthly = percent(usage.monthly);
	return {
		value: [rolling, weekly, monthly].map((v) => (v === undefined ? "--" : `${Math.round(v)}%`)).join("·"),
		hint: "OpenCode Go 官方用量（滚动/周/月）",
	};
}

// ── 会话统计（每轮拉取时重新计算） ────────────────────────────────────────────

function fmtTokens(n: number): string {
	return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(n);
}

function fmtCost(n: number): string {
	return n >= 0.01 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`;
}

function readCompactionSettings(): { reserveTokens: number; keepRecentTokens: number } {
	try {
		const path = join(getAgentDir(), "settings.json");
		if (!existsSync(path)) return { reserveTokens: 16384, keepRecentTokens: 30000 };
		const settings = JSON.parse(readFileSync(path, "utf8"));
		const compaction = settings?.compaction;
		return {
			reserveTokens: typeof compaction?.reserveTokens === "number" ? compaction.reserveTokens : 16384,
			keepRecentTokens: typeof compaction?.keepRecentTokens === "number" ? compaction.keepRecentTokens : 30000,
		};
	} catch {
		return { reserveTokens: 16384, keepRecentTokens: 30000 };
	}
}

interface SessionSegments {
	lastHit?: StatusSegmentValue;
	avgHit?: StatusSegmentValue;
	totalTok?: StatusSegmentValue;
	lastTotal?: StatusSegmentValue;
	lastCost?: StatusSegmentValue;
	totalCost?: StatusSegmentValue;
	turns?: StatusSegmentValue;
	ctx?: StatusSegmentValue;
	compactThreshold?: StatusSegmentValue;
}

async function computeSessionStats(session: AgentSession): Promise<SessionSegments> {
	const stats = session.getSessionStats();
	const lastAssistant = [...session.messages].reverse().find((m) => m.role === "assistant" && "usage" in m);
	const lastUsage = lastAssistant && "usage" in lastAssistant ? lastAssistant.usage : undefined;
	const lastTotal = lastUsage ? lastUsage.input + lastUsage.cacheRead + lastUsage.cacheWrite : 0;
	const lastHit = lastTotal > 0 ? Math.round((lastUsage!.cacheRead / lastTotal) * 100) : undefined;
	const avgHit = stats.tokens.total > 0 ? Math.round((stats.tokens.cacheRead / stats.tokens.total) * 100) : undefined;
	const lastCost = lastUsage?.cost?.total ?? 0;
	const ctxPercent =
		stats.contextUsage && typeof stats.contextUsage.percent === "number"
			? Math.round(stats.contextUsage.percent)
			: undefined;
	const compaction = readCompactionSettings();
	const compactThreshold = compaction ? compaction.reserveTokens + compaction.keepRecentTokens : undefined;
	return {
		lastHit: lastHit === undefined ? undefined : { value: `${lastHit}%`, hint: "本次命中率" },
		avgHit: avgHit === undefined ? undefined : { value: `${avgHit}%`, hint: "平均命中率" },
		totalTok: { value: `${fmtTokens(stats.tokens.total)} tok`, hint: "会话 token" },
		lastTotal: lastTotal > 0 ? { value: `+${fmtTokens(lastTotal)}`, hint: "本次 token" } : undefined,
		lastCost: lastCost > 0 ? { value: fmtCost(lastCost), hint: "本次费用" } : undefined,
		totalCost: stats.cost > 0 ? { value: fmtCost(stats.cost), hint: "会话费用" } : undefined,
		turns: { value: `${stats.userMessages} 轮`, hint: "对话轮数" },
		ctx:
			ctxPercent === undefined
				? undefined
				: { value: `${ctxPercent}%`, hint: "上下文占用", progress: ctxPercent / 100 },
		compactThreshold:
			compactThreshold === undefined ? undefined : { value: fmtTokens(compactThreshold), hint: "压缩阈值" },
	};
}

// ── 内置 providers + 聚合 ────────────────────────────────────────────────────

function builtinProviders(session: AgentSession): StatusSegmentProvider[] {
	let shared: Promise<SessionSegments> | undefined;
	const getShared = () => {
		if (shared === undefined) shared = computeSessionStats(session);
		return shared;
	};
	return [
		{
			id: "opencode-usage",
			label: "Go",
			order: 1,
			getValue: () => cached("opencode-usage", fetchOpencodeUsage),
		},
		{
			id: "provider-balance",
			label: "余额",
			order: 2,
			getValue: async () => {
				const provider = session.model?.provider;
				if (!provider) return undefined;
				return cached(`balance:${provider}`, () => fetchProviderBalance(provider));
			},
		},
		{
			id: "deepseek-balance",
			label: "DS",
			order: 3,
			getValue: () => cached("deepseek", () => fetchProviderBalance("deepseek")),
		},
		{ id: "last-hit", label: "本次命中", order: 20, getValue: async () => (await getShared()).lastHit },
		{ id: "avg-hit", label: "平均命中", order: 21, getValue: async () => (await getShared()).avgHit },
		{ id: "total-tok", label: "会话 Token", order: 22, getValue: async () => (await getShared()).totalTok },
		{ id: "last-total", label: "本次 Token", order: 23, getValue: async () => (await getShared()).lastTotal },
		{ id: "last-cost", label: "本次费用", order: 24, getValue: async () => (await getShared()).lastCost },
		{ id: "total-cost", label: "会话费用", order: 25, getValue: async () => (await getShared()).totalCost },
		{ id: "turns", label: "对话轮数", order: 26, getValue: async () => (await getShared()).turns },
		{ id: "ctx", label: "上下文占用", order: 27, getValue: async () => (await getShared()).ctx },
		{
			id: "compact-threshold",
			label: "压缩阈值",
			order: 28,
			getValue: async () => (await getShared()).compactThreshold,
		},
	];
}

/**
 * Merge built-in + extension status segments and compute current values.
 * Providers that throw or return undefined are omitted for this poll.
 */
export async function getStatusSegments(session: AgentSession): Promise<StatusSegment[]> {
	const providers = [...builtinProviders(session), ...session.extensionRunner.getStatusSegments()];
	const entries = await Promise.all(
		providers.map(async (provider) => {
			try {
				const value = await provider.getValue();
				if (!value) return undefined;
				return {
					order: provider.order ?? 100,
					segment: {
						id: provider.id,
						label: provider.label,
						value: value.value,
						hint: value.hint,
						progress: value.progress,
						tone: value.tone,
					} satisfies StatusSegment,
				};
			} catch {
				return undefined;
			}
		}),
	);
	const present: Array<{ order: number; segment: StatusSegment }> = [];
	for (const entry of entries) {
		if (entry) present.push(entry);
	}
	present.sort((left, right) => left.order - right.order);
	return present.map((entry) => entry.segment);
}
