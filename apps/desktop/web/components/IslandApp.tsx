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
	formatActionItem,
	type ActionChainItem,
	type ToolCallBlock,
} from "../lib/helpers";
import {
	initialTurnProgress,
	reduceTurnProgress,
	toolLabel,
	type TurnProgress,
} from "../lib/turn-progress";
import { useTheme } from "../lib/theme-manager";
import { MarkdownText } from "../lib/markdown";
import type { AgentInstance, ConversationMessage, ConversationSnapshot, RunningTool } from "../types";
import {
	Send,
	X,
	ExternalLink,
	Bot,
	ChevronDown,
	Sparkles,
} from "./icons";
import { TurnProgressRow } from "./surfaces/workspace/turn-progress-row";
import { AgentActionChain } from "./surfaces/workspace/action-chain";
import { ReasoningBlock } from "./surfaces/workspace/reasoning-block";

function sanitizeTitle(raw?: string): string {
	if (!raw) return "OpenPI 对话";
	const trimmed = raw.trim();
	if (
		trimmed.includes("Ephemeral Subagent Directive") ||
		trimmed.includes("Directive") ||
		trimmed.includes("ROLE:") ||
		trimmed.startsWith("【")
	) {
		return "OpenPI 任务会话";
	}
	return trimmed.length > 20 ? `${trimmed.slice(0, 18)}…` : trimmed;
}

function formatModelName(name?: string): string {
	if (!name) return "";
	return name
		.replace(/-high$|-low$|-medium$/i, "")
		.replace(/^gemini-/, "Gemini ")
		.replace(/^claude-/, "Claude ")
		.replace(/^gpt-/, "GPT-");
}

interface IslandFeedUserItem {
	kind: "user";
	id: string;
	text: string;
}

interface IslandFeedActionsItem {
	kind: "actions";
	id: string;
	actions: ActionChainItem[];
	reasoning?: string;
}

interface IslandFeedAssistantItem {
	kind: "assistant";
	id: string;
	text: string;
	reasoning?: string;
}

type IslandFeedItem = IslandFeedUserItem | IslandFeedActionsItem | IslandFeedAssistantItem;

