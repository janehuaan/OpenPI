import {
	Fragment,
	type ClipboardEvent,
	type DragEvent,
	type KeyboardEvent,
	type ReactNode,
	type WheelEvent,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { desktopApi } from "../../../api";
import {
	type DocumentAttachment,
	type ImageAttachment,
	MAX_DOCUMENT_ATTACHMENTS,
	MAX_IMAGE_ATTACHMENTS,
	MAX_TOTAL_DOCUMENT_TEXT_BYTES,
	MAX_TOTAL_IMAGE_BASE64_BYTES,
	SUPPORTED_IMAGE_TYPES,
} from "../../../lib/app-types";
import { isDiffContent } from "../../../lib/diff";
import { ErrorBoundary } from "../../error-boundary";
import { draftStore } from "../../../lib/draft-store";
import { TodayBriefingHero } from "./today-briefing-hero";
import { supabase } from "../../../lib/supabase-client";
import {
	contentImages,
	contentText,
	fmtCost,
	fmtTokens,
	formatActionItem,
	formatConversationTime,
	formatDate,
	formatDuration,
	formatTime,
	groupConversationsByDate,
	instanceTitle,
	isConversationMessage,
	isDocumentFile,
	isRecord,
	isToolCallBlock,
	LOCAL_SLASH,
	messageBlockCounts,
	messageReasoning,
	parseCommand,
	prepareDocumentAttachment,
	prepareImageAttachment,
	shortWorkspacePath,
	statusLabel,
	modelSupportsReasoning,
	getHighestThinkingLevel,
	thinkingLevelsForModel,
	toolCallIconName,
	toolCalls,
	toolCallSummary,
	visibleMessageText,
	type ActionChainItem,
	type ToolCallBlock,
} from "../../../lib/helpers";
import { MarkdownText } from "../../../lib/markdown";
import {
	IMAGE_RATIO_OPTIONS,
	IMAGE_SIZE_OPTIONS,
	loadMediaHistory,
	MEDIA_HISTORY_STORAGE_KEY,
	mediaErrorMessage,
	VIDEO_DURATION_OPTIONS,
	VIDEO_RATIO_OPTIONS,
	VIDEO_RESOLUTION_OPTIONS,
	type VideoRatio,
	type VideoResolution,
	videoDimensions,
} from "../../../lib/media";
import { extractLatestSuggestions } from "../../../lib/recap";
import { joinSpeechText } from "../../../lib/speech-recognition";
import type { TurnProgress } from "../../../lib/turn-progress";
import type {
	AgentInstance,
	AgentMode,
	AgnesImageRatio,
	AgnesImageSize,
	AgnesMediaCapabilities,
	AvailableModel,
	ConversationCapabilities,
	ConversationMessage,
	ConversationModelOption,
	ConversationSnapshot,
	ConversationState,
	ConversationStats,
	DesktopSnapshot,
	GeneratedMediaItem,
	ImageContent,
	MediaComposerMode,
	RunningTool,
	RunStatus,
	ThinkingLevel,
	VisionFallbackConfig,
	WorkspaceSummary,
	AutoPilotTask,
} from "../../../types";
import { MiniDiffView } from "../../diff-viewer";
import { LivePreviewPanel } from "./live-preview-panel";
import { SwarmCanvas } from "./swarm-canvas";
import { AutoPilotModal } from "./autopilot-modal";
import { extractSwarmFromMessages } from "../../../lib/swarm-types";
import {
	ArrowDown,
	ArrowLeft,
	ArrowUp,
	AtSign,
	Bell,
	BookOpen,
	Bot,
	BrainCircuit,
	Cable,
	Check,
	ChevronDown,
	ChevronRight,
	ChevronsUpDown,
	CircleStop,
	Clapperboard,
	Clock3,
	Copy,
	Cpu,
	Download,
	ExternalLink,
	FileCode,
	FileJson,
	FileText,
	Folder,
	FolderMinus,
	FolderPlus,
	GitBranch,
	Github,
	Globe,
	History,
	Home,
	Image as ImageIcon,
	Keyboard,
	ListTodo,
	LogIn,
	Menu,
	MessageSquare,
	Mic,
	Moon,
	MoreHorizontal,
	Package,
	PanelLeftClose,
	PanelLeftOpen,
	PanelRight,
	Paperclip,
	Pause,
	Pencil,
	Pin,
	Play,
	Plus,
	Quote,
	RefreshCw,
	RotateCcw,
	Save,
	Search,
	Send,
	Server,
	Share2,
	Slash,
	Sliders,
	Sparkles,
	Square,
	Store,
	Sun,
	Terminal,
	TerminalSquare,
	Trash2,
	User,
	UserRound,
	Users,
	WandSparkles,
	Wrench,
	X,
	Zap,
	Target,
	Shield,
	Settings,
	CalendarClock,
	AlertCircle,
	Cloud,
} from "../../icons";
import "../today/styles/today-os-dashboard.css";
import type { PersonalGoalRecord, SafetyStatus } from "../../../lib/app-types";
import { useTheme } from "../../../lib/theme-manager";
import { ClaudeCodeRecapCard } from "../../recap-card";
import { TodoPanel } from "../../todo-panel";
import { MessageImages } from "../chat/message-images";
import type { TodoState, GitStatusResult, TaskRun } from "../../../types";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "../../ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "../../ui/popover";
import type { DeleteProjectTarget } from "../dialogs/delete-project-dialog";
import { AgentActionChain } from "./action-chain";
import type { AppMode } from "./mode-tab-bar";
import { ReasoningBlock } from "./reasoning-block";
import { TurnProgressRow } from "./turn-progress-row";
import { ContextInspector } from "../inspector/context-inspector";
import {
	AgentWorkingActivityCard,
	AgentDecisionPromptCard,
	AgentExecutionOverviewCard,
	AgentOutcomeCard,
	parseAgentOutcome,
	AnswerBriefCard,
	parseAnswerBrief,
	AgentPresenceCard,
} from "./personal-agent-blocks";
import type { AgentActivityItem, AgentPresenceStatus } from "./personal-agent-blocks";

type ChatNavView =
	| "today"
	| "chat"
	| "tasks"
	| "capabilities"
	| "memory"
	| "intelligence"
	| "daemon"
	| "git"
	| "goals"
	| "activity"
	| "projects"
	| "agent";

function shortModelName(name: string): string {
	const trimmed = name.trim();
	if (trimmed.length <= 18) return trimmed;
	return `${trimmed.slice(0, 16)}…`;
}

function formatModelContext(context?: number): string {
	if (!context) return "";
	if (context >= 1_000_000) {
		const m = Math.round(context / 1_000_000);
		return `${m}M 上下文`;
	}
	if (context >= 190_000 && context <= 210_000) return "200K 上下文";
	if (context >= 240_000 && context <= 270_000) return "256K 上下文";
	if (context >= 120_000 && context <= 135_000) return "128K 上下文";
	if (context >= 60_000 && context <= 70_000) return "64K 上下文";
	if (context >= 30_000 && context <= 35_000) return "32K 上下文";
	return `${Math.round(context / 1024)}K 上下文`;
}

function inferModelFamily(modelId: string, modelName: string): string {
	const s = `${modelId} ${modelName}`.toLowerCase();
	if (s.includes("gemini")) return "Google Gemini";
	if (s.includes("claude")) return "Anthropic Claude";
	if (s.includes("deepseek")) return "DeepSeek";
	if (s.includes("gpt") || s.includes("o1") || s.includes("o3") || s.includes("o4") || s.includes("openai")) return "OpenAI";
	if (s.includes("qwen")) return "阿里通义千问";
	if (s.includes("glm")) return "智谱清言";
	if (s.includes("moonshot") || s.includes("kimi")) return "月之暗面 Kimi";
	if (s.includes("minimax")) return "MiniMax";
	if (s.includes("agnes") || s.includes("mimo")) return "Agnes 原生架构";
	return "通用模型";
}

function hasVisionContext(content: unknown): boolean {
	return contentText(content).includes("<openpi-vision-context");
}

const THINKING_SHORT_ZH: Record<string, string> = {
	off: "关闭",
	minimal: "极低",
	low: "轻度",
	medium: "标准",
	high: "深度",
	xhigh: "极高",
	max: "最大",
};

export function ReferenceWorkspacePreview({
	projectInstances,
	chatInstances,
	selectedInstanceId,
	conversation,
	conversationTitles,
	workspaceSummary,
	runningTools,
	taskRuns,
	toolDurations = {},
	turnProgress,
	todoState,
	optimisticMessage,
	memoryEntries,
	memoryCount,
	stats,
	providerBalance,
	modelOptions,
	visionFallback,
	loadingModels,
	configuring,
	sending,
	appMode,
	slashCommands = [],
	onSelectConversation,
	onOpenProject,
	onNewProjectSession,
	onNewConversation,
	onOpenSettings,
	onSend,
	onSteer,
	onFollowUp,
	onAbort,
	onRenameConversation,
	onExportConversation,
	onDeleteConversation,
	onRemoveProject,
	onRemember,
	onCreateTaskFromChat,
	onModelChange,
	onThinkingLevelChange,
	onAppModeChange,
	onNavigate,
	sidebarOpen,
	onToggleSidebar,
	onCollapseSidebar,
	gitStatus,
	gitLoading,
	onRefreshGit,
	onOpenGit,
	extraDataSlot,
	prefillDraft,
	activeView,
	customContent,
	onOpenShortcuts,
	onSwitchWorkspace,
	userProfile,
	onOpenAccount,
}: {
	projectInstances: AgentInstance[];
	chatInstances: AgentInstance[];
	selectedInstanceId?: string;
	conversation?: ConversationSnapshot;
	conversationTitles: Record<string, string>;
	workspaceSummary?: WorkspaceSummary;
	runningTools: RunningTool[];
	taskRuns?: TaskRun[];
	toolDurations?: Record<string, number>;
	turnProgress?: TurnProgress;
	todoState?: TodoState;
	optimisticMessage?: ConversationMessage;
	memoryEntries: string[];
	memoryCount: number;
	stats?: ConversationStats;
	providerBalance?: { currency: string; totalBalance: number } | null;
	modelOptions: ConversationModelOption[];
	visionFallback?: VisionFallbackConfig;
	loadingModels: boolean;
	configuring: boolean;
	sending: boolean;
	appMode: AppMode;
	slashCommands: string[];
	sidebarOpen?: boolean;
	onSelectConversation(instanceId: string): void;
	onOpenProject(instanceId: string): void;
	onNewProjectSession(workspace: string): void;
	onNewConversation(): void;
	onOpenSettings(): void;
	onSend(message: string, images: ImageContent[], documents: DocumentAttachment[]): Promise<void>;
	onSteer?(message: string, images: ImageContent[]): Promise<void> | void;
	onFollowUp?(message: string, images: ImageContent[]): Promise<void> | void;
	onAbort(): void;
	onRenameConversation?(instance?: AgentInstance): void;
	onExportConversation?(): void;
	onDeleteConversation?(instance?: AgentInstance): void;
	onRemoveProject?(target: DeleteProjectTarget): void;
	onRemember(text: string): Promise<void> | void;
	onCreateTaskFromChat(prompt: string): void;
	onModelChange(model: ConversationModelOption): void;
	onThinkingLevelChange(level: ThinkingLevel): void;
	onAppModeChange(mode: AppMode): void;
	onNavigate(view: ChatNavView): void;
	onToggleSidebar?(): void;
	onCollapseSidebar?(): void;
	gitStatus?: GitStatusResult | null;
	gitLoading?: boolean;
	onRefreshGit?: () => void;
	onOpenGit?: () => void;
	extraDataSlot?: ReactNode;
	prefillDraft?: { id: string; text: string; images?: string[] };
	activeView?: string;
	customContent?: ReactNode;
	onOpenShortcuts?: () => void;
	onSwitchWorkspace?: (cwd?: string) => void;
	userProfile?: { nickname?: string; avatarEmoji?: string; avatarUrl?: string };
	onOpenAccount?: () => void;
}) {
	const { effectiveMode, toggle: toggleTheme } = useTheme();
	const [supabaseUser, setSupabaseUser] = useState(() => supabase.getUser());

	useEffect(() => {
		const unsub = supabase.onAuthStateChange(setSupabaseUser);
		return () => unsub();
	}, []);

	const [safetyStatus, setSafetyStatus] = useState<SafetyStatus | null>(null);
	const [activeGoals, setActiveGoals] = useState<PersonalGoalRecord[]>([]);

	useEffect(() => {
		let active = true;
		desktopApi.getSafetyStatus().then((s) => {
			if (active && s) setSafetyStatus(s);
		}).catch(() => {});
		// `list_personal_goals` 返回 `{ goals }` 包装对象，不是裸数组。
		desktopApi.listPersonalGoals("active").then((res) => {
			if (active && Array.isArray(res?.goals)) setActiveGoals(res.goals);
		}).catch(() => {});
		return () => {
			active = false;
		};
	}, [selectedInstanceId]);

	const activeGoal = useMemo(() => {
		if (activeGoals.length > 0) {
			const g = activeGoals[0];
			return {
				title: g.title,
				nextActionTitle: "设计 Decision Engine",
				nextActionDesc: g.description || "推进当前主线目标任务",
			};
		}
		return {
			title: "OpenPI Personal Agent OS",
			nextActionTitle: "设计 Decision Engine",
			nextActionDesc: "定义决策对象与策略，建立事件→决策→行动闭环",
		};
	}, [activeGoals]);

	const [now, setNow] = useState(new Date());
	useEffect(() => {
		const timer = setInterval(() => setNow(new Date()), 30000);
		return () => clearInterval(timer);
	}, []);

	const formattedDateTime = useMemo(() => {
		const year = now.getFullYear();
		const month = String(now.getMonth() + 1).padStart(2, "0");
		const date = String(now.getDate()).padStart(2, "0");
		const days = ["日", "一", "二", "三", "四", "五", "六"];
		const dayName = days[now.getDay()];
		const hours = String(now.getHours()).padStart(2, "0");
		const minutes = String(now.getMinutes()).padStart(2, "0");
		return `${year}年${month}月${date}日 星期${dayName} ${hours}:${minutes}`;
	}, [now]);

	const userName =
		userProfile?.nickname === "Jane" || userProfile?.nickname === "Janehuaan" || !userProfile?.nickname
			? "简华安"
			: userProfile.nickname;
	const hour = now.getHours();
	const greeting =
		hour < 12 ? `早安，${userName}` : hour < 18 ? `下午好，${userName}` : `晚上好，${userName}`;

	const circuitBadge = useMemo(() => {
		if (!safetyStatus?.circuitState) {
			return { text: "● 正常运行 (Healthy)", color: "#10b981", bg: "rgba(16, 185, 129, 0.12)" };
		}
		const s = safetyStatus.circuitState.state;
		if (s === "healthy") {
			return { text: "● 正常运行 (Healthy)", color: "#10b981", bg: "rgba(16, 185, 129, 0.12)" };
		} else if (s === "degraded") {
			return { text: "▲ 降级观察 (Degraded)", color: "#eab308", bg: "rgba(234, 179, 8, 0.12)" };
		} else if (s === "open") {
			return { text: "■ 熔断保护 (Circuit Open)", color: "#ef4444", bg: "rgba(239, 68, 68, 0.12)" };
		} else {
			return { text: "◌ 探针探测 (Recovery)", color: "#3b82f6", bg: "rgba(59, 130, 246, 0.12)" };
		}
	}, [safetyStatus]);

	const initialKey = selectedInstanceId ?? "__new_draft__";
	const [draft, setDraft] = useState(() => draftStore.getDraft(initialKey)?.text ?? "");
	const [attachments, setAttachments] = useState<ImageAttachment[]>(
		() => draftStore.getDraft(initialKey)?.attachments ?? [],
	);
	const [documents, setDocuments] = useState<DocumentAttachment[]>(
		() => draftStore.getDraft(initialKey)?.documents ?? [],
	);
	const activeInstanceIdRef = useRef(selectedInstanceId);
	const draftRef = useRef(draft);
	draftRef.current = draft;
	const attachmentsRef = useRef(attachments);
	attachmentsRef.current = attachments;
	const documentsRef = useRef(documents);
	documentsRef.current = documents;

	useEffect(() => {
		const prevKey = activeInstanceIdRef.current ?? "__new_draft__";
		const nextKey = selectedInstanceId ?? "__new_draft__";
		if (prevKey !== nextKey) {
			const text = draftRef.current;
			const atts = attachmentsRef.current;
			const docs = documentsRef.current;
			if (text.trim() || atts.length > 0 || docs.length > 0) {
				draftStore.setDraft(prevKey, {
					text,
					attachments: [...atts],
					documents: [...docs],
				});
			} else {
				draftStore.clearDraft(prevKey);
			}
		}
		activeInstanceIdRef.current = selectedInstanceId;

		const saved = draftStore.getDraft(nextKey);
		setDraft(saved?.text ?? "");
		setAttachments(saved?.attachments ?? []);
		setDocuments(saved?.documents ?? []);
		setAttachmentNotice(undefined);
	}, [selectedInstanceId]);

	useEffect(() => {
		return () => {
			const currentKey = activeInstanceIdRef.current ?? "__new_draft__";
			const text = draftRef.current;
			const atts = attachmentsRef.current;
			const docs = documentsRef.current;
			if (text.trim() || atts.length > 0 || docs.length > 0) {
				draftStore.setDraft(currentKey, {
					text,
					attachments: [...atts],
					documents: [...docs],
				});
			} else {
				draftStore.clearDraft(currentKey);
			}
		};
	}, []);

	const [livePreviewOpen, setLivePreviewOpen] = useState(false);
	const [swarmCanvasOpen, setSwarmCanvasOpen] = useState(false);
	const [autoPilotOpen, setAutoPilotOpen] = useState(false);
	const [autoPilotPrompt, setAutoPilotPrompt] = useState("");
	const [autoPilotAutoStart, setAutoPilotAutoStart] = useState(false);
	const [activeAutoPilotTask, setActiveAutoPilotTask] = useState<AutoPilotTask | null>(null);

	useEffect(() => {
		const unsub = desktopApi.onAutoPilotEvent?.(({ task }) => {
			setActiveAutoPilotTask(task);
		});
		return () => {
			if (unsub) unsub();
		};
	}, []);

	const detectedHtml = useMemo(() => {
		const msgs = conversation?.messages ?? [];
		for (let i = msgs.length - 1; i >= 0; i--) {
			const msg = msgs[i];
			if (msg?.role === "assistant") {
				const text = visibleMessageText(contentText(msg.content));
				const htmlMatch = text.match(/```(?:html|xml|svg)\s*([\s\S]*?)```/i);
				if (htmlMatch?.[1]) return htmlMatch[1];
				if (text.includes("<!DOCTYPE html>") || (text.includes("<html") && text.includes("</html>"))) {
					return text;
				}
			}
		}
		return undefined;
	}, [conversation?.messages]);

	useEffect(() => {
		if (prefillDraft) {
			if (prefillDraft.text) {
				setDraft(prefillDraft.text);
			}
			if (prefillDraft.images && prefillDraft.images.length > 0) {
				const imgAttachments: ImageAttachment[] = prefillDraft.images.map((img, idx) => {
					const match = /^data:(image\/[^;]+);base64,(.+)$/.exec(img);
					const mimeType = match ? match[1] : "image/png";
					const data = match ? match[2] : img;
					return {
						id: `screenshot-${Date.now()}-${idx + 1}`,
						type: "image",
						mimeType,
						data,
						name: `screenshot-${Date.now()}-${idx + 1}.png`,
					};
				});
				setAttachments(imgAttachments);
			}
			draftInput.current?.focus();
		}
	}, [prefillDraft]);
	const [attachmentNotice, setAttachmentNotice] = useState<string>();

	useEffect(() => {
		if (!attachmentNotice) return;
		const timer = setTimeout(() => {
			setAttachmentNotice(undefined);
		}, 4000);
		return () => clearTimeout(timer);
	}, [attachmentNotice]);

	const [contextPickerOpen, setContextPickerOpen] = useState(false);
	const [modelMenuOpen, setModelMenuOpen] = useState(false);
	const [slashOpen, setSlashOpen] = useState(false);

	useEffect(() => {
		if (!modelMenuOpen) return;
		window.dispatchEvent(new CustomEvent("openpi:model-providers-changed"));
		const timer = setTimeout(() => {
			const container = document.querySelector(".model-popover .ui-command-list, .model-popover [cmdk-list]");
			const activeItem = container?.querySelector('[data-active-model="true"]') as HTMLElement | null;
			if (activeItem) {
				activeItem.scrollIntoView({ block: "center", behavior: "smooth" });
			}
		}, 60);
		return () => clearTimeout(timer);
	}, [modelMenuOpen]);
	const [slashIndex, setSlashIndex] = useState(0);
	const [showAllSpaces, setShowAllSpaces] = useState(false);
	const [showAllSessions, setShowAllSessions] = useState(false);
	const [projectsOverflow, setProjectsOverflow] = useState(false);
	const [chatsOverflow, setChatsOverflow] = useState(false);
	const [showAllFiles, setShowAllFiles] = useState(false);
	const [collapsedProjects, setCollapsedProjects] = useState<Record<string, boolean>>({});
	const [headCollapsed, setHeadCollapsed] = useState(false);
	const [agentActivity, setAgentActivity] = useState<AgentActivityItem[]>([]);
	const [agentBubble, setAgentBubble] = useState<
		{ text: string; detail?: string; tone: "info" | "warn" } | undefined
	>();
	const agentStatus: AgentPresenceStatus =
		Boolean(conversation?.state?.isStreaming) || runningTools.length > 0 ? "working" : "idle";
	const agentStatusDetail =
		runningTools.length > 0
			? `正在执行 ${runningTools.length} 个工具${runningTools[0]?.toolName ? `：${runningTools[0].toolName}` : ""}`
			: Boolean(conversation?.state?.isStreaming)
				? "正在组织回复…"
				: `${greeting} · 待命中，后台持续观察工作区`;

	useEffect(() => {
		let active = true;
		const clock = (iso?: string) => {
			if (!iso) return "";
			const d = new Date(iso);
			if (Number.isNaN(d.getTime())) return "";
			return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
		};
		const load = async () => {
			const raw: { ts: number; item: AgentActivityItem }[] = [];
			try {
				const res = await desktopApi.listActionCards(undefined, 6);
				for (const c of res.cards ?? []) {
					raw.push({
						ts: new Date(c.createdAt).getTime() || 0,
						item: { id: c.id, time: clock(c.createdAt), label: c.title, detail: c.summary, kind: "card" },
					});
				}
			} catch {
				// ignore
			}
			try {
				const openRes = await desktopApi.listActionCards("open", 3);
				const first = openRes.cards?.[0];
				if (active) {
					setAgentBubble(
						first ? { text: first.title, detail: first.summary, tone: "warn" } : undefined,
					);
				}
			} catch {
				// ignore
			}
			for (const r of taskRuns ?? []) {
				const when = r.finishedAt || r.startedAt || r.createdAt;
				raw.push({
					ts: new Date(when).getTime() || 0,
					item: { id: r.id, time: clock(when), label: `任务运行 · ${r.status}`, detail: r.result || r.error || undefined, kind: "run" },
				});
			}
			raw.sort((a, b) => b.ts - a.ts);
			if (active) setAgentActivity(raw.slice(0, 6).map((r) => r.item));
		};
		void load();
		const handler = () => void load();
		window.addEventListener("openpi:proactive", handler);
		return () => {
			active = false;
			window.removeEventListener("openpi:proactive", handler);
		};
	}, [taskRuns]);
	const toggleProjectCollapsed = (cwd: string, e: React.MouseEvent) => {
		e.stopPropagation();
		setCollapsedProjects((prev) => ({ ...prev, [cwd]: !prev[cwd] }));
	};
	const [memoryQuery, setMemoryQuery] = useState("");
	const attachmentInput = useRef<HTMLInputElement>(null);
	const draftInput = useRef<HTMLTextAreaElement>(null);
	const feedScroll = useRef<HTMLElement>(null);
	const chatView = useRef<HTMLDivElement>(null);
	const bottomAnchorRef = useRef<HTMLDivElement>(null);
	const projectList = useRef<HTMLDivElement>(null);
	const chatList = useRef<HTMLDivElement>(null);
	const autoFollow = useRef(true);
	const isUserManuallyScrolledUp = useRef(false);
	const initialScrollSettleUntil = useRef(0);
	const [contextPanelOpen, setContextPanelOpen] = useState(() => {
		try {
			const saved = localStorage.getItem("openpi.contextPanelOpen_v2");
			if (saved !== null) return saved === "true";
		} catch {}
		return true;
	});

	useEffect(() => {
		try {
			localStorage.setItem("openpi.contextPanelOpen_v2", String(contextPanelOpen));
		} catch {}
	}, [contextPanelOpen]);

	useEffect(() => {
		const handleToggle = () => setContextPanelOpen((prev) => !prev);
		window.addEventListener("openpi:toggle-context", handleToggle);
		return () => window.removeEventListener("openpi:toggle-context", handleToggle);
	}, []);
	const [sidebarSearch, setSidebarSearch] = useState("");
	const [showScrollToBottom, setShowScrollToBottom] = useState(false);
	const instances = [...projectInstances, ...chatInstances];
	const selectedInstance = instances.find((instance) => instance.id === selectedInstanceId);
	const workspace = conversation?.instance.cwd ?? selectedInstance?.cwd;

	const filteredChats = useMemo(() => {
		if (!sidebarSearch.trim()) return chatInstances;
		const q = sidebarSearch.toLowerCase();
		return chatInstances.filter((inst) => {
			const t = instanceTitle(inst, conversationTitles[inst.id]).toLowerCase();
			return t.includes(q) || inst.id.toLowerCase().includes(q);
		});
	}, [chatInstances, sidebarSearch, conversationTitles]);

	const chatGroups = useMemo(() => groupConversationsByDate(filteredChats), [filteredChats]);
	const spaces = useMemo(() => {
		const groups = new Map<string, AgentInstance[]>();
		for (const instance of projectInstances) {
			if (!instance.cwd) continue;
			const group = groups.get(instance.cwd) ?? [];
			group.push(instance);
			groups.set(instance.cwd, group);
		}
		return [...groups.entries()];
	}, [projectInstances]);
	const title = conversation
		? instanceTitle(conversation.instance, conversationTitles[conversation.instance.id])
		: selectedInstance
			? instanceTitle(selectedInstance, conversationTitles[selectedInstance.id])
			: "新对话";
	const storedMessages = conversation?.messages ?? [];
	const messages = optimisticMessage ? [...storedMessages, optimisticMessage] : storedMessages;
	const isWorking = Boolean(conversation?.state?.isStreaming || sending || optimisticMessage || runningTools.length > 0);

	const currentModelName = conversation?.state?.model?.name || conversation?.state?.model?.id;
	const swarmWorkflow = useMemo(() => {
		return extractSwarmFromMessages(
			messages,
			currentModelName,
			isWorking,
		);
	}, [messages, currentModelName, isWorking]);

	const workingStartedAtRef = useRef<number>(0);
	const wasWorkingRef = useRef(false);
	useEffect(() => {
		if (isWorking) {
			workingStartedAtRef.current = Date.now();
			if (!wasWorkingRef.current) {
				// Agent started executing: auto-collapse left and right sidebars for max message canvas
				if (sidebarOpen !== false) {
					if (onCollapseSidebar) onCollapseSidebar();
					else onToggleSidebar?.();
				}
				setContextPanelOpen(false);
			}
		}
		wasWorkingRef.current = isWorking;
	}, [isWorking, sidebarOpen, onToggleSidebar, onCollapseSidebar]);

	const handleSafeAbort = useCallback(() => {
		// Prevent accidental misfires: ignore abort clicks within 800ms of generation start
		if (Date.now() - workingStartedAtRef.current < 800) {
			console.warn("[WorkspacePreview] Ignored rapid abort click within 800ms grace period");
			return;
		}
		onAbort();
	}, [onAbort]);
	const topSuggestion = useMemo(() => extractLatestSuggestions(messages, todoState)[0], [messages, todoState]);

	const feedItems = useMemo(() => {
		const items: Array<
			| { kind: "user"; message: ConversationMessage; index: number; turnNumber: number }
			| {
					kind: "assistant";
					message: ConversationMessage;
					index: number;
					reasoning?: string;
					isLastAssistantMessage: boolean;
					isLatestAssistant: boolean;
			  }
			| { kind: "actions"; id: string; actions: ActionChainItem[]; reasoning?: string }
		> = [];

		let currentActions: ActionChainItem[] = [];
		let currentReasoning = "";
		let userTurnIndex = 0;
		const seenActionIds = new Set<string>();

		const flushActions = () => {
			if (currentActions.length > 0 || currentReasoning) {
				items.push({
					kind: "actions",
					id: `actions-${items.length}`,
					reasoning: currentReasoning,
					actions: [...currentActions],
				});
				currentActions = [];
				currentReasoning = "";
			}
		};

		let pendingRecalled: Array<{ type: string; key: string; value: string }> | undefined;

		messages.forEach((message, index) => {
			const customType = (message as any).customType || (message as any).details?.customType;
			if (customType === "openpi-memory:snapshot" || (message as any).type === "custom_message") {
				const recalled = (message as any).details?.recalled;
				if (Array.isArray(recalled) && recalled.length > 0) {
					pendingRecalled = recalled;
				}
				return;
			}

			if (message.role === "user") {
				flushActions();
				userTurnIndex++;
				items.push({ kind: "user", message, index, turnNumber: userTurnIndex });
				return;
			}

			if (message.role === "toolResult") {
				let match = currentActions.find((a) => a.output === undefined && (a.id === message.toolCallId || a.name === message.toolName || !a.name));
				if (!match && message.toolCallId) {
					// Search backwards in previously flushed actions items
					for (let i = items.length - 1; i >= 0; i--) {
						const it = items[i];
						if (it?.kind === "actions") {
							const prevMatch = it.actions.find((a) => a.output === undefined && (a.id === message.toolCallId || a.name === message.toolName));
							if (prevMatch) {
								match = prevMatch;
								break;
							}
						}
					}
				}
				const durationMs = message.toolCallId && toolDurations ? toolDurations[message.toolCallId] : undefined;
				if (match) {
					match.output = contentText(message.content);
					match.isError = Boolean(message.isError);
					if (durationMs !== undefined) match.durationMs = durationMs;
					const formatted = formatActionItem(match.name, match.args, match.output, match.isError);
					match.badge = formatted.badge;
					if (message.toolCallId) seenActionIds.add(message.toolCallId);
				} else {
					const name = message.toolName || "tool";
					const outputText = contentText(message.content);
					const isError = Boolean(message.isError);
					const formatted = formatActionItem(name, undefined, outputText, isError);
					const id = message.toolCallId || `tr_${index}`;
					if (!seenActionIds.has(id)) {
						seenActionIds.add(id);
						const toolBlock: ToolCallBlock = {
							type: "toolCall",
							id,
							name,
							arguments: {},
						};
						currentActions.push({
							id,
							name,
							summary: name,
							iconName: toolCallIconName(toolBlock),
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
				return;
			}

			if (message.role === "assistant") {
				const text = visibleMessageText(contentText(message.content));
				const reasoning = messageReasoning(message);
				const toolCallBlocks = Array.isArray(message.content)
					? (message.content.filter(isToolCallBlock) as ToolCallBlock[])
					: [];

				const isLastAssistantMessage =
					index === messages.length - 1 ||
					messages.slice(index + 1).every((m) => m.role !== "assistant");

				const messageWithRecalled: ConversationMessage =
					message.recalledMemories && message.recalledMemories.length > 0
						? message
						: pendingRecalled && pendingRecalled.length > 0
							? { ...message, recalledMemories: pendingRecalled }
							: message;
				pendingRecalled = undefined;

				if (
					text ||
					reasoning ||
					contentImages(message.content).length > 0 ||
					message.errorMessage ||
					(isWorking && isLastAssistantMessage && toolCallBlocks.length === 0)
				) {
					flushActions();
					items.push({
						kind: "assistant",
						message: messageWithRecalled,
						index,
						reasoning: toolCallBlocks.length > 0 ? undefined : reasoning,
						isLastAssistantMessage,
						isLatestAssistant: isLastAssistantMessage && !isWorking,
					});
				}

				if (toolCallBlocks.length > 0) {
					for (const tc of toolCallBlocks) {
						const actionId = tc.id || `tc_${index}_${currentActions.length}`;
						if (seenActionIds.has(actionId)) {
							continue;
						}
						seenActionIds.add(actionId);
						const args = (tc.arguments && typeof tc.arguments === "object" ? tc.arguments : {}) as Record<string, unknown>;
						const formatted = formatActionItem(tc.name, args);
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
						});
					}
				}

				if (reasoning && !text && toolCallBlocks.length > 0) {
					currentReasoning = currentReasoning ? `${currentReasoning}\n\n${reasoning}` : reasoning;
				}
			}
		});

		flushActions();
		return items;
	}, [messages, isWorking, runningTools]);

	const lastUserPrompt = useMemo(() => {
		for (let i = messages.length - 1; i >= 0; i--) {
			if (messages[i]?.role === "user") {
				return visibleMessageText(contentText(messages[i].content));
			}
		}
		return "";
	}, [messages]);

	const lastActionsId = useMemo(() => {
		for (let i = feedItems.length - 1; i >= 0; i--) {
			const item = feedItems[i];
			if (item?.kind === "actions") {
				return item.id;
			}
		}
		return undefined;
	}, [feedItems]);

	const defaultOption = useMemo(
		() => modelOptions.find((m) => (m as { isDefault?: boolean }).isDefault) ?? modelOptions[0],
		[modelOptions],
	);

	const currentModel = useMemo(() => {
		if (conversation?.state?.model?.id) {
			const byExact = modelOptions.find(
				(model) =>
					model.provider.toLowerCase() === (conversation?.state?.model?.provider || "").toLowerCase() &&
					model.id === conversation?.state?.model?.id,
			);
			if (byExact) return byExact;
			const byId = modelOptions.find((model) => model.id === conversation?.state?.model?.id);
			if (byId) return byId;
		}
		return defaultOption;
	}, [modelOptions, conversation?.state?.model, defaultOption]);

	const usesVisionFallback =
		attachments.length > 0 &&
		currentModel?.supportsImages === false &&
		visionFallback?.enabled === true &&
		visionFallback.configured;
	const supportsThinking = modelSupportsReasoning(currentModel ?? conversation?.state?.model);
	const thinkingLevels = currentModel?.thinkingLevels ?? thinkingLevelsForModel({ reasoning: supportsThinking });
	const modelGroups = useMemo(() => {
		const currentProvider = (currentModel?.provider ?? conversation?.state?.model?.provider ?? "").toLowerCase();
		const currentId = currentModel?.id ?? conversation?.state?.model?.id ?? "";

		// Detect if a single provider hosts models from multiple families (e.g. 自建, custom, oneapi)
		const providerFamilyCounts = new Map<string, Set<string>>();
		for (const model of modelOptions) {
			const fam = inferModelFamily(model.id, model.name);
			const set = providerFamilyCounts.get(model.provider) ?? new Set();
			set.add(fam);
			providerFamilyCounts.set(model.provider, set);
		}

		const groups = new Map<string, ConversationModelOption[]>();
		for (const model of modelOptions) {
			const multiFamily = (providerFamilyCounts.get(model.provider)?.size ?? 0) > 1;
			const groupKey = multiFamily
				? `${model.provider} · ${inferModelFamily(model.id, model.name)}`
				: model.provider;
			const list = groups.get(groupKey) ?? [];
			list.push(model);
			groups.set(groupKey, list);
		}

		// Sort models within each group:
		// Active model first, then reasoning models, then natural alphabetized
		for (const [_, list] of groups.entries()) {
			list.sort((a, b) => {
				const aIsCurrent = a.provider.toLowerCase() === currentProvider && a.id === currentId;
				const bIsCurrent = b.provider.toLowerCase() === currentProvider && b.id === currentId;
				if (aIsCurrent && !bIsCurrent) return -1;
				if (!aIsCurrent && bIsCurrent) return 1;

				const aReasoning = modelSupportsReasoning(a);
				const bReasoning = modelSupportsReasoning(b);
				if (aReasoning !== bReasoning) return aReasoning ? -1 : 1;

				return (a.name || "").localeCompare(b.name || "", "zh-CN", { numeric: true, sensitivity: "base" });
			});
		}

		const entries = [...groups.entries()];

		entries.sort(([gA], [gB]) => {
			const lowerA = (gA || "").toLowerCase();
			const lowerB = (gB || "").toLowerCase();
			const aHasCurrent = lowerA.startsWith(currentProvider);
			const bHasCurrent = lowerB.startsWith(currentProvider);
			if (aHasCurrent && !bHasCurrent) return -1;
			if (!aHasCurrent && bHasCurrent) return 1;

			return (gA || "").localeCompare(gB || "", "zh-CN");
		});

		return entries;
	}, [modelOptions, currentModel, conversation?.state?.model]);
	const IGNORED_EXTENSIONS = useMemo(
		() =>
			new Set([
				".dmg", ".pkg", ".iso", ".zip", ".tar", ".gz", ".7z", ".rar",
				".exe", ".bin", ".app", ".dylib", ".so", ".a", ".mp4", ".mov",
				".avi", ".mkv", ".mp3", ".wav", ".flac", ".png", ".jpg", ".jpeg",
				".gif", ".webp", ".ico", ".pdf", ".woff", ".woff2", ".ttf", ".otf",
			]),
		[],
	);

	const relatedFiles = useMemo(() => {
		const raw = workspaceSummary?.files ?? [];
		return raw.filter((file) => {
			const name = file.split(/[\\/]/).pop() || "";
			if (name === ".DS_Store" || name === "Thumbs.db" || name.endsWith("history")) return false;
			if (name.startsWith(".") && !name.startsWith(".env")) return false;
			if (name === "package-lock.json" || name === "pnpm-lock.yaml" || name === "yarn.lock" || name === "bun.lockb") return false;
			const dotIndex = name.lastIndexOf(".");
			if (dotIndex !== -1 && IGNORED_EXTENSIONS.has(name.slice(dotIndex).toLowerCase())) return false;
			return true;
		});
	}, [workspaceSummary?.files, IGNORED_EXTENSIONS]);
	const visibleMemory = (Array.isArray(memoryEntries) ? memoryEntries : []).filter((entry) =>
		typeof entry === "string" && entry.toLowerCase().includes(memoryQuery.trim().toLowerCase()),
	);

	const modelId = conversation?.state?.model?.id || currentModel?.id || "";
	const rawCtx = currentModel?.contextWindow ?? conversation?.state?.model?.contextWindow;
	const rawMax = currentModel?.maxTokens ?? conversation?.state?.model?.maxTokens;

	const contextUsage = stats?.contextUsage;
	const contextTokens = contextUsage?.tokens ?? 0;

	const contextWindow =
		rawCtx && rawCtx > 0
			? rawCtx
			: contextUsage?.contextWindow && contextUsage.contextWindow > 128000
				? contextUsage.contextWindow
				: modelId.toLowerCase().includes("gemini")
					? 1048576
					: modelId.toLowerCase().includes("agnes")
						? 524288
						: modelId.toLowerCase().includes("deepseek") || modelId.toLowerCase().includes("qwen") || modelId.toLowerCase().includes("glm-5") || modelId.toLowerCase().includes("minimax") || modelId.toLowerCase().includes("claude-opus") || modelId.toLowerCase().includes("gpt-5") || modelId.toLowerCase().includes("k3")
							? 1000000
							: modelId.toLowerCase().includes("sensenova") || modelId.toLowerCase().includes("kimi")
								? 262144
								: modelId.toLowerCase().includes("claude")
									? 200000
									: (contextUsage?.contextWindow || 128000);

	const isLargeOutput =
		modelId.toLowerCase().includes("gemini") ||
		modelId.toLowerCase().includes("agnes") ||
		modelId.toLowerCase().includes("deepseek") ||
		modelId.toLowerCase().includes("sensenova") ||
		modelId.toLowerCase().includes("glm") ||
		modelId.toLowerCase().includes("qwen") ||
		modelId.toLowerCase().includes("kimi") ||
		modelId.toLowerCase().includes("k3") ||
		modelId.toLowerCase().includes("minimax");

	const maxTokens =
		rawMax && rawMax > 0
			? rawMax
			: isLargeOutput
				? 65536
				: modelId.toLowerCase().includes("claude")
					? 64000
					: 8192;

	const contextPercent =
		contextWindow > 0
			? Math.min(contextTokens / contextWindow, 1)
			: undefined;
	const cacheRead = stats?.tokens?.cacheRead ?? 0;
	const cacheWrite = stats?.tokens?.cacheWrite ?? 0;
	const cacheEligibleTokens = (stats?.tokens?.input ?? 0) + cacheRead;
	const cacheHitPercent = cacheEligibleTokens > 0 ? Math.round((cacheRead / cacheEligibleTokens) * 100) : undefined;
	const messageSignature = `${messages
		.map((message, index) => {
			const textLen = contentText(message.content).length;
			const reasoningLen = messageReasoning(message).length;
			return `${message.timestamp ?? index}:${message.role}:${textLen}:${reasoningLen}`;
		})
		.join("|")}:${runningTools.length}:${isWorking}`;
	const agentSlash = useMemo(
		() =>
			(Array.isArray(slashCommands) ? slashCommands : []).map((line) => {
				const parsed = parseCommand(line);
				return {
					id: `agent:${parsed.name}`,
					label: parsed.name.startsWith("/") ? parsed.name : `/${parsed.name}`,
					hint: parsed.description,
					insert: parsed.name.startsWith("/") ? `${parsed.name} ` : `/${parsed.name} `,
				};
			}),
		[slashCommands],
	);
	const slashQuery = draft.startsWith("/") ? draft.slice(1).trim().toLowerCase() : "";
	const localSlashItems = useMemo(
		() =>
			LOCAL_SLASH.map((item) => ({
				id: item.id,
				label: item.label,
				hint: item.hint,
				insert: `${item.label.split(" ")[0]} `,
			})),
		[],
	);
	const slashItems = useMemo(() => {
		const combined = [...localSlashItems, ...agentSlash];
		if (!slashQuery) return combined.slice(0, 30);
		return combined
			.filter(
				(item) =>
					item.label.toLowerCase().includes(slashQuery) ||
					item.hint.toLowerCase().includes(slashQuery) ||
					item.id.toLowerCase().includes(slashQuery),
			)
			.slice(0, 30);
	}, [agentSlash, localSlashItems, slashQuery]);

	const forceScrollToBottom = useCallback((smooth = false) => {
		const feed = feedScroll.current;
		if (feed) {
			if (smooth) {
				feed.scrollTo({ top: feed.scrollHeight, behavior: "smooth" });
			} else {
				feed.scrollTop = feed.scrollHeight;
			}
		}
		bottomAnchorRef.current?.scrollIntoView({
			block: "end",
			behavior: smooth ? "smooth" : "auto",
		});
	}, []);

	const pulseScrollToBottom = useCallback(() => {
		if (isUserManuallyScrolledUp.current) return () => {};
		autoFollow.current = true;
		forceScrollToBottom();
		const delays = [30, 80, 180, 350, 700, 1200, 1800];
		const timers = delays.map((ms) =>
			window.setTimeout(() => {
				if (!isUserManuallyScrolledUp.current) {
					forceScrollToBottom();
				}
			}, ms),
		);
		return () => {
			for (const t of timers) {
				window.clearTimeout(t);
			}
		};
	}, [forceScrollToBottom]);

	useLayoutEffect(() => {
		isUserManuallyScrolledUp.current = false;
		autoFollow.current = true;
		initialScrollSettleUntil.current = Date.now() + 2500;
		setShowScrollToBottom(false);
		setModelMenuOpen(false);
		setSlashOpen(false);
		return pulseScrollToBottom();
	}, [conversation?.instance?.id, selectedInstanceId, pulseScrollToBottom]);

	useLayoutEffect(() => {
		if (!isUserManuallyScrolledUp.current) {
			autoFollow.current = true;
			forceScrollToBottom();
		}
	}, [messageSignature, forceScrollToBottom]);

	useEffect(() => {
		const open = draft.startsWith("/") && !draft.includes("\n");
		setSlashOpen(open);
		if (open) setSlashIndex(0);
	}, [draft]);

	useEffect(() => {
		const measureOverflow = (): void => {
			if (!showAllSpaces && projectList.current) {
				setProjectsOverflow(projectList.current.scrollHeight > projectList.current.clientHeight + 1);
			}
			if (!showAllSessions && chatList.current) {
				setChatsOverflow(chatList.current.scrollHeight > chatList.current.clientHeight + 1);
			}
		};
		measureOverflow();
		const observer = new ResizeObserver(measureOverflow);
		if (projectList.current) observer.observe(projectList.current);
		if (chatList.current) observer.observe(chatList.current);
		return () => observer.disconnect();
	}, [chatInstances, showAllSessions, showAllSpaces, spaces]);

	useEffect(() => {
		if (isUserManuallyScrolledUp.current) return;
		let rafId: number;
		let count = 0;
		const tick = () => {
			if (!isUserManuallyScrolledUp.current) {
				forceScrollToBottom();
			}
			count++;
			if (count < 8) {
				rafId = window.requestAnimationFrame(tick);
			}
		};
		rafId = window.requestAnimationFrame(tick);
		return () => window.cancelAnimationFrame(rafId);
	}, [messageSignature, forceScrollToBottom]);

	useEffect(() => {
		const target = chatView.current;
		if (!target) return;
		const observer = new ResizeObserver(() => {
			if (!isUserManuallyScrolledUp.current) {
				autoFollow.current = true;
				forceScrollToBottom();
			}
		});
		observer.observe(target);
		return () => observer.disconnect();
	}, [forceScrollToBottom]);

	function handleFeedWheel(event: WheelEvent<HTMLElement>): void {
		if (event.deltaY < -2) {
			// User is actively scrolling UP to inspect past history
			initialScrollSettleUntil.current = 0;
			isUserManuallyScrolledUp.current = true;
			autoFollow.current = false;
			setShowScrollToBottom(true);
		} else if (event.deltaY > 2) {
			// User is scrolling DOWN towards bottom
			const feed = feedScroll.current;
			if (feed) {
				const distance = feed.scrollHeight - feed.scrollTop - feed.clientHeight;
				if (distance < 70) {
					isUserManuallyScrolledUp.current = false;
					autoFollow.current = true;
					setShowScrollToBottom(false);
				}
			}
		}
	}

	function handleFeedScroll(): void {
		const feed = feedScroll.current;
		if (!feed) return;
		// 滚动超过阈值时收窄顶部态势头，把空间让给内容
		const nextCollapsed = feed.scrollTop > 40;
		setHeadCollapsed((prev) => (prev === nextCollapsed ? prev : nextCollapsed));
		const distance = feed.scrollHeight - feed.scrollTop - feed.clientHeight;
		const isAwayFromBottom = distance > 120;

		if (Date.now() < initialScrollSettleUntil.current) {
			// During initial load / transition, layout reflows should stay locked to bottom
			if (isAwayFromBottom && !isUserManuallyScrolledUp.current) {
				feed.scrollTop = feed.scrollHeight;
				return;
			}
		}

		if (distance <= 40) {
			// Reached the bottom
			isUserManuallyScrolledUp.current = false;
			autoFollow.current = true;
			setShowScrollToBottom(false);
		} else if (isUserManuallyScrolledUp.current) {
			setShowScrollToBottom(true);
		} else {
			// Content grew or layout shifted without user scrolling up: keep pinned to bottom
			if (autoFollow.current) {
				feed.scrollTop = feed.scrollHeight;
				setShowScrollToBottom(false);
			} else {
				setShowScrollToBottom(isAwayFromBottom);
			}
		}
	}

	function scrollToBottom(smooth?: boolean | unknown): void {
		const isSmooth = smooth !== false;
		isUserManuallyScrolledUp.current = false;
		autoFollow.current = true;
		initialScrollSettleUntil.current = Date.now() + 1000;
		setShowScrollToBottom(false);
		forceScrollToBottom(isSmooth);
	}

	async function addFiles(files: File[]): Promise<void> {
		if (files.length === 0) return;
		setAttachmentNotice(undefined);
		const imageFiles = files.filter((file) => SUPPORTED_IMAGE_TYPES.has(file.type));
		const documentFiles = files.filter((file) => !SUPPORTED_IMAGE_TYPES.has(file.type) && isDocumentFile(file));
		if (imageFiles.length + documentFiles.length !== files.length) {
			setAttachmentNotice("仅支持 PNG、JPEG、GIF、WebP、PDF、DOCX 和文本类文档");
		}
		const availableImages = MAX_IMAGE_ATTACHMENTS - attachments.length;
		const availableDocuments = MAX_DOCUMENT_ATTACHMENTS - documents.length;
		try {
			const preparedImages: ImageAttachment[] = [];
			let totalImageBytes = attachments.reduce((total, image) => total + image.data.length, 0);
			for (const file of imageFiles.slice(0, Math.max(0, availableImages))) {
				const image = await prepareImageAttachment(file);
				if (totalImageBytes + image.data.length > MAX_TOTAL_IMAGE_BASE64_BYTES) {
					throw new Error("图片总大小不能超过 12 MB");
				}
				totalImageBytes += image.data.length;
				preparedImages.push(image);
			}
			const preparedDocuments: DocumentAttachment[] = [];
			let totalDocumentBytes = documents.reduce((total, document) => total + document.text.length, 0);
			for (const file of documentFiles.slice(0, Math.max(0, availableDocuments))) {
				const document = await prepareDocumentAttachment(file, desktopApi.extractDocumentText);
				if (totalDocumentBytes + document.text.length > MAX_TOTAL_DOCUMENT_TEXT_BYTES) {
					throw new Error("文档总大小不能超过 4 MB");
				}
				totalDocumentBytes += document.text.length;
				preparedDocuments.push(document);
			}
			if (imageFiles.length > availableImages) {
				setAttachmentNotice(`每条消息最多附加 ${MAX_IMAGE_ATTACHMENTS} 张图片`);
			} else if (documentFiles.length > availableDocuments) {
				setAttachmentNotice(`每条消息最多附加 ${MAX_DOCUMENT_ATTACHMENTS} 个文档`);
			}
			if (preparedImages.length > 0) setAttachments((current) => [...current, ...preparedImages]);
			if (preparedDocuments.length > 0) setDocuments((current) => [...current, ...preparedDocuments]);
		} catch (caught) {
			setAttachmentNotice(caught instanceof Error ? caught.message : String(caught));
		}
	}

	function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>): void {
		const files = Array.from(event.clipboardData.files);
		if (files.length === 0) return;
		event.preventDefault();
		void addFiles(files);
	}

	async function addWorkspaceFile(path: string): Promise<void> {
		if (!workspace) {
			setAttachmentNotice("请先选择一个工作区");
			return;
		}
		if (documents.some((document) => document.path === path)) {
			setContextPickerOpen(false);
			return;
		}
		if (documents.length >= MAX_DOCUMENT_ATTACHMENTS) {
			setAttachmentNotice(`每条消息最多附加 ${MAX_DOCUMENT_ATTACHMENTS} 个文档`);
			return;
		}
		try {
			const file = await desktopApi.readWorkspaceFile(workspace, path);
			const totalDocumentBytes = documents.reduce((total, document) => total + document.text.length, 0);
			if (totalDocumentBytes + file.text.length > MAX_TOTAL_DOCUMENT_TEXT_BYTES) {
				throw new Error("文档总大小不能超过 4 MB");
			}
			setDocuments((current) => [
				...current,
				{
					id: crypto.randomUUID(),
					name: file.path.split(/[\\/]/).at(-1) ?? file.path,
					path: file.path,
					text: file.text,
				},
			]);
			setAttachmentNotice(undefined);
			setContextPickerOpen(false);
		} catch (caught) {
			setAttachmentNotice(caught instanceof Error ? caught.message : String(caught));
		}
	}

	async function selectProject(): Promise<void> {
		const selectedWorkspace = await desktopApi.selectWorkspace(workspace);
		if (selectedWorkspace) onNewProjectSession(selectedWorkspace);
	}

	async function handleLocalSlash(raw: string): Promise<boolean> {
		const message = raw.trim();
		const [cmd, ...argsArr] = message.split(/\s+/);
		const args = argsArr.join(" ").trim();
		const lowerCmd = cmd.toLowerCase();

		if (lowerCmd === "/clear" || lowerCmd === "/清屏" || lowerCmd === "/清空") {
			onNewConversation();
			setAttachmentNotice("已开启新会话");
			return true;
		}
		if (lowerCmd === "/compact" || lowerCmd === "/压缩") {
			setAttachmentNotice("正在压缩上下文并提炼结构化检查点…");
			if (conversation?.instance?.id) {
				desktopApi
					.compactConversation(conversation.instance.id, args || undefined)
					.then(() => {
						setAttachmentNotice("上下文已完成结构化压缩并保存检查点");
					})
					.catch((err) => {
						setAttachmentNotice(`压缩失败：${err instanceof Error ? err.message : String(err)}`);
					});
			}
			return true;
		}
		if (lowerCmd === "/model" || lowerCmd === "/模型") {
			if (args) {
				const match = modelOptions.find(
					(m) =>
						m.id.toLowerCase().includes(args.toLowerCase()) ||
						m.name.toLowerCase().includes(args.toLowerCase()) ||
						m.provider.toLowerCase().includes(args.toLowerCase()),
				);
				if (match) {
					onModelChange(match);
					setAttachmentNotice(`已切换模型为：${match.name} (${match.provider})`);
					return true;
				}
			}
			setModelMenuOpen(true);
			return true;
		}
		if (lowerCmd === "/thinking" || lowerCmd === "/思考") {
			const levels: ThinkingLevel[] = ["off", "low", "medium", "high"];
			const cur = conversation?.state.thinkingLevel ?? "off";
			if (args && (levels as string[]).includes(args.toLowerCase())) {
				const target = args.toLowerCase() as ThinkingLevel;
				onThinkingLevelChange(target);
				setAttachmentNotice(`思考强度已切换为：${target}`);
				return true;
			}
			const nextIdx = (levels.indexOf(cur as any) + 1) % levels.length;
			const nextLevel = levels[nextIdx];
			onThinkingLevelChange(nextLevel);
			setAttachmentNotice(`思考强度已切换为：${nextLevel}`);
			return true;
		}
		if (lowerCmd === "/fast" || lowerCmd === "/快速") {
			onThinkingLevelChange("off");
			setAttachmentNotice("已切换至快速模式（关闭深度思考）");
			return true;
		}
		if (lowerCmd === "/deep" || lowerCmd === "/深度") {
			onThinkingLevelChange("high");
			setAttachmentNotice("已切换至深度推理模式（Thinking: high）");
			return true;
		}
		if (lowerCmd === "/mode" || lowerCmd === "/模式") {
			if (args.includes("code") || args.includes("cwork") || args.includes("编程")) {
				onAppModeChange("code");
				setAttachmentNotice("已切换至 CWork 编程工作区模式");
				return true;
			}
			if (args.includes("personal") || args.includes("助理")) {
				onAppModeChange("personal");
				setAttachmentNotice("已切换至 Personal 助理模式");
				return true;
			}
			if (args.includes("chat") || args.includes("对话")) {
				onAppModeChange("chat");
				setAttachmentNotice("已切换至 Chat 对话模式");
				return true;
			}
			const nextMode = appMode === "chat" ? "personal" : appMode === "personal" ? "code" : "chat";
			onAppModeChange(nextMode);
			setAttachmentNotice(`已切换应用模式为：${nextMode.toUpperCase()}`);
			return true;
		}
		if (lowerCmd === "/rename" || lowerCmd === "/重命名") {
			if (args && conversation?.instance?.id) {
				desktopApi.renameConversation(conversation.instance.id, args).then(() => {
					setAttachmentNotice(`会话已重命名为：${args}`);
				}).catch(() => {});
				return true;
			}
			onRenameConversation?.(conversation?.instance ?? selectedInstance);
			return true;
		}
		if (lowerCmd === "/copy" || lowerCmd === "/复制") {
			const msgs = conversation?.messages ?? [];
			const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant");
			if (lastAssistant) {
				const txt = contentText(lastAssistant.content);
				navigator.clipboard.writeText(txt).catch(() => {});
				setAttachmentNotice("已复制最后一条回复内容");
			} else {
				setAttachmentNotice("暂无可复制的回复内容");
			}
			return true;
		}
		if (lowerCmd === "/stats" || lowerCmd === "/统计") {
			const inTokens = stats?.tokens?.input ?? 0;
			const outTokens = stats?.tokens?.output ?? 0;
			const cacheR = stats?.tokens?.cacheRead ?? 0;
			const toolsUsed = stats?.toolCalls ?? 0;
			setAttachmentNotice(`会话统计：输入 ${inTokens} | 输出 ${outTokens} | 缓存命中 ${cacheR} | 工具调用 ${toolsUsed} 次`);
			return true;
		}
		if (lowerCmd === "/export" || lowerCmd === "/导出") {
			onExportConversation?.();
			return true;
		}
		if (lowerCmd === "/new" || lowerCmd === "/新建") {
			onNewConversation();
			return true;
		}
		if (lowerCmd === "/help" || lowerCmd === "/帮助") {
			setAttachmentNotice("快捷命令：/清屏 /压缩 /模型 /思考 /快速 /深度 /模式 /重命名 /导出 /复制 /统计 /记住 /任务 /能力 /技能 /mcp /市场 /运行时");
			return true;
		}
		if (lowerCmd === "/remember" || lowerCmd === "/记住") {
			if (!args) {
				setAttachmentNotice("用法：/记住 要记住的内容");
				return true;
			}
			await onRemember(args);
			setAttachmentNotice("已写入长期记忆库");
			return true;
		}
		if (lowerCmd === "/task" || lowerCmd === "/任务") {
			onCreateTaskFromChat(args || "定期检查并汇报工作区进展");
			return true;
		}
		if (lowerCmd === "/web" || lowerCmd === "/搜索") {
			if (args) {
				await onSend(`使用 web_search 搜索：${args}`, [], []);
			} else {
				setDraft("/搜索 ");
				draftInput.current?.focus();
			}
			return true;
		}
		if (lowerCmd === "/fetch" || lowerCmd === "/抓取") {
			if (args) {
				await onSend(`使用 web_fetch 抓取网页：${args}`, [], []);
			} else {
				setDraft("/抓取 ");
				draftInput.current?.focus();
			}
			return true;
		}
		if (lowerCmd === "/code" || lowerCmd === "/代码搜索") {
			if (args) {
				await onSend(`使用 code_search 检索代码：${args}`, [], []);
			} else {
				setDraft("/代码搜索 ");
				draftInput.current?.focus();
			}
			return true;
		}
		if (lowerCmd === "/kb" || lowerCmd === "/知识库") {
			if (args) {
				await onSend(`使用 kb_query 查询知识库：${args}`, [], []);
			} else {
				setDraft("/知识库 ");
				draftInput.current?.focus();
			}
			return true;
		}
		if (lowerCmd === "/browser" || lowerCmd === "/浏览器") {
			if (args) {
				await onSend(`使用 browser 工具访问：${args}`, [], []);
			} else {
				setDraft("/浏览器 ");
				draftInput.current?.focus();
			}
			return true;
		}
		if (lowerCmd === "/github" || lowerCmd === "/仓库") {
			if (args) {
				await onSend(`使用 github 工具查询：${args}`, [], []);
			} else {
				setDraft("/仓库 ");
				draftInput.current?.focus();
			}
			return true;
		}
		if (lowerCmd === "/skills" || lowerCmd === "/技能" || lowerCmd === "/mcp" || lowerCmd === "/market" || lowerCmd === "/市场" || lowerCmd === "/settings" || lowerCmd === "/设置") {
			onNavigate("capabilities");
			return true;
		}
		if (lowerCmd === "/git" || lowerCmd === "/版本管理" || lowerCmd === "/分支") {
			onNavigate("git");
			return true;
		}

		for (const item of LOCAL_SLASH) {
			const match = message.match(item.match);
			if (!match) continue;
			if (item.kind === "nav") {
				const navMap: Record<string, ChatNavView> = {
					memory: "memory",
					tasks: "tasks",
					capabilities: "capabilities",
					intelligence: "intelligence",
					daemon: "daemon",
					git: "git",
				};
				const target = navMap[item.id] || "capabilities";
				onNavigate(target);
				return true;
			}
		}
		return false;
	}

	function applySlashItem(item: { id: string; label: string; insert: string }): void {
		const local = LOCAL_SLASH.find((entry) => entry.id === item.id);
		if (local?.kind === "nav") {
			void handleLocalSlash(item.label);
			setDraft("");
			setSlashOpen(false);
			return;
		}
		if (
			local?.id === "clear" ||
			local?.id === "compact" ||
			local?.id === "export" ||
			local?.id === "new" ||
			local?.id === "model" ||
			local?.id === "thinking" ||
			local?.id === "fast" ||
			local?.id === "deep" ||
			local?.id === "mode" ||
			local?.id === "copy" ||
			local?.id === "stats" ||
			local?.id === "help"
		) {
			void handleLocalSlash(item.label);
			setDraft("");
			setSlashOpen(false);
			return;
		}
		if (local?.id === "task") {
			onCreateTaskFromChat("");
			setDraft("");
			setSlashOpen(false);
			return;
		}
		if (local?.id === "rename") {
			setDraft("/重命名 ");
		} else if (local?.id === "remember") {
			setDraft("/记住 ");
		} else if (local?.id === "web") {
			setDraft("/搜索 ");
		} else if (local?.id === "fetch") {
			setDraft("/抓取 ");
		} else if (local?.id === "code") {
			setDraft("/代码搜索 ");
		} else if (local?.id === "kb") {
			setDraft("/知识库 ");
		} else if (local?.id === "browser") {
			setDraft("/浏览器 ");
		} else if (local?.id === "github") {
			setDraft("/仓库 ");
		} else {
			setDraft(item.insert);
		}
		setSlashOpen(false);
		draftInput.current?.focus();
	}

	const submit = async (): Promise<void> => {
		const message = draft.trim();
		if ((!message && attachments.length === 0 && documents.length === 0) || isWorking) return;
		const activeKey = selectedInstanceId ?? "__new_draft__";
		if (message.startsWith("/") && attachments.length === 0 && (await handleLocalSlash(message))) {
			draftStore.clearDraft(activeKey);
			setDraft("");
			setSlashOpen(false);
			return;
		}

		(document.activeElement as HTMLElement)?.blur();
		draftInput.current?.focus();
		isUserManuallyScrolledUp.current = false;
		autoFollow.current = true;
		setShowScrollToBottom(false);
		pulseScrollToBottom();
		await onSend(message, attachments, documents);
		draftStore.clearDraft(activeKey);
		setDraft("");
		setAttachments([]);
		setDocuments([]);
		setAttachmentNotice(undefined);
	};

	const submitSteer = async (): Promise<void> => {
		const message = draft.trim();
		if (!message && attachments.length === 0 && documents.length === 0) return;
		const activeKey = selectedInstanceId ?? "__new_draft__";
		isUserManuallyScrolledUp.current = false;
		autoFollow.current = true;
		setShowScrollToBottom(false);
		pulseScrollToBottom();
		if (onSteer) {
			await onSteer(message, attachments);
		} else {
			await onSend(message, attachments, documents);
		}
		draftStore.clearDraft(activeKey);
		setDraft("");
		setAttachments([]);
		setDocuments([]);
		setAttachmentNotice(undefined);
	};

	const submitFollowUp = async (): Promise<void> => {
		const message = draft.trim();
		if (!message && attachments.length === 0 && documents.length === 0) return;
		const activeKey = selectedInstanceId ?? "__new_draft__";
		if (onFollowUp) {
			await onFollowUp(message, attachments);
		} else {
			await onSend(message, attachments, documents);
		}
		draftStore.clearDraft(activeKey);
		setDraft("");
		setAttachments([]);
		setDocuments([]);
		setAttachmentNotice(undefined);
	};

	const shouldShowInspector =
		contextPanelOpen &&
		activeView !== "capabilities" &&
		activeView !== "memory" &&
		activeView !== "goals" &&
		activeView !== "projects" &&
		activeView !== "activity" &&
		activeView !== "agent" &&
		activeView !== "today";

	return (
		<div
			className={`reference-workspace personal-assistant-theme ${sidebarOpen === false ? "left-collapsed" : ""} ${!shouldShowInspector ? "context-collapsed" : ""} ${isWorking ? "agent-executing" : ""}`}
		>

			<aside className="pa-sidebar">
				{/*
				 * macOS 的红黄绿交通灯由系统原生绘制（titleBarStyle: "Overlay" +
				 * decorations: true），这里只保留一条同高度的拖拽留白，避免品牌头
				 * 与原生按钮重叠。**不要在这里再画一套假圆点** —— 会与原生按钮错位
				 * 叠成两排（实测 6 个圆点）。
				 */}
				<div className="pa-window-controls" aria-hidden="true" />

				{/* Brand Header */}
				<div className="pa-brand-header" onClick={() => onNavigate("today")}>
					<div className="pa-brand-icon">
						<Bot size={20} />
					</div>
					<div className="pa-brand-text">
						<span className="pa-brand-title">OpenPI</span>
						<span className="pa-brand-subtitle">个人助理</span>
					</div>
				</div>

				{/* Primary Navigation */}
				<nav className="pa-nav-group">
					<div
						className={`pa-nav-item ${activeView === "today" ? "active" : ""}`}
						onClick={() => onNavigate("today")}
					>
						<Home size={16} />
						<span>今日</span>
					</div>
					<div
						className={`pa-nav-item ${activeView === "chat" ? "active" : ""}`}
						onClick={() => onNavigate("chat")}
					>
						<MessageSquare size={16} />
						<span>对话</span>
					</div>
					<div
						className={`pa-nav-item ${activeView === "goals" ? "active" : ""}`}
						onClick={() => onNavigate("goals")}
					>
						<Target size={16} />
						<span>目标</span>
					</div>
					<div
						className={`pa-nav-item ${activeView === "projects" ? "active" : ""}`}
						onClick={() => onNavigate("projects")}
					>
						<Folder size={16} />
						<span>项目</span>
					</div>
					<div
						className={`pa-nav-item ${activeView === "memory" ? "active" : ""}`}
						onClick={() => onNavigate("memory")}
					>
						<BrainCircuit size={16} />
						<span>记忆</span>
					</div>
					<div
						className={`pa-nav-item ${activeView === "activity" || activeView === "git" ? "active" : ""}`}
						onClick={() => onNavigate("activity")}
					>
						<Clock3 size={16} />
						<span>活动</span>
					</div>
					<div
						className={`pa-nav-item ${activeView === "agent" ? "active" : ""}`}
						onClick={() => onNavigate("agent")}
					>
						<Shield size={16} />
						<span>智能体</span>
					</div>
				</nav>

				{/* Scrollable Project and Conversation Sections */}
				<div className="pa-sidebar-scroll">
					{/* 1. Projects Section (项目工程) */}
					<div className="pa-sidebar-section">
						<div className="pa-section-header">
							<span className="pa-section-title">项目工程 ({spaces.length})</span>
							<button
								type="button"
								className="pa-section-action-btn"
								title="选择或打开其他项目工程"
								aria-label="选择或打开其他项目工程"
								onClick={() => void selectProject()}
							>
								<FolderPlus size={13} />
							</button>
						</div>
						<div className="pa-project-list" ref={projectList}>
							{spaces.map(([cwd, spaceInstances]) => {
								const isCollapsed = Boolean(collapsedProjects[cwd]);
								const projectName = cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? cwd;
								const isProjectActive = spaceInstances.some((instance) => instance.id === selectedInstanceId);
								return (
									<div className={`pa-project-group ${isProjectActive ? "project-active" : ""}`} key={cwd}>
										<div className="pa-project-row">
											<button
												type="button"
												className="pa-project-toggle-btn"
												title={isCollapsed ? "展开项目会话" : "收起项目会话"}
												onClick={(e) => toggleProjectCollapsed(cwd, e)}
											>
												{isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
											</button>
											<div
												className="pa-project-meta"
												title={cwd}
												onClick={() => {
													const targetInstance =
														spaceInstances.find((instance) => instance.id === selectedInstanceId) ??
														spaceInstances[0];
													if (targetInstance) onOpenProject(targetInstance.id);
												}}
											>
												<Folder size={13} className="pa-project-folder-icon" />
												<span className="pa-project-name">{projectName}</span>
											</div>
											<div className="pa-project-row-actions">
												<button
													type="button"
													className="pa-project-add-session-btn"
													title="新建此项目会话"
													onClick={(e) => {
														e.stopPropagation();
														onNewProjectSession(cwd);
													}}
												>
													<Plus size={11} />
												</button>
											</div>
										</div>

										{!isCollapsed && (
											<div className="pa-project-sessions">
												{spaceInstances.map((instance) => {
													const isSelected = instance.id === selectedInstanceId;
													const sessionTitle = instanceTitle(instance, conversationTitles[instance.id]);
													return (
														<div
															key={instance.id}
															className={`pa-project-session-item ${isSelected ? "active" : ""}`}
															onClick={() => {
																if (instance.id === selectedInstanceId) scrollToBottom(true);
																onOpenProject(instance.id);
															}}
														>
															<div className="pa-session-item-left">
																<MessageSquare size={12} className="pa-session-icon" />
																{isSelected && <span className="pa-active-dot" />}
																<span title={sessionTitle}>{sessionTitle}</span>
															</div>
															<div className="pa-recent-actions">
																<button
																	type="button"
																	className="pa-item-action-btn"
																	title="重命名"
																	onClick={(e) => {
																		e.stopPropagation();
																		onRenameConversation?.(instance);
																	}}
																>
																	<Pencil size={11} />
																</button>
																<button
																	type="button"
																	className="pa-item-action-btn danger"
																	title="删除"
																	onClick={(e) => {
																		e.stopPropagation();
																		onDeleteConversation?.(instance);
																	}}
																>
																	<Trash2 size={11} />
																</button>
															</div>
														</div>
													);
												})}
											</div>
										)}
									</div>
								);
							})}
							{spaces.length === 0 && (
								<div className="pa-empty-hint">暂无项目</div>
							)}
						</div>
					</div>

					{/* 2. Conversations Section (最近会话) */}
					<div className="pa-sidebar-section">
						<div className="pa-section-header">
							<span className="pa-section-title">最近会话 ({filteredChats.length})</span>
							<button
								type="button"
								className="pa-section-action-btn"
								title="新建通用会话"
								aria-label="新建通用会话"
								onClick={() => {
									onNewConversation();
									draftInput.current?.focus();
								}}
							>
								<Plus size={13} />
							</button>
						</div>
						<div className="pa-recent-list" ref={chatList}>
							{filteredChats.map((instance) => {
								const isSelected = instance.id === selectedInstanceId;
								const titleText = instanceTitle(instance, conversationTitles[instance.id]);
								return (
									<div
										key={instance.id}
										className={`pa-recent-item ${isSelected ? "active" : ""}`}
										onClick={() => {
											if (instance.id === selectedInstanceId) {
												scrollToBottom(true);
											}
											onSelectConversation(instance.id);
										}}
									>
										<div className="pa-recent-item-left">
											<MessageSquare size={12} className="pa-session-icon" />
											{isSelected && <span className="pa-active-dot" />}
											<span title={titleText}>{titleText}</span>
										</div>
										<div className="pa-recent-actions">
											<button
												type="button"
												className="pa-item-action-btn"
												title="重命名"
												onClick={(e) => {
													e.stopPropagation();
													onRenameConversation?.(instance);
												}}
											>
												<Pencil size={11} />
											</button>
											<button
												type="button"
												className="pa-item-action-btn danger"
												title="删除"
												onClick={(e) => {
													e.stopPropagation();
													onDeleteConversation?.(instance);
												}}
											>
												<Trash2 size={11} />
											</button>
										</div>
									</div>
								);
							})}
							{filteredChats.length === 0 && (
								<div className="pa-empty-hint">暂无会话</div>
							)}
						</div>
					</div>
				</div>

				{/* User Profile Footer */}
				<Popover>
					<PopoverTrigger asChild>
						<div className="pa-profile-footer" title="点击打开个人画像与系统设置">
							<div className="pa-profile-left">
								<div className="pa-profile-avatar">
									<img src="/assets/jane-avatar.jpg" alt="简华安" />
								</div>
								<span className="pa-profile-name">{userProfile?.nickname || "简华安"}</span>
							</div>
							<ChevronRight size={14} color="var(--text-tertiary)" />
						</div>
					</PopoverTrigger>
					<PopoverContent className="today-os-profile-popover" side="top" align="start">
						<div className="today-os-profile-popover-header">
							<div className="today-os-popover-avatar">
								<img src="/assets/jane-avatar.jpg" alt="简华安" />
							</div>
							<div>
								<div className="today-os-popover-name">{userProfile?.nickname || "简华安"}</div>
								<div className="today-os-popover-desc">OpenPI 个人助理 · 在线</div>
							</div>
						</div>
						<div className="today-os-profile-popover-divider" />
						<button
							type="button"
							className="today-os-popover-item"
							onClick={onOpenAccount}
						>
							<User size={14} />
							<span>个人画像与档案</span>
						</button>
						<button
							type="button"
							className="today-os-popover-item"
							onClick={onOpenSettings}
						>
							<Settings size={14} />
							<span>系统与模型设置</span>
						</button>
						<button
							type="button"
							className="today-os-popover-item"
							onClick={() => onNavigate("memory")}
						>
							<BookOpen size={14} />
							<span>长期记忆中枢</span>
						</button>
					</PopoverContent>
				</Popover>
			</aside>

			<main className="reference-main">
				{customContent ? (
					<div className="reference-custom-container">
						{sidebarOpen === false && onToggleSidebar && (
							<button
								type="button"
								className="reference-floating-toggle-sidebar"
								title="展开侧边栏 (⌘B)"
								aria-label="展开侧边栏"
								onClick={onToggleSidebar}
							>
								<PanelLeftOpen size={16} />
							</button>
						)}
						<ErrorBoundary fallbackView={() => onNavigate?.("chat")}>
							{customContent}
						</ErrorBoundary>
					</div>
				) : (
					<>
						{/* dots 式常驻 Agent 形象（问候 + 实时状态 + 最近活动） */}
						<div className="pa-presence-wrap">
							<AgentPresenceCard
								agentName="OpenPI"
								status={agentStatus}
								detail={agentStatusDetail}
								weather="26°C 新加坡"
								dateText={formattedDateTime}
								activity={agentActivity}
								bubble={agentBubble}
							/>
						</div>

				{/* 今天的重点 */}
				<div className={`pa-focus-container${headCollapsed ? " collapsed" : ""}`}>
					<div className="pa-focus-header">
						<Sparkles size={14} color="var(--accent)" />
						<span>今天的重点</span>
						<span className="pa-focus-summary">OpenPI 架构改造 72% · 2 项待办</span>
					</div>
					<div className="pa-focus-cards">
						<div
							className="pa-focus-card"
							onClick={() => {
								setDraft("推进主线目标【OpenPI 架构改造】的下一步计划。");
								draftInput.current?.focus();
							}}
						>
							<div className="pa-focus-card-top">
								<div className="pa-focus-card-title-row">
									<span className="pa-focus-dot blue" />
									<span>OpenPI 架构改造</span>
								</div>
								<ChevronRight size={13} color="#94a3b8" />
							</div>
							<div className="pa-focus-card-body">
								已完成 72% · 下一步: 熔断器模型
							</div>
						</div>

						<div
							className="pa-focus-card"
							onClick={() => onNavigate("activity")}
						>
							<div className="pa-focus-card-top">
								<div className="pa-focus-card-title-row">
									<span className="pa-focus-dot green" />
									<span>2 个任务已完成</span>
								</div>
								<Check size={13} color="#10b981" />
							</div>
							<div className="pa-focus-card-body">
								构建检查通过 · 测试全绿
							</div>
						</div>

						<div
							className="pa-focus-card"
							onClick={() => {
								setDraft("请展示需要我确认的决策方案。");
								draftInput.current?.focus();
							}}
						>
							<div className="pa-focus-card-top">
								<div className="pa-focus-card-title-row">
									<span className="pa-focus-dot orange" />
									<span>需要你确认</span>
								</div>
								<AlertCircle size={13} color="#f59e0b" />
							</div>
							<div className="pa-focus-card-body">
								决策待裁决: 熔断降级策略
							</div>
						</div>
					</div>
				</div>

				<div className="workspace-preview-split-container">
					<div className="workspace-preview-chat-pane">
						<section className="reference-feed" ref={feedScroll} onScroll={handleFeedScroll} onWheel={handleFeedWheel}>
							<div className="reference-chat-view" ref={chatView}>
						<TodoPanel state={todoState} />
						{feedItems.length === 0 && (
							<div className="reference-draft-welcome">
								<div className="reference-draft-hero">
									<div className="reference-draft-icon">
										<Sparkles size={28} />
									</div>
									<h2>开启新对话</h2>
									<p>输入提示词并发送以启动对话，支持代码编辑、多轮推理与本地工具调用。</p>
								</div>
							</div>
						)}
						{feedItems.map((item) => {
							if (item.kind === "user") {
								const text = visibleMessageText(contentText(item.message.content));
								const images = contentImages(item.message.content);
								const isEphemeral = text.includes("Ephemeral Subagent Directive") || text.startsWith("【Ephemeral");
								let directiveRole = "";
								let directiveObjective = "";
								if (isEphemeral) {
									const roleMatch = text.match(/(?:Role|角色)[:：]\s*([^\n\r]+)/i);
									const objMatch = text.match(/(?:Objective|目标)[:：]\s*([^\n\r.]+)/i);
									directiveRole = roleMatch ? roleMatch[1].trim() : "独立评审员";
									directiveObjective = objMatch ? objMatch[1].trim() : "执行独立后台子任务";
								}
								return (
									<Fragment key={`${item.message.timestamp ?? "untimed"}-user-${item.index}`}>
										{item.turnNumber > 1 && (
											<div className="reference-turn-separator">
												<span className="turn-separator-badge">第 {item.turnNumber} 轮对话</span>
											</div>
										)}
										<div className="reference-message-row user">
											<div className="reference-user-bubble-wrapper">
												{text && !isEphemeral && (
													<UserMessageActions text={text} onRemember={onRemember} />
												)}
												{isEphemeral ? (
													<div className="reference-user-card ephemeral-directive-card">
														<div className="ephemeral-directive-header">
															<span className="ephemeral-directive-tag">🤖 后台自主子智能体指令</span>
															{directiveRole && <span className="ephemeral-directive-role">{directiveRole}</span>}
														</div>
														<div className="ephemeral-directive-objective">
															<strong>核心任务：</strong>{directiveObjective}
														</div>
														<details className="ephemeral-directive-details">
															<summary>查看详细提示词规范</summary>
															<div className="ephemeral-directive-content">{text}</div>
														</details>
													</div>
												) : (
													<div
														className={`reference-user-card ${item.message === optimisticMessage ? "pending" : ""} ${!text && images.length > 0 ? "image-only" : ""}`}
													>
														{text && <p>{text}</p>}
														{hasVisionContext(item.message.content) && (
															<span className="reference-vision-badge">
																<ImageIcon size={12} /> GLM-4.6V 视觉解析
															</span>
														)}
														{images.length > 0 && <MessageImages images={images} />}
													</div>
												)}
											</div>
										</div>
									</Fragment>
								);
							}

							if (item.kind === "actions") {
								const isLastActions = item.id === lastActionsId;
								const isLatestActions = isLastActions && feedItems[feedItems.length - 1]?.kind === "actions";
								return (
									<div className="reference-message-row actions" key={item.id}>
										<div className="reference-activity-chain-wrap">
											{isWorking && isLastActions && (
												<AgentWorkingActivityCard
													goal={activeGoal.title}
													intent="根据长程目标推演架构约束，调度受控执行网关"
													decision="保持 Execution Core 零污染，通过统一安全网关分发执行"
													activities={[
														{ title: "检查网关预算与超时限额 (≤60s)", status: "completed" },
														{ title: "执行代码分析与上下文巡检", status: runningTools.length > 0 ? "running" : "completed" },
														{ title: "双盲质量评审与不变量校验", status: "pending" },
													]}
												/>
											)}
											{item.reasoning && (
												<ReasoningBlock reasoning={item.reasoning} isWorking={isWorking && isLastActions} />
											)}
											{(item.actions.length > 0 || (isLatestActions && isWorking && runningTools.length > 0)) && (
												<AgentActionChain
													actions={item.actions}
													runningTools={isLatestActions && isWorking ? runningTools : []}
													isWorking={isWorking && isLastActions}
													workspaceCwd={workspace}
												/>
											)}
										</div>
									</div>
								);
							}

							if (item.kind === "assistant") {
								const text = visibleMessageText(contentText(item.message.content));
								const outcome = !isWorking ? parseAgentOutcome(text) : null;
								const briefParsed = !outcome && !isWorking ? parseAnswerBrief(text) : null;
								return (
									<div className="reference-message-row assistant" key={`${item.message.timestamp ?? "untimed"}-assistant-${item.index}`}>
										<div
											className={`reference-assistant-card ${item.message === optimisticMessage ? "pending" : ""}`}
										>
											<div className="agent-identity-meta-bar" style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
												<div style={{ width: "20px", height: "20px", borderRadius: "5px", background: "linear-gradient(135deg, #f97316 0%, #ea580c 100%)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}>
													<Zap size={12} />
												</div>
												<span style={{ fontSize: "12px", fontWeight: 600, color: "#f8fafc" }}>OpenPI Personal Agent</span>
												<span style={{ fontSize: "10.5px", padding: "1px 6px", borderRadius: "4px", background: "rgba(255, 255, 255, 0.05)", color: "#94a3b8" }}>
													{currentModel?.name || "DeepSeek V4.1 Flash"}
												</span>
											</div>
											{item.message.recalledMemories && item.message.recalledMemories.length > 0 && (
												<div className="reference-memory-recall-row">
													<span
														className="reference-memory-recall-badge"
														title={`本轮命中 ${item.message.recalledMemories.length} 条记忆：\n${item.message.recalledMemories
															.map((m) => `• [${m.type}] ${m.key}: ${m.value}`)
															.join("\n")}`}
													>
														<BrainCircuit size={12} />
														<span>命中 {item.message.recalledMemories.length} 条记忆</span>
														<span className="recall-keys">
															({item.message.recalledMemories.map((m) => m.key).slice(0, 3).join(", ")}
															{item.message.recalledMemories.length > 3 ? "…" : ""})
														</span>
													</span>
												</div>
											)}
											{item.reasoning && (
												<ReasoningBlock
													reasoning={item.reasoning}
													isWorking={isWorking && item.isLastAssistantMessage}
													defaultOpen={!text}
												/>
											)}
											{text ? (
												(() => {
													const parsed = outcome;
													if (parsed) {
														return (
															<div className="reference-assistant-message">
																<AgentOutcomeCard
																	outcome={parsed}
																	onActionRun={(actionText) => {
																		setDraft(actionText);
																		draftInput.current?.focus();
																	}}
																	onDecisionChoose={(decisionText) => {
																		void onSend(decisionText, [], []);
																	}}
																/>
															</div>
														);
													}
													if (briefParsed) {
														return (
															<div className="reference-assistant-message">
																<AnswerBriefCard
																	brief={briefParsed}
																	onSuggestion={(s) => {
																		setDraft(s);
																		draftInput.current?.focus();
																	}}
																/>
															</div>
														);
													}
													return (
														<div className="reference-assistant-message">
															<MarkdownText text={text} streaming={isWorking && item.isLastAssistantMessage} />
														</div>
													);
												})()
											) : isWorking && item.isLastAssistantMessage && !item.message.errorMessage ? (
												<div className="reference-streaming-indicator" aria-label="OpenPI 正在组织回复">
													<span />
													<span />
													<span />
												</div>
											) : !isWorking && item.reasoning && !item.message.errorMessage ? (
												<div className="reference-thinking-only-notice">
													<span>💭 模型已完成深度思考推演（上方已展开），未附加最终总结正文。</span>
												</div>
											) : null}
											{contentImages(item.message.content).length > 0 && (
												<MessageImages images={contentImages(item.message.content)} />
											)}
											{item.isLatestAssistant && (
												<ClaudeCodeRecapCard
													suppressRecap={Boolean(outcome || briefParsed)}
													message={item.message}
													lastUserPrompt={lastUserPrompt}
													todoState={todoState}
													onApplySuggestion={(suggestion) => {
														setDraft(suggestion);
														draftInput.current?.focus();
													}}
													onSendSuggestion={(suggestion) => {
														void onSend(suggestion, [], []);
													}}
												/>
											)}
											{item.message.errorMessage && (
												/abort|已停止|cancelled/i.test(item.message.errorMessage) ? (
													<div className="reference-aborted-notice">
														<span className="aborted-dot" />
														<span>生成已终止</span>
														{item.isLatestAssistant && lastUserPrompt && !isWorking && (
															<button
																type="button"
																className="reference-inline-retry-btn"
																onClick={() => void onSend(lastUserPrompt, [], [])}
																title="重新运行当前提问"
															>
																<RotateCcw size={11} />
																<span>重试</span>
															</button>
														)}
													</div>
												) : (
													<div className="reference-error-box">
														<div className="reference-error-text">{item.message.errorMessage}</div>
														{item.isLatestAssistant && lastUserPrompt && !isWorking && (
															<button
																type="button"
																className="reference-error-retry-btn"
																onClick={() => void onSend(lastUserPrompt, [], [])}
																title="重新尝试请求"
															>
																<RotateCcw size={11} />
																<span>重试</span>
															</button>
														)}
													</div>
												)
											)}
											{text && !isWorking && (
												<div className="reference-assistant-footer">
													<AssistantMessageActions
														text={text}
														onRetry={
															item.isLatestAssistant && lastUserPrompt
																? () => void onSend(lastUserPrompt, [], [])
																: undefined
														}
														onQuote={(quoteText) => {
															const snippet = quoteText.length > 180 ? `${quoteText.slice(0, 180)}…` : quoteText;
															setDraft((current) => {
																const quoted = snippet.split("\n").map((line) => `> ${line}`).join("\n");
																return current ? `${current}\n\n${quoted}\n\n` : `${quoted}\n\n`;
															});
															draftInput.current?.focus();
														}}
														onRemember={onRemember ? (rememberText) => void onRemember(rememberText) : undefined}
													/>
												</div>
											)}
										</div>
									</div>
								);
							}

							return null;
						})}
						{runningTools.length > 0 &&
							!(feedItems.length > 0 && feedItems[feedItems.length - 1].kind === "actions") && (
								<div className="reference-activity-chain-wrap">
									<AgentActionChain
										actions={[]}
										runningTools={runningTools}
										isWorking={isWorking}
										workspaceCwd={workspace}
									/>
								</div>
							)}
						<TurnProgressRow progress={turnProgress} isWorking={isWorking} />
						{isWorking && runningTools.length === 0 && !turnProgress && (
							<div className="reference-streaming-indicator" aria-label="OpenPI 正在回复">
								<span />
								<span />
								<span />
							</div>
						)}
						<div
							ref={bottomAnchorRef}
							className="reference-bottom-anchor"
							style={{ height: 1, width: "100%", pointerEvents: "none" }}
						/>
					</div>
				</section>
				<footer className="reference-composer-shelf">
					{showScrollToBottom && (
						<button
							type="button"
							className="reference-scroll-to-bottom"
							title="回到最新消息"
							aria-label="回到最新消息"
							onClick={scrollToBottom}
						>
							<ArrowDown size={16} />
							{isWorking && <span className="scroll-pulse-dot" />}
						</button>
					)}
					{(appMode === "code" || conversation?.instance.mode === "code") &&
						activeAutoPilotTask &&
						activeAutoPilotTask.status !== "merged" &&
						activeAutoPilotTask.status !== "discarded" && (
							<div
								className="code-autopilot-active-bar"
								onClick={() => setAutoPilotOpen(true)}
								title="点击查看 Auto-Pilot 执行流水线、终端日志与变更 Diff"
							>
								<div className="code-autopilot-active-left">
									<Zap size={14} className="text-blue-500 animate-pulse" />
									<span className="code-autopilot-title">
										无人值守任务: {activeAutoPilotTask.prompt.slice(0, 32)}
									</span>
									<span className={`code-autopilot-status-badge status-${activeAutoPilotTask.status}`}>
										{activeAutoPilotTask.status === "ready_for_review"
											? activeAutoPilotTask.discoveredIssues && activeAutoPilotTask.discoveredIssues.length > 0
												? `⚠️ 发现 ${activeAutoPilotTask.discoveredIssues.length} 项问题 (待处理)`
												: "✅ 全维 0 错误完全解决 (交付就绪)"
											: activeAutoPilotTask.status === "testing"
												? "🔍 全维问题雷达扫描中 (编译/测试/构建)"
												: activeAutoPilotTask.status === "diagnosing"
													? `🔄 持续排查与自愈中 (第 ${activeAutoPilotTask.currentIteration}/${activeAutoPilotTask.maxIterations} 轮)...`
													: "⚡ 正在编码实施与自测"}
									</span>
								</div>
								<button type="button" className="code-autopilot-open-btn">
									查看流水线 / 日志 / Diff ➔
								</button>
							</div>
						)}
					<div className="reference-composer">
					{(attachments.length > 0 || documents.length > 0) && (
						<div className="reference-attachment-list" aria-label="已附加内容">
							{attachments.map((attachment) => (
								<div className="reference-attachment-chip image" key={attachment.id}>
									<img src={`data:${attachment.mimeType};base64,${attachment.data}`} alt="" />
									<span>{attachment.name}</span>
									<button
										type="button"
										title={`移除 ${attachment.name}`}
										aria-label={`移除 ${attachment.name}`}
										onClick={() =>
											setAttachments((current) => current.filter((item) => item.id !== attachment.id))
										}
									>
										<X size={12} />
									</button>
								</div>
							))}
							{documents.map((document) => (
								<div
									className="reference-attachment-chip document"
									key={document.id}
									title={document.path ?? document.name}
								>
									{document.path ? <AtSign size={13} /> : <FileText size={13} />}
									<span>{document.path ?? document.name}</span>
									<button
										type="button"
										title={`移除 ${document.name}`}
										aria-label={`移除 ${document.name}`}
										onClick={() =>
											setDocuments((current) => current.filter((item) => item.id !== document.id))
										}
									>
										<X size={12} />
									</button>
								</div>
							))}
						</div>
					)}
					{slashOpen && slashItems.length > 0 && (
						<div className="reference-slash-menu" role="listbox" aria-label="斜杠命令">
							{slashItems.map((item, index) => (
								<button
									type="button"
									key={item.id}
									className={index === slashIndex ? "active" : ""}
									onMouseEnter={() => setSlashIndex(index)}
									onClick={() => applySlashItem(item)}
								>
									<code>{item.label}</code>
									<span>{item.hint}</span>
								</button>
							))}
						</div>
					)}
					<textarea
						ref={draftInput}
						placeholder="有什么可以帮你的吗？"
						rows={1}
						value={draft ?? ""}
						onChange={(event) => setDraft(event.target.value)}
						onPaste={handlePaste}
						onKeyDown={(event) => {
							if (slashOpen && slashItems.length > 0) {
								if (event.key === "ArrowDown") {
									event.preventDefault();
									setSlashIndex((current) => (current + 1) % slashItems.length);
									return;
								}
								if (event.key === "ArrowUp") {
									event.preventDefault();
									setSlashIndex((current) => (current - 1 + slashItems.length) % slashItems.length);
									return;
								}
								if (
									event.key === "Tab" ||
									(event.key === "Enter" && !event.metaKey && !event.ctrlKey && !event.altKey)
								) {
									event.preventDefault();
									applySlashItem(slashItems[slashIndex] ?? slashItems[0]);
									return;
								}
								if (event.key === "Escape") {
									event.preventDefault();
									event.stopPropagation();
									setSlashOpen(false);
									return;
								}
							}
							if (event.key === "Tab" && !draft && topSuggestion && !slashOpen) {
								event.preventDefault();
								setDraft(topSuggestion);
								return;
							}
							if (event.key === "Enter") {
								if (event.nativeEvent.isComposing) {
									return;
								}
								// ⌘/Ctrl+Enter send; plain Enter is newline.
								const isSend = Boolean(event.metaKey || event.ctrlKey);
								if (isSend) {
									event.preventDefault();
									if (isWorking && (draft.trim() || attachments.length > 0 || documents.length > 0)) {
										if (event.shiftKey) {
											void submitFollowUp().catch(() => undefined);
										} else {
											void submitSteer().catch(() => undefined);
										}
									} else {
										void submit().catch(() => undefined);
									}
								}
							}
						}}
					/>
					{attachmentNotice && <p className="reference-attachment-notice">{attachmentNotice}</p>}
					{usesVisionFallback && (
						<p className="reference-attachment-vision">
							<ImageIcon size={12} /> 将由 GLM-4.6V-Flash 解析图片
						</p>
					)}
					<div className="reference-composer-toolbar today-os-dock-tools-row">
						<div className="reference-composer-primary today-os-dock-tools-left">
							<input
								ref={attachmentInput}
								type="file"
								accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.pdf,.docx,.txt,.md,.csv,.json,.yaml,.yml,.xml,.html,.css,.js,.jsx,.mjs,.ts,.tsx,.py,.go,.rs,.java,.c,.cc,.cpp,.h,.sql,.sh,.toml,.svg"
								multiple
								hidden
								onChange={(event) => {
									void addFiles([...(event.target.files ?? [])]);
									event.target.value = "";
								}}
							/>
							{workspace && relatedFiles.length > 0 && (
								<Popover open={contextPickerOpen} onOpenChange={setContextPickerOpen}>
									<PopoverTrigger asChild>
										<button
											type="button"
											className="today-os-icon-btn"
											title="选择工作区文件 (@)"
											aria-label="选择工作区文件"
										>
											@
										</button>
									</PopoverTrigger>
									<PopoverContent className="reference-file-picker" side="top" align="start">
										<Command label="选择工作区文件" loop>
											<CommandInput placeholder="搜索项目文件" />
											<CommandList>
												<CommandEmpty>没有可用的工作区文件</CommandEmpty>
												<CommandGroup heading="工作区文件">
													{relatedFiles.map((path) => (
														<CommandItem
															key={path}
															value={path}
															onSelect={() => void addWorkspaceFile(path)}
														>
															<FileText size={14} />
															<span>{path}</span>
														</CommandItem>
													))}
												</CommandGroup>
											</CommandList>
										</Command>
									</PopoverContent>
								</Popover>
							)}
							<button
								type="button"
								className="today-os-icon-btn"
								title="附加图片或文档"
								aria-label="附加图片或文档"
								onClick={() => attachmentInput.current?.click()}
							>
								<Paperclip size={14} />
							</button>
							<Popover open={modelMenuOpen} onOpenChange={setModelMenuOpen}>
								<PopoverTrigger asChild>
									<div className="today-os-dock-model-pill" style={{ cursor: "pointer" }}>
										<Zap size={11} color="#f97316" />
										<span>
											{shortModelName(
												currentModel?.name ??
													conversation?.state?.model?.name ??
													conversation?.state?.model?.id ??
													defaultOption?.name ??
													"Model",
											)}
										</span>
										{supportsThinking && conversation?.state?.thinkingLevel && conversation.state.thinkingLevel !== "off" && (
											<span style={{ fontSize: "10px", color: "#fb923c" }}>
												· {THINKING_SHORT_ZH[conversation.state.thinkingLevel] ?? conversation.state.thinkingLevel}
											</span>
										)}
										<span style={{ opacity: 0.6 }}>∨</span>
									</div>
								</PopoverTrigger>
								<PopoverContent className="model-popover model-popover-wide" side="top" align="start">
									{supportsThinking && (
										<div className="model-popover-section">
											<span className="model-popover-label">思考强度</span>
											<div className="thinking-row">
												{thinkingLevels.map((level) => (
													<button
														type="button"
														key={level}
														className={
															(conversation?.state?.thinkingLevel ?? getHighestThinkingLevel(currentModel)) === level
																? "active"
																: ""
														}
														disabled={configuring || loadingModels || !currentModel}
														onClick={() => {
															setModelMenuOpen(false);
															onThinkingLevelChange(level);
														}}
													>
														{THINKING_SHORT_ZH[level] ?? level}
													</button>
												))}
											</div>
										</div>
									)}
									<div className="model-popover-section">
										<span className="model-popover-label">模型</span>
										<Command label="选择模型" loop>
											<CommandInput placeholder="搜索模型" />
											<CommandList>
												<CommandEmpty>没有匹配的模型</CommandEmpty>
												{modelGroups.map(([provider, models]) => (
													<CommandGroup heading={provider} key={provider}>
														{models.map((model) => {
															const isCurrent =
																model.provider.toLowerCase() ===
																	(currentModel?.provider ?? conversation?.state?.model?.provider ?? "").toLowerCase() &&
																model.id === (currentModel?.id ?? conversation?.state?.model?.id);
															return (
																<CommandItem
																	value={`${model.provider}/${model.id} ${model.name}`}
																	keywords={[model.name, model.provider, model.id]}
																	key={`${model.provider}/${model.id}`}
																	data-active-model={isCurrent ? "true" : undefined}
																	className={`ui-command-item ${isCurrent ? "model-item-current active" : ""}`}
																	onSelect={() => {
																		setModelMenuOpen(false);
																		onModelChange(model);
																	}}
																	onClick={() => {
																		setModelMenuOpen(false);
																		onModelChange(model);
																	}}
																>
																	<span className="model-option-main">
																		<div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
																			<strong>{model.name}</strong>
																			{modelSupportsReasoning(model) && (
																				<span style={{ fontSize: "10px", padding: "1px 5px", borderRadius: "4px", background: "rgba(99, 102, 241, 0.15)", color: "var(--accent-primary)", fontWeight: 600 }}>
																					🧠 思考
																				</span>
																			)}
																			{model.contextWindow ? (
																				<span style={{ fontSize: "10px", opacity: 0.65 }}>
																					{formatModelContext(model.contextWindow)}
																				</span>
																			) : null}
																		</div>
																		<small>{model.id}</small>
																	</span>
																	{model.supportsImages && (
																		<span className="model-option-vision" title="支持图片输入">
																			<ImageIcon size={13} />
																		</span>
																	)}
																	{isCurrent && <Check size={14} className="model-current-check" />}
																</CommandItem>
															);
														})}
													</CommandGroup>
												))}
											</CommandList>
										</Command>
									</div>
								</PopoverContent>
							</Popover>
							{gitStatus?.isRepo && (
								<div
									className="today-os-dock-model-pill"
									style={{ cursor: "pointer" }}
									title={`当前 Git 分支：${gitStatus.branch} (${gitStatus.files?.length ?? 0} 个变动)`}
									onClick={onOpenGit || (() => onNavigate("git"))}
								>
									<GitBranch size={11} color="#38bdf8" />
									<span>{gitStatus.branch}</span>
									{Boolean(gitStatus.files?.length) && (
										<span style={{ color: "#fb923c" }}>· {gitStatus.files.length}</span>
									)}
								</div>
							)}
						</div>

						<div className="today-os-dock-tools-right">
							{isWorking ? (
								<>
									{draft.trim() || attachments.length > 0 || documents.length > 0 ? (
										<>
											<button
												type="button"
												className="today-os-agent-action-pill"
												style={{ cursor: "pointer", color: "#fb923c", borderColor: "rgba(249, 115, 22, 0.4)" }}
												title="实时干预 Agent (⌘Enter)"
												onClick={() => void submitSteer()}
											>
												<Sparkles size={11} color="#fb923c" />
												<span>干预</span>
											</button>
											<button
												type="button"
												className="today-os-agent-action-pill"
												style={{ cursor: "pointer" }}
												title="排队至下一轮 (⇧⌘Enter)"
												onClick={() => void submitFollowUp()}
											>
												<Clock3 size={11} />
												<span>排队</span>
											</button>
										</>
									) : null}
									<button
										type="button"
										tabIndex={-1}
										className="today-os-send-arrow-btn stop"
										style={{ background: "#ef4444", boxShadow: "0 2px 8px rgba(239, 68, 68, 0.4)" }}
										title="停止生成"
										aria-label="停止生成"
										onClick={handleSafeAbort}
									>
										<Square size={13} fill="#fff" />
									</button>
								</>
							) : (
								<>
									<button
										type="button"
										className="today-os-send-arrow-btn"
										title="发送消息 (⌘Enter)"
										aria-label="发送消息"
										disabled={!draft.trim() && attachments.length === 0 && documents.length === 0}
										onClick={() => void submit()}
									>
										<ArrowUp size={15} />
									</button>
								</>
							)}
						</div>
					</div>
					{extraDataSlot && <div className="today-os-dock-custom-slot">{extraDataSlot}</div>}
				</div>
			</footer>
					</div>
					{livePreviewOpen && (
						<LivePreviewPanel
							isOpen={livePreviewOpen}
							defaultHtml={detectedHtml}
							onClose={() => setLivePreviewOpen(false)}
							onInspectElement={(info) => {
								setDraft((prev) => `${prev ? prev + " " : ""}[针对元素: <${info.selector}>] `);
								draftInput.current?.focus();
							}}
						/>
					)}
					{swarmCanvasOpen && (
						<SwarmCanvas
							workflow={swarmWorkflow}
							isOpen={swarmCanvasOpen}
							onClose={() => setSwarmCanvasOpen(false)}
							onAssignTask={(member) => {
								setDraft((prev) => `${prev ? prev + " " : ""}@${member.role}: `);
								draftInput.current?.focus();
							}}
						/>
					)}
					{autoPilotOpen && (
						<AutoPilotModal
							workspaceCwd={workspace}
							initialPrompt={autoPilotPrompt}
							autoStart={autoPilotAutoStart}
							onClose={() => {
								setAutoPilotOpen(false);
								setAutoPilotAutoStart(false);
								setAutoPilotPrompt("");
							}}
						/>
					)}
				</div>
					</>
				)}
			</main>

			{shouldShowInspector && (
				<ContextInspector
					target={{
						kind: "conversation",
						goalTitle: activeGoal.title,
						projectName: workspace?.split(/[\\/]/).filter(Boolean).at(-1) || "openpi-next",
						state: isWorking ? "正在执行 (Working · 2.4s)" : "空间就绪 (Idle · Ready)",
						recentDecision: "保持 Execution Core 零污染，通过统一安全网关分发执行",
						relevantMemoryCount: memoryCount || 3,
					}}
					safetyStatus={safetyStatus}
					workspace={workspace}
					onClose={() => setContextPanelOpen(false)}
					onNavigate={onNavigate}
				/>
			)}
		</div>
	);
}

function UserMessageActions({
	text,
	onRemember,
}: {
	text: string;
	onRemember?(text: string): void;
}) {
	const [copied, setCopied] = useState(false);
	const handleCopy = () => {
		void navigator.clipboard.writeText(text).then(() => {
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		});
	};
	return (
		<div className="reference-user-actions" role="toolbar" aria-label="用户消息操作">
			<button
				type="button"
				className={`ref-action-btn ${copied ? "copied" : ""}`}
				title={copied ? "已复制" : "复制"}
				aria-label={copied ? "已复制" : "复制"}
				onClick={handleCopy}
			>
				{copied ? <Check size={11} /> : <Copy size={11} />}
				{copied && <span className="ref-action-text">已复制</span>}
			</button>
			{onRemember && (
				<button
					type="button"
					className="ref-action-btn"
					title="存为长期记忆"
					aria-label="存为长期记忆"
					onClick={() => void onRemember(text)}
				>
					<BrainCircuit size={11} />
					<span className="ref-action-text">存为记忆</span>
				</button>
			)}
		</div>
	);
}

function AssistantMessageActions({
	text,
	onRetry,
	onQuote,
	onRemember,
}: {
	text: string;
	onRetry?(): void;
	onQuote?(text: string): void;
	onRemember?(text: string): void;
}) {
	const [copied, setCopied] = useState(false);
	const handleCopy = () => {
		void navigator.clipboard.writeText(text).then(() => {
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		});
	};
	return (
		<div className="reference-assistant-actions" role="toolbar" aria-label="消息操作">
			<button
				type="button"
				className={`ref-action-btn ${copied ? "copied" : ""}`}
				title={copied ? "已复制" : "复制 Markdown"}
				aria-label={copied ? "已复制" : "复制 Markdown"}
				onClick={handleCopy}
			>
				{copied ? <Check size={12} /> : <Copy size={12} />}
				{copied && <span className="ref-action-text">已复制</span>}
			</button>
			{onQuote && (
				<button
					type="button"
					className="ref-action-btn"
					title="引用回复"
					aria-label="引用回复"
					onClick={() => onQuote(text)}
				>
					<Quote size={12} />
				</button>
			)}
			{onRetry && (
				<button
					type="button"
					className="ref-action-btn"
					title="重新生成"
					aria-label="重新生成"
					onClick={onRetry}
				>
					<RefreshCw size={12} />
				</button>
			)}
			{onRemember && (
				<button
					type="button"
					className="ref-action-btn"
					title="存为长期记忆"
					aria-label="存为长期记忆"
					onClick={() => onRemember(text)}
				>
					<BrainCircuit size={12} />
					<span className="ref-action-text">存为记忆</span>
				</button>
			)}
		</div>
	);
}

function ReferenceContextCard({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="reference-context-card">
			<h2>{title}</h2>
			{children}
		</section>
	);
}

function renderFileIcon(basename: string) {
	const ext = basename.includes(".") ? `.${basename.split(".").pop()!.toLowerCase()}` : "";
	if ([".ts", ".tsx", ".js", ".jsx", ".py", ".rs", ".go", ".c", ".cpp", ".swift", ".java", ".vue"].includes(ext)) {
		return <FileCode size={13} className="ref-file-icon code" />;
	}
	if ([".json", ".yaml", ".yml", ".toml"].includes(ext)) {
		return <FileJson size={13} className="ref-file-icon config" />;
	}
	if ([".md", ".txt", ".rst"].includes(ext)) {
		return <FileText size={13} className="ref-file-icon doc" />;
	}
	return <FileText size={13} className="ref-file-icon generic" />;
}


