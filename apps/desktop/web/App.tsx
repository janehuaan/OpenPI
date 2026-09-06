import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { desktopApi } from "./api";
import { ArrowLeft, Bell, RefreshCw, X } from "./components/icons.tsx";
import {
	type AppMode,
	CapabilitiesSurface,
	ConversationUiDialog,
	CreateTaskDialog,
	DaemonSurface,
	DeleteConversationDialog,
	DeleteProjectDialog,
	type DeleteProjectTarget,
	EditProfileDialog,
	IntelligenceSurface,
	MemorySurface,
	ProviderAuthDialog,
	QuickSaveMemoryDialog,
	ReferenceWorkspacePreview,
	RenameConversationDialog,
	TasksSurface,
	GitSurface,
	FloatingHud,
} from "./components/surfaces";
import {
	type CapabilityTab,
	type DocumentAttachment,
	type ExtensionNotice,
	emptySnapshot,
	type OptimisticUserMessage,
	type PendingConversationUiRequest,
	type TaskFilter,
	type View,
} from "./lib/app-types";
import {
	blockingConversationUiRequest,
	contentText,
	conversationContentMatches,
	detectRepetitionLoop,
	instanceTitle,
	isConversationMessage,
	isRecord,
	mergeConversationMessage,
	messageReasoning,
	modelSupportsReasoning,
	normalizeConversationModels,
	getHighestThinkingLevel,
} from "./lib/helpers";
import { reduceTurnProgress, submittedTurnProgress, type TurnProgress } from "./lib/turn-progress";
import { hashForView, initialView, isView, VIEW_STORAGE_KEY, viewFromHash } from "./lib/view-route";
import { draftStore } from "./lib/draft-store";
import { exportAndDownloadConversation } from "./lib/export-markdown";
import { useGlobalKeybindings } from "./lib/keybindings";

const SELECTED_INSTANCE_KEY = "openpi-selected-instance";

import type {
	AgentInstance,
	AgentMode,
	ConversationCapabilities,
	ConversationModelOption,
	ConversationSnapshot,
	ConversationState,
	ConversationStats,
	ConversationUiResponse,
	CreateTaskInput,
	GitStatusResult,
	ImageContent,
	RunningTool,
	TaskRun,
	ThinkingLevel,
	TodoState,
	VisionFallbackConfig,
	WorkspaceSummary,
} from "./types";

