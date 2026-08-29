/**
 * OpenPI Memory Package
 *
 * File-based long-term memory with frozen session snapshots, index CRUD,
 * compact-safe re-injection, heuristic + LLM extract, and AutoDream maintain.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { globalMemoryDir, loadMemoryConfig } from "./config.ts";
import { backupMemoryDirectory, ensureDurabilityLayout, listArchiveCount, loadActiveOrRecover } from "./durability.ts";
import {
	applyCandidates,
	extractFromTranscript,
	isHighConfidenceMemoryUtterance,
	isSoftMemoryUtterance,
	refreshSessionDigest,
	runBackgroundExtract,
	type TranscriptTurn,
	textFromSessionMessage,
} from "./extract.ts";
import { queueLlmExtract, runPendingLlmExtract } from "./llm-extract.ts";
import {
	bumpSessionCount,
	idleOrganize,
	loadMeta,
	maintainMemoryDirectory,
	maintainMemoryIndex,
	saveMeta,
	shouldMaintain,
} from "./maintain.ts";
import { formatSelectiveSnapshot, selectSnapshotEntries } from "./snapshot.ts";
import {
	deleteTopic,
	deleteTopicAt,
	formatSnapshot,
	loadIndex,
	loadIndexFile,
	memoryDir,
	queryEntries,
	readTopic,
	readTopicAt,
	removeEntry,
	sanitizeKey,
	sanitizeType,
	saveIndex,
	saveIndexAt,
	saveTopic,
	saveTopicAt,
	upsertEntry,
} from "./store.ts";
import { EXCLUSION_LIST, type MemoryConfig, type MemoryIndexEntry } from "./types.ts";
import { entriesFingerprint, hybridSearch, reindexVectors } from "./vectors.ts";

const MemoryParams = Type.Object({
	action: Type.String({
		description: "save | query | list | delete | read | maintain",
	}),
	type: Type.Optional(Type.String({ description: "user | feedback | project | lesson" })),
	key: Type.Optional(Type.String()),
	value: Type.Optional(Type.String({ description: "Short index summary for save" })),
	body: Type.Optional(Type.String({ description: "Optional full topic body for save" })),
	keyword: Type.Optional(Type.String({ description: "Keyword filter for query/list" })),
	scope: Type.Optional(Type.String({ description: "project (default) | global (~/.pi/memory)" })),
});

export default function (pi: ExtensionAPI) {
	let frozen: MemoryIndexEntry[] = [];

	// Per-session inject-set cache: keeps the proactive memory prefix
	// byte-stable across turns (prompt-cache friendly) while still letting
	// the first turn pick the most relevant memories via hybrid retrieval.
	const injectSetCache = new Map<string, { fingerprint: string; rankedRest: MemoryIndexEntry[] }>();
	let config = loadMemoryConfig(process.cwd());
	let lastAgentEndExtractAt = 0;
	let lastDigestRefreshAt = 0;

	function refreeze(cwd: string): void {
		config = loadMemoryConfig(cwd);
		const project = loadIndex(cwd);
		const globalParsed = config.includeGlobal ? loadIndexFile(globalMemoryDir()) : [];
		frozen = mergeUnique(globalParsed, project);
	}

	function bodyResolverProject(cwd: string) {
		return (entry: MemoryIndexEntry) => readTopic(cwd, entry.type, entry.key) ?? "";
	}

	function bodyResolverGlobal(dir: string) {
		return (entry: MemoryIndexEntry) => readTopicAt(dir, entry.type, entry.key) ?? "";
	}

	pi.registerTool({
		name: "memory",
		label: "Memory",
		description: `Manage long-term file memory under .pi/memory/ and ~/.pi/memory.

Actions:
- list / query: ranked search (BM25 over index + topic body)
- read: read topic file for type+key
- save: upsert index entry and topic file
- delete: remove index entry and topic file
- maintain: merge duplicates and prune junk (AutoDream)

Types: user, feedback, project, lesson.
Exclusion list: ${EXCLUSION_LIST.join("; ")}`,
		promptSnippet:
			"Long-term memory is auto-injected each turn. Apply prior preferences/decisions without asking the user to restate them. Save durable new prefs/facts with memory save.",
		promptGuidelines: [
			"Prior conversations may already appear under long-term memory — treat them as known; do not ask the user to re-explain.",
			"Do not wait for the user to say 'remember' or 'search memory'; use injected notes and call memory query only when you need more detail.",
			"When the user states a lasting preference, rule, or project decision, save it (user/feedback → prefer scope=global).",
			"Read the index before saving duplicates. Do not store git/code-derivable details.",
			"Prefer short index values; put detail in the topic body.",
		],
		parameters: MemoryParams,
		async execute(_id, params, _signal, _update, ctx) {
			const action = (params.action ?? "list").toLowerCase();
			const type = params.type ? sanitizeType(params.type) : undefined;
			const key = params.key ? sanitizeKey(params.key) : "";
			const scope = (params.scope ?? "project").toLowerCase() === "global" ? "global" : "project";
			config = loadMemoryConfig(ctx.cwd);
			const globalDir = globalMemoryDir();
			const projectEntries = loadIndex(ctx.cwd);
			const globalEntries = loadIndexFile(globalDir);
			const entries = scope === "global" ? globalEntries : projectEntries;

			if (action === "maintain") {
				const projectResult = maintainMemoryIndex(ctx.cwd, config);
				let globalResult: ReturnType<typeof maintainMemoryDirectory> | undefined;
				if (config.maintainGlobal) {
					globalResult = maintainMemoryDirectory(globalDir, config);
				}
				refreeze(ctx.cwd);
				const text = [
					`Project maintain: ${projectResult.before} → ${projectResult.after} (merged ${projectResult.merged}, pruned ${projectResult.pruned})`,
					globalResult
						? `Global maintain: ${globalResult.before} → ${globalResult.after} (merged ${globalResult.merged}, pruned ${globalResult.pruned})`
						: undefined,
				]
					.filter(Boolean)
					.join("\n");
				return {
					content: [{ type: "text", text }],
					details: { action, project: projectResult, global: globalResult },
				};
			}

			if (action === "list" || action === "query") {
				const hybridOpts = (dir: string) =>
					config.vectorSearch
						? {
								memoryDirectory: dir,
								hybrid: true as const,
								alpha: config.vectorAlpha,
								limit: 100,
								searchArchive: config.searchArchive,
								archiveSearchLimit: config.archiveSearchLimit,
								archiveSearchMinScore: config.archiveSearchMinScore,
							}
						: {
								searchArchive: config.searchArchive,
								archiveSearchLimit: config.archiveSearchLimit,
								archiveSearchMinScore: config.archiveSearchMinScore,
								memoryDirectory: dir,
								hybrid: false as const,
								limit: 100,
							};
				const matched =
					scope === "global"
						? queryEntries(
								globalEntries,
								params.keyword,
								type,
								bodyResolverGlobal(globalDir),
								hybridOpts(globalDir),
							)
						: params.scope
							? queryEntries(
									projectEntries,
									params.keyword,
									type,
									bodyResolverProject(ctx.cwd),
									hybridOpts(memoryDir(ctx.cwd)),
								)
							: queryEntries(
									mergeUnique(globalEntries, projectEntries),
									params.keyword,
									type,
									(entry) =>
										readTopic(ctx.cwd, entry.type, entry.key) ??
										readTopicAt(globalDir, entry.type, entry.key) ??
										"",
									hybridOpts(memoryDir(ctx.cwd)),
								);
				const text =
					matched.length === 0
						? "No memories found."
						: matched.map((entry) => `[${entry.type}] ${entry.key}: ${entry.value}`).join("\n");
				return {
					content: [{ type: "text", text }],
					details: { count: matched.length, action, scope, hybrid: config.vectorSearch },
				};
			}

			if (action === "read") {
				if (!type || !key) {
					return {
						content: [{ type: "text", text: "read requires type and key." }],
						details: { action, error: "missing params" },
					};
				}
				if (scope === "global") {
					const text = readTopicAt(globalDir, type, key);
					const summary = globalEntries.find((entry) => entry.type === type && entry.key === key)?.value;
					return {
						content: [
							{
								type: "text",
								text: text ?? summary ?? `No topic file for global ${type}/${key}.`,
							},
						],
						details: { action, found: Boolean(text || summary), scope },
					};
				}
				const body = readTopic(ctx.cwd, type, key);
				return {
					content: [{ type: "text", text: body ?? `No topic file for ${type}/${key}.` }],
					details: { action, found: Boolean(body), scope },
				};
			}

			if (action === "save") {
				if (!type || !key || !params.value) {
					return {
						content: [{ type: "text", text: "save requires type, key, and value." }],
						details: { action, error: "missing params" },
					};
				}
				if (scope === "global") {
					const next = saveIndexAt(
						globalDir,
						upsertEntry(globalEntries, type, key, params.value),
						config.maxIndexEntries,
					);
					const file = saveTopicAt(globalDir, type, key, params.body ?? params.value);
					refreeze(ctx.cwd);
					pi.appendEntry("openpi-memory:save", { type, key, file, scope, at: new Date().toISOString() });
					prewarmOnSave(config, params, globalDir);
					return {
						content: [{ type: "text", text: `Saved global ${type}/${key} (${next.length} index entries).` }],
						details: { action, type, key, count: next.length, scope },
					};
				}
				const next = saveIndex(ctx.cwd, upsertEntry(entries, type, key, params.value), config.maxIndexEntries);
				const file = saveTopic(ctx.cwd, type, key, params.body ?? params.value);
				refreeze(ctx.cwd);
				pi.appendEntry("openpi-memory:save", { type, key, file, scope, at: new Date().toISOString() });
				prewarmOnSave(config, params, memoryDir(ctx.cwd));
				return {
					content: [
						{
							type: "text",
							text: `Saved ${type}/${key} (${next.length} index entries). Snapshot refreshed for this session.`,
						},
					],
					details: { action, type, key, count: next.length, scope },
				};
			}

			if (action === "delete") {
				if (!type || !key) {
					return {
						content: [{ type: "text", text: "delete requires type and key." }],
						details: { action, error: "missing params" },
					};
				}
				if (scope === "global") {
					const next = saveIndexAt(globalDir, removeEntry(globalEntries, type, key), config.maxIndexEntries);
					deleteTopicAt(globalDir, type, key);
					refreeze(ctx.cwd);
					pi.appendEntry("openpi-memory:delete", { type, key, scope, at: new Date().toISOString() });
					return {
						content: [{ type: "text", text: `Deleted global ${type}/${key}. Index now ${next.length} entries.` }],
						details: { action, type, key, count: next.length, scope },
					};
				}
				const next = saveIndex(ctx.cwd, removeEntry(entries, type, key), config.maxIndexEntries);
				deleteTopic(ctx.cwd, type, key);
				refreeze(ctx.cwd);
				pi.appendEntry("openpi-memory:delete", { type, key, scope, at: new Date().toISOString() });
				return {
					content: [{ type: "text", text: `Deleted ${type}/${key}. Index now ${next.length} entries.` }],
					details: { action, type, key, count: next.length, scope },
				};
			}

			return {
				content: [{ type: "text", text: `Unknown action: ${action}` }],
				details: { action: "invalid" },
			};
		},
	});

	pi.registerCommand("memory", {
		description: "Show memory status; args: maintain | backup | status",
		handler: async (args, ctx) => {
			const cmd = (args ?? "").trim().toLowerCase();
			config = loadMemoryConfig(ctx.cwd);
			if (cmd === "maintain") {
				const projectResult = maintainMemoryIndex(ctx.cwd, config);
				const globalResult = config.maintainGlobal ? maintainMemoryDirectory(globalMemoryDir(), config) : undefined;
				refreeze(ctx.cwd);
				ctx.ui.notify(
					[
						`Project ${projectResult.before}→${projectResult.after} (merge ${projectResult.merged}, prune ${projectResult.pruned})`,
						globalResult
							? `Global ${globalResult.before}→${globalResult.after} (merge ${globalResult.merged}, prune ${globalResult.pruned})`
							: undefined,
					]
						.filter(Boolean)
						.join("\n"),
					"info",
				);
				return;
			}
			if (cmd === "backup") {
				const dest = backupMemoryDirectory(memoryDir(ctx.cwd), "manual");
				const gdest = backupMemoryDirectory(globalMemoryDir(), "manual-global");
				ctx.ui.notify(`Backup ok:\n${dest}\n${gdest}`, "info");
				return;
			}
			const disk = loadIndex(ctx.cwd);
			const global = loadIndexFile(globalMemoryDir());
			const meta = loadMeta(ctx.cwd);
			const archived = listArchiveCount(memoryDir(ctx.cwd));
			ctx.ui.notify(
				[
					`Freeze: ${frozen.length}`,
					`Project: ${disk.length} · Global: ${global.length} · Archive: ${archived}`,
					`Last maintain: ${meta.lastMaintainAt ?? "never"}`,
					`Last idle organize: ${meta.lastIdleOrganizeAt ?? "never"}`,
					`Last LLM extract: ${meta.lastLlmExtractAt ?? "never"}`,
					`Sessions since maintain: ${meta.sessionCountSinceMaintain ?? 0}`,
					`Durability: journal + archive + backups (soft-delete)`,
					`Paths: .pi/memory + ~/.pi/memory`,
				].join("\n"),
				"info",
			);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		config = loadMemoryConfig(ctx.cwd);
		// Durability: ensure layout + recover if index missing
		try {
			const dir = memoryDir(ctx.cwd);
			const gdir = globalMemoryDir();
			ensureDurabilityLayout(dir);
			loadActiveOrRecover(dir, config.maxIndexEntries);
			ensureDurabilityLayout(gdir);
			loadActiveOrRecover(gdir, config.maxIndexEntries);
			// Ensure vectors exist for fast proactive search (project + global)
			reindexVectors(dir, loadIndex(ctx.cwd), (e) => readTopic(ctx.cwd, e.type, e.key) ?? "");
			reindexVectors(gdir, loadIndexFile(gdir), (e) => readTopicAt(gdir, e.type, e.key) ?? "");
		} catch {
			// ignore
		}

		bumpSessionCount(ctx.cwd);

		let llmSaved = 0;
		try {
			llmSaved = await runPendingLlmExtract(ctx.cwd, config, ctx.model, ctx.modelRegistry, ctx.signal);
			if (llmSaved > 0) {
				const meta = loadMeta(ctx.cwd);
				meta.lastLlmExtractAt = new Date().toISOString();
				saveMeta(ctx.cwd, meta);
				pi.appendEntry("openpi-memory:llm-extract", {
					count: llmSaved,
					at: new Date().toISOString(),
				});
			}
		} catch {
			// ignore
		}

		let maintained: { before: number; after: number; merged: number; pruned: number } | undefined;
		let globalMaintained: typeof maintained;
		try {
			if (shouldMaintain(ctx.cwd, config)) {
				maintained = maintainMemoryIndex(ctx.cwd, config);
				if (config.maintainGlobal) {
					globalMaintained = maintainMemoryDirectory(globalMemoryDir(), config);
				}
				pi.appendEntry("openpi-memory:maintain", {
					...maintained,
					global: globalMaintained,
					at: new Date().toISOString(),
				});
			}
		} catch {
			// ignore
		}

		refreeze(ctx.cwd);
		if (ctx.hasUI) {
			const bits = [`frozen ${frozen.length}`];
			if (llmSaved > 0) bits.push(`llm+${llmSaved}`);
			if (maintained && (maintained.merged > 0 || maintained.pruned > 0 || maintained.before !== maintained.after)) {
				bits.push(`maintain ${maintained.before}→${maintained.after}`);
			}
			const archived = listArchiveCount(memoryDir(ctx.cwd));
			if (archived > 0) bits.push(`archive ${archived}`);
			if (frozen.length > 0 || llmSaved > 0 || maintained) {
				ctx.ui.notify(`Memory: ${bits.join(" · ")} · auto-inject on`, "info");
			}
		}
		pi.appendEntry("openpi-memory:freeze", {
			count: frozen.length,
			proactiveInject: config.proactiveInject,
			at: new Date().toISOString(),
		});

		// Standing instruction: cross-session memory is automatic
		if (config.proactiveInject && frozen.length > 0) {
			try {
				pi.sendMessage(
					{
						customType: "openpi-memory:proactive",
						content: [
							"Long-term memory is enabled for this session.",
							`${frozen.length} notes are available from prior chats (project + global).`,
							"Each user turn, relevant notes are injected automatically — apply them without asking the user to restate past preferences or work.",
							"Save new durable preferences/decisions with the memory tool (user/feedback → scope=global when personal).",
						].join("\n"),
						display: false,
						details: { kind: "proactive-standing", count: frozen.length },
					},
					{ deliverAs: "nextTurn" },
				);
			} catch {
				// ignore if host does not support sendMessage
			}
		}
	});

	pi.on("before_agent_start", async (event, ctx) => {
		config = loadMemoryConfig(ctx.cwd);
		if (!config.proactiveInject) return;
		// Always refresh freeze so same-session saves are visible next turn
		refreeze(ctx.cwd);
		if (frozen.length === 0) return;

		const gdir = globalMemoryDir();
		const resolveBody = (entry: MemoryIndexEntry) =>
			readTopic(ctx.cwd, entry.type, entry.key) ?? readTopicAt(gdir, entry.type, entry.key) ?? "";

		// Relevance-ranked inject set, fixed per session: hybrid vector+BM25 is
		// computed once (first turn), then reused so the injected prefix stays
		// byte-stable across turns — keeping provider prompt-cache hits and
		// long-session context intact. Cache invalidates when the frozen set
		// changes (new memories saved).
		const sessionId = ctx.sessionManager?.getSessionId?.() ?? ctx.cwd;
		const fingerprint = entriesFingerprint(frozen);
		const cached = injectSetCache.get(sessionId);
		let rankedRest: MemoryIndexEntry[] | undefined;
		if (!cached || cached.fingerprint !== fingerprint) {
			const pinSet = new Set(config.pinTypes);
			const others = frozen.filter(
				(entry) => !pinSet.has(entry.type) && !(entry.type === "project" && entry.key.startsWith("session-")),
			);
			const max = Math.max(config.pinTypes.length + 2, config.maxSnapshotEntries);
			const hits = config.vectorSearch
				? hybridSearch(others, event.prompt ?? "", memoryDir(ctx.cwd), {
						bodyResolver: resolveBody,
						limit: max,
						alpha: config.vectorAlpha,
					})
				: [];
			rankedRest = hits.map((hit) => hit.entry);
			injectSetCache.set(sessionId, { fingerprint, rankedRest });
		} else {
			rankedRest = cached.rankedRest;
		}

		const selected = selectSnapshotEntries(
			frozen,
			event.prompt,
			config,
			resolveBody,
			// Prefer project vectors; BM25 still ranks global entries via value/body text
			memoryDir(ctx.cwd),
			rankedRest,
		);
		// Include digest bodies so “上次聊到哪” gets real facts, not a one-line teaser
		const content = formatSelectiveSnapshot(selected, frozen.length, event.prompt, resolveBody);
		return {
			message: {
				customType: "openpi-memory:snapshot",
				content,
				display: false,
				details: {
					count: selected.length,
					available: frozen.length,
					selective: selected.length < frozen.length,
					hybrid: config.vectorSearch,
					proactive: true,
					withBodies: true,
				},
			},
		};
	});

	// Idle time: after agent settles, refresh continuity digest + organize when due
	pi.on("agent_settled", async (_event, ctx) => {
		config = loadMemoryConfig(ctx.cwd);
		try {
			// Mid-session digest so crash/close mid-chat still leaves continuity
			if (config.digestRefreshDuringSession && config.autoSessionDigest) {
				const now = Date.now();
				const minGap = config.digestRefreshMinIntervalMs ?? 90_000;
				if (now - lastDigestRefreshAt >= minGap) {
					const turns = collectTranscriptTurns(ctx.sessionManager);
					const richAssistant = turns.some(
						(t) =>
							t.role === "assistant" &&
							(t.text.includes("|") || /\d+\/10/.test(t.text) || t.text.includes("结论")),
					);
					if (turns.length >= 2 && richAssistant) {
						const dig = refreshSessionDigest(ctx.cwd, turns, config);
						if (dig.saved) {
							lastDigestRefreshAt = now;
							const meta = loadMeta(ctx.cwd);
							meta.lastDigestAt = new Date().toISOString();
							saveMeta(ctx.cwd, meta);
							refreeze(ctx.cwd);
							try {
								reindexVectors(
									memoryDir(ctx.cwd),
									loadIndex(ctx.cwd),
									(e) => readTopic(ctx.cwd, e.type, e.key) ?? "",
								);
							} catch {
								// ignore
							}
							pi.appendEntry("openpi-memory:session-digest", {
								when: "agent_settled",
								summary: dig.summary,
								bodyLen: dig.bodyLen,
								at: new Date().toISOString(),
							});
						}
					}
				}
			}

			const result = idleOrganize(ctx.cwd, config);
			if (result && ctx.hasUI && (result.merged > 0 || result.pruned > 0)) {
				ctx.ui.notify(
					`Memory idle organize: ${result.before}→${result.after} (merge ${result.merged}, prune ${result.pruned})`,
					"info",
				);
			}
		} catch {
			// ignore
		}
	});

	// Mid-session extract: high-confidence always; soft signals when enabled (no user ritual required)
	pi.on("agent_end", async (event, ctx) => {
		config = loadMemoryConfig(ctx.cwd);
		if (!config.extractOnAgentEnd && !config.digestRefreshDuringSession) return;
		const now = Date.now();

		const turns = messagesToTurns(event.messages ?? []);
		const lastUser = [...turns].reverse().find((t) => t.role === "user");
		const lastAssistant = [...turns].reverse().find((t) => t.role === "assistant");

		// Continuity digest: refresh when assistant produced structured conclusions
		if (
			config.digestRefreshDuringSession &&
			config.autoSessionDigest &&
			lastAssistant &&
			now - lastDigestRefreshAt >= (config.digestRefreshMinIntervalMs ?? 90_000) &&
			(lastAssistant.text.includes("|") ||
				/\d+\/10/.test(lastAssistant.text) ||
				/结论|优先改进|Named topics/i.test(lastAssistant.text) ||
				lastAssistant.text.length > 800)
		) {
			try {
				const dig = refreshSessionDigest(ctx.cwd, turns, config);
				if (dig.saved) {
					lastDigestRefreshAt = now;
					const meta = loadMeta(ctx.cwd);
					meta.lastDigestAt = new Date().toISOString();
					saveMeta(ctx.cwd, meta);
					refreeze(ctx.cwd);
					pi.appendEntry("openpi-memory:session-digest", {
						when: "agent_end",
						summary: dig.summary,
						bodyLen: dig.bodyLen,
						at: new Date().toISOString(),
					});
				}
			} catch {
				// ignore
			}
		}

		if (!config.extractOnAgentEnd || !lastUser) return;
		if (now - lastAgentEndExtractAt < 8_000) return; // debounce

		const high = isHighConfidenceMemoryUtterance(lastUser.text);
		const soft = config.softExtractEveryTurn && isSoftMemoryUtterance(lastUser.text);
		if (!high && !soft) return;

		const existing = mergeUnique(loadIndexFile(globalMemoryDir()), loadIndex(ctx.cwd));
		const candidates = extractFromTranscript([lastUser], existing);
		if (candidates.length === 0) return;
		const saved = applyCandidates(ctx.cwd, candidates, config);
		if (saved > 0) {
			lastAgentEndExtractAt = now;
			refreeze(ctx.cwd);
			// Keep search indexes warm for next turn inject
			try {
				reindexVectors(memoryDir(ctx.cwd), loadIndex(ctx.cwd), (e) => readTopic(ctx.cwd, e.type, e.key) ?? "");
				if (config.promoteUserToGlobal) {
					const gdir = globalMemoryDir();
					reindexVectors(gdir, loadIndexFile(gdir), (e) => readTopicAt(gdir, e.type, e.key) ?? "");
				}
			} catch {
				// ignore
			}
			pi.appendEntry("openpi-memory:turn-extract", {
				count: saved,
				high,
				soft,
				at: new Date().toISOString(),
			});
			if (ctx.hasUI && high) {
				ctx.ui.notify(`Memory: captured ${saved} note(s) for later chats.`, "info");
			}
		}
	});

	pi.on("session_before_compact", async (_event, ctx) => {
		const snapshot = formatSnapshot(frozen);
		pi.appendEntry("openpi-memory:compact-checkpoint", {
			at: new Date().toISOString(),
			frozenCount: frozen.length,
			instructions:
				"Preserve durable user preferences, validated corrections, project decisions, and lessons from the frozen memory snapshot.",
			snapshot,
		});
		if (!config.flushOnCompact) return;
		// Soft heuristic extract + queue LLM before compact loses detail
		try {
			const turns = collectTranscriptTurns(ctx.sessionManager);
			const existing = loadIndex(ctx.cwd);
			const candidates = extractFromTranscript(turns, existing);
			const saved = applyCandidates(ctx.cwd, candidates, config);
			if (saved > 0) refreeze(ctx.cwd);
			if (config.llmExtract && turns.length >= 2) {
				queueLlmExtract(ctx.cwd, turns, loadIndex(ctx.cwd));
			}
		} catch {
			// ignore
		}
		pi.sendMessage(
			{
				customType: "openpi-memory:compact-flush",
				content: [
					"Context compaction is about to summarize older turns.",
					"If anything durable should be remembered across sessions, call the memory tool (save) now for user/feedback/project/lesson items.",
					"Do not store code/git-derivable details.",
					"",
					formatSnapshot(frozen),
				].join("\n"),
				display: false,
				details: { kind: "compact-flush" },
			},
			{ deliverAs: "nextTurn" },
		);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		config = loadMemoryConfig(ctx.cwd);
		if (!config.extractOnShutdown && !config.autoSessionDigest) return;

		let heuristicSaved = 0;
		let digestSaved = 0;
		let turns: TranscriptTurn[] = [];
		try {
			turns = collectTranscriptTurns(ctx.sessionManager);
			const existing = mergeUnique(loadIndexFile(globalMemoryDir()), loadIndex(ctx.cwd));

			if (config.extractOnShutdown) {
				const candidates = extractFromTranscript(turns, existing);
				heuristicSaved = applyCandidates(ctx.cwd, candidates, config);
				if (heuristicSaved > 0) {
					pi.appendEntry("openpi-memory:auto-extract", {
						count: heuristicSaved,
						at: new Date().toISOString(),
						keys: candidates.slice(0, 12).map((c) => `${c.type}/${c.key}`),
					});
				}
			}

			// Always try session digest so next chat knows “what we were doing”
			if (config.autoSessionDigest) {
				const dig = refreshSessionDigest(ctx.cwd, turns, config);
				if (dig.saved) {
					digestSaved = 1;
					const meta = loadMeta(ctx.cwd);
					meta.lastDigestAt = new Date().toISOString();
					saveMeta(ctx.cwd, meta);
					pi.appendEntry("openpi-memory:session-digest", {
						when: "shutdown",
						summary: dig.summary,
						bodyLen: dig.bodyLen,
						at: new Date().toISOString(),
					});
				}
			}

			if (config.llmExtract && turns.length >= 2) {
				queueLlmExtract(ctx.cwd, turns, loadIndex(ctx.cwd));
			}

			// Refresh vectors so next session proactive inject is warm
			try {
				reindexVectors(memoryDir(ctx.cwd), loadIndex(ctx.cwd), (e) => readTopic(ctx.cwd, e.type, e.key) ?? "");
			} catch {
				// ignore
			}
		} catch {
			// ignore
		}

		const promoted = config.extractOnShutdown ? runBackgroundExtract(ctx.cwd, config) : 0;
		const total = heuristicSaved + digestSaved + promoted;
		if (total > 0 && ctx.hasUI) {
			ctx.ui.notify(
				`Memory: auto-saved ${total} note(s) for later chats${digestSaved ? " (incl. session digest)" : ""}.`,
				"info",
			);
		}
	});
}

function collectTranscriptTurns(sessionManager: {
	getBranch?: () => Array<{ type?: string; message?: unknown }>;
}): TranscriptTurn[] {
	const branch = typeof sessionManager.getBranch === "function" ? sessionManager.getBranch() : [];
	const turns: TranscriptTurn[] = [];
	for (const entry of branch) {
		if (!entry || entry.type !== "message" || !entry.message) continue;
		const message = entry.message as { role?: string };
		if (message.role !== "user" && message.role !== "assistant") continue;
		const text = textFromSessionMessage(message);
		if (!text) continue;
		turns.push({ role: message.role, text });
	}
	return turns;
}

function messagesToTurns(messages: unknown[]): TranscriptTurn[] {
	const turns: TranscriptTurn[] = [];
	for (const message of messages) {
		if (!message || typeof message !== "object") continue;
		const role = (message as { role?: string }).role;
		if (role !== "user" && role !== "assistant") continue;
		const text = textFromSessionMessage(message);
		if (!text) continue;
		turns.push({ role, text });
	}
	return turns;
}

/** Fire-and-forget cache pre-warm after a memory save/update. */
function prewarmOnSave(_config: MemoryConfig, _params: { value?: string; body?: string }, _dir: string): void {
	// Vector indexing is handled by reindexVectors on the next maintain cycle;
	// explicit cache pre-warm is no longer needed.
}

function mergeUnique(globalEntries: MemoryIndexEntry[], project: MemoryIndexEntry[]): MemoryIndexEntry[] {
	const map = new Map<string, MemoryIndexEntry>();
	for (const entry of globalEntries) map.set(`${entry.type}:${entry.key}`, entry);
	for (const entry of project) map.set(`${entry.type}:${entry.key}`, entry);
	return [...map.values()];
}
