import { ArrowLeft, Bell, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { desktopApi } from "./api";
import {
	type AppMode,
	AppRail,
	CapabilitiesSurface,
	ChatSurface,
	ContextPanel,
	ConversationSidebar,
	ConversationUiDialog,
	CreateTaskDialog,
	DaemonSurface,
	DeleteConversationDialog,
	IntelligenceSurface,
	MemorySurface,
	RenameConversationDialog,
	SecuritySurface,
	TasksSurface,
} from "./components/surfaces";
import { TodoPanel } from "./components/todo-panel";
import {
	type CapabilityTab,
	type ExtensionNotice,
	emptySnapshot,
	type OptimisticUserMessage,
	type PendingConversationUiRequest,
	type TaskFilter,
	type View,
} from "./lib/app-types";
import {
	blockingConversationUiRequest,
	conversationContentMatches,
	instanceTitle,
	isConversationMessage,
	isRecord,
	normalizeConversationModels,
} from "./lib/helpers";
import { hashForView, initialView, VIEW_STORAGE_KEY, viewFromHash } from "./lib/view-route";

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
	ImageContent,
	TaskRun,
	ThinkingLevel,
	TodoState,
} from "./types";

export function App() {
	const [setup, setSetup] = useState<{
		checked: boolean;
		enabled: boolean;
		busy: boolean;
		error?: string;
		workspace?: string;
		doctor?: string;
	}>({ checked: false, enabled: true, busy: false });
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
	const [composerDraftRequest, setComposerDraftRequest] = useState<{ id: string; text: string }>();
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
	const [busy, setBusy] = useState<string>();
	const [error, setError] = useState<string>();
	// Track which instances are actively processing (agent_start → agent_settled)
	const [streamingInstances, setStreamingInstances] = useState<Set<string>>(new Set());
	const [showCreateTask, setShowCreateTask] = useState(false);
	const [taskPrefill, setTaskPrefill] = useState<{ title?: string; prompt?: string }>({});
	const [renamingConversation, setRenamingConversation] = useState<AgentInstance>();
	const [deletingConversation, setDeletingConversation] = useState<AgentInstance>();
	const [sidebarOpen, setSidebarOpen] = useState(false);
	const [contextOpen, setContextOpen] = useState(false);
	const [log, setLog] = useState<string>();
	const [workspaceMemory, setWorkspaceMemory] = useState<string[]>([]);
	const [workspaceIntelligenceRuns, setWorkspaceIntelligenceRuns] = useState<string[]>([]);
	const [securityAudit, setSecurityAudit] = useState<string[]>([]);
	const [securityMode, setSecurityMode] = useState<string>();
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
	const [includeStopped, setIncludeStopped] = useState(false);
	const [showAllConversations, setShowAllConversations] = useState(false);
	// Stable first-seen order: once an instance gets an index it never changes
	const [conversationOrder, setConversationOrder] = useState<Record<string, number>>({});
	const [appMode, setAppMode] = useState<AppMode>(() => {
		if (typeof window === "undefined") return "chat";
		return window.localStorage.getItem("openpi-app-mode") === "code" ? "code" : "chat";
	});
	const [preferredMode, setPreferredMode] = useState<AgentMode>(() => {
		if (typeof window === "undefined") return "work";
		return window.localStorage.getItem("openpi-agent-mode") === "code" ? "code" : "work";
	});
	const [codeWorkspace, setCodeWorkspace] = useState<string | undefined>(() => {
		if (typeof window === "undefined") return undefined;
		return window.localStorage.getItem("openpi-code-workspace") || undefined;
	});
	const selectedInstanceIdRef = useRef(selectedInstanceId);
	const routeInitializedRef = useRef(false);
	const refreshCurrentViewRef = useRef<() => Promise<void>>(async () => undefined);
	selectedInstanceIdRef.current = selectedInstanceId;
	const activeConversationUiRequest = pendingConversationUiRequests[0];
	const isStreaming = Boolean(conversation?.state.isStreaming || optimisticMessage);

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
				if (showLoading) setLoading(false);
			}
		},
		[includeStopped],
	);

	useEffect(() => {
		window.localStorage.setItem("openpi-app-mode", appMode);
		// Sync preferredMode with appMode for new conversation creation
		setPreferredMode(appMode === "code" ? "code" : "work");
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
				setSetup({
					checked: true,
					enabled: status.enabled,
					busy: false,
					workspace: status.workspace,
				});
			})
			.catch((caught: unknown) => {
				if (disposed) return;
				setSetup({
					checked: true,
					enabled: false,
					busy: false,
					error: caught instanceof Error ? caught.message : String(caught),
				});
			});
		return () => {
			disposed = true;
		};
	}, []);

	useEffect(() => {
		if (!setup.checked || !setup.enabled) return;
		void refresh(true);
		// Faster while streaming; otherwise 15s full snapshot (was 5s).
		const intervalMs = isStreaming ? 5_000 : 15_000;
		const timer = window.setInterval(() => void refresh(), intervalMs);
		return () => window.clearInterval(timer);
	}, [refresh, setup.checked, setup.enabled, isStreaming]);

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
		if (!setup.checked || !setup.enabled) return;
		let disposed = false;
		void desktopApi
			.getSecurityMode()
			.then((mode) => {
				if (!disposed) setSecurityMode(mode);
			})
			.catch((caught: unknown) => {
				if (!disposed) setError(caught instanceof Error ? caught.message : String(caught));
			});
		return () => {
			disposed = true;
		};
	}, [setup.checked, setup.enabled]);

	useEffect(() => {
		if (!desktopApi.isNative) return;
		let disposed = false;
		const unlisten = desktopApi.onConversationEvent((payload) => {
			if (disposed || payload.instanceId !== selectedInstanceIdRef.current || !isRecord(payload.event)) return;
			const eventType = typeof payload.event.type === "string" ? payload.event.type : undefined;
			if (eventType === "extension_ui_request") {
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
				setPendingConversationUiRequests((current) =>
					current.filter((pending) => pending.instanceId !== payload.instanceId),
				);
				if (eventType === "stream_error" && typeof payload.event.error === "string") {
					setError(payload.event.error);
				}
				return;
			}
			if (eventType === "agent_start") {
				setStreamingInstances((prev) => new Set(prev).add(payload.instanceId));
				setConversation((current) =>
					current?.instance.id === payload.instanceId
						? { ...current, state: { ...current.state, isStreaming: true } }
						: current,
				);
				return;
			}
			if (eventType === "agent_settled") {
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
			if (
				(eventType !== "message_start" && eventType !== "message_update" && eventType !== "message_end") ||
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
				const messageIndex = current.messages.findIndex(
					(message) =>
						incoming.timestamp !== undefined &&
						message.role === incoming.role &&
						message.timestamp === incoming.timestamp,
				);
				const messages = [...current.messages];
				if (messageIndex === -1) messages.push(incoming);
				else messages[messageIndex] = incoming;
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
		void desktopApi.watchConversation(selectedInstanceId).catch((caught: unknown) => {
			if (!disposed) setError(caught instanceof Error ? caught.message : String(caught));
		});
		return () => {
			disposed = true;
			setStreamConnectedInstanceId((current) => (current === selectedInstanceId ? undefined : current));
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
		const poll = async () => {
			let delay = 4_000;
			try {
				const next = await desktopApi.getConversation(instanceId);
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
					setConversation(next);
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
		};
	}, [selectedInstanceId, optimisticMessage, streamConnectedInstanceId]);

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
		};
		window.addEventListener("openpi:model-providers-changed", handleModelProvidersChanged);
		return () => window.removeEventListener("openpi:model-providers-changed", handleModelProvidersChanged);
	}, [loadConversationModels]);

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
		if (!selectedInstanceId || view !== "capabilities") return;
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
		// Split by cwd: conversations with a specific project path go to "projects"
		const defaultCwd = setup.workspace;
		const isProject = (i: AgentInstance) => {
			const cwd = i.cwd?.trim();
			return Boolean(cwd) && cwd !== defaultCwd;
		};
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
	}, [
		snapshot.instances,
		conversationTitles,
		chatQuery,
		showAllConversations,
		selectedInstanceId,
		conversationOrder,
		setup.workspace,
	]);
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
		snapshot.instances.find((instance) => instance.id === selectedInstanceId)?.cwd;
	const operationView = view === "memory" || view === "security" || view === "intelligence" || view === "daemon";

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
			if (view === "memory") setWorkspaceMemory([]);
			if (view === "security") setSecurityAudit([]);
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
				if (view === "memory") {
					const entries = await desktopApi.listMemoryIndex(selectedWorkspace, memoryScope);
					const meta = await desktopApi.memoryMeta(selectedWorkspace);
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
				if (view === "security") return;
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
		void loadWorkspaceSurface();
		return () => {
			disposed = true;
		};
	}, [view, selectedWorkspace, selectedInstanceId, memoryScope]);

	useEffect(() => {
		if (view !== "security") return;
		let disposed = false;
		void Promise.all([
			desktopApi.getSecurityMode(),
			selectedWorkspace ? desktopApi.listSecurityAudit(selectedWorkspace) : Promise.resolve([]),
		])
			.then(([mode, audit]) => {
				if (disposed) return;
				setSecurityMode(mode);
				setSecurityAudit(audit);
			})
			.catch((caught: unknown) => {
				if (!disposed) setError(caught instanceof Error ? caught.message : String(caught));
			});
		return () => {
			disposed = true;
		};
	}, [view, selectedWorkspace]);

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
			let workspace = requestedWorkspace ?? selectedWorkspace ?? setup.workspace;
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

	async function sendMessage(message: string, images: ImageContent[]): Promise<void> {
		setTurnMeta(undefined);
		setBusy("send-message");
		setError(undefined);
		const selectedConversation = conversation?.instance.id === selectedInstanceId ? conversation : undefined;
		const pending: OptimisticUserMessage = {
			instanceId: selectedInstanceId,
			baselineMessageCount: selectedConversation?.messages.length ?? 0,
			message: {
				role: "user",
				content: images.length > 0 ? [{ type: "text", text: message }, ...images] : message,
				timestamp: Date.now(),
			},
		};
		setOptimisticMessage(pending);
		try {
			let instanceId = selectedInstanceId;
			if (!instanceId) {
				const newMode = appMode === "code" ? "code" : "work";
				let workspace = newMode === "code" ? codeWorkspace : (selectedWorkspace ?? setup.workspace);
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
				setConversation(undefined);
				setOptimisticMessage((current) =>
					current === pending ? { ...current, instanceId: instance.id } : current,
				);
				setView("chat");
				setSidebarOpen(false);
			}
			const sessionName =
				pending.baselineMessageCount === 0
					? (message.replace(/\s+/g, " ").trim() || "Image conversation").slice(0, 48)
					: undefined;
			if (sessionName) {
				setConversationTitles((current) => ({ ...current, [instanceId]: sessionName }));
			}
			if (desktopApi.isNative) await desktopApi.watchConversation(instanceId);
			await desktopApi.sendMessage(instanceId, message, images, sessionName);
		} catch (caught) {
			setOptimisticMessage((current) =>
				current === pending || current?.message === pending.message ? undefined : current,
			);
			setError(caught instanceof Error ? caught.message : String(caught));
			throw caught;
		} finally {
			setBusy(undefined);
		}
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
		const targetAgentMode = nextMode === "code" ? "code" : "work";
		setPreferredMode(targetAgentMode);
		const defaultCwd = setup.workspace;
		const isProjectInstance = (i: AgentInstance) => {
			const cwd = i.cwd?.trim();
			return Boolean(cwd) && cwd !== defaultCwd;
		};
		// If current selection already matches the target view, keep it
		const currentIsProject = selectedAgentInstance ? isProjectInstance(selectedAgentInstance) : false;
		if ((nextMode === "code") === currentIsProject) return;
		// Find the most recent conversation matching the target view
		const candidates = snapshot.instances.filter((i) => {
			if (i.status === "error") return false;
			return nextMode === "code" ? isProjectInstance(i) : !isProjectInstance(i);
		});
		const match = candidates
			.sort((a, b) => (conversationOrder[a.id] ?? Infinity) - (conversationOrder[b.id] ?? Infinity))
			.at(-1);
		if (match) {
			selectedInstanceIdRef.current = match.id;
			setSelectedInstanceId(match.id);
			setConversation(undefined);
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
		if (await perform("rename-conversation", () => desktopApi.renameConversation(instance.id, name))) {
			setConversationTitles((current) => ({ ...current, [instance.id]: name.trim() }));
			setConversation((current) =>
				current?.instance.id === instance.id
					? {
							...current,
							instance: { ...current.instance, label: name.trim() },
							state: { ...current.state, sessionName: name.trim() },
						}
					: current,
			);
			setRenamingConversation(undefined);
		}
	}

	async function deleteSelectedConversation(): Promise<void> {
		if (!deletingConversation) return;
		const instanceId = deletingConversation.id;
		if (await perform("delete-conversation", () => desktopApi.deleteConversation(instanceId))) {
			setConversationTitles((current) => {
				const next = { ...current };
				delete next[instanceId];
				return next;
			});
			setPendingConversationUiRequests((current) => current.filter((pending) => pending.instanceId !== instanceId));
			if (selectedInstanceId === instanceId) {
				setConversation(undefined);
				setOptimisticMessage(undefined);
			}
			setDeletingConversation(undefined);
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
			setWorkspaceMemory(await desktopApi.listMemoryIndex(cwd, memoryScope));
			const meta = await desktopApi.memoryMeta(cwd);
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

	async function rememberFromChat(text: string): Promise<void> {
		const body = text.trim();
		if (!body) {
			setError("没有可记住的内容。");
			return;
		}
		if (!selectedWorkspace) {
			setError("先选中一个对话，再写入记忆。");
			return;
		}
		const key =
			body
				.toLowerCase()
				.replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
				.replace(/^-|-$/g, "")
				.slice(0, 32) || `note-${Date.now().toString(36)}`;
		await saveMemoryEntry("project", key, body.slice(0, 500));
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

	async function updateSecurityMode(mode: string): Promise<void> {
		const previousMode = securityMode;
		setSecurityMode(mode);
		if (
			!(await perform("security-mode", async () => {
				await desktopApi.writeSecurityMode(mode);
			}))
		) {
			setSecurityMode(previousMode);
		}
	}

	async function refreshSecurityAudit(): Promise<void> {
		setBusy("security-refresh");
		setError(undefined);
		try {
			const [mode, audit] = await Promise.all([
				desktopApi.getSecurityMode(),
				selectedWorkspace ? desktopApi.listSecurityAudit(selectedWorkspace) : Promise.resolve([]),
			]);
			setSecurityMode(mode);
			setSecurityAudit(audit);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setBusy(undefined);
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
		if (view === "security") {
			await refreshSecurityAudit();
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
		return desktopApi.onRefreshData(() => {
			void refreshCurrentViewRef.current();
		});
	}, []);

	if (!setup.checked) {
		return (
			<div className="setup-shell">
				<div className="setup-card">
					<h1>OpenPI</h1>
					<p className="muted">正在启动桌面助手…</p>
				</div>
			</div>
		);
	}

	if (!setup.enabled) {
		return (
			<div className="setup-shell">
				<div className="setup-card">
					<h1>欢迎使用 OpenPI</h1>
					<p>一键开启记忆、安全、工具与智能规划。日常使用不需要命令行。</p>
					{setup.workspace && <p className="muted">工作区：{setup.workspace}</p>}
					{setup.error && <p className="error-text">{setup.error}</p>}
					{setup.doctor && (
						<pre className="code-block" style={{ maxHeight: 200, overflow: "auto" }}>
							{setup.doctor}
						</pre>
					)}
					<div className="button-row">
						<button
							type="button"
							disabled={setup.busy}
							onClick={() => {
								setSetup((current) => ({ ...current, busy: true, error: undefined }));
								void desktopApi
									.runSetup()
									.then(async () => {
										const doctor = await desktopApi.doctor();
										setSetup({
											checked: true,
											enabled: true,
											busy: false,
											doctor: doctor.output,
											workspace: setup.workspace,
										});
										void refresh(true);
									})
									.catch((caught: unknown) => {
										setSetup((current) => ({
											...current,
											busy: false,
											error: caught instanceof Error ? caught.message : String(caught),
										}));
									});
							}}
						>
							{setup.busy ? "配置中…" : "启用 OpenPI"}
						</button>
						<button
							type="button"
							disabled={setup.busy}
							onClick={() => {
								void desktopApi.doctor().then((result) => {
									setSetup((current) => ({ ...current, doctor: result.output }));
								});
							}}
						>
							检查环境
						</button>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div
			className={`app-shell chat-first ${view === "tasks" ? "tasks-view" : ""} ${view === "capabilities" ? "capabilities-view" : ""} ${operationView ? "operations-view" : ""} ${sidebarOpen ? "sidebar-open" : ""} ${contextOpen ? "context-open" : ""}`}
		>
			<AppRail
				activeView={view}
				tasks={snapshot.tasks}
				runs={snapshot.runs}
				daemonRunning={snapshot.daemonRunning}
				onNavigate={(next) => {
					setView(next);
					setSidebarOpen(false);
				}}
			/>
			<ConversationSidebar
				conversations={conversations}
				projects={conversationList.projects}
				conversationTitles={conversationTitles}
				selectedInstanceId={selectedInstanceId}
				streamingInstances={streamingInstances}
				query={chatQuery}
				onQueryChange={setChatQuery}
				onSelect={(instanceId) => {
					setOptimisticMessage(undefined);
					setTurnMeta(undefined);
					selectedInstanceIdRef.current = instanceId;
					setSelectedInstanceId(instanceId);
					setView("chat");
					setSidebarOpen(false);
				}}
				onNew={() => {
					if (appMode === "code" && !codeWorkspace) {
						void changeCodeWorkspace();
					} else {
						void createConversation(
							appMode === "code" ? "code" : "work",
							appMode === "code" ? codeWorkspace : undefined,
						);
					}
				}}
				creating={busy === "new-conversation"}
				onRename={setRenamingConversation}
				onDelete={setDeletingConversation}
				includeStopped={includeStopped}
				onIncludeStoppedChange={setIncludeStopped}
				stoppedCount={snapshot.instanceStats?.stopped ?? 0}
				pruning={busy === "prune-stopped"}
				onPruneStopped={() => void perform("prune-stopped", desktopApi.pruneStoppedInstances)}
				totalCount={conversationList.totalCount}
				truncated={conversationList.truncated}
				showAll={showAllConversations}
				onShowAllChange={setShowAllConversations}
				activeView={view}
				appMode={appMode}
				onAppModeChange={handleModeChange}
				onSelectProject={() => void changeCodeWorkspace()}
				currentProject={codeWorkspace}
			/>

			<div className="main-column">
				{view !== "chat" && (
					<div className="secondary-bar">
						<button type="button" className="text-button back-chat" onClick={() => setView("chat")}>
							<ArrowLeft size={14} />
							返回对话
						</button>
						<span className="secondary-bar-note">辅助页面 · 主路径是聊天</span>
					</div>
				)}
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
				) : view === "chat" ? (
					<>
						<TodoPanel state={todoState} />
						<ChatSurface
							mode={activeAgentMode}
							workspace={activeAgentMode === "code" ? activeCodeWorkspace : selectedWorkspace}
							conversation={conversation}
							selectedInstance={selectedAgentInstance}
							stats={conversationStats}
							providerBalance={providerBalance}
							optimisticMessage={
								optimisticMessage &&
								(optimisticMessage.instanceId === undefined ||
									optimisticMessage.instanceId === selectedInstanceId)
									? optimisticMessage.message
									: undefined
							}
							modelOptions={conversationModels}
							loadingModels={loadingConversationModels}
							draftRequest={composerDraftRequest}
							configuring={busy === "set-model" || busy === "set-thinking"}
							sending={busy === "send-message"}
							onSend={sendMessage}
							onError={setError}
							onModelChange={(model) =>
								void updateConversationConfiguration("set-model", (instanceId) =>
									desktopApi.setConversationModel(instanceId, model.provider, model.id),
								)
							}
							onThinkingLevelChange={(level) =>
								void updateConversationConfiguration("set-thinking", (instanceId) =>
									desktopApi.setConversationThinkingLevel(instanceId, level),
								)
							}
							onAbort={() =>
								selectedInstanceId && perform("abort", () => desktopApi.abortConversation(selectedInstanceId))
							}
							onOpenSidebar={() => setSidebarOpen(true)}
							onToggleContext={() => setContextOpen((current) => !current)}
							slashCommands={conversationCommands}
							turnMeta={turnMeta && turnMeta.instanceId === selectedInstanceId ? turnMeta.message : undefined}
							onRemember={(text) => rememberFromChat(text)}
							onCreateTaskFromChat={openTaskFromChat}
							onNavigate={(next) => setView(next)}
						/>
					</>
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
				) : view === "capabilities" ? (
					<CapabilitiesSurface
						conversation={conversation}
						capabilities={capabilities}
						loading={loadingCapabilities}
						busy={busy}
						onOpenSidebar={() => setSidebarOpen(true)}
						onReload={() => selectedInstanceId && void loadCapabilities(selectedInstanceId, true)}
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
				) : view === "security" ? (
					<SecuritySurface
						mode={securityMode}
						audit={securityAudit}
						busy={busy}
						onOpenSidebar={() => setSidebarOpen(true)}
						onModeChange={(mode) => void updateSecurityMode(mode)}
						onRefresh={() => void refreshSecurityAudit()}
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

			{view === "chat" && (
				<ContextPanel
					conversation={conversation}
					snapshot={snapshot}
					onClose={() => setContextOpen(false)}
					onShowTasks={() => setView("tasks")}
				/>
			)}

			{sidebarOpen && (
				<button className="mobile-scrim" aria-label="Close conversations" onClick={() => setSidebarOpen(false)} />
			)}
			{contextOpen && (
				<button className="context-scrim" aria-label="Close context" onClick={() => setContextOpen(false)} />
			)}

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

			{renamingConversation && (
				<RenameConversationDialog
					conversation={renamingConversation}
					busy={busy === "rename-conversation"}
					onClose={() => setRenamingConversation(undefined)}
					onRename={renameSelectedConversation}
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

			{activeConversationUiRequest && (
				<ConversationUiDialog
					key={activeConversationUiRequest.request.id}
					request={activeConversationUiRequest.request}
					busy={respondingConversationUiRequestId === activeConversationUiRequest.request.id}
					onRespond={respondToConversationUi}
				/>
			)}
		</div>
	);
}