function escapeAttachmentName(name: string): string {
	return name.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function messageWithDocuments(message: string, documents: DocumentAttachment[]): string {
	if (documents.length === 0) return message;
	const prompt = message.trim() || "请分析已附加的文件。";
	const content = documents
		.map((document) => {
			const source = document.path ? ` path="${escapeAttachmentName(document.path)}"` : "";
			return `<file name="${escapeAttachmentName(document.name)}"${source}>\n${document.text}\n</file>`;
		})
		.join("\n\n");
	return `${prompt}\n\n<openpi-attachments>\n${content}\n</openpi-attachments>`;
}

export function App() {
	const [setup, setSetup] = useState<{
		checked: boolean;
		enabled: boolean;
		workspace?: string;
	}>({ checked: false, enabled: true });
	const [snapshot, setSnapshot] = useState(emptySnapshot);
	const [conversation, setConversation] = useState<ConversationSnapshot>();
	const [conversationStats, setConversationStats] = useState<ConversationStats>();
	const [todoState, setTodoState] = useState<TodoState>();
	const [providerBalance, setProviderBalance] = useState<{ currency: string; totalBalance: number } | null>();
	const [conversationModels, setConversationModels] = useState<ConversationModelOption[]>([]);
	const [capabilities, setCapabilities] = useState<ConversationCapabilities>();
	const [loadingCapabilities, setLoadingCapabilities] = useState(false);
	const [loadingConversationModels, setLoadingConversationModels] = useState(false);
	const [optimisticMessage, setOptimisticMessage] = useState<OptimisticUserMessage>();
	const [streamConnectedInstanceId, setStreamConnectedInstanceId] = useState<string>();
	const [conversationTitles, setConversationTitles] = useState<Record<string, string>>({});
	const [pendingConversationUiRequests, setPendingConversationUiRequests] = useState<PendingConversationUiRequest[]>(
		[],
	);
	const [respondingConversationUiRequestId, setRespondingConversationUiRequestId] = useState<string>();
	const [extensionNotice, setExtensionNotice] = useState<ExtensionNotice>();
	/** info notify (e.g. TPS) shown under the latest assistant reply, not the top bar */
	const [turnMeta, setTurnMeta] = useState<{ instanceId: string; message: string }>();
	const [composerDraftRequest, setComposerDraftRequest] = useState<{ id: string; text: string; images?: string[] }>();
	const [selectedInstanceId, setSelectedInstanceId] = useState<string>();
	const [selectedTaskId, setSelectedTaskId] = useState<string>();
	const [selectedRunId, setSelectedRunId] = useState<string>();
	const [view, setView] = useState<View>(() => {
		if (typeof window === "undefined") return "chat";
		return initialView(window.location.hash, window.localStorage.getItem(VIEW_STORAGE_KEY));
	});
	const [taskFilter, setTaskFilter] = useState<TaskFilter>("all");
	const [taskQuery, setTaskQuery] = useState("");
	const [chatQuery, setChatQuery] = useState("");
	const [loading, setLoading] = useState(true);
	const [initialLoadComplete, setInitialLoadComplete] = useState(false);
	const [startupReady, setStartupReady] = useState(false);
	const [busy, setBusy] = useState<string>();
	const [error, setError] = useState<string>();
	// Track which instances are actively processing (agent_start → agent_settled)
	const [streamingInstances, setStreamingInstances] = useState<Set<string>>(new Set());
	const [turnProgress, setTurnProgress] = useState<TurnProgress>();
	const [showCreateTask, setShowCreateTask] = useState(false);
	const [taskPrefill, setTaskPrefill] = useState<{ title?: string; prompt?: string }>({});
	const [renamingConversation, setRenamingConversation] = useState<AgentInstance>();
	const [deletingConversation, setDeletingConversation] = useState<AgentInstance>();
	const [removingProject, setRemovingProject] = useState<DeleteProjectTarget>();
	const [quickSaveMemoryText, setQuickSaveMemoryText] = useState<string | null>(null);
	const [sidebarOpen, setSidebarOpen] = useState(true);
	const [contextOpen, setContextOpen] = useState(false);
	const [log, setLog] = useState<string>();
	const [workspaceMemory, setWorkspaceMemory] = useState<string[]>([]);
	const [workspaceSummary, setWorkspaceSummary] = useState<WorkspaceSummary>();
	const [gitStatus, setGitStatus] = useState<GitStatusResult | null>(null);
	const [gitLoading, setGitLoading] = useState(false);
	const [runningTools, setRunningTools] = useState<RunningTool[]>([]);
	const [toolDurations, setToolDurations] = useState<Record<string, number>>({});
	const [visionFallback, setVisionFallback] = useState<VisionFallbackConfig>();
	const [workspaceIntelligenceRuns, setWorkspaceIntelligenceRuns] = useState<string[]>([]);
	const [intelligenceDetail, setIntelligenceDetail] = useState<string>("");
	const [selectedIntelligenceRunId, setSelectedIntelligenceRunId] = useState<string>();
	const [conversationCommands, setConversationCommands] = useState<string[]>([]);
	const [memoryDraft, setMemoryDraft] = useState({ type: "project", key: "", value: "", body: "" });
	const [memoryScope, setMemoryScope] = useState<"project" | "global">("project");
	const [memoryMeta, setMemoryMeta] = useState<{
		lastMaintainAt?: string;
		sessionCountSinceMaintain?: number;
		lastLlmExtractAt?: string;
		lastIdleOrganizeAt?: string;
		projectCount?: number;
		globalCount?: number;
		archiveCount?: number;
		digestCount?: number;
		latestDigest?: string | null;
		hasVectors?: boolean;
		hasLexicon?: boolean;
		features?: {
			proactiveInject?: boolean;
			softExtractEveryTurn?: boolean;
			autoSessionDigest?: boolean;
			promoteUserToGlobal?: boolean;
			searchArchive?: boolean;
		};
	}>({});
	const [includeStopped, setIncludeStopped] = useState(true);
	const [showAllConversations, setShowAllConversations] = useState(false);
	const [userProfile, setUserProfile] = useState<{ nickname?: string; avatarEmoji?: string; updatedAt?: string }>({});
	const [editingProfile, setEditingProfile] = useState(false);
	const [authDialog, setAuthDialog] = useState<{
		provider: string;
		url?: string;
		userCode?: string;
		status: "pending" | "completed" | "failed";
		message?: string;
	}>();
	// Stable first-seen order: once an instance gets an index it never changes
	const [conversationOrder, setConversationOrder] = useState<Record<string, number>>({});
	const [appMode, setAppMode] = useState<AppMode>(() => {
		if (typeof window === "undefined") return "chat";
		const stored = window.localStorage.getItem("openpi-app-mode");
		return stored === "code" || stored === "personal" ? stored : "chat";
	});
	const [preferredMode, setPreferredMode] = useState<AgentMode>(() => {
		if (typeof window === "undefined") return "work";
		const stored = window.localStorage.getItem("openpi-agent-mode");
		return stored === "code" || stored === "personal" ? stored : "work";
	});
	const [codeWorkspace, setCodeWorkspace] = useState<string | undefined>(() => {
		if (typeof window === "undefined") return undefined;
		return window.localStorage.getItem("openpi-code-workspace") || undefined;
	});
	const selectedInstanceIdRef = useRef(selectedInstanceId);
	const runningToolsInstanceIdRef = useRef<string | undefined>(undefined);
	const conversationCacheRef = useRef<Record<string, ConversationSnapshot>>({});
	const routeInitializedRef = useRef(false);
	const refreshCurrentViewRef = useRef<() => Promise<void>>(async () => undefined);
	const turnStartTimesRef = useRef<Record<string, number>>({});
	selectedInstanceIdRef.current = selectedInstanceId;
	const clearRunningTools = useCallback((instanceId?: string): void => {
		if (instanceId !== undefined && runningToolsInstanceIdRef.current !== instanceId) return;
		runningToolsInstanceIdRef.current = undefined;
		setRunningTools([]);
	}, []);

	const activeConversationUiRequest = pendingConversationUiRequests[0];
	const isStreaming = Boolean(
		conversation?.state.isStreaming ||
		optimisticMessage ||
		(selectedInstanceId && streamingInstances.has(selectedInstanceId)),
	);
	const isWorking = Boolean(isStreaming || busy === "send-message" || runningTools.length > 0);

	useEffect(() => {
		if (conversation) conversationCacheRef.current[conversation.instance.id] = conversation;
	}, [conversation]);

	const refresh = useCallback(
		async (showLoading = false) => {
			if (showLoading) setLoading(true);
			try {
				const next = await desktopApi.getSnapshot({ includeStopped });
				setSnapshot(next);
				setSelectedInstanceId((current) => {
					// Keep pinned selection if still present (including just-created online)
					if (current && next.instances.some((instance) => instance.id === current)) return current;
					// Prefer online; never auto-select stopped/error ghosts
					const online =
						next.instances.find((instance) => instance.status === "online") ??
						next.instances.find((instance) => instance.status === "starting");
					return online?.id;
				});
				setSelectedTaskId((current) => {
					if (current && next.tasks.some((task) => task.id === current)) return current;
					return next.tasks[0]?.id;
				});
				setError(undefined);
			} catch (caught) {
				setError(caught instanceof Error ? caught.message : String(caught));
			} finally {
				if (showLoading) {
					setLoading(false);
					setInitialLoadComplete(true);
				}
			}
		},
		[includeStopped],
	);

	useEffect(() => {
		if (!desktopApi.isNative) return;
		let disposed = false;
		void desktopApi
			.getUserProfile()
			.then((profile) => {
				if (!disposed) setUserProfile(profile ?? {});
			})
			.catch(() => {});
		return () => {
			disposed = true;
		};
	}, []);

	async function saveUserProfile(profile: { nickname?: string; avatarEmoji?: string }): Promise<void> {
		setBusy("save-profile");
		setError(undefined);
		try {
			const next = await desktopApi.saveUserProfile(profile);
			setUserProfile(next ?? {});
			setEditingProfile(false);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setBusy(undefined);
		}
	}

	useEffect(() => {
		window.localStorage.setItem("openpi-app-mode", appMode);
		// Sync preferredMode with appMode for new conversation creation
		setPreferredMode(appMode === "code" ? "code" : appMode === "personal" ? "personal" : "work");
	}, [appMode]);

	useEffect(() => {
		window.localStorage.setItem("openpi-agent-mode", preferredMode);
	}, [preferredMode]);

	useEffect(() => {
		if (codeWorkspace) window.localStorage.setItem("openpi-code-workspace", codeWorkspace);
		else window.localStorage.removeItem("openpi-code-workspace");
	}, [codeWorkspace]);

	// Persist the selected conversation so a reload (Cmd/Ctrl+R) keeps focus
	// on the project you were working on instead of falling back to the
	// first online instance.
	useEffect(() => {
		if (selectedInstanceId) window.localStorage.setItem(SELECTED_INSTANCE_KEY, selectedInstanceId);
		else window.localStorage.removeItem(SELECTED_INSTANCE_KEY);
	}, [selectedInstanceId]);

	useEffect(() => {
		window.localStorage.setItem(VIEW_STORAGE_KEY, view);
		const nextHash = hashForView(view);
		if (window.location.hash !== nextHash) {
			if (routeInitializedRef.current) window.history.pushState(null, "", nextHash);
			else window.history.replaceState(null, "", nextHash);
		}
		routeInitializedRef.current = true;
	}, [view]);

	useEffect(() => {
		const syncViewFromRoute = () => {
			const nextView = viewFromHash(window.location.hash) ?? "chat";
			const normalizedHash = hashForView(nextView);
			if (window.location.hash !== normalizedHash) {
				window.history.replaceState(null, "", normalizedHash);
			}
			setView(nextView);
		};
		window.addEventListener("hashchange", syncViewFromRoute);
		window.addEventListener("popstate", syncViewFromRoute);
		return () => {
			window.removeEventListener("hashchange", syncViewFromRoute);
			window.removeEventListener("popstate", syncViewFromRoute);
		};
	}, []);

	useEffect(() => {
		let disposed = false;
		void desktopApi
			.setupStatus()
			.then((status) => {
				if (disposed) return;
				setSetup({ checked: true, enabled: status.enabled, workspace: status.workspace });
			})
			.catch((_caught: unknown) => {
				if (disposed) return;
				setSetup({ checked: true, enabled: false });
				setInitialLoadComplete(true);
			});
		return () => {
			disposed = true;
		};
	}, []);

	useEffect(() => {
		if (!setup.checked || !setup.enabled) return;
		void refresh(true);
		// Reconcile quickly while the daemon is starting, then back off.
		const intervalMs =
			snapshot.daemonRunning && snapshot.health?.sessionsIndexed ? (isStreaming ? 5_000 : 15_000) : 750;
		const timer = window.setInterval(() => void refresh(), intervalMs);
		return () => window.clearInterval(timer);
	}, [refresh, setup.checked, setup.enabled, isStreaming, snapshot.daemonRunning, snapshot.health?.sessionsIndexed]);

	useEffect(() => {
		if (startupReady) return;
		if (!setup.checked) return;
		if (!setup.enabled) {
			setStartupReady(true);
			return;
		}
		if (!initialLoadComplete || !snapshot.daemonRunning || !snapshot.health?.sessionsIndexed) return;

		let disposed = false;
		const loadInitialData = async (): Promise<void> => {
			try {
				const [profile, fallback] = await Promise.all([
					desktopApi.getUserProfile(),
					desktopApi.getVisionFallback(),
				]);
				if (disposed) return;
				setUserProfile(profile ?? {});
				setVisionFallback(fallback);
			} catch (caught) {
				if (!disposed) setError(caught instanceof Error ? caught.message : String(caught));
			} finally {
				if (!disposed) setStartupReady(true);
			}
		};

		void loadInitialData();
		return () => {
			disposed = true;
		};
	}, [
		initialLoadComplete,
		setup.checked,
		setup.enabled,
		snapshot.daemonRunning,
		snapshot.health?.sessionsIndexed,
		startupReady,
	]);

	// Conversation stats + provider balance for the status bar.
	useEffect(() => {
		if (!selectedInstanceId) {
			setConversationStats(undefined);
			setProviderBalance(undefined);
			return;
		}
		let disposed = false;
		const poll = () =>
			desktopApi
				.getConversationStats(selectedInstanceId)
				.then((stats) => {
					if (!disposed) setConversationStats(stats);
				})
				.catch(() => {});
		poll();
		const timer = window.setInterval(poll, 3000);
		return () => {
			disposed = true;
			window.clearInterval(timer);
		};
	}, [selectedInstanceId]);

	useEffect(() => {
		const provider = conversation?.state.model?.provider;
		if (!provider) {
			setProviderBalance(undefined);
			return;
		}
		void desktopApi
			.getProviderBalance(provider)
			.then(setProviderBalance)
			.catch(() => setProviderBalance(undefined));
	}, [conversation?.state.model?.provider]);

	// Task list panel: poll while a conversation is selected (todo changes come
	// from agent tool calls, which emit no dedicated desktop event).
	useEffect(() => {
		if (!selectedInstanceId || view !== "chat") {
			setTodoState(undefined);
			return;
		}
		let disposed = false;
		const poll = () =>
			void desktopApi
				.getSessionTodo(selectedInstanceId)
				.then((state) => {
					if (!disposed) setTodoState(state ?? undefined);
				})
				.catch(() => {});
		poll();
		const timer = window.setInterval(poll, 2000);
		return () => {
			disposed = true;
			window.clearInterval(timer);
		};
	}, [selectedInstanceId, view]);

	useEffect(() => {
		if (!desktopApi.isNative) return;
		let disposed = false;
		const unlisten = desktopApi.onConversationEvent((payload) => {
			if (disposed || payload.instanceId !== selectedInstanceIdRef.current || !isRecord(payload.event)) return;
			const event = payload.event;
			const eventType = typeof event.type === "string" ? event.type : undefined;
			const assistantMessageEvent = isRecord(event.assistantMessageEvent)
				? {
						type:
							typeof event.assistantMessageEvent.type === "string"
								? event.assistantMessageEvent.type
								: undefined,
					}
				: undefined;
			setTurnProgress((current) =>
				reduceTurnProgress(current, {
					instanceId: payload.instanceId,
					type: eventType,
					assistantMessageEvent,
					toolName: event.toolName,
					error: event.error,
				}),
			);
			if (eventType === "extension_ui_request") {
				if (payload.event.method === "auth" && typeof payload.event.provider === "string") {
					setAuthDialog({
						provider: payload.event.provider,
						url: typeof payload.event.url === "string" ? payload.event.url : undefined,
						userCode: typeof payload.event.userCode === "string" ? payload.event.userCode : undefined,
						status:
							payload.event.status === "completed" || payload.event.status === "failed"
								? payload.event.status
								: "pending",
						message:
							typeof payload.event.message === "string"
								? payload.event.message
								: typeof payload.event.instructions === "string"
									? payload.event.instructions
									: undefined,
					});
					return;
				}
				if (payload.event.method === "notify" && typeof payload.event.message === "string") {
					const type: ExtensionNotice["type"] =
						payload.event.notifyType === "warning" || payload.event.notifyType === "error"
							? payload.event.notifyType
							: "info";
					// Stats / info go under the assistant message; only warn/error stay as top banners
					if (type === "info") {
						setTurnMeta({ instanceId: payload.instanceId, message: payload.event.message });
						return;
					}
					setExtensionNotice({
						id: typeof payload.event.id === "string" ? payload.event.id : crypto.randomUUID(),
						message: payload.event.message,
						type,
					});
					return;
				}
				if (payload.event.method === "set_editor_text" && typeof payload.event.text === "string") {
					setComposerDraftRequest({
						id: typeof payload.event.id === "string" ? payload.event.id : crypto.randomUUID(),
						text: payload.event.text,
					});
					return;
				}
				const request = blockingConversationUiRequest(payload.event);
				if (request) {
					setPendingConversationUiRequests((current) =>
						current.some((pending) => pending.request.id === request.id)
							? current
							: [...current, { instanceId: payload.instanceId, request }],
					);
				}
				return;
			}
			if (eventType === "rpc_ready") {
				setStreamConnectedInstanceId(payload.instanceId);
				return;
			}
			if (eventType === "stream_closed" || eventType === "stream_error") {
				setStreamConnectedInstanceId((current) => (current === payload.instanceId ? undefined : current));
				clearRunningTools(payload.instanceId);
				setStreamingInstances((prev) => {
					const next = new Set(prev);
					next.delete(payload.instanceId);
					return next;
				});
				setPendingConversationUiRequests((current) =>
					current.filter((pending) => pending.instanceId !== payload.instanceId),
				);
				if (eventType === "stream_error" && typeof payload.event.error === "string") {
					setError(payload.event.error);
				}
				return;
			}
			if (eventType === "rpc_ready") {
				setStreamConnectedInstanceId(payload.instanceId);
				return;
			}
			if (eventType === "agent_start") {
				turnStartTimesRef.current[payload.instanceId] = Date.now();
				clearRunningTools();
				setStreamConnectedInstanceId(payload.instanceId);
				setStreamingInstances((prev) => new Set(prev).add(payload.instanceId));
				setConversation((current) =>
					current?.instance.id === payload.instanceId
						? { ...current, state: { ...current.state, isStreaming: true } }
						: current,
				);
				return;
			}
			if (eventType === "agent_settled") {
				clearRunningTools(payload.instanceId);
				setStreamingInstances((prev) => {
					const next = new Set(prev);
					next.delete(payload.instanceId);
					return next;
				});
				setConversation((current) =>
					current?.instance.id === payload.instanceId
						? { ...current, state: { ...current.state, isStreaming: false } }
						: current,
				);
				const startTime = turnStartTimesRef.current[payload.instanceId];
				delete turnStartTimesRef.current[payload.instanceId];
				const duration = startTime ? Date.now() - startTime : 0;
				const isUnfocused = typeof document !== "undefined" && (document.hidden || !document.hasFocus());
				if (duration >= 5000 || isUnfocused) {
					void desktopApi.notifyTaskCompleted?.({
						message: "任务执行完成",
						durationMs: duration,
					});
				}
				void desktopApi
					.getConversation(payload.instanceId)
					.then((next) => {
						if (!disposed && selectedInstanceIdRef.current === payload.instanceId) setConversation(next);
					})
					.catch((caught: unknown) => {
						if (!disposed) setError(caught instanceof Error ? caught.message : String(caught));
					});
				void desktopApi.getConversationStats(payload.instanceId).then((stats) => {
					if (!disposed && selectedInstanceIdRef.current === payload.instanceId) setConversationStats(stats);
				});
				return;
			}
			if (eventType === "tool_execution_start" || eventType === "tool_execution_update") {
				const toolCallId = typeof payload.event.toolCallId === "string" ? payload.event.toolCallId : undefined;
				const toolName = typeof payload.event.toolName === "string" ? payload.event.toolName : undefined;
				if (!toolCallId || !toolName || selectedInstanceIdRef.current !== payload.instanceId) return;
				runningToolsInstanceIdRef.current = payload.instanceId;
				const now = Date.now();
				setRunningTools((current) => {
					const existingTool = current.find((tool) => tool.toolCallId === toolCallId);
					const next: RunningTool = {
						toolCallId,
						toolName,
						status: eventType === "tool_execution_update" ? "updating" : "running",
						args: (payload.event as { args?: unknown }).args,
						partialResult: (payload.event as { partialResult?: unknown }).partialResult,
						startedAt: existingTool?.startedAt ?? now,
						updatedAt: now,
					};
					const existing = current.findIndex((tool) => tool.toolCallId === toolCallId);
					if (existing === -1) return [...current, next];
					return current.map((tool, index) => (index === existing ? next : tool));
				});
				return;
			}
			if (eventType === "tool_execution_end") {
				const toolCallId = typeof payload.event.toolCallId === "string" ? payload.event.toolCallId : undefined;
				if (toolCallId && selectedInstanceIdRef.current === payload.instanceId) {
					setRunningTools((current) => {
						const existing = current.find((tool) => tool.toolCallId === toolCallId);
						if (existing) {
							const duration = Math.max(1, Date.now() - existing.startedAt);
							setToolDurations((prev) => ({ ...prev, [toolCallId]: duration }));
						}
						return current.filter((tool) => tool.toolCallId !== toolCallId);
					});
				}
				return;
			}
			if (eventType === "message_update") {
				const amEvent = (payload.event as Record<string, any>).assistantMessageEvent;
				if (amEvent) {
					setConversation((current) => {
						if (!current || current.instance.id !== payload.instanceId) return current;
						const messages = [...current.messages];
						let last = messages[messages.length - 1];
						if (!last || last.role !== "assistant") {
							last = { role: "assistant", content: [] };
							messages.push(last);
						} else {
							last = { ...last };
							messages[messages.length - 1] = last;
						}
						const content = Array.isArray(last.content) ? [...last.content] : [];
						const idx = typeof amEvent.contentIndex === "number" ? amEvent.contentIndex : 0;
						while (content.length <= idx) {
							content.push(
								amEvent.type === "thinking_delta" || amEvent.type === "thinking_start" || amEvent.type === "reasoning_delta" || amEvent.type === "reasoning_start"
									? { type: "thinking", thinking: "" }
									: amEvent.type === "toolcall_start" || amEvent.type === "toolcall_delta" || amEvent.type === "toolcall_end"
									? { type: "toolCall", id: amEvent.id ?? "", name: amEvent.toolName ?? "", arguments: {} }
									: { type: "text", text: "" },
							);
						}
						const block = { ...(content[idx] as Record<string, any>) };
						if (amEvent.type === "text_delta" && typeof amEvent.delta === "string") {
							block.type = "text";
							block.text = (block.text || "") + amEvent.delta;
						} else if (
							(amEvent.type === "thinking_delta" || amEvent.type === "reasoning_delta") &&
							(typeof amEvent.delta === "string" || typeof amEvent.reasoning_delta === "string")
						) {
							block.type = "thinking";
							const chunk = typeof amEvent.delta === "string" ? amEvent.delta : amEvent.reasoning_delta;
							block.thinking = (block.thinking || "") + chunk;
						} else if (amEvent.type === "thinking_end" || amEvent.type === "reasoning_end") {
							block.type = "thinking";
							if (typeof amEvent.content === "string") {
								block.thinking = amEvent.content;
							}
						} else if (amEvent.type === "toolcall_start") {
							block.type = "toolCall";
							block.id = amEvent.id || block.id;
							block.name = amEvent.toolName || block.name;
							block.arguments = amEvent.arguments ?? block.arguments ?? {};
						} else if (amEvent.type === "toolcall_delta" && typeof amEvent.delta === "string") {
							block.type = "toolCall";
							block.rawDelta = (block.rawDelta || "") + amEvent.delta;
							try {
								block.arguments = JSON.parse(block.rawDelta);
							} catch {}
						} else if (amEvent.type === "toolcall_end" && amEvent.toolCall) {
							block.type = "toolCall";
							block.id = amEvent.toolCall.id || block.id;
							block.name = amEvent.toolCall.name || block.name;
							block.arguments = amEvent.toolCall.arguments ?? block.arguments ?? {};
						}
						content[idx] = block;
						last.content = content;

						// Circuit Breaker: detect repetitive degeneration loop (only on final text output)
						const textToCheck = block.type === "text" ? block.text : "";
						const loop = detectRepetitionLoop(textToCheck || "");
						if (loop.isLoop && loop.repeatedPattern) {
							void desktopApi.abortConversation(payload.instanceId);
							setError(
								`⚠️ 检测到模型输出陷入重复死循环（“${loop.repeatedPattern}” 连续重复出现），已自动为您熔断截停！已阻止不必要的 Token 消耗。建议切换至 medium 思考档位或选用 Pro 模型。`,
							);
							setStreamingInstances((prev) => {
								const next = new Set(prev);
								next.delete(payload.instanceId);
								return next;
							});
							clearRunningTools(payload.instanceId);
							if (block.type === "text") {
								block.text = `${block.text}\n\n> ⚠️ *[OpenPI 智能熔断]* 检测到模型输出陷入自回归复读死循环，已自动终止生成，保护您的 Token 与上下文。`;
							}
							return {
								...current,
								state: { ...current.state, isStreaming: false },
								messages,
							};
						}

						return {
							...current,
							state: { ...current.state, isStreaming: true, messageCount: messages.length },
							messages,
						};
					});
				}
				return;
			}
			if (
				(eventType !== "message_start" && eventType !== "message_end") ||
				!isConversationMessage(payload.event.message)
			) {
				return;
			}
			const incoming = payload.event.message;
			if (incoming.role === "user") {
				setOptimisticMessage((current) =>
					current &&
					(current.instanceId === undefined || current.instanceId === payload.instanceId) &&
					conversationContentMatches(current.message.content, incoming.content)
						? undefined
						: current,
				);
			}
			setConversation((current) => {
				if (!current || current.instance.id !== payload.instanceId) return current;
				const messages = mergeConversationMessage(current.messages, incoming);
				return {
					...current,
					state: { ...current.state, isStreaming: true, messageCount: messages.length },
					messages,
				};
			});
		});
		return () => {
			disposed = true;
			unlisten();
		};
	}, []);

	useEffect(() => {
		if (!activeConversationUiRequest) return;
		const { request } = activeConversationUiRequest;
		const timeout = "timeout" in request ? request.timeout : undefined;
		if (timeout === undefined) return;
		const timer = window.setTimeout(() => {
			setPendingConversationUiRequests((current) => current.filter((pending) => pending.request.id !== request.id));
		}, timeout);
		return () => window.clearTimeout(timer);
	}, [activeConversationUiRequest]);

	useEffect(() => {
		if (!desktopApi.isNative || !selectedInstanceId) return;
		let disposed = false;
		void desktopApi
			.watchConversation(selectedInstanceId)
			.then(() => {
				if (!disposed) {
					setStreamConnectedInstanceId(selectedInstanceId);
				}
			})
			.catch((caught: unknown) => {
				if (!disposed) {
					setStreamConnectedInstanceId((current) => (current === selectedInstanceId ? undefined : current));
					clearRunningTools(selectedInstanceId);
					setError(caught instanceof Error ? caught.message : String(caught));
				}
			});
		return () => {
			disposed = true;
			setStreamConnectedInstanceId((current) => (current === selectedInstanceId ? undefined : current));
			clearRunningTools(selectedInstanceId);
			void desktopApi.stopWatchingConversation(selectedInstanceId);
		};
	}, [selectedInstanceId]);

	useEffect(() => {
		if (!selectedInstanceId) {
			setConversation(undefined);
			return;
		}
		let disposed = false;
		let timer: number | undefined;
		const instanceId = selectedInstanceId;
		const cached = conversationCacheRef.current[instanceId];
		setConversation(cached);
		const poll = async () => {
			let delay = 4_000;
			try {
				const next = await desktopApi.getConversation(instanceId);
				conversationCacheRef.current[instanceId] = next;
				const pending = optimisticMessage?.instanceId === instanceId ? optimisticMessage : undefined;
				const messageAccepted = pending
					? next.messages
							.slice(pending.baselineMessageCount)
							.some(
								(message) =>
									message.role === "user" &&
									conversationContentMatches(message.content, pending.message.content),
							)
					: false;
				const streamConnected = streamConnectedInstanceId === instanceId;
				delay = (pending && !messageAccepted) || (next.state.isStreaming && !streamConnected) ? 250 : 4_000;
				if (!disposed) {
					setConversation((current) => {
						if (!current || current.instance.id !== next.instance.id) {
							return next;
						}
						const isActivelyStreaming = Boolean(
							current.state?.isStreaming ||
							next.state?.isStreaming ||
							streamingInstances.has(instanceId),
						);
						if (isActivelyStreaming) {
							if (current.messages.length > next.messages.length) {
								return {
									...next,
									state: { ...next.state, isStreaming: true },
									messages: [
										...next.messages,
										...current.messages.slice(next.messages.length),
									],
								};
							}
							const lastCurrent = current.messages[current.messages.length - 1];
							const lastNext = next.messages[next.messages.length - 1];
							if (lastCurrent?.role === "assistant" && lastNext?.role === "assistant") {
								const currentText = contentText(lastCurrent.content);
								const nextText = contentText(lastNext.content);
								const currentReasoning = messageReasoning(lastCurrent);
								const nextReasoning = messageReasoning(lastNext);
								if (currentText.length > nextText.length || currentReasoning.length > nextReasoning.length) {
									const merged = [...next.messages];
									merged[merged.length - 1] = lastCurrent;
									return {
										...next,
										state: { ...next.state, isStreaming: true },
										messages: merged,
									};
								}
							}
							return {
								...next,
								state: { ...next.state, isStreaming: true },
							};
						}
						return next;
					});
					if (!next.state.isStreaming && !streamingInstances.has(instanceId)) {
						clearRunningTools(instanceId);
					}
					if (messageAccepted) {
						setOptimisticMessage((current) => (current === pending ? undefined : current));
					}
					const sessionName = next.state.sessionName;
					if (sessionName) {
						setConversationTitles((current) => ({ ...current, [next.instance.id]: sessionName }));
					}
					setError(undefined);
				}
			} catch (caught) {
				const msg = caught instanceof Error ? caught.message : String(caught);
				if (!disposed) {
					// Dead instance: stop polling and drop selection so we don't spam Unknown instance
					if (/Unknown instance|对话已失效|已删除/i.test(msg)) {
						setConversation(undefined);
						setError(msg.includes("新建") ? msg : `对话已失效。请点 + 新建对话。`);
						setSelectedInstanceId((current) => (current === instanceId ? undefined : current));
						setSnapshot((current) => ({
							...current,
							instances: current.instances.filter((entry) => entry.id !== instanceId),
						}));
						return;
					}
					setError(msg);
				}
			}
			if (!disposed) timer = window.setTimeout(poll, delay);
		};
		void poll();
		return () => {
			disposed = true;
			if (timer !== undefined) window.clearTimeout(timer);
			if (instanceId) {
				void desktopApi.stopConversationStream(instanceId).catch(() => {});
			}
		};
	}, [selectedInstanceId, optimisticMessage, streamConnectedInstanceId, streamingInstances]);

	useEffect(() => {
		clearRunningTools();
	}, [clearRunningTools, selectedInstanceId]);

	const loadConversationModels = useCallback(async (instanceId: string): Promise<void> => {
		setLoadingConversationModels(true);
		try {
			const models = await desktopApi.getConversationModels(instanceId);
			if (selectedInstanceIdRef.current === instanceId) {
				setConversationModels(normalizeConversationModels(models));
			}
		} catch (caught: unknown) {
			if (selectedInstanceIdRef.current === instanceId) {
				setError(caught instanceof Error ? caught.message : String(caught));
			}
		} finally {
			if (selectedInstanceIdRef.current === instanceId) setLoadingConversationModels(false);
		}
	}, []);

	useEffect(() => {
		setConversationModels([]);
		if (!selectedInstanceId) {
			setLoadingConversationModels(false);
			return;
		}
		void loadConversationModels(selectedInstanceId);
	}, [selectedInstanceId, loadConversationModels]);

	useEffect(() => {
		const handleModelProvidersChanged = () => {
			const instanceId = selectedInstanceIdRef.current;
			if (instanceId) void loadConversationModels(instanceId);
			void desktopApi
				.getVisionFallback()
				.then(setVisionFallback)
				.catch(() => undefined);
		};
		window.addEventListener("openpi:model-providers-changed", handleModelProvidersChanged);
		return () => window.removeEventListener("openpi:model-providers-changed", handleModelProvidersChanged);
	}, [loadConversationModels]);

	useEffect(() => {
		void desktopApi
			.getVisionFallback()
			.then(setVisionFallback)
			.catch(() => undefined);
	}, []);

	const loadCapabilities = useCallback(async (instanceId: string, reload = false): Promise<void> => {
		setLoadingCapabilities(true);
		setError(undefined);
		try {
			const next = reload
				? await desktopApi.reloadConversationCapabilities(instanceId)
				: await desktopApi.getConversationCapabilities(instanceId);
			if (selectedInstanceIdRef.current === instanceId) setCapabilities(next);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			if (selectedInstanceIdRef.current === instanceId) setLoadingCapabilities(false);
		}
	}, []);

	useEffect(() => {
		setCapabilities(undefined);
		if (!selectedInstanceId || view !== "capabilities") {
			setLoadingCapabilities(false);
			return;
		}
		void loadCapabilities(selectedInstanceId);
	}, [selectedInstanceId, view, loadCapabilities]);

	const tasks = useMemo(() => {
		const normalized = taskQuery.trim().toLowerCase();
		return snapshot.tasks.filter((task) => {
			if (taskFilter !== "all" && task.status !== taskFilter) return false;
			return !normalized || `${task.title} ${task.prompt} ${task.cwd ?? ""}`.toLowerCase().includes(normalized);
		});
	}, [snapshot.tasks, taskFilter, taskQuery]);

	const SIDEBAR_LIMIT = 15;
	// Register any new instances so their position is fixed once and for all
	const knownIds = new Set(Object.keys(conversationOrder));
	const newIds = snapshot.instances.filter((i) => !knownIds.has(i.id));
	if (newIds.length > 0) {
		let seq = Object.keys(conversationOrder).length;
		const additions: Record<string, number> = {};
		for (const inst of newIds) additions[inst.id] = seq++;
		setConversationOrder((prev) => ({ ...prev, ...additions }));
	}
	const conversationList = useMemo(() => {
		const normalized = chatQuery.trim().toLowerCase();
		const filtered = snapshot.instances.filter((instance) => {
			return (
				!normalized ||
				`${instanceTitle(instance, conversationTitles[instance.id])} ${instance.cwd}`
					.toLowerCase()
					.includes(normalized)
			);
		});
		const isProject = (instance: AgentInstance) => instance.mode === "code";
		const projectFiltered = filtered.filter(isProject);
		const chatFiltered = filtered.filter((i) => !isProject(i));
		const sortByOrder = (a: AgentInstance, b: AgentInstance) =>
			(conversationOrder[a.id] ?? Infinity) - (conversationOrder[b.id] ?? Infinity);
		const rankedProjects = projectFiltered.slice().sort(sortByOrder);
		const rankedChat = chatFiltered.slice().sort(sortByOrder);
		const searching = Boolean(normalized);
		const totalAll = rankedProjects.length + rankedChat.length;
		const truncateList = (list: AgentInstance[]) => {
			if (showAllConversations || searching || list.length <= SIDEBAR_LIMIT) return list;
			const head = list.slice(0, SIDEBAR_LIMIT);
			if (selectedInstanceId && !head.some((i) => i.id === selectedInstanceId)) {
				const selected = list.find((i) => i.id === selectedInstanceId);
				if (selected) return [selected, ...head.slice(0, SIDEBAR_LIMIT - 1)];
			}
			return head;
		};
		return {
			conversations: truncateList(rankedChat),
			projects: truncateList(rankedProjects),
			totalCount: totalAll,
			truncated: totalAll > SIDEBAR_LIMIT && !searching,
		};
	}, [snapshot.instances, conversationTitles, chatQuery, showAllConversations, selectedInstanceId, conversationOrder]);
	const conversations = conversationList.conversations;

	const selectedTask = snapshot.tasks.find((task) => task.id === selectedTaskId);
	const taskRuns = snapshot.runs
		.filter((run) => run.taskId === selectedTaskId)
		.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
	const selectedRun = snapshot.runs.find((run) => run.id === selectedRunId) ?? taskRuns[0];
	const activeConversation = conversation?.instance.id === selectedInstanceId ? conversation : undefined;
	const selectedAgentInstance =
		activeConversation?.instance ?? snapshot.instances.find((instance) => instance.id === selectedInstanceId);
	const activeAgentMode = selectedAgentInstance?.mode ?? preferredMode;
	const activeCodeWorkspace =
		selectedAgentInstance?.mode === "code" ? selectedAgentInstance.cwd : (codeWorkspace ?? setup.workspace);
	const selectedWorkspace =
		activeConversation?.instance.cwd ??
		snapshot.instances.find((instance) => instance.id === selectedInstanceId)?.cwd ??
		setup.workspace;
	const operationView =
		view === "memory" || view === "intelligence" || view === "daemon" || view === "git";

	const loadGitStatus = useCallback(
		async (cwd?: string) => {
			const targetCwd = cwd ?? selectedWorkspace ?? setup.workspace;
			if (!targetCwd) {
				setGitStatus(null);
				return;
			}
			setGitLoading(true);
			try {
				const res = await desktopApi.getGitStatus(targetCwd);
				setGitStatus(res);
			} catch {
				setGitStatus(null);
			} finally {
				setGitLoading(false);
			}
		},
		[selectedWorkspace, setup.workspace],
	);

	useEffect(() => {
		void loadGitStatus();
	}, [loadGitStatus]);

	useEffect(() => {
		if (!selectedWorkspace) {
			setWorkspaceSummary(undefined);
			return;
		}
		let disposed = false;
		void desktopApi
			.getWorkspaceSummary(selectedWorkspace)
			.then((summary) => {
				if (!disposed) setWorkspaceSummary(summary);
			})
			.catch((caught: unknown) => {
				if (!disposed) {
					setWorkspaceSummary(undefined);
					setError(caught instanceof Error ? caught.message : String(caught));
				}
			});
		return () => {
			disposed = true;
		};
	}, [selectedWorkspace]);

	// Load agent slash commands for chat hub (not only intelligence page)
	useEffect(() => {
		if (!selectedInstanceId) {
			setConversationCommands([]);
			return;
		}
		let disposed = false;
		void desktopApi
			.getConversationCommands(selectedInstanceId)
			.then((commands) => {
				if (!disposed) setConversationCommands(commands);
			})
			.catch(() => {
				if (!disposed) setConversationCommands([]);
			});
		return () => {
			disposed = true;
		};
	}, [selectedInstanceId]);

	useEffect(() => {
		if (!selectedWorkspace) {
			if (view === "memory" || view === "chat") setWorkspaceMemory([]);
			if (view === "intelligence") {
				setWorkspaceIntelligenceRuns([]);
				setSelectedIntelligenceRunId(undefined);
				setIntelligenceDetail("");
			}
			return;
		}
		let disposed = false;
		const loadWorkspaceSurface = async (): Promise<void> => {
			try {
				if (view === "memory" || view === "chat") {
					const [entries, meta] = await Promise.all([
						desktopApi.listMemoryIndex(selectedWorkspace, memoryScope),
						desktopApi.memoryMeta(selectedWorkspace),
					]);
					if (!disposed) {
						setWorkspaceMemory(entries);
						setMemoryMeta({
							...meta.meta,
							projectCount: meta.projectCount,
							globalCount: meta.globalCount,
							archiveCount: meta.archiveCount,
							digestCount: meta.digestCount,
							latestDigest: meta.latestDigest,
							hasVectors: meta.hasVectors,
							hasLexicon: meta.hasLexicon,
							features: meta.features,
						});
					}
					return;
				}
				if (view !== "intelligence") return;
				const runs = await desktopApi.listIntelligenceRuns(selectedWorkspace);
				if (disposed) return;
				setWorkspaceIntelligenceRuns(runs);
				const latestRunId = runs[runs.length - 1];
				setSelectedIntelligenceRunId(latestRunId);
				if (!latestRunId) {
					setIntelligenceDetail("");
					return;
				}
				const detail = await desktopApi.readIntelligenceRun(selectedWorkspace, latestRunId);
				if (!disposed) setIntelligenceDetail(detail);
			} catch (caught) {
				if (!disposed) setError(caught instanceof Error ? caught.message : String(caught));
			}
		};
		const timer = view === "chat" ? window.setTimeout(() => void loadWorkspaceSurface(), 1_000) : undefined;
		if (timer === undefined) void loadWorkspaceSurface();
		return () => {
			disposed = true;
			if (timer !== undefined) window.clearTimeout(timer);
		};
	}, [view, selectedWorkspace, memoryScope]);

	async function perform(key: string, action: () => Promise<unknown>): Promise<boolean> {
		setBusy(key);
		setError(undefined);
		try {
			await action();
			await refresh();
			return true;
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
			return false;
		} finally {
			setBusy(undefined);
		}
	}

	async function createConversation(mode: AgentMode = preferredMode, requestedWorkspace?: string): Promise<void> {
		setBusy("new-conversation");
		setError(undefined);
		try {
			let workspace = mode === "personal" ? undefined : (requestedWorkspace ?? selectedWorkspace ?? setup.workspace);
			if (mode === "code" && !workspace) {
				workspace = await desktopApi.selectWorkspace(codeWorkspace ?? selectedWorkspace ?? setup.workspace);
				if (!workspace) return;
			}
			const instance = await desktopApi.createConversation({ mode, cwd: workspace });
			setPreferredMode(mode);
			if (mode === "code") setCodeWorkspace(instance.cwd);
			// Pin selection before any refresh can race and wipe it
			selectedInstanceIdRef.current = instance.id;
			setSelectedInstanceId(instance.id);
			setConversation(undefined);
			setOptimisticMessage(undefined);
			setView("chat");
			setSidebarOpen(false);
			setSnapshot((current) => ({
				...current,
				daemonRunning: true,
				instances: [
					{
						id: instance.id,
						status: instance.status === "stopped" ? "online" : (instance.status ?? "online"),
						mode: instance.mode,
						cwd: instance.cwd,
						label: instance.label,
						sessionId: instance.sessionId,
						sessionFile: instance.sessionFile,
					},
					...current.instances.filter((entry) => entry.id !== instance.id),
				],
			}));
			// Deferred soft refresh — never clear the new selection if list lags
			window.setTimeout(() => {
				void refresh().catch(() => undefined);
			}, 400);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setBusy(undefined);
		}
	}

	async function sendMessage(
		message: string,
		images: ImageContent[],
		documents: DocumentAttachment[] = [],
	): Promise<void> {
		setTurnMeta(undefined);
		setBusy("send-message");
		setError(undefined);
		const prompt = messageWithDocuments(message, documents);
		const selectedConversation = conversation?.instance.id === selectedInstanceId ? conversation : undefined;
		const pending: OptimisticUserMessage = {
			instanceId: selectedInstanceId,
			baselineMessageCount: selectedConversation?.messages.length ?? 0,
			message: {
				role: "user",
				content: images.length > 0 ? [{ type: "text", text: prompt }, ...images] : prompt,
				timestamp: Date.now(),
			},
		};
		setOptimisticMessage(pending);
		setTurnProgress(submittedTurnProgress(selectedInstanceId ?? "pending"));
		let instanceId = selectedInstanceId;
		try {
			if (!instanceId) {
				const newMode = appMode === "code" ? "code" : appMode === "personal" ? "personal" : "work";
				let workspace =
					newMode === "code"
						? codeWorkspace
						: newMode === "personal"
							? undefined
							: (selectedWorkspace ?? setup.workspace);
				if (newMode === "code" && !workspace) {
					workspace = await desktopApi.selectWorkspace(setup.workspace);
					if (!workspace) throw new Error("请选择一个项目后再发送。");
					setCodeWorkspace(workspace);
				}
				const instance = await desktopApi.createConversation({ mode: newMode, cwd: workspace });
				instanceId = instance.id;
				selectedInstanceIdRef.current = instance.id;
				setSnapshot((current) => ({
					...current,
					daemonRunning: true,
					instances: [
						{
							id: instance.id,
							status: instance.status ?? "online",
							mode: instance.mode,
							cwd: instance.cwd,
							label: instance.label,
							sessionId: instance.sessionId,
							sessionFile: instance.sessionFile,
						},
						...current.instances.filter((entry) => entry.id !== instance.id),
					],
				}));
				setSelectedInstanceId(instance.id);
				setTurnProgress((current) =>
					current?.instanceId === "pending" ? { ...current, instanceId: instance.id } : current,
				);
				setConversation(undefined);
				setOptimisticMessage((current) =>
					current === pending ? { ...current, instanceId: instance.id } : current,
				);
				setView("chat");
				setSidebarOpen(false);
			}
			if (!instanceId) throw new Error("未选择对话。");
			const activeInstanceId = instanceId;
			const sessionName =
				pending.baselineMessageCount === 0
					? (message.replace(/^[/@#*\s]+/, "").replace(/\s+/g, " ").trim() || documents[0]?.name || "Image conversation").slice(0, 32)
					: undefined;
			if (sessionName) {
				setConversationTitles((current) => ({ ...current, [activeInstanceId]: sessionName }));
				setSnapshot((current) => ({
					...current,
					instances: current.instances.map((inst) =>
						inst.id === activeInstanceId ? { ...inst, label: sessionName } : inst,
					),
				}));
			}
			if (desktopApi.isNative) {
				await desktopApi.watchConversation(activeInstanceId);
				setStreamConnectedInstanceId(activeInstanceId);
			}
			setStreamingInstances((prev) => new Set(prev).add(activeInstanceId));
			await desktopApi.sendMessage(activeInstanceId, prompt, images, sessionName);
		} catch (caught) {
			if (instanceId) {
				const targetId = instanceId;
				setStreamingInstances((prev) => {
					const next = new Set(prev);
					next.delete(targetId);
					return next;
				});
				clearRunningTools(targetId);
			}
			setTurnProgress(undefined);
			setOptimisticMessage((current) =>
				current === pending || current?.message === pending.message ? undefined : current,
			);
			const messageText = caught instanceof Error ? caught.message : String(caught);
			if (/已停止|aborted|abort/i.test(messageText)) return;
			setError(messageText);
			throw caught;
		} finally {
			setBusy(undefined);
		}
	}

	async function steerMessage(message: string, images: ImageContent[] = []): Promise<void> {
		const instanceId = selectedInstanceIdRef.current ?? selectedInstanceId;
		if (!instanceId) return;
		try {
			await desktopApi.steerConversation(instanceId, message, images);
		} catch (caught) {
			const messageText = caught instanceof Error ? caught.message : String(caught);
			setError(messageText);
			throw caught;
		}
	}

	async function followUpMessage(message: string, images: ImageContent[] = []): Promise<void> {
		const instanceId = selectedInstanceIdRef.current ?? selectedInstanceId;
		if (!instanceId) return;
		try {
			await desktopApi.followUpConversation(instanceId, message, images);
		} catch (caught) {
			const messageText = caught instanceof Error ? caught.message : String(caught);
			setError(messageText);
			throw caught;
		}
	}

	function selectConversation(instanceId: string): void {
		const cached = conversationCacheRef.current[instanceId];
		setOptimisticMessage(undefined);
		setTurnProgress(undefined);
		setTurnMeta(undefined);
		clearRunningTools();
		selectedInstanceIdRef.current = instanceId;
		setConversation(cached);
		setSelectedInstanceId(instanceId);
	}

	function abortConversation(): void {
		const instanceId = selectedInstanceIdRef.current;
		if (!instanceId) return;
		setStreamingInstances((prev) => {
			const next = new Set(prev);
			next.delete(instanceId);
			return next;
		});
		setOptimisticMessage(undefined);
		setTurnProgress(undefined);
		clearRunningTools(instanceId);
		setBusy((current) => (current === "send-message" ? undefined : current));
		setConversation((current) => {
			if (!current || current.instance.id !== instanceId) return current;
			const next = { ...current, state: { ...current.state, isStreaming: false } };
			conversationCacheRef.current[instanceId] = next;
			return next;
		});
		void desktopApi.abortConversation(instanceId).catch((caught: unknown) => {
			clearRunningTools(instanceId);
			setError(caught instanceof Error ? caught.message : String(caught));
		});
	}

	async function changeConversationMode(mode: AgentMode): Promise<void> {
		if (selectedAgentInstance?.mode === mode || (!selectedAgentInstance && preferredMode === mode)) return;
		let workspace: string | undefined;
		if (mode === "code") {
			workspace = await desktopApi.selectWorkspace(codeWorkspace ?? selectedAgentInstance?.cwd ?? setup.workspace);
			if (!workspace) return;
			setCodeWorkspace(workspace);
		}
		setPreferredMode(mode);
		if (selectedAgentInstance) await createConversation(mode, workspace);
	}

	async function changeCodeWorkspace(): Promise<void> {
		const workspace = await desktopApi.selectWorkspace(
			selectedAgentInstance?.cwd ?? codeWorkspace ?? setup.workspace,
		);
		if (!workspace) return;
		setCodeWorkspace(workspace);
		setPreferredMode("code");
		if (selectedAgentInstance) await createConversation("code", workspace);
	}

	function handleModeChange(nextMode: AppMode): void {
		setAppMode(nextMode);
		setView("chat");
		const targetAgentMode = nextMode === "code" ? "code" : nextMode === "personal" ? "personal" : "work";
		setPreferredMode(targetAgentMode);
		if (selectedAgentInstance?.mode === targetAgentMode) return;
		// Find the most recent conversation matching the target view
		const candidates = snapshot.instances.filter((i) => {
			if (i.status === "error") return false;
			return i.mode === targetAgentMode;
		});
		const match = candidates
			.sort((a, b) => (conversationOrder[a.id] ?? Infinity) - (conversationOrder[b.id] ?? Infinity))
			.at(-1);
		if (match) {
			selectedInstanceIdRef.current = match.id;
			setConversation(conversationCacheRef.current[match.id]);
			setSelectedInstanceId(match.id);
			setView("chat");
		} else {
			selectedInstanceIdRef.current = undefined;
			setSelectedInstanceId(undefined);
			setConversation(undefined);
		}
	}

	async function renameSelectedConversation(name: string): Promise<void> {
		if (!renamingConversation) return;
		const instance = renamingConversation;
		const trimmedName = name.trim();
		setRenamingConversation(undefined);
		setConversationTitles((current) => ({ ...current, [instance.id]: trimmedName }));
		setSnapshot((prev) => ({
			...prev,
			instances: prev.instances.map((inst) =>
				inst.id === instance.id ? { ...inst, label: trimmedName } : inst,
			),
		}));
		setConversation((current) =>
			current?.instance.id === instance.id
				? {
						...current,
						instance: { ...current.instance, label: trimmedName },
						state: { ...current.state, sessionName: trimmedName },
					}
				: current,
		);
		await perform("rename-conversation", () => desktopApi.renameConversation(instance.id, trimmedName));
	}

	function exportSelectedConversation(): void {
		if (!conversation) {
			setError("没有可导出的对话。");
			return;
		}
		exportAndDownloadConversation(conversation);
	}

	const handleNewConversation = useCallback(() => {
		const isCode = appMode === "code";
		const targetAgentMode: AgentMode = isCode ? "code" : "work";
		const targetAppMode: AppMode = isCode ? "code" : "chat";
		const targetWorkspace = isCode ? (codeWorkspace ?? selectedWorkspace) : undefined;
		setAppMode(targetAppMode);
		setPreferredMode(targetAgentMode);
		clearRunningTools();
		void createConversation(targetAgentMode, targetWorkspace);
	}, [appMode, codeWorkspace, selectedWorkspace, clearRunningTools, createConversation]);

	const handleAbort = useCallback(() => {
		abortConversation();
	}, []);

	useGlobalKeybindings({
		onNewConversation: handleNewConversation,
		onToggleSidebar: () => setSidebarOpen((prev) => !prev),
		onAbort: handleAbort,
		onOpenSettings: () => setView("capabilities"),
		onExportMarkdown: exportSelectedConversation,
		onToggleGit: () => setView((prev) => (prev === "git" ? "chat" : "git")),
		isWorking,
	});

	useEffect(() => {
		const unsubNavigate = desktopApi.onNavigate((targetView) => {
			if (isView(targetView)) {
				setView(targetView);
			}
		});
		const unsubNew = desktopApi.onNewConversation(() => {
			handleNewConversation();
			setView("chat");
		});
		const unsubPrefill = desktopApi.onComposerPrefill?.((draft) => {
			setView("chat");
			setComposerDraftRequest({
				id: Date.now().toString(),
				text: draft.text,
				images: draft.images,
			});
		});
		return () => {
			unsubNavigate();
			unsubNew();
			unsubPrefill?.();
		};
	}, [handleNewConversation]);

	async function deleteSelectedConversation(): Promise<void> {
		if (!deletingConversation) return;
		const instanceId = deletingConversation.id;
		const targetToDelete = deletingConversation;

		// Immediately dismiss dialog and optimistically remove conversation from state
		setDeletingConversation(undefined);
		draftStore.clearDraft(instanceId);
		setConversationTitles((current) => {
			const next = { ...current };
			delete next[instanceId];
			return next;
		});
		setPendingConversationUiRequests((current) => current.filter((pending) => pending.instanceId !== instanceId));
		setSnapshot((prev) => ({
			...prev,
			instances: prev.instances.filter((inst) => inst.id !== instanceId),
		}));
		if (selectedInstanceId === instanceId) {
			setConversation(undefined);
			setOptimisticMessage(undefined);
			setSelectedInstanceId((current) => {
				if (current !== instanceId) return current;
				const remaining = snapshot.instances.filter((inst) => inst.id !== instanceId);
				return remaining[0]?.id;
			});
		}

		const success = await perform("delete-conversation", () => desktopApi.deleteConversation(instanceId));
		if (!success) {
			// Rollback on failure
			setSnapshot((prev) => ({
				...prev,
				instances: [...prev.instances, targetToDelete],
			}));
		}
	}

	async function removeSelectedProject(): Promise<void> {
		if (!removingProject) return;
		const target = removingProject;
		const targetIds = new Set(target.instances.map((i) => i.id));
		const backupInstances = [...target.instances];

		// Immediately dismiss dialog and optimistically clean up state
		setRemovingProject(undefined);

		// Clear drafts for all project sessions
		for (const inst of target.instances) {
			draftStore.clearDraft(inst.id);
		}

		// Clean up titles and pending conversation UI requests
		setConversationTitles((current) => {
			const next = { ...current };
			for (const inst of target.instances) {
				delete next[inst.id];
			}
			return next;
		});
		setPendingConversationUiRequests((current) =>
			current.filter((pending) => !targetIds.has(pending.instanceId)),
		);

		// Optimistically filter instances from snapshot
		setSnapshot((prev) => ({
			...prev,
			instances: prev.instances.filter((inst) => !targetIds.has(inst.id)),
		}));

		// If active session belonged to this project, switch away cleanly
		if (selectedInstanceId && targetIds.has(selectedInstanceId)) {
			setConversation(undefined);
			setOptimisticMessage(undefined);
			setSelectedInstanceId((current) => {
				if (!current || !targetIds.has(current)) return current;
				const remaining = snapshot.instances.filter((inst) => !targetIds.has(inst.id));
				return remaining[0]?.id;
			});
		}

		// Reset codeWorkspace if it pointed to the removed project
		if (codeWorkspace === target.cwd) {
			setCodeWorkspace(undefined);
			window.localStorage.removeItem("openpi-code-workspace");
		}

		// Concurrently remove each conversation from daemon
		const results = await perform("remove-project", () =>
			Promise.allSettled(target.instances.map((inst) => desktopApi.deleteConversation(inst.id))),
		);

		// If completely failed, rollback
		if (!results) {
			setSnapshot((prev) => ({
				...prev,
				instances: [...prev.instances, ...backupInstances],
			}));
		}
	}

	async function loadLog(run: TaskRun, stream: "stdout" | "stderr"): Promise<void> {
		setSelectedRunId(run.id);
		setBusy(`log-${stream}`);
		try {
			setLog(await desktopApi.readRunLog(run.id, stream));
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setBusy(undefined);
		}
	}

	async function updateConversationConfiguration(
		key: string,
		action: (instanceId: string) => Promise<ConversationState>,
	): Promise<void> {
		if (!selectedInstanceId) return;
		const instanceId = selectedInstanceId;
		setBusy(key);
		setError(undefined);
		try {
			const state = await action(instanceId);
			setConversation((current) => (current?.instance.id === instanceId ? { ...current, state } : current));
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setBusy(undefined);
		}
	}

	async function respondToConversationUi(response: ConversationUiResponse): Promise<void> {
		const pending = pendingConversationUiRequests.find((item) => item.request.id === response.id);
		if (!pending || respondingConversationUiRequestId) return;
		setRespondingConversationUiRequestId(response.id);
		setError(undefined);
		try {
			await desktopApi.respondConversationUi(pending.instanceId, response);
			setPendingConversationUiRequests((current) => current.filter((item) => item.request.id !== response.id));
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setRespondingConversationUiRequestId(undefined);
		}
	}

	async function mutateCapabilities(
		key: string,
		action: (instanceId: string) => Promise<ConversationCapabilities>,
	): Promise<void> {
		if (!selectedInstanceId) return;
		const instanceId = selectedInstanceId;
		setBusy(key);
		setError(undefined);
		try {
			const next = await action(instanceId);
			if (selectedInstanceIdRef.current === instanceId) setCapabilities(next);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setBusy(undefined);
		}
	}

	async function refreshMemory(): Promise<void> {
		if (!selectedWorkspace && memoryScope === "project") {
			setError("Select a conversation workspace first.");
			return;
		}
		setBusy("memory-refresh");
		setError(undefined);
		try {
			const cwd = selectedWorkspace || (await desktopApi.defaultWorkspace());
			const [entries, meta] = await Promise.all([
				desktopApi.listMemoryIndex(cwd, memoryScope),
				desktopApi.memoryMeta(cwd),
			]);
			setWorkspaceMemory(entries);
			setMemoryMeta({
				...meta.meta,
				projectCount: meta.projectCount,
				globalCount: meta.globalCount,
				archiveCount: meta.archiveCount,
				digestCount: meta.digestCount,
				latestDigest: meta.latestDigest,
				hasVectors: meta.hasVectors,
				hasLexicon: meta.hasLexicon,
				features: meta.features,
			});
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setBusy(undefined);
		}
	}

	async function runMemoryMaintain(): Promise<void> {
		const cwd = selectedWorkspace || (await desktopApi.defaultWorkspace().catch(() => undefined));
		if (!cwd) {
			setError("先选中一个对话或工作区。");
			return;
		}
		if (await perform("memory-maintain", () => desktopApi.maintainMemory(cwd))) {
			await refreshMemory();
		}
	}

	async function saveMemory(): Promise<void> {
		if (!selectedWorkspace && memoryScope === "project") {
			setError("先选中一个对话，再写入记忆。");
			return;
		}
		const cwd = selectedWorkspace || (await desktopApi.defaultWorkspace());
		const body = memoryDraft.body?.trim() || memoryDraft.value;
		if (
			await perform("write-memory", () =>
				desktopApi.writeMemoryEntry(cwd, memoryDraft.type, memoryDraft.key, memoryDraft.value, body, memoryScope),
			)
		) {
			await refreshMemory();
			setMemoryDraft((current) => ({ ...current, key: "", value: "", body: "" }));
		}
	}

	async function saveMemoryEntry(memoryType: string, key: string, value: string): Promise<void> {
		if (!selectedWorkspace && memoryScope === "project") {
			setError("先选中一个对话，再写入记忆。");
			return;
		}
		const cwd = selectedWorkspace || (await desktopApi.defaultWorkspace());
		if (
			await perform("write-memory", () =>
				desktopApi.writeMemoryEntry(cwd, memoryType, key, value, value, memoryScope),
			)
		) {
			await refreshMemory();
		}
	}

	function rememberFromChat(text: string): void {
		const body = text.trim();
		if (!body) {
			setError("没有可记住的内容。");
			return;
		}
		setQuickSaveMemoryText(body);
	}

	function openTaskFromChat(prompt: string): void {
		const trimmed = prompt.trim();
		const title = trimmed.length === 0 ? "" : trimmed.length > 40 ? `${trimmed.slice(0, 38)}…` : trimmed;
		setTaskPrefill({ title, prompt: trimmed });
		setShowCreateTask(true);
	}

	async function deleteMemory(memoryType: string, key: string): Promise<void> {
		const cwd = selectedWorkspace || (await desktopApi.defaultWorkspace().catch(() => undefined));
		if (!cwd) return;
		if (await perform("delete-memory", () => desktopApi.deleteMemoryEntry(cwd, memoryType, key, memoryScope))) {
			await refreshMemory();
		}
	}

	async function refreshIntelligence(): Promise<void> {
		if (!selectedWorkspace) {
			setError("Select a conversation workspace first.");
			return;
		}
		setBusy("intelligence-refresh");
		setError(undefined);
		try {
			const [runs, commands] = await Promise.all([
				desktopApi.listIntelligenceRuns(selectedWorkspace),
				selectedInstanceId ? desktopApi.getConversationCommands(selectedInstanceId) : Promise.resolve([]),
			]);
			setWorkspaceIntelligenceRuns(runs);
			setConversationCommands(commands);
			const currentRunId =
				selectedIntelligenceRunId && runs.includes(selectedIntelligenceRunId)
					? selectedIntelligenceRunId
					: runs[runs.length - 1];
			setSelectedIntelligenceRunId(currentRunId);
			setIntelligenceDetail(
				currentRunId ? await desktopApi.readIntelligenceRun(selectedWorkspace, currentRunId) : "",
			);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setBusy(undefined);
		}
	}

	async function loadIntelligenceRun(runId: string): Promise<void> {
		if (!selectedWorkspace) return;
		setSelectedIntelligenceRunId(runId);
		setBusy("intelligence-detail");
		setError(undefined);
		try {
			setIntelligenceDetail(await desktopApi.readIntelligenceRun(selectedWorkspace, runId));
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setBusy(undefined);
		}
	}

	function openCapabilityPrompt(prompt: string): void {
		setComposerDraftRequest({ id: crypto.randomUUID(), text: prompt });
		setView("chat");
	}

	async function refreshCurrentViewData(): Promise<void> {
		if (view === "capabilities") {
			if (selectedInstanceId) await loadCapabilities(selectedInstanceId, true);
			else await refresh();
			return;
		}
		if (view === "memory") {
			await refreshMemory();
			return;
		}
		if (view === "intelligence") {
			await refreshIntelligence();
			return;
		}
		await refresh();
		if (view !== "chat") return;
		const instanceId = selectedInstanceIdRef.current;
		if (!instanceId) return;
		try {
			const next = await desktopApi.getConversation(instanceId);
			if (selectedInstanceIdRef.current === instanceId) setConversation(next);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		}
	}

	refreshCurrentViewRef.current = refreshCurrentViewData;

	useEffect(() => {
		const unsubRefresh = desktopApi.onRefreshData(() => {
			void refreshCurrentViewRef.current();
		});
		const unsubDaemonStatus = desktopApi.onDaemonStatus?.((status) => {
			if (status === "connected") {
				void refreshCurrentViewRef.current();
			}
		});
		return () => {
			unsubRefresh();
			unsubDaemonStatus?.();
		};
	}, []);

	if (!startupReady) {
		return (
			<div className="setup-shell">
				<div className="setup-card startup-card startup-card-active">
					<h1>OpenPI</h1>
					<p className="muted">正在加载工作区…</p>
					<div className="startup-progress" role="status" aria-live="polite">
						<RefreshCw size={20} className="spin" />
						<span>初始化服务与会话</span>
					</div>
				</div>
			</div>
		);
	}

	let mainContent: ReactNode;

	if (view === "chat") {
		mainContent = (
			<ReferenceWorkspacePreview
				projectInstances={conversationList.projects}
				chatInstances={conversations}
				selectedInstanceId={selectedInstanceId}
				conversation={conversation}
				conversationTitles={conversationTitles}
				workspaceSummary={workspaceSummary}
				runningTools={runningTools}
				toolDurations={toolDurations}
				turnProgress={turnProgress}
				todoState={todoState}
				optimisticMessage={
					optimisticMessage &&
					(optimisticMessage.instanceId === undefined || optimisticMessage.instanceId === selectedInstanceId)
						? optimisticMessage.message
						: undefined
				}
				memoryEntries={workspaceMemory}
				memoryCount={memoryMeta.projectCount ?? workspaceMemory.length}
				stats={conversationStats}
				providerBalance={providerBalance}
				modelOptions={conversationModels}
				visionFallback={visionFallback}
				loadingModels={loadingConversationModels}
				configuring={busy === "set-model" || busy === "set-thinking"}
				sending={busy === "send-message"}
				appMode={appMode}
				sidebarOpen={sidebarOpen}
				onToggleSidebar={() => setSidebarOpen((prev) => !prev)}
				onSelectConversation={(instanceId) => {
					setAppMode("chat");
					setPreferredMode("work");
					selectConversation(instanceId);
				}}
				onOpenProject={(instanceId) => {
					const project = snapshot.instances.find((instance) => instance.id === instanceId);
					setAppMode("code");
					setPreferredMode("code");
					if (project?.cwd) setCodeWorkspace(project.cwd);
					selectConversation(instanceId);
				}}
				onNewProjectSession={(workspace) => {
					setAppMode("code");
					setPreferredMode("code");
					setCodeWorkspace(workspace);
					clearRunningTools();
					void createConversation("code", workspace);
				}}
				onNewConversation={() => {
					setAppMode("chat");
					setPreferredMode("work");
					clearRunningTools();
					void createConversation("work", undefined);
				}}
				onOpenSettings={() => setView("capabilities")}
				onSend={sendMessage}
				onSteer={steerMessage}
				onFollowUp={followUpMessage}
				onAbort={handleAbort}
				onRenameConversation={(target) => {
					const inst = target ?? selectedAgentInstance;
					if (inst) setRenamingConversation(inst);
				}}
				onExportConversation={exportSelectedConversation}
				onDeleteConversation={(target) => {
					const inst = target ?? selectedAgentInstance;
					if (inst) setDeletingConversation(inst);
				}}
				onRemoveProject={(target) => {
					setRemovingProject(target);
				}}
				onRemember={(text) => rememberFromChat(text)}
				onCreateTaskFromChat={openTaskFromChat}
				onModelChange={(model) =>
					void updateConversationConfiguration("set-model", async (instanceId) => {
						const res = await desktopApi.setConversationModel(instanceId, model.provider, model.id);
						if (modelSupportsReasoning(model)) {
							const highest = getHighestThinkingLevel(model);
							await desktopApi.setConversationThinkingLevel(instanceId, highest).catch(() => {});
						}
						return res;
					})
				}
				onThinkingLevelChange={(level) =>
					void updateConversationConfiguration("set-thinking", (instanceId) =>
						desktopApi.setConversationThinkingLevel(instanceId, level),
					)
				}
				onAppModeChange={handleModeChange}
				slashCommands={conversationCommands}
				gitStatus={gitStatus}
				gitLoading={gitLoading}
				onRefreshGit={loadGitStatus}
				onOpenGit={() => setView("git")}
				onNavigate={(next) => setView(next)}
				prefillDraft={composerDraftRequest}
			/>
		);
	} else if (view === "capabilities") {
		mainContent = (
			<CapabilitiesSurface
				conversation={conversation}
				capabilities={capabilities}
				loading={loadingCapabilities}
				busy={busy}
				onClose={() => setView("chat")}
				onReload={async () => {
					if (selectedInstanceId) {
						await loadCapabilities(selectedInstanceId, true);
					}
					await desktopApi.getSnapshot().then(setSnapshot).catch(() => {});
				}}
				onUseSkill={(name) => openCapabilityPrompt(`/skill:${name} `)}
				onConfigureMcp={() => openCapabilityPrompt("/mcp setup")}
				onInstallPackage={(marketPackage) =>
					void mutateCapabilities(`install-market-${marketPackage.id}`, (instanceId) =>
						desktopApi.installConversationPackage(instanceId, marketPackage.source),
					)
				}
				onRemoveMcp={(source, local) =>
					void mutateCapabilities("remove-mcp", (instanceId) =>
						desktopApi.removeConversationPackage(instanceId, source, local),
					)
				}
			/>
		);
	} else if (typeof window !== "undefined" && window.location.hash.includes("hud")) {
		return (
			<FloatingHud
				onOpenMainWithPrompt={(prompt) => {
					void desktopApi.createConversation({ label: prompt.slice(0, 30), mode: "work" });
				}}
			/>
		);
	} else {
		mainContent = (
		<div className={`app-shell chat-first ${sidebarOpen ? "sidebar-open" : ""} ${view === "tasks" ? "tasks-view" : ""} ${operationView ? "operations-view" : ""}`}>
			<div className="main-column">
				<div className="secondary-bar">
					<button type="button" className="text-button back-chat" onClick={() => setView("chat")}>
						<ArrowLeft size={14} />
						返回对话
					</button>
					<span className="secondary-bar-note">辅助页面 · 主路径是聊天</span>
				</div>
				{extensionNotice && (
					<div className={`notice-banner ${extensionNotice.type}`}>
						<Bell size={15} />
						<span>{extensionNotice.message}</span>
						<button
							className="icon-button quiet"
							title="关闭通知"
							aria-label="关闭通知"
							onClick={() => setExtensionNotice(undefined)}
						>
							<X size={15} />
						</button>
					</div>
				)}
				{error && (
					<div className="error-banner">
						<span>{error}</span>
						<button
							className="icon-button quiet"
							title="关闭错误"
							aria-label="关闭错误"
							onClick={() => setError(undefined)}
						>
							<X size={15} />
						</button>
					</div>
				)}
				{loading ? (
					<div className="loading-state">
						<RefreshCw size={22} className="spin" />
						<span>加载中…</span>
					</div>
				) : view === "tasks" ? (
					<TasksSurface
						tasks={tasks}
						taskCount={snapshot.tasks.length}
						selectedTask={selectedTask}
						taskRuns={taskRuns}
						selectedRun={selectedRun}
						filter={taskFilter}
						query={taskQuery}
						log={log}
						busy={busy}
						onFilterChange={setTaskFilter}
						onQueryChange={setTaskQuery}
						onSelectTask={(taskId) => {
							setSelectedTaskId(taskId);
							setSelectedRunId(undefined);
							setLog(undefined);
						}}
						onSelectRun={(runId) => {
							setSelectedRunId(runId);
							setLog(undefined);
						}}
						onNew={() => setShowCreateTask(true)}
						onOpenSidebar={() => setSidebarOpen(true)}
						onRun={(taskId) => perform("run", () => desktopApi.runTask(taskId))}
						onPause={(taskId, paused) => perform("pause", () => desktopApi.setTaskPaused(taskId, paused))}
						onDelete={(taskId) => perform("delete", () => desktopApi.deleteTask(taskId))}
						onCancel={(runId) => perform("cancel", () => desktopApi.cancelRun(runId))}
						onLoadLog={loadLog}
					/>
				) : view === "memory" ? (
					<MemorySurface
						workspace={selectedWorkspace}
						entries={workspaceMemory}
						draft={memoryDraft}
						scope={memoryScope}
						meta={memoryMeta}
						busy={busy}
						onOpenSidebar={() => setSidebarOpen(true)}
						onRefresh={() => void refreshMemory()}
						onScopeChange={(scope) => {
							setMemoryScope(scope);
							// refresh after scope flip on next tick
							queueMicrotask(() => void refreshMemory());
						}}
						onMaintain={() => void runMemoryMaintain()}
						onDraftChange={(field, value) => setMemoryDraft((current) => ({ ...current, [field]: value }))}
						onSave={() => void saveMemory()}
						onSaveEntry={(memoryType, key, value) => void saveMemoryEntry(memoryType, key, value)}
						onDelete={(memoryType, key) => void deleteMemory(memoryType, key)}
					/>
				) : view === "intelligence" ? (
					<IntelligenceSurface
						workspace={selectedWorkspace}
						runs={workspaceIntelligenceRuns}
						commands={conversationCommands}
						selectedRunId={selectedIntelligenceRunId}
						detail={intelligenceDetail}
						busy={busy}
						onOpenSidebar={() => setSidebarOpen(true)}
						onRefresh={() => void refreshIntelligence()}
						onSelectRun={(runId) => void loadIntelligenceRun(runId)}
					/>
				) : view === "git" ? (
					<GitSurface
						cwd={selectedWorkspace ?? setup.workspace}
						gitStatus={gitStatus}
						loading={gitLoading}
						onRefresh={() => void loadGitStatus()}
						onClose={() => setView("chat")}
					/>
				) : (
					<DaemonSurface
						snapshot={snapshot}
						busy={busy}
						onOpenSidebar={() => setSidebarOpen(true)}
						onStart={() => void perform("daemon-start", desktopApi.startDaemon)}
						onStop={() => void perform("daemon-stop", desktopApi.stopDaemon)}
						onRestart={() => void perform("daemon-restart", desktopApi.restartDaemon)}
						onStopInstance={(instanceId) =>
							void perform("stop-instance", () => desktopApi.stopInstance(instanceId))
						}
						onPruneStopped={() => void perform("prune-stopped", desktopApi.pruneStoppedInstances)}
					/>
				)}
			</div>
		</div>
		);
	}

	return (
		<>
			{mainContent}

			{showCreateTask && (
				<CreateTaskDialog
					busy={busy === "create-task"}
					initialTitle={taskPrefill.title}
					initialPrompt={taskPrefill.prompt}
					initialCwd={selectedWorkspace ?? ""}
					onClose={() => {
						setShowCreateTask(false);
						setTaskPrefill({});
					}}
					onCreate={async (input) => {
						if (await perform("create-task", () => desktopApi.createTask(input))) {
							setShowCreateTask(false);
							setTaskPrefill({});
						}
					}}
				/>
			)}

			{quickSaveMemoryText !== null && (
				<QuickSaveMemoryDialog
					initialText={quickSaveMemoryText}
					workspace={selectedWorkspace}
					busy={busy === "write-memory"}
					onClose={() => setQuickSaveMemoryText(null)}
					onSave={async (entry) => {
						const cwd =
							(entry.scope === "project" ? selectedWorkspace : undefined) ||
							(await desktopApi.defaultWorkspace().catch(() => ""));
						if (
							await perform("write-memory", () =>
								desktopApi.writeMemoryEntry(
									cwd,
									entry.type,
									entry.key,
									entry.value,
									entry.body,
									entry.scope,
								),
							)
						) {
							await refreshMemory();
							setExtensionNotice({
								id: `mem-${Date.now()}`,
								type: "info",
								message: `已记入长期记忆 [${entry.scope === "global" ? "全局" : "项目"}]: ${entry.key}`,
							});
						}
					}}
				/>
			)}

			{renamingConversation && (
				<RenameConversationDialog
					conversation={renamingConversation}
					busy={busy === "rename-conversation"}
					onClose={() => setRenamingConversation(undefined)}
					onRename={renameSelectedConversation}
				/>
			)}

			{editingProfile && (
				<EditProfileDialog
					profile={userProfile}
					busy={busy === "save-profile"}
					onClose={() => setEditingProfile(false)}
					onSave={saveUserProfile}
				/>
			)}

			{authDialog && (
				<ProviderAuthDialog
					auth={authDialog}
					busy={false}
					onClose={() => setAuthDialog(undefined)}
					onOpenUrl={(url) => {
						void desktopApi.openExternal(url).catch((caught: unknown) => {
							setError(caught instanceof Error ? caught.message : String(caught));
						});
					}}
					onDone={() => setAuthDialog(undefined)}
				/>
			)}

			{deletingConversation && (
				<DeleteConversationDialog
					conversation={deletingConversation}
					busy={busy === "delete-conversation"}
					onClose={() => setDeletingConversation(undefined)}
					onDelete={deleteSelectedConversation}
				/>
			)}

			{removingProject && (
				<DeleteProjectDialog
					target={removingProject}
					busy={busy === "remove-project"}
					onClose={() => setRemovingProject(undefined)}
					onDelete={removeSelectedProject}
				/>
			)}

			{activeConversationUiRequest && (
				<ConversationUiDialog
					key={activeConversationUiRequest.request.id}
					request={activeConversationUiRequest.request}
					busy={respondingConversationUiRequestId === activeConversationUiRequest.request.id}
					onRespond={respondToConversationUi}
				/>
			)}
		</>
	);
}