function buildIslandFeedItems(
	messages: ConversationMessage[] = [],
	toolDurations: Record<string, number> = {},
): IslandFeedItem[] {
	const items: IslandFeedItem[] = [];
	let currentActions: ActionChainItem[] = [];
	let currentReasoning = "";
	const seenActionIds = new Set<string>();

	const flushActions = () => {
		if (currentActions.length > 0 || currentReasoning) {
			items.push({
				kind: "actions",
				id: `actions-${items.length}`,
				actions: [...currentActions],
				reasoning: currentReasoning || undefined,
			});
			currentActions = [];
			currentReasoning = "";
		}
	};

	for (let index = 0; index < messages.length; index++) {
		const message = messages[index];
		if (!message) continue;

		if (message.role === "user") {
			flushActions();
			const text = contentText(message.content).trim();
			if (text) {
				items.push({
					kind: "user",
					id: `user-${index}`,
					text,
				});
			}
			continue;
		}

		if (message.role === "toolResult") {
			let match = currentActions.find(
				(a) => !a.output && (a.id === message.toolCallId || a.name === message.toolName),
			);
			if (!match && message.toolCallId) {
				for (let i = items.length - 1; i >= 0; i--) {
					const it = items[i];
					if (it?.kind === "actions") {
						const prevMatch = it.actions.find(
							(a) => !a.output && (a.id === message.toolCallId || a.name === message.toolName),
						);
						if (prevMatch) {
							match = prevMatch;
							break;
						}
					}
				}
			}

			const outputText = contentText(message.content);
			const isError = Boolean(message.isError);
			const durationMs = message.toolCallId ? toolDurations[message.toolCallId] : undefined;

			if (match) {
				match.output = outputText;
				match.isError = isError;
				if (durationMs !== undefined) match.durationMs = durationMs;
				const formatted = formatActionItem(match.name, match.args, outputText, isError);
				match.badge = formatted.badge;
				if (message.toolCallId) seenActionIds.add(message.toolCallId);
			} else {
				const name = message.toolName || "tool";
				const formatted = formatActionItem(name, undefined, outputText, isError);
				const id = message.toolCallId || `tr_${index}`;
				if (!seenActionIds.has(id)) {
					seenActionIds.add(id);
					currentActions.push({
						id,
						name,
						summary: name,
						iconName: "wrench",
						output: outputText,
						isError,
						actionType: formatted.actionType,
						verb: formatted.verb,
						target: formatted.target,
						badge: formatted.badge,
						durationMs,
					});
				}
			}
			continue;
		}

		if (message.role === "assistant") {
			const text = visibleMessageText(contentText(message.content)).trim();
			const reasoning = messageReasoning(message);
			const toolBlocks = Array.isArray(message.content)
				? (message.content.filter(isToolCallBlock) as ToolCallBlock[])
				: [];

			if (toolBlocks.length > 0) {
				for (const tc of toolBlocks) {
					const actionId = tc.id || `tc_${index}_${currentActions.length}`;
					if (seenActionIds.has(actionId)) continue;
					seenActionIds.add(actionId);
					const args =
						tc.arguments && typeof tc.arguments === "object"
							? (tc.arguments as Record<string, unknown>)
							: {};
					const formatted = formatActionItem(tc.name, args);
					const durationMs = tc.id ? toolDurations[tc.id] : undefined;
					currentActions.push({
						id: actionId,
						name: tc.name,
						summary: toolCallSummary(tc),
						iconName: toolCallIconName(tc),
						args,
						actionType: formatted.actionType,
						verb: formatted.verb,
						target: formatted.target,
						badge: formatted.badge,
						durationMs,
					});
				}
			}

			if (reasoning && !text && toolBlocks.length > 0) {
				currentReasoning = currentReasoning ? `${currentReasoning}\n\n${reasoning}` : reasoning;
			}

			if (text || (reasoning && toolBlocks.length === 0)) {
				flushActions();
				items.push({
					kind: "assistant",
					id: `asst-${index}`,
					text,
					reasoning: toolBlocks.length > 0 ? undefined : reasoning,
				});
			}
		}
	}

	flushActions();
	return items;
}

