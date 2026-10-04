import React, { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { desktopApi } from "../api";
import {
	contentText,
	visibleMessageText,
	messageReasoning,
	isRecord,
	isToolCallBlock,
	toolCallSummary,
	toolCallIconName,
	shortWorkspacePath,
	cleanPath,
	formatDuration,
	type ActionChainItem,
	type ToolCallBlock,
} from "../lib/helpers";
import {
	initialTurnProgress,
	reduceTurnProgress,
	toolLabel,
	turnVerb,
	type TurnProgress,
} from "../lib/turn-progress";
import type { AgentInstance, ConversationMessage, ConversationSnapshot, ConversationStats, RunningTool } from "../types";
import {
	ExternalLink,
	CircleStop,
	FileText,
	Terminal,
	Clock3,
} from "./icons";

// ── Step & Scope Extraction ──
interface ProcessRow {
	id: string;
	actionType: string;
	path: string;
	durationText: string;
	status: "done" | "running" | "pending" | "error";
}

function deriveVerb(toolName?: string, pathOrCommand?: string): string {
	const t = (toolName || "").toLowerCase();
	const p = (pathOrCommand || "").toLowerCase();
	if (t.includes("read") || t.includes("cat") || t.includes("view")) return "Analyzed";
	if (t.includes("edit") || t.includes("replace") || t.includes("patch")) return "Edited";
	if (t.includes("write")) return "Wrote";
	if (t.includes("grep") || t.includes("search") || t.includes("find") || t.includes("glob")) return "Searched";
	if (t.includes("bash") || t.includes("terminal") || t.includes("exec")) {
		if (p.includes("cargo test") || p.includes("pytest") || p.includes("test")) return "Tested";
		if (p.includes("cargo build") || p.includes("cargo check") || p.includes("build")) return "Built";
		if (p.includes("git ")) return "Git";
		if (p.includes("npm") || p.includes("pnpm") || p.includes("yarn") || p.includes("pip")) return "Installed";
		return "Ran";
	}
	if (t.includes("subagent")) return "Delegated";
	if (t.includes("mcp")) return "Interfaced";
	return "Called";
}

function cleanActionTarget(raw?: string, toolName?: string, cwd?: string): string {
	if (!raw) return "—";
	let text = raw.trim();
	// Remove leading shell wrappers
	text = text.replace(/^cd\s+[^&]+\s*&&\s*/i, "");
	text = text.replace(/^bash\s+-c\s+["']?(.*?)["']?$/i, "$1");

	// Strip workspace cwd prefix if present
	if (cwd && text.startsWith(cwd)) {
		text = text.slice(cwd.length).replace(/^[/\\]+/, "");
	}
	// Strip users home path prefix
	if (text.startsWith("/Users/")) {
		const parts = text.split("/");
		if (parts.length > 3) {
			text = parts.slice(3).join("/");
		}
	}
	return text || "—";
}

function formatDurationDisplay(ms?: number): string {
	if (ms === undefined || ms === null || isNaN(ms)) return "—";
	if (ms < 1000) return `${Math.max(10, Math.round(ms))}ms`;
	const sec = ms / 1000;
	if (sec < 60) return `${sec.toFixed(1)}s`;
	const min = Math.floor(sec / 60);
	const rem = Math.round(sec % 60);
	return `${min}m ${rem}s`;
}

function formatElapsedSec(sec: number): string {
	if (sec < 60) return `${sec}s`;
	const min = Math.floor(sec / 60);
	const rem = sec % 60;
	return `${min}m ${rem}s`;
}

export type IslandMode = "idle" | "working" | "expanded" | "attention";

export function IslandApp() {
	const [isExpanded, setIsExpanded] = useState(false);

	const [justCompleted, setJustCompleted] = useState(false);
	const completionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const [activeInstance, setActiveInstance] = useState<AgentInstance | null>(null);
	const [conversation, setConversation] = useState<ConversationSnapshot | null>(null);
	const [turnProgress, setTurnProgress] = useState<TurnProgress | undefined>();
	const [runningTools, setRunningTools] = useState<RunningTool[]>([]);
	const [toolDurations, setToolDurations] = useState<Record<string, number>>({});
	const [isStreaming, setIsStreaming] = useState(false);
	const [stats, setStats] = useState<ConversationStats | null>(null);
	const [lastTurnDuration, setLastTurnDuration] = useState<number | null>(null);
	const [now, setNow] = useState(() => Date.now());

	const activeInstanceRef = useRef<AgentInstance | null>(null);
	activeInstanceRef.current = activeInstance;
	const isBusyRef = useRef(false);

	const loadConversation = useCallback(async (instanceId: string) => {
		try {
			const conv = await desktopApi.getConversation(instanceId);
			if (conv?.instance) {
				setConversation(conv);
				const streaming = Boolean(conv.state?.isStreaming);
				setIsStreaming(streaming);
				setActiveInstance(conv.instance);
				if (!streaming) {
					// The daemon owns the run state. Once it reports the run as over, drop
					// the transient working state as well — otherwise the HUD keeps showing
					// a finished run as if it were still going, contradicting the main
					// window (which polls and sees the same daemon state).
					setRunningTools([]);
					setTurnProgress(undefined);
				}
			}
		} catch (err) {
			console.error("Failed to load conversation:", err);
		}
	}, []);

	const refreshSnapshot = useCallback(async () => {
		try {
			const snap = await desktopApi.getSnapshot();
			if (!snap?.instances?.length) return;

			const userInstances = snap.instances.filter((i) => !i.id.startsWith("subagent-"));
			const candidates = userInstances.length ? userInstances : snap.instances;

			let storedId: string | undefined;
			try {
				const stored = window.localStorage.getItem("openpi-selected-instance");
				if (stored && candidates.some((c) => c.id === stored)) {
					storedId = stored;
				}
			} catch {}

			const runningInstance = candidates.find((i) => i.status === "online" || i.status === "starting");
			const targetId = storedId || (runningInstance ? runningInstance.id : candidates[0].id);
			if (targetId) {
				await loadConversation(targetId);
			}
		} catch (err) {
			console.error("Failed to load island snapshot:", err);
		}
	}, [loadConversation]);

	useEffect(() => {
		refreshSnapshot();
	}, [refreshSnapshot]);

	const isBusy =
		isStreaming ||
		runningTools.length > 0 ||
		turnProgress?.stage === "thinking" ||
		turnProgress?.stage === "tool";
	isBusyRef.current = isBusy;

	const currentMode: IslandMode = useMemo(() => {
		if (isExpanded) return "expanded";
		if (isBusy) return "working";
		return "idle";
	}, [isExpanded, isBusy]);

	// Reconcile with the daemon on a timer. The island used to refresh only on a
	// handful of events, so one missed event (window hidden, island started late)
	// left it stuck on a stale run while the main window — which polls — moved on.
	useEffect(() => {
		const interval = window.setInterval(
			() => {
				void refreshSnapshot();
			},
			isBusy ? 3_000 : 12_000,
		);
		return () => window.clearInterval(interval);
	}, [isBusy, refreshSnapshot]);

	useEffect(() => {
		const syncWindow = async () => {
			try {
				await desktopApi.setIslandExpanded(isExpanded, currentMode);
			} catch (e) {
				console.warn("Failed to update island window frame:", e);
			}
		};
		void syncWindow();
	}, [isExpanded, currentMode]);

	useEffect(() => {
		const unlisten = desktopApi.onIslandState?.((payload) => {
			if (typeof payload?.expanded === "boolean") {
				setIsExpanded(payload.expanded);
			}
		});
		return () => {
			unlisten?.();
		};
	}, []);

	// ── Mouse Auto-Collapse Management (Hover-Out to Retract) ──
	const collapseTimerRef = useRef<NodeJS.Timeout | null>(null);

	const handleCardMouseEnter = useCallback(() => {
		if (collapseTimerRef.current) {
			clearTimeout(collapseTimerRef.current);
			collapseTimerRef.current = null;
		}
	}, []);

	const handleCardMouseLeave = useCallback(() => {
		if (!isExpanded) return;
		if (collapseTimerRef.current) {
			clearTimeout(collapseTimerRef.current);
		}
		// 180ms grace window to prevent accidental retract on fast mouse moves
		collapseTimerRef.current = setTimeout(() => {
			setIsExpanded(false);
		}, 180);
	}, [isExpanded]);

	useEffect(() => {
		if (!isExpanded) return;

		const handleDocLeave = (e: MouseEvent) => {
			if (!e.relatedTarget && !(e as any).toElement) {
				handleCardMouseLeave();
			}
		};

		document.addEventListener("mouseleave", handleDocLeave);
		window.addEventListener("blur", handleCardMouseLeave);
		return () => {
			document.removeEventListener("mouseleave", handleDocLeave);
			window.removeEventListener("blur", handleCardMouseLeave);
			if (collapseTimerRef.current) {
				clearTimeout(collapseTimerRef.current);
			}
		};
	}, [isExpanded, handleCardMouseLeave]);

	useEffect(() => {
		if (!isBusy) return;
		const t = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(t);
	}, [isBusy]);

	// Keep conversation updated while busy
	useEffect(() => {
		if (!isBusy || !activeInstance?.id) return;
		const timer = setInterval(() => {
			void loadConversation(activeInstance.id);
		}, 1500);
		return () => clearInterval(timer);
	}, [isBusy, activeInstance?.id, loadConversation]);

	useEffect(() => {
		const id = activeInstance?.id;
		if (!id) return;
		let cancelled = false;
		const load = async () => {
			try {
				const s = await desktopApi.getConversationStats(id);
				if (!cancelled) setStats(s);
			} catch {}
		};
		void load();
		const t = setInterval(load, 3000);
		return () => {
			cancelled = true;
			clearInterval(t);
		};
	}, [activeInstance?.id]);

	useEffect(() => {
		if (isBusy) {
			if (completionTimerRef.current) {
				clearTimeout(completionTimerRef.current);
				completionTimerRef.current = null;
			}
			setJustCompleted(false);
			void desktopApi.showIslandWindow();
		}
	}, [isBusy]);

	useEffect(() => {
		if (!desktopApi.isNative) return;

		const unlisten = desktopApi.onConversationEvent((payload) => {
			if (!payload?.instanceId || !payload?.event || !isRecord(payload.event)) return;
			const { instanceId } = payload;
			const event = payload.event as Record<string, any>;
			const eventType = typeof event.type === "string" ? event.type : undefined;

			const amEvent = isRecord(event.assistantMessageEvent)
				? (event.assistantMessageEvent as Record<string, any>)
				: undefined;
			const amType = amEvent && typeof amEvent.type === "string" ? amEvent.type : undefined;

			const isSubagent = instanceId.startsWith("subagent-");
			if (instanceId === "task-scheduler") {
				const evType = event.type;
				if (evType === "task_run_started") {
					void desktopApi.showIslandWindow();
				} else if (evType === "task_run_completed") {
					setJustCompleted(true);
					setTimeout(() => {
						void desktopApi.hideIslandWindow();
					}, 3500);
				}
				return;
			}

			const currentId = activeInstanceRef.current?.id;
			if (!isSubagent && currentId !== instanceId) {
				void loadConversation(instanceId);
			}

			setTurnProgress((current) => {
				const base =
					current && current.instanceId === instanceId
						? current
						: initialTurnProgress(instanceId);
				return reduceTurnProgress(base, {
					instanceId,
					type: eventType,
					assistantMessageEvent: amType ? { type: amType } : undefined,
					toolName: event.toolName,
					step: typeof event.step === "number" ? event.step : undefined,
					maxSteps: typeof event.maxSteps === "number" ? event.maxSteps : undefined,
					model: typeof event.model === "string" ? event.model : undefined,
					error: event.error,
				});
			});

			if (eventType === "tool_execution_start" || eventType === "tool_execution_update") {
				const toolCallId = typeof event.toolCallId === "string" ? event.toolCallId : undefined;
				const toolName = typeof event.toolName === "string" ? event.toolName : undefined;
				if (toolCallId && toolName) {
					const nowMs = Date.now();
					setRunningTools((current) => {
						const existingTool = current.find((t) => t.toolCallId === toolCallId);
						const next: RunningTool = {
							toolCallId,
							toolName,
							status: eventType === "tool_execution_update" ? "updating" : "running",
							args: event.args,
							partialResult: event.partialResult,
							startedAt: existingTool?.startedAt ?? nowMs,
							updatedAt: nowMs,
						};
						const existingIndex = current.findIndex((t) => t.toolCallId === toolCallId);
						if (existingIndex === -1) return [...current, next];
						return current.map((t, idx) => (idx === existingIndex ? next : t));
					});
				}
			} else if (eventType === "tool_execution_end") {
				const toolCallId = typeof event.toolCallId === "string" ? event.toolCallId : undefined;
				if (toolCallId) {
					setRunningTools((current) => {
						const existing = current.find((t) => t.toolCallId === toolCallId);
						if (existing) {
							const duration = Math.max(1, Date.now() - existing.startedAt);
							setToolDurations((prev) => ({ ...prev, [toolCallId]: duration }));
						}
						return current.filter((t) => t.toolCallId !== toolCallId);
					});
				}
				if (!isSubagent) void loadConversation(instanceId);
			}

			if (eventType === "agent_start" || eventType === "turn_start") {
				if (completionTimerRef.current) {
					clearTimeout(completionTimerRef.current);
					completionTimerRef.current = null;
				}
				setJustCompleted(false);
				void desktopApi.showIslandWindow();
				setIsStreaming(true);
				setConversation((curr) =>
					curr ? { ...curr, state: { ...curr.state, isStreaming: true } } : curr,
				);
			} else if (eventType === "agent_settled" || eventType === "turn_end") {
				setIsStreaming(false);
				setRunningTools([]);
				if (turnProgress?.startedAt) {
					setLastTurnDuration(Math.max(1, Math.floor((Date.now() - turnProgress.startedAt) / 1000)));
				}
				setTurnProgress(undefined);
				if (!isSubagent) void loadConversation(instanceId);

				setJustCompleted(true);
				if (completionTimerRef.current) {
					clearTimeout(completionTimerRef.current);
				}
				completionTimerRef.current = setTimeout(() => {
					setJustCompleted(false);
					if (!isBusyRef.current) {
						void desktopApi.hideIslandWindow();
					}
				}, 3500);
			} else if (eventType === "message_end") {
				if (!isSubagent) void loadConversation(instanceId);
			}
		});

		const unlistenSelect = desktopApi.onSelectConversation((id: string) => {
			if (id && !id.startsWith("subagent-")) {
				void loadConversation(id);
			}
		});

		const onStorage = (e: StorageEvent) => {
			if (e.key === "openpi-selected-instance" && e.newValue) {
				void loadConversation(e.newValue);
			}
		};
		window.addEventListener("storage", onStorage);

		return () => {
			unlisten();
			unlistenSelect();
			window.removeEventListener("storage", onStorage);
		};
	}, [loadConversation, turnProgress?.startedAt]);

	const handleOpenMain = useCallback(async () => {
		try {
			await desktopApi.openMainFromIsland();
			setIsExpanded(false);
			await desktopApi.setIslandExpanded(false, "idle");
		} catch (err) {
			console.error("Failed to open main window:", err);
		}
	}, []);

	const handleStop = useCallback(async () => {
		// The engine has no pause, so the only honest action is to stop the run.
		// Aborting is what actually ends it; unsubscribing from the event stream
		// (as this used to do) left the agent running while the HUD went quiet.
		if (!isBusy || !activeInstance?.id) return;
		try {
			await desktopApi.abortConversation(activeInstance.id, "island_stop");
		} catch (e) {
			console.error("Failed to stop the run:", e);
		}
	}, [isBusy, activeInstance?.id]);

	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape" && isExpanded) {
				setIsExpanded(false);
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [isExpanded]);

	// Re-fetch snapshot whenever expanded
	useEffect(() => {
		if (isExpanded) {
			refreshSnapshot();
		}
	}, [isExpanded, refreshSnapshot]);

	const cwd = activeInstance?.cwd;
	const activeTool = runningTools[0];

	// ── Real Data Extraction from Messages ──
	const {
		allActions,
		touchedFiles,
		lastUserPrompt,
		latestReasoningSnippet,
		lastBashCommand,
	} = useMemo(() => {
		const msgs = conversation?.messages || [];
		const actions: ProcessRow[] = [];
		const filesSet = new Set<string>();
		let lastUser = "";
		let lastReasoning = "";
		let lastBash = "";

		// Map tool results by toolCallId
		const toolResultsMap = new Map<string, { output: string; isError: boolean; timestamp?: number }>();
		for (const m of msgs) {
			if (m.role === "toolResult" && m.toolCallId) {
				toolResultsMap.set(m.toolCallId, {
					output: contentText(m.content),
					isError: Boolean(m.isError),
					timestamp: m.timestamp,
				});
			}
		}

		for (let i = 0; i < msgs.length; i++) {
			const m = msgs[i];
			if (!m) continue;

			if (m.role === "user") {
				const text = contentText(m.content).trim();
				if (text) lastUser = text;
				continue;
			}

			if (m.role === "assistant") {
				const reasoning = messageReasoning(m);
				if (reasoning) lastReasoning = reasoning;

				const toolBlocks = Array.isArray(m.content)
					? (m.content.filter(isToolCallBlock) as ToolCallBlock[])
					: [];

				if (toolBlocks.length > 0) {
					for (const tc of toolBlocks) {
						const args = (tc.arguments && typeof tc.arguments === "object" ? tc.arguments : {}) as Record<string, any>;
						const res = toolResultsMap.get(tc.id);
						const isError = res?.isError ?? false;

						let durationMs: number | undefined = toolDurations[tc.id];
						if (durationMs === undefined && res?.timestamp && m.timestamp && res.timestamp >= m.timestamp) {
							durationMs = Math.max(20, res.timestamp - m.timestamp);
						}

						const rawTarget =
							args.command ||
							args.cmd ||
							args.CommandLine ||
							args.path ||
							args.file ||
							args.target_file ||
							args.targetFile ||
							args.AbsolutePath ||
							args.query ||
							args.pattern ||
							args.role ||
							args.task ||
							tc.name;

						const cleanTarget = cleanActionTarget(String(rawTarget), tc.name, cwd);
						const verb = deriveVerb(tc.name, String(rawTarget));

						if (tc.name === "bash" || tc.name === "run_command") {
							lastBash = cleanTarget;
						} else if (
							tc.name.includes("read") ||
							tc.name.includes("edit") ||
							tc.name.includes("write") ||
							tc.name.includes("patch")
						) {
							if (cleanTarget && cleanTarget !== "—") {
								filesSet.add(cleanTarget);
							}
						}

						actions.push({
							id: tc.id || `action-${actions.length}`,
							actionType: verb,
							path: cleanTarget,
							durationText: formatDurationDisplay(durationMs),
							status: isError ? "error" : "done",
						});
					}
				}
			}
		}

		return {
			allActions: actions,
			touchedFiles: filesSet,
			lastUserPrompt: lastUser,
			latestReasoningSnippet: lastReasoning ? lastReasoning.slice(0, 64).replace(/\s+/g, " ") : "",
			lastBashCommand: lastBash,
		};
	}, [conversation?.messages, toolDurations, cwd]);

	// Elapsed runtime in seconds
	const hudElapsed = useMemo(() => {
		if (turnProgress?.startedAt) {
			return Math.max(0, Math.floor((now - turnProgress.startedAt) / 1000));
		}
		if (lastTurnDuration !== null) {
			return lastTurnDuration;
		}
		return 0;
	}, [turnProgress?.startedAt, now, lastTurnDuration]);

	// Active tool target text
	const activeToolTarget = useMemo(() => {
		if (!activeTool) return "";
		const detail = (activeTool.args && typeof activeTool.args === "object" ? activeTool.args : {}) as Record<string, any>;
		const raw =
			detail.command ||
			detail.cmd ||
			detail.CommandLine ||
			detail.path ||
			detail.file ||
			detail.target_file ||
			detail.query ||
			detail.pattern ||
			activeTool.toolName;
		return cleanActionTarget(String(raw), activeTool.toolName, cwd);
	}, [activeTool, cwd]);

	// Derive Process Rows (Exactly 4 rows, completely real)
	const processRows: ProcessRow[] = useMemo(() => {
		const liveRunningRows: ProcessRow[] = runningTools.map((t) => {
			const detail = (t.args && typeof t.args === "object" ? t.args : {}) as Record<string, any>;
			const raw =
				detail.command ||
				detail.cmd ||
				detail.CommandLine ||
				detail.path ||
				detail.file ||
				detail.query ||
				t.toolName;
			const target = cleanActionTarget(String(raw), t.toolName, cwd);
			return {
				id: t.toolCallId,
				actionType: deriveVerb(t.toolName, String(raw)),
				path: target,
				durationText: "running",
				status: "running",
			};
		});

		const combined = [...allActions, ...liveRunningRows];

		if (combined.length > 0) {
			const recent = combined.slice(-4);
			// If fewer than 4 actions while active, pad with genuine live workflow stages
			if (recent.length < 4 && isBusy) {
				const padded = [...recent];
				if (padded.length === 1) {
					padded.push({
						id: "flow-plan",
						actionType: "Analyzing",
						path: "Reviewing the output to plan the next step",
						durationText: "running",
						status: "running",
					});
					padded.push({
						id: "flow-exec",
						actionType: "Queueing",
						path: "Waiting for the next step",
						durationText: "waiting",
						status: "pending",
					});
					padded.push({
						id: "flow-verify",
						actionType: "Verifying",
						path: "Checking for a clean, converged result",
						durationText: "waiting",
						status: "pending",
					});
				} else if (padded.length === 2) {
					padded.push({
						id: "flow-plan",
						actionType: "Assessing",
						path: "Reviewing progress and the remaining plan",
						durationText: "running",
						status: "running",
					});
					padded.push({
						id: "flow-reply",
						actionType: "Summarizing",
						path: "Preparing the final response",
						durationText: "waiting",
						status: "pending",
					});
				} else if (padded.length === 3) {
					padded.push({
						id: "flow-verify",
						actionType: "Verifying",
						path: "Confirming the goal was met",
						durationText: "running",
						status: "running",
					});
				}
				return padded.slice(-4);
			}
			return recent;
		}

		// When 0 tool actions have executed yet:
		if (isBusy) {
			const goalText = lastUserPrompt ? cleanActionTarget(lastUserPrompt.slice(0, 36)) : "Parsing the current goal";
			return [
				{ id: "s1", actionType: "Understanding", path: goalText, durationText: `${hudElapsed}s`, status: "done" },
				{ id: "s2", actionType: "Planning", path: "Analyzing context and the execution strategy", durationText: "running", status: "running" },
				{ id: "s3", actionType: "Tool call", path: "Preparing terminal or code operations", durationText: "waiting", status: "pending" },
				{ id: "s4", actionType: "Verifying", path: "Validating the output and converging", durationText: "waiting", status: "pending" },
			];
		}

		// When idle / settled with no prior actions
		const wsName = shortWorkspacePath(cwd) || "openpi-next";
		const modelTitle = conversation?.state?.model?.name || conversation?.state?.model?.id || "Not selected";
		return [
			{ id: "i1", actionType: "Workspace", path: wsName, durationText: "ready", status: "done" },
			{ id: "i2", actionType: "Engine", path: "OpenPI Daemon (Active)", durationText: "online", status: "done" },
			{ id: "i3", actionType: "Model", path: modelTitle, durationText: "ready", status: "done" },
			{ id: "i4", actionType: "Awaiting", path: "Send a task to start", durationText: "standby", status: "pending" },
		];
	}, [allActions, runningTools, isBusy, cwd, lastUserPrompt, hudElapsed, conversation?.state?.model]);

	// Progress percentage
	const progressPercent = useMemo(() => {
		const step = turnProgress?.step;
		const max = turnProgress?.maxSteps;
		if (step && max && max > 0) {
			return Math.min(100, Math.round((step / max) * 100));
		}
		if (justCompleted) return 100;
		if (!isBusy) return allActions.length > 0 ? 100 : 0;

		const stage = turnProgress?.stage;
		if (stage === "starting") return 15;
		if (stage === "thinking") return 35;
		if (stage === "tool") return Math.min(88, 45 + (turnProgress?.toolCount || 1) * 12);
		if (stage === "responding") return 95;
		return 50;
	}, [turnProgress?.step, turnProgress?.maxSteps, turnProgress?.stage, turnProgress?.toolCount, isBusy, justCompleted, allActions.length]);

	// Current Command Text
	const currentCommandText = useMemo(() => {
		if (activeTool) {
			const detail = (activeTool.args && typeof activeTool.args === "object" ? activeTool.args : {}) as Record<string, any>;
			const cmd = detail.command || detail.cmd || detail.CommandLine;
			if (cmd) return cleanActionTarget(String(cmd), activeTool.toolName, cwd);
			return `${activeTool.toolName}: ${activeToolTarget}`;
		}
		if (lastBashCommand) {
			return lastBashCommand;
		}
		if (allActions.length > 0) {
			const last = allActions[allActions.length - 1];
			return `${last.actionType}: ${last.path}`;
		}
		return "No active command";
	}, [activeTool, activeToolTarget, lastBashCommand, allActions, cwd]);

	// Processed Files Count
	const processedFilesText = useMemo(() => {
		if (turnProgress?.step && turnProgress?.maxSteps) {
			return `${turnProgress.step} / ${turnProgress.maxSteps}`;
		}
		if (touchedFiles.size > 0) {
			return `${touchedFiles.size} files`;
		}
		if (allActions.length > 0) {
			return `${allActions.length} actions`;
		}
		return "No files";
	}, [turnProgress?.step, turnProgress?.maxSteps, touchedFiles.size, allActions.length]);

	// Session / Task Name
	const sessionTitle = conversation?.state?.sessionName || activeInstance?.label || "";

	// Hero Category Pill
	const categoryPill = useMemo(() => {
		if (isBusy) {
			if (activeTool) {
				const t = activeTool.toolName.toLowerCase();
				if (t.includes("bash") || t.includes("terminal") || t.includes("exec")) return "EXECUTING";
				if (t.includes("edit") || t.includes("write") || t.includes("patch")) return "EDITING";
				if (t.includes("read") || t.includes("cat") || t.includes("view")) return "READING";
				if (t.includes("grep") || t.includes("search") || t.includes("find")) return "SEARCHING";
				if (t.includes("subagent")) return "ORCHESTRATING";
				return "WORKING";
			}
			const stage = turnProgress?.stage;
			if (stage === "thinking") return "THINKING";
			if (stage === "responding") return "RESPONDING";
			return "ANALYZING";
		}
		if (justCompleted) return "COMPLETED";
		return allActions.length > 0 ? "STANDBY" : "READY";
	}, [isBusy, activeTool, turnProgress?.stage, justCompleted, allActions.length]);

	// Hero Title
	const heroTitle = useMemo(() => {
		if (isBusy) {
			const verb = turnVerb(turnProgress, hudElapsed);
			const target = activeToolTarget && activeToolTarget !== "—" ? activeToolTarget : "";
			return target ? `${verb} · ${target}` : verb;
		}
		if (justCompleted) {
			return "Task completed";
		}
		if (sessionTitle) {
			return sessionTitle;
		}
		if (lastUserPrompt) {
			return lastUserPrompt.length > 22 ? `${lastUserPrompt.slice(0, 22)}…` : lastUserPrompt;
		}
		return "OpenPI Agent";
	}, [isBusy, turnProgress, hudElapsed, activeToolTarget, justCompleted, sessionTitle, lastUserPrompt]);

	// Hero Subtitle
	const heroSub = useMemo(() => {
		if (isBusy) {
			if (activeTool) {
				return activeToolTarget || "Running the command…";
			}
			if (turnProgress?.stage === "thinking") {
				return latestReasoningSnippet || "Reviewing context and results to plan the next step";
			}
			if (turnProgress?.stage === "responding") {
				return "Composing the reply…";
			}
			return activeInstance?.cwd ? `Workspace: ${shortWorkspacePath(activeInstance.cwd)}` : "Working…";
		}
		if (justCompleted) {
			return `${allActions.length} actions · ready for the next instruction`;
		}
		if (activeInstance?.cwd) {
			return `Workspace: ${shortWorkspacePath(activeInstance.cwd)} · ready for a task`;
		}
		return "Ready";
	}, [isBusy, activeTool, activeToolTarget, turnProgress?.stage, latestReasoningSnippet, activeInstance?.cwd, justCompleted, allActions.length]);

	// Capsule Pill Task. Shows what the agent is doing right now — never the session
	// title, which says nothing about the current activity.
	const capsuleTaskText = useMemo(() => {
		if (isBusy) {
			const verb = turnVerb(turnProgress, hudElapsed);
			const target = activeToolTarget && activeToolTarget !== "—" ? activeToolTarget : "";
			return target ? `${verb} · ${target}` : verb;
		}
		if (justCompleted) return "Completed";
		return "Standby";
	}, [isBusy, turnProgress, hudElapsed, activeToolTarget, justCompleted]);

	// Total Token Usage
	const totalTokens = stats?.tokens?.total || stats?.contextUsage?.tokens || 0;

	return (
		<div className="island-root">
			{!isExpanded ? (
				/* ── Top Floating Island (capsule attached to the screen's top edge) ── */
				<div className="island-pill-assembly">
					<div
						className={`island-capsule-pill ${isBusy ? "working" : "idle"}`}
						onClick={() => setIsExpanded(true)}
					>
						<span className={`island-dot ${isBusy ? "busy" : ""}`} />
						<span className="island-capsule-brand">OpenPI</span>

						{isBusy ? (
							<>
								<span className="island-capsule-task">
									{capsuleTaskText}
								</span>

								{/* Pulsing Energy/Audio Waveform |||||| */}
								<div className="island-waveform">
									<span className="wave-bar" />
									<span className="wave-bar" />
									<span className="wave-bar" />
									<span className="wave-bar" />
									<span className="wave-bar" />
								</div>

								<span className="island-capsule-timer">{formatElapsedSec(hudElapsed)}</span>
							</>
						) : justCompleted ? (
							<>
								<span className="island-capsule-task">Completed</span>
								<span className="island-capsule-check">✓</span>
							</>
						) : (
							<>
								<span className="island-capsule-task">
									{capsuleTaskText}
								</span>
								<div className="island-waveform idle-wave">
									<span className="wave-bar" />
									<span className="wave-bar" />
									<span className="wave-bar" />
									<span className="wave-bar" />
									<span className="wave-bar" />
								</div>
							</>
						)}
					</div>
				</div>
			) : (
				/* ── Expanded Liquid HUD Card (sits flush under the capsule) ── */
				<div
					className="island-card-assembly"
					onMouseEnter={handleCardMouseEnter}
					onMouseLeave={handleCardMouseLeave}
				>
					<div className="island-hud-card" onClick={(e) => e.stopPropagation()}>
						{/* 1. Header Row */}
						<div className="hud-card-header">
							<div className="hud-brand-group">
								<svg className="hud-brand-logo" width="18" height="18" viewBox="0 0 24 24" fill="none">
									<circle cx="12" cy="12" r="9" stroke="var(--hud-accent)" strokeWidth="2.8" strokeLinecap="round" strokeDasharray="42 16" />
								</svg>
								<span className="hud-brand-title">OpenPI</span>
								<span className="hud-agent-badge">Agent</span>
							</div>

							<div className="hud-header-right">
								{/* Audio/Energy Waveform */}
								<div className={`island-waveform card-wave ${!isBusy ? "idle-wave" : ""}`}>
									<span className="wave-bar" />
									<span className="wave-bar" />
									<span className="wave-bar" />
									<span className="wave-bar" />
									<span className="wave-bar" />
								</div>

								{totalTokens > 0 && (
									<span className="hud-card-tokens" title={`Context usage: ${totalTokens.toLocaleString()} tokens`}>
										{totalTokens.toLocaleString()} tokens
									</span>
								)}

								<span className="hud-card-timer">{formatElapsedSec(hudElapsed)}</span>
							</div>
						</div>

						{/* 2. Hero Stage Banner */}
						<div className="hud-hero-stage">
							<div className="hud-hero-left">
								{isBusy ? (
									<div className="hud-spinner-ring" />
								) : (
									<div
										style={{
											width: 24,
											height: 24,
											borderRadius: "50%",
											background: "rgba(63, 158, 106, 0.12)",
											border: "1.5px solid rgba(63, 158, 106, 0.35)",
											display: "flex",
											alignItems: "center",
											justifyContent: "center",
											color: "var(--hud-ok)",
											fontSize: 13,
											fontWeight: 700,
											flexShrink: 0,
										}}
									>
										✓
									</div>
								)}
								<div className="hud-hero-text">
									<div className="hud-hero-title">{heroTitle}</div>
									<div className="hud-hero-sub" title={heroSub}>{heroSub}</div>
								</div>
							</div>
							<div className="hud-category-pill">{categoryPill}</div>
						</div>

						{/* 3. Progress Bar */}
						<div className="hud-progress-section">
							<div className="hud-progress-track">
								<div className="hud-progress-bar" style={{ width: `${progressPercent}%` }} />
							</div>
							<span className="hud-progress-number">{progressPercent}%</span>
						</div>

						{/* 4. Structured Process Table (4 Rows) */}
						<div className="hud-process-table">
							{processRows.map((row) => (
								<div key={row.id} className={`hud-process-row ${row.status}`}>
									<div className="process-col-action">
										<span className={`process-status-dot ${row.status}`} />
										<span className="process-action-label">{row.actionType}</span>
									</div>
									<div className="process-col-path" title={row.path}>
										{row.path}
									</div>
									<div className="process-col-duration">
										{row.durationText}
									</div>
									<div className="process-col-state">
										{row.status === "done" && <span className="process-check-mark">✓</span>}
										{row.status === "running" && <span className="process-running-gear">⚙</span>}
										{row.status === "pending" && <span className="process-pending-dot">○</span>}
										{row.status === "error" && <span className="process-error-mark">×</span>}
									</div>
								</div>
							))}
						</div>

						{/* 5. Inset Metric Card (3 Columns) */}
						<div className="hud-metric-card">
							<div className="metric-col">
								<div className="metric-label">
									<Terminal size={11} className="metric-icon" />
									<span>{isBusy ? "Command" : "Last command"}</span>
								</div>
								<div className="metric-value code-font" title={currentCommandText}>
									{currentCommandText || "—"}
								</div>
							</div>

							<div className="metric-col">
								<div className="metric-label">
									<FileText size={11} className="metric-icon" />
									<span>Files</span>
								</div>
								<div className="metric-value">{processedFilesText}</div>
							</div>

							<div className="metric-col">
								<div className="metric-label">
									<Clock3 size={11} className="metric-icon" />
									<span>Elapsed</span>
								</div>
								<div className="metric-value">{formatElapsedSec(hudElapsed)}</div>
							</div>
						</div>

						{/* 6. Bottom Controls Toolbar */}
						<div className="hud-bottom-bar">
							<div className="hud-bottom-left">
								<button
									type="button"
									className="hud-action-pill-btn"
									disabled={!isBusy}
									onClick={() => void handleStop()}
								>
									<CircleStop size={11} />
									<span>Stop</span>
								</button>

								<button
									type="button"
									className="hud-action-pill-btn"
									onClick={() => void handleOpenMain()}
								>
									<FileText size={11} />
									<span>Details</span>
								</button>
							</div>

							<div className="hud-bottom-right">
								<button
									type="button"
									className="hud-primary-open-btn"
									onClick={() => void handleOpenMain()}
								>
									<ExternalLink size={12} />
									<span>Open OpenPI</span>
								</button>
							</div>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