export function IslandApp() {
	// Hook to synchronize theme automatically with OpenPI
	useTheme();

	const [isExpanded, setIsExpanded] = useState(false);
	const isExpandedRef = useRef(false);
	isExpandedRef.current = isExpanded;

	const [justCompleted, setJustCompleted] = useState(false);
	const completionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const [activeInstance, setActiveInstance] = useState<AgentInstance | null>(null);
	const [conversation, setConversation] = useState<ConversationSnapshot | null>(null);
	const [turnProgress, setTurnProgress] = useState<TurnProgress | undefined>();
	const [runningTools, setRunningTools] = useState<RunningTool[]>([]);
	const [toolDurations, setToolDurations] = useState<Record<string, number>>({});
	const [isStreaming, setIsStreaming] = useState(false);
	const [input, setInput] = useState("");
	const [isSending, setIsSending] = useState(false);

	const messagesEndRef = useRef<HTMLDivElement>(null);
	const activeInstanceRef = useRef<AgentInstance | null>(null);
	activeInstanceRef.current = activeInstance;
	const isBusyRef = useRef(false);

	// Cleanup any completion timer on unmount
	useEffect(() => {
		return () => {
			if (completionTimerRef.current) {
				clearTimeout(completionTimerRef.current);
			}
		};
	}, []);

	// Listen for expand/collapse synchronization from native IPC or tray
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

	// Load and set conversation by instanceId
	const loadConversation = useCallback(async (instanceId: string) => {
		try {
			const conv = await desktopApi.getConversation(instanceId);
			if (conv?.instance) {
				setConversation(conv);
				setIsStreaming(Boolean(conv.state?.isStreaming));
				setActiveInstance(conv.instance);
			}
		} catch (err) {
			console.error("Failed to load conversation:", err);
		}
	}, []);

	// Pick the most relevant user conversation (ignoring internal subagents)
	const refreshSnapshot = useCallback(async () => {
		try {
			const snap = await desktopApi.getSnapshot();
			if (!snap?.instances?.length) return;

			// Filter out internal subagents
			const userInstances = snap.instances.filter((i) => !i.id.startsWith("subagent-"));
			const candidates = userInstances.length ? userInstances : snap.instances;

			// 1. Is any instance currently running / online?
			const runningInstance = candidates.find((i) => i.status === "online" || i.status === "starting");

			// 2. Check stored selection from main window
			let storedId: string | undefined;
			try {
				const stored = window.localStorage.getItem("openpi-selected-instance");
				if (stored && candidates.some((c) => c.id === stored)) {
					storedId = stored;
				}
			} catch {}

			const targetId = runningInstance ? runningInstance.id : (storedId || candidates[0].id);

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

	// Auto-scroll to bottom on messages, tools, or streaming update
	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [conversation?.messages?.length, runningTools.length, isStreaming]);

	// Derive display states
	const isBusy =
		isStreaming ||
		runningTools.length > 0 ||
		turnProgress?.stage === "thinking" ||
		turnProgress?.stage === "tool";
	isBusyRef.current = isBusy;

	// When busy state begins, ensure island window is visible and reset completed badge
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

	// Periodically refresh active conversation when busy/streaming to stay in lock-step
	useEffect(() => {
		if (!isBusy || !activeInstance?.id) return;
		const timer = setInterval(() => {
			void loadConversation(activeInstance.id);
		}, 1500);
		return () => clearInterval(timer);
	}, [isBusy, activeInstance?.id, loadConversation]);

	// Listen for live daemon events & synchronization
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
						if (!isExpandedRef.current) void desktopApi.hideIslandWindow();
					}, 3500);
				}
				return;
			}

			const currentId = activeInstanceRef.current?.id;

			// If event is for a user instance and not currently selected, switch to track the active work!
			if (!isSubagent && currentId !== instanceId) {
				void loadConversation(instanceId);
			}

			// Update turn progress
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

			// Update running tools & durations in real time (identical to main window)
			if (eventType === "tool_execution_start" || eventType === "tool_execution_update") {
				const toolCallId = typeof event.toolCallId === "string" ? event.toolCallId : undefined;
				const toolName = typeof event.toolName === "string" ? event.toolName : undefined;
				if (toolCallId && toolName) {
					const now = Date.now();
					setRunningTools((current) => {
						const existingTool = current.find((t) => t.toolCallId === toolCallId);
						const next: RunningTool = {
							toolCallId,
							toolName,
							status: eventType === "tool_execution_update" ? "updating" : "running",
							args: event.args,
							partialResult: event.partialResult,
							startedAt: existingTool?.startedAt ?? now,
							updatedAt: now,
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
				setTurnProgress(undefined);
				if (!isSubagent) void loadConversation(instanceId);

				// Signal completion badge & schedule auto-hide after 3.5s
				setJustCompleted(true);
				if (completionTimerRef.current) {
					clearTimeout(completionTimerRef.current);
				}
				completionTimerRef.current = setTimeout(() => {
					setJustCompleted(false);
					if (!isExpandedRef.current) {
						void desktopApi.hideIslandWindow();
					}
				}, 3500);
			} else if (eventType === "message_end") {
				if (!isSubagent) void loadConversation(instanceId);
			} else if (eventType === "message_update" || eventType === "message_start") {
				if (amEvent) {
					// Handle text delta streaming
					if (amEvent.type === "text_delta" && typeof amEvent.delta === "string") {
						setConversation((curr) => {
							if (!curr) return curr;
							const msgs = [...curr.messages];
							let last = msgs[msgs.length - 1];
							if (!last || last.role !== "assistant") {
								last = { role: "assistant", content: [{ type: "text", text: amEvent.delta }] };
								msgs.push(last);
							} else {
								const contentArr = Array.isArray(last.content)
									? [...last.content]
									: [{ type: "text", text: contentText(last.content) }];
								const textBlock = contentArr.find((b: any) => b.type === "text");
								if (textBlock) {
									textBlock.text = (textBlock.text || "") + amEvent.delta;
								} else {
									contentArr.push({ type: "text", text: amEvent.delta });
								}
								last = { ...last, content: contentArr };
								msgs[msgs.length - 1] = last;
							}
							return { ...curr, messages: msgs };
						});
					} else if (
						(amEvent.type === "thinking_delta" || amEvent.type === "reasoning_delta") &&
						typeof amEvent.delta === "string"
					) {
						setConversation((curr) => {
							if (!curr) return curr;
							const msgs = [...curr.messages];
							let last = msgs[msgs.length - 1];
							if (!last || last.role !== "assistant") {
								last = { role: "assistant", content: [{ type: "thinking", thinking: amEvent.delta }] };
								msgs.push(last);
							} else {
								const contentArr = Array.isArray(last.content) ? [...last.content] : [];
								const thinkBlock = contentArr.find((b: any) => b.type === "thinking");
								if (thinkBlock) {
									thinkBlock.thinking = (thinkBlock.thinking || "") + amEvent.delta;
								} else {
									contentArr.push({ type: "thinking", thinking: amEvent.delta });
								}
								last = { ...last, content: contentArr };
								msgs[msgs.length - 1] = last;
							}
							return { ...curr, messages: msgs };
						});
					}
				}
			}
		});

		// Listen to user selecting conversation in main window
		const unlistenSelect = desktopApi.onSelectConversation((id: string) => {
			if (id && !id.startsWith("subagent-")) {
				void loadConversation(id);
			}
		});

		// Listen to localStorage changes across windows
		const onStorage = (e: StorageEvent) => {
			if (e.key === "openpi-selected-instance" && e.newValue && !e.newValue.startsWith("subagent-")) {
				void loadConversation(e.newValue);
			}
		};
		window.addEventListener("storage", onStorage);

		return () => {
			unlisten();
			unlistenSelect();
			window.removeEventListener("storage", onStorage);
		};
	}, [loadConversation]);

	// Toggle Island Expand / Collapse (280x42 <-> 460x540 pinned to screen top)
	const handleToggleExpand = useCallback(async (expand: boolean) => {
		setIsExpanded(expand);
		try {
			await desktopApi.setIslandExpanded(expand);
			if (!expand && !isBusyRef.current) {
				// Collapsed while idle -> auto-hide island window
				await desktopApi.hideIslandWindow();
				setJustCompleted(false);
			}
		} catch (err) {
			console.error("Failed to toggle island expand:", err);
		}
	}, []);

	// Open Main Window & Collapse Island
	const handleOpenMain = useCallback(async () => {
		try {
			await desktopApi.openMainFromIsland();
			await desktopApi.setIslandExpanded(false);
			await desktopApi.hideIslandWindow();
			setIsExpanded(false);
			setJustCompleted(false);
		} catch (err) {
			console.error("Failed to open main window:", err);
		}
	}, []);

	// Send message
	const handleSend = async () => {
		const text = input.trim();
		if (!text || isSending || !activeInstance) return;

		setIsSending(true);
		setInput("");
		try {
			await desktopApi.sendMessage(activeInstance.id, text, []);
			await loadConversation(activeInstance.id);
		} catch (err) {
			console.error("Failed to send message:", err);
		} finally {
			setIsSending(false);
		}
	};

	// Keyboard shortcut handling: Esc to collapse
	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape" && isExpanded) {
				void handleToggleExpand(false);
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [isExpanded, handleToggleExpand]);

	// Auto-collapse on blur when clicking outside (only when expanded)
	const lastFocusedRef = useRef<number>(Date.now());
	useEffect(() => {
		if (isExpanded) {
			lastFocusedRef.current = Date.now();
		}
	}, [isExpanded]);

	useEffect(() => {
		const onFocus = () => {
			lastFocusedRef.current = Date.now();
		};
		const onBlur = () => {
			if (isExpanded && Date.now() - lastFocusedRef.current > 600) {
				void handleToggleExpand(false);
			}
		};
		window.addEventListener("focus", onFocus);
		window.addEventListener("blur", onBlur);
		return () => {
			window.removeEventListener("focus", onFocus);
			window.removeEventListener("blur", onBlur);
		};
	}, [isExpanded, handleToggleExpand]);

	// Derive display states
	const rawModelName = conversation?.state?.model?.name || conversation?.state?.model?.id;
	const formattedModel = formatModelName(rawModelName);

	// Status label matching main window accurately
	const statusLabel = useMemo(() => {
		if (justCompleted && !isBusy) return "回答完毕";
		if (runningTools.length > 0) {
			const activeTool = runningTools[0];
			const name = activeTool?.toolName;
			return name === "subagent"
				? "正在执行独立子任务…"
				: name
					? toolLabel(name)
					: "正在执行工具…";
		}
		if (turnProgress?.label) return turnProgress.label;
		if (isStreaming) return "正在生成回复…";
		return formattedModel || "待命";
	}, [justCompleted, isBusy, runningTools, turnProgress?.label, isStreaming, formattedModel]);

	// Derive title: check instance label, state sessionName, or first user prompt
	const conversationTitle = (() => {
		if (activeInstance?.label && !activeInstance.label.startsWith("【")) {
			return sanitizeTitle(activeInstance.label);
		}
		if (conversation?.state?.sessionName && !conversation.state.sessionName.startsWith("【")) {
			return sanitizeTitle(conversation.state.sessionName);
		}
		const firstUserMsg = conversation?.messages?.find((m) => m.role === "user");
		if (firstUserMsg) {
			const txt = contentText(firstUserMsg.content).trim();
			if (txt) return sanitizeTitle(txt);
		}
		return "OpenPI 对话";
	})();

	// Build cohesive feed items matching main window
	const feedItems = useMemo(() => {
		const msgs = (conversation?.messages || []).slice(-35);
		return buildIslandFeedItems(msgs, toolDurations);
	}, [conversation?.messages, toolDurations]);

	return (
		<div className="island-root">
			{!isExpanded ? (
				/* ── 1. 胶囊静默/工作态 (The Pill — Hardware Top-Docked Notch Island) ── */
				<div
					onClick={() => handleToggleExpand(true)}
					className={`island-pill ${isBusy ? "busy" : justCompleted ? "completed" : "idle"}`}
				>
					{/* Status Dot & Title */}
					<div className="island-pill-left">
						<div className={`island-dot ${isBusy ? "busy" : justCompleted ? "completed" : "idle"}`} />
						<span className="island-brand">OpenPI</span>
					</div>

					{/* Center Live Status */}
					<div className={`island-pill-center ${isBusy ? "busy" : justCompleted ? "completed" : "idle"}`}>
						{isBusy && <Sparkles style={{ width: 12, height: 12 }} />}
						{justCompleted && <span style={{ color: "#34c759", fontWeight: 700 }}>✓</span>}
						<span>{statusLabel}</span>
					</div>

					{/* Actions indicator: Dismiss button & Expand chevron */}
					<div className="island-pill-right">
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								setJustCompleted(false);
								void desktopApi.hideIslandWindow();
							}}
							title="隐藏灵动岛"
							className="island-pill-dismiss-btn"
						>
							<X style={{ width: 11, height: 11 }} />
						</button>
						<ChevronDown style={{ width: 13, height: 13 }} />
					</div>
				</div>
			) : (
				/* ── 2. 展开交互小窗态 (The Expanded Card — Flowing Down From The Notch) ── */
				<div className="island-card">
					{/* Header — Seamless with Canvas */}
					<div className="island-header">
						<div className="island-header-left">
							<div className={`island-dot ${isBusy ? "busy" : "idle"}`} />
							<span className="island-header-title">
								{conversationTitle}
							</span>
							{formattedModel && (
								<span className="island-header-badge">
									{formattedModel}
								</span>
							)}
						</div>

						<div className="island-header-actions">
							{/* Open in full workspace */}
							<button
								type="button"
								onClick={handleOpenMain}
								title="在完整工作台中打开"
								className="island-action-btn"
							>
								<span>大窗</span>
								<ExternalLink style={{ width: 12, height: 12 }} />
							</button>

							{/* Close / Collapse button */}
							<button
								type="button"
								onClick={() => handleToggleExpand(false)}
								title="收起灵动岛 (Esc)"
								className="island-close-btn"
							>
								<X style={{ width: 14, height: 14 }} />
							</button>
						</div>
					</div>

					{/* Message & Execution Flow */}
					<div className="island-body">
						{feedItems.length === 0 && runningTools.length === 0 ? (
							<div className="island-empty">
								<Bot style={{ width: 32, height: 32, opacity: 0.6, color: "var(--accent)" }} />
								<div className="island-empty-title">随时向 OpenPI 发送指令</div>
								<div className="island-empty-desc">灵动岛将实时同步执行细节</div>
								<div className="island-quick-chips">
									{["总结当前代码变更", "执行 cargo check", "写一个快速测试"].map((prompt) => (
										<button
											type="button"
											key={prompt}
											onClick={() => setInput(prompt)}
											className="island-chip"
										>
											{prompt}
										</button>
									))}
								</div>
							</div>
						) : (
							feedItems.map((item, idx) => {
								if (item.kind === "user") {
									return (
										<div key={item.id} className="island-msg-row user">
											<div className="island-bubble-user">
												{item.text}
											</div>
										</div>
									);
								}

								if (item.kind === "actions") {
									const isLast = idx === feedItems.length - 1;
									return (
										<div key={item.id} className="island-msg-row actions">
											{item.reasoning && (
												<ReasoningBlock
													reasoning={item.reasoning}
													isWorking={isBusy && isLast}
												/>
											)}
											{(item.actions.length > 0 || (isLast && runningTools.length > 0)) && (
												<AgentActionChain
													actions={item.actions}
													runningTools={isLast && isBusy ? runningTools : []}
													isWorking={isBusy && isLast}
													workspaceCwd={activeInstance?.cwd}
												/>
											)}
										</div>
									);
								}

								if (item.kind === "assistant") {
									const isLast = idx === feedItems.length - 1;
									return (
										<div key={item.id} className="island-msg-row assistant">
											{item.reasoning && (
												<ReasoningBlock
													reasoning={item.reasoning}
													isWorking={isBusy && isLast}
												/>
											)}
											{item.text && (
												<div className="island-bubble-assistant">
													<MarkdownText
														text={item.text}
														streaming={isStreaming && isLast}
													/>
												</div>
											)}
										</div>
									);
								}

								return null;
							})
						)}

						{/* Standalone active running tools if actions block not yet flushed */}
						{runningTools.length > 0 &&
							!(feedItems.length > 0 && feedItems[feedItems.length - 1].kind === "actions") && (
								<div className="island-msg-row actions">
									<AgentActionChain
										actions={[]}
										runningTools={runningTools}
										isWorking={isBusy}
										workspaceCwd={activeInstance?.cwd}
									/>
								</div>
							)}

						{/* Non-tool progress (thinking / responding), identical to main window */}
						{isBusy && runningTools.length === 0 && (
							<div className="island-turn-progress">
								{turnProgress ? (
									<TurnProgressRow progress={turnProgress} />
								) : (
									<div className="turn-progress" role="status">
										<span className="turn-progress-dots" aria-hidden="true">
											<span />
											<span />
											<span />
										</span>
										<span className="turn-progress-label">正在处理中…</span>
									</div>
								)}
							</div>
						)}
						<div ref={messagesEndRef} />
					</div>

					{/* Dialogue Input Floating Composer */}
					<div className="island-footer">
						<form
							onSubmit={(e) => {
								e.preventDefault();
								handleSend();
							}}
							className="island-input-box"
						>
							<input
								type="text"
								value={input}
								onChange={(e) => setInput(e.target.value)}
								placeholder="输入消息或指令... (Enter 发送)"
								disabled={isSending}
								autoFocus
								className="island-text-input"
							/>
							<button
								type="submit"
								disabled={!input.trim() || isSending}
								className="island-send-btn"
								title="发送 (Enter)"
							>
								<Send style={{ width: 13, height: 13 }} />
							</button>
						</form>
						<div className="island-shortcuts-bar">
							<span>按 Esc 收起</span>
							<span>Enter 发送 · Shift+Enter 换行</span>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
