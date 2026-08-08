import {
	ArrowDown,
	ArrowLeft,
	AtSign,
	Bell,
	Blocks,
	BookOpen,
	Bot,
	BrainCircuit,
	Cable,
	CalendarClock,
	Check,
	ChevronDown,
	ChevronRight,
	ChevronsUpDown,
	CircleStop,
	Clapperboard,
	Clock3,
	Copy,
	Cpu,
	Database,
	Download,
	ExternalLink,
	FileJson,
	FileText,
	Folder,
	FolderPlus,
	GitBranch,
	Github,
	History,
	Image as ImageIcon,
	ListTodo,
	LogIn,
	LogOut,
	Menu,
	MessageSquare,
	Mic,
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
	RefreshCw,
	Save,
	Search,
	Send,
	Server,
	Share2,
	ShieldCheck,
	Slash,
	Sparkles,
	Square,
	Store,
	Terminal,
	TerminalSquare,
	Trash2,
	UserRound,
	WandSparkles,
	Wrench,
	X,
} from "lucide-react";
import {
	type ClipboardEvent,
	type DragEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { desktopApi } from "../../api";
import {
	type BlockingConversationUiRequest,
	type CapabilityTab,
	type DocumentAttachment,
	type ImageAttachment,
	MAX_DOCUMENT_ATTACHMENTS,
	MAX_IMAGE_ATTACHMENTS,
	MAX_TOTAL_DOCUMENT_TEXT_BYTES,
	MAX_TOTAL_IMAGE_BASE64_BYTES,
	type ModelProviderConfig,
	SUPPORTED_IMAGE_TYPES,
	type TaskFilter,
	type View,
} from "../../lib/app-types";
import {
	assistantToolsHaveResults,
	blockingConversationUiRequest,
	contentImages,
	contentText,
	conversationContentMatches,
	formatDate,
	formatTime,
	instanceTitle,
	isConversationMessage,
	isDocumentFile,
	isRecord,
	messageBlockCounts,
	prepareDocumentAttachment,
	prepareImageAttachment,
	scheduleLabel,
	shortWorkspacePath,
	statusLabel,
	thinkingLevelsForModel,
	toolCalls,
} from "../../lib/helpers";
import { MarkdownText } from "../../lib/markdown";
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
} from "../../lib/media";
import { joinSpeechText } from "../../lib/speech-recognition";
import {
	MARKETPLACE_PACKAGES,
	type MarketplaceKind,
	type MarketplacePackage,
	MCP_ADAPTER_MARKETPLACE_PACKAGE,
} from "../../marketplace";
import type {
	AgentInstance,
	AgentMode,
	AgnesImageRatio,
	AgnesImageSize,
	AgnesMediaCapabilities,
	ConversationCapabilities,
	ConversationMessage,
	ConversationModelOption,
	ConversationSnapshot,
	ConversationState,
	ConversationStats,
	ConversationUiRequest,
	ConversationUiResponse,
	CreateTaskInput,
	DesktopSnapshot,
	GeneratedMediaItem,
	ImageContent,
	MediaComposerMode,
	RunningTool,
	RunStatus,
	TaskDefinition,
	TaskRun,
	ThinkingLevel,
	VisionFallbackConfig,
	VisionFallbackModel,
	WorkspaceSummary,
} from "../../types";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "../ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

// re-export helpers used by App if needed - actually surfaces are self-contained

type MoreView = "tasks" | "capabilities" | "memory" | "security" | "intelligence" | "daemon";

const MORE_ITEMS: Array<{ id: MoreView; label: string; hint: string; icon: typeof BookOpen }> = [
	{ id: "memory", label: "记忆", hint: "跨对话记住的偏好", icon: BookOpen },
	{ id: "tasks", label: "定时任务", hint: "后台自动化", icon: ListTodo },
	{ id: "capabilities", label: "能力与扩展", hint: "技能 / MCP / 工具", icon: Blocks },
	{ id: "security", label: "安全策略", hint: "确认 / 拦截规则", icon: ShieldCheck },
	{ id: "intelligence", label: "智能规划", hint: "多步计划记录", icon: BrainCircuit },
	{ id: "daemon", label: "运行时", hint: "本地服务状态", icon: Server },
];

function visibleMessageText(text: string): string {
	return text
		.replace(/\n*<openpi-attachments>[\s\S]*?<\/openpi-attachments>/g, "")
		.replace(/\n*<openpi-vision-context[\s\S]*?<\/openpi-vision-context>/g, "")
		.trim();
}

function hasVisionContext(content: unknown): boolean {
	return contentText(content).includes("<openpi-vision-context");
}

export type AppMode = "chat" | "code";

export function ModeTabBar({
	mode,
	onModeChange,
	onSelectProject,
	currentProject,
}: {
	mode: AppMode;
	onModeChange(mode: AppMode): void;
	onSelectProject?(): void;
	currentProject?: string;
}) {
	return (
		<div className="mode-tab-bar">
			<div className="segmented mode-switch mode-tab-switch" aria-label="应用模式">
				<button
					type="button"
					className={mode === "chat" ? "active" : ""}
					title="Chat"
					onClick={() => onModeChange("chat")}
				>
					<MessageSquare size={14} />
					Chat
				</button>
				<button
					type="button"
					className={mode === "code" ? "active" : ""}
					title="CWork"
					onClick={() => onModeChange("code")}
				>
					<TerminalSquare size={14} />
					CWork
				</button>
			</div>
			{mode === "code" && onSelectProject && (
				<button
					className="mode-tab-project-btn"
					type="button"
					title={currentProject ?? "选择项目"}
					onClick={onSelectProject}
				>
					<Folder size={14} />
					<span>{currentProject ? shortWorkspacePath(currentProject) : "选择项目"}</span>
				</button>
			)}
		</div>
	);
}

export function AppRail({
	activeView,
	tasks,
	runs,
	daemonRunning,
	onNavigate,
}: {
	activeView: MoreView | "chat";
	tasks: TaskDefinition[];
	runs: TaskRun[];
	daemonRunning: boolean;
	onNavigate(view: MoreView | "chat"): void;
}) {
	const activeRuns = runs.filter((run) => run.status === "running" || run.status === "queued").length;
	return (
		<aside className="app-rail" aria-label="主导航">
			<button
				type="button"
				className="brand-mark"
				data-label="OpenPI"
				title="OpenPI"
				onClick={() => onNavigate("chat")}
			>
				π
			</button>
			<nav className="rail-navigation" aria-label="页面">
				<button
					type="button"
					className={`rail-button ${activeView === "chat" ? "active" : ""}`}
					data-label="对话"
					title="对话"
					onClick={() => onNavigate("chat")}
				>
					<MessageSquare size={18} />
				</button>
				{MORE_ITEMS.map((item) => {
					const Icon = item.icon;
					const count = item.id === "tasks" ? activeRuns || tasks.length : 0;
					return (
						<button
							type="button"
							className={`rail-button ${activeView === item.id ? "active" : ""} ${item.id === "daemon" && daemonRunning ? "online" : ""}`}
							data-label={item.label}
							title={item.label}
							key={item.id}
							onClick={() => onNavigate(item.id)}
						>
							<Icon size={18} />
							{count > 0 && <span className="rail-count">{count > 9 ? "9+" : count}</span>}
							{item.id === "daemon" && <span className="rail-status" />}
						</button>
					);
				})}
			</nav>
		</aside>
	);
}

/** Brand mark shown at the top of the merged sidebar (nav lives in the left rail). */
export function SidebarHeader({
	activeView: _activeView,
	tasks: _tasks,
	runs: _runs,
	daemonRunning: _daemonRunning,
	onNavigate,
}: {
	activeView: MoreView | "chat";
	tasks: TaskDefinition[];
	runs: TaskRun[];
	daemonRunning: boolean;
	onNavigate(view: MoreView | "chat"): void;
}) {
	return (
		<div className="sidebar-header">
			<button type="button" className="sidebar-brand" title="OpenPI" onClick={() => onNavigate("chat")}>
				<span className="sidebar-brand-mark">π</span>
				<span className="sidebar-brand-text">
					<strong>OpenPI</strong>
					<span>Personal agent</span>
				</span>
			</button>
		</div>
	);
}

export function ReferenceWorkspacePreview({
	projectInstances,
	chatInstances,
	selectedInstanceId,
	conversation,
	conversationTitles,
	workspaceSummary,
	runningTools,
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
	slashCommands,
	onSelectConversation,
	onOpenProject,
	onNewProjectSession,
	onNewConversation,
	onOpenSettings,
	onSend,
	onAbort,
	onRenameConversation,
	onExportConversation,
	onDeleteConversation,
	onRemember,
	onCreateTaskFromChat,
	onModelChange,
	onThinkingLevelChange,
	onAppModeChange,
	onNavigate,
}: {
	projectInstances: AgentInstance[];
	chatInstances: AgentInstance[];
	selectedInstanceId?: string;
	conversation?: ConversationSnapshot;
	conversationTitles: Record<string, string>;
	workspaceSummary?: WorkspaceSummary;
	runningTools: RunningTool[];
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
	onSelectConversation(instanceId: string): void;
	onOpenProject(instanceId: string): void;
	onNewProjectSession(workspace: string): void;
	onNewConversation(): void;
	onOpenSettings(): void;
	onSend(message: string, images: ImageContent[], documents: DocumentAttachment[]): Promise<void>;
	onAbort(): void;
	onRenameConversation(): void;
	onExportConversation(): void;
	onDeleteConversation(): void;
	onRemember(text: string): Promise<void> | void;
	onCreateTaskFromChat(prompt: string): void;
	onModelChange(model: ConversationModelOption): void;
	onThinkingLevelChange(level: ThinkingLevel): void;
	onAppModeChange(mode: AppMode): void;
	onNavigate(view: ChatNavView): void;
}) {
	const [draft, setDraft] = useState("");
	const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
	const [documents, setDocuments] = useState<DocumentAttachment[]>([]);
	const [attachmentNotice, setAttachmentNotice] = useState<string>();
	const [contextPickerOpen, setContextPickerOpen] = useState(false);
	const [modelMenuOpen, setModelMenuOpen] = useState(false);
	const [slashOpen, setSlashOpen] = useState(false);
	const [slashIndex, setSlashIndex] = useState(0);
	const [showAllSpaces, setShowAllSpaces] = useState(false);
	const [showAllSessions, setShowAllSessions] = useState(false);
	const [projectsOverflow, setProjectsOverflow] = useState(false);
	const [chatsOverflow, setChatsOverflow] = useState(false);
	const [showAllFiles, setShowAllFiles] = useState(false);
	const [memoryQuery, setMemoryQuery] = useState("");
	const [leftCollapsed, setLeftCollapsed] = useState(false);
	const attachmentInput = useRef<HTMLInputElement>(null);
	const draftInput = useRef<HTMLTextAreaElement>(null);
	const feedScroll = useRef<HTMLElement>(null);
	const projectList = useRef<HTMLDivElement>(null);
	const chatList = useRef<HTMLDivElement>(null);
	const autoFollow = useRef(true);
	const [showScrollToBottom, setShowScrollToBottom] = useState(false);
	const instances = [...projectInstances, ...chatInstances];
	const selectedInstance = instances.find((instance) => instance.id === selectedInstanceId);
	const workspace = conversation?.instance.cwd ?? selectedInstance?.cwd;
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
			: "New conversation";
	const storedMessages = conversation?.messages ?? [];
	const messages = optimisticMessage ? [...storedMessages, optimisticMessage] : storedMessages;
	const isWorking = Boolean(conversation?.state.isStreaming || sending || optimisticMessage);
	const currentModel = modelOptions.find(
		(model) => model.provider === conversation?.state.model?.provider && model.id === conversation.state.model.id,
	);
	const usesVisionFallback =
		attachments.length > 0 &&
		currentModel?.supportsImages === false &&
		visionFallback?.enabled === true &&
		visionFallback.configured;
	const thinkingLevels = currentModel?.thinkingLevels ?? thinkingLevelsForModel({ reasoning: true });
	const modelGroups = useMemo(() => {
		const groups = new Map<string, ConversationModelOption[]>();
		for (const model of modelOptions) groups.set(model.provider, [...(groups.get(model.provider) ?? []), model]);
		return [...groups];
	}, [modelOptions]);
	const relatedFiles = workspaceSummary?.files ?? [];
	const visibleMemory = memoryEntries.filter((entry) =>
		entry.toLowerCase().includes(memoryQuery.trim().toLowerCase()),
	);
	const contextUsage = stats?.contextUsage;
	const contextTokens = contextUsage?.tokens ?? 0;
	const contextWindow = contextUsage?.contextWindow ?? conversation?.state.model?.contextWindow ?? 0;
	const contextPercent =
		contextUsage?.percent !== undefined
			? Math.min(contextUsage.percent > 1 ? contextUsage.percent / 100 : contextUsage.percent, 1)
			: contextWindow > 0
				? Math.min(contextTokens / contextWindow, 1)
				: undefined;
	const cacheRead = stats?.tokens.cacheRead ?? 0;
	const cacheWrite = stats?.tokens.cacheWrite ?? 0;
	const cacheEligibleTokens = (stats?.tokens.input ?? 0) + cacheRead;
	const cacheHitPercent = cacheEligibleTokens > 0 ? Math.round((cacheRead / cacheEligibleTokens) * 100) : undefined;
	const messageSignature = messages
		.map((message, index) => `${message.timestamp ?? index}:${message.role}:${contentText(message.content).length}`)
		.join("|");
	const agentSlash = useMemo(
		() =>
			slashCommands.map((line) => {
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
		if (!slashQuery) return combined.slice(0, 12);
		return combined
			.filter(
				(item) =>
					item.label.toLowerCase().includes(slashQuery) ||
					item.hint.toLowerCase().includes(slashQuery) ||
					item.id.toLowerCase().includes(slashQuery),
			)
			.slice(0, 12);
	}, [agentSlash, localSlashItems, slashQuery]);

	useEffect(() => {
		autoFollow.current = true;
		setShowScrollToBottom(false);
		setModelMenuOpen(false);
		setSlashOpen(false);
	}, [conversation?.instance.id]);

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
		if (!autoFollow.current) return;
		const frame = window.requestAnimationFrame(() => {
			const feed = feedScroll.current;
			if (feed) feed.scrollTop = feed.scrollHeight;
		});
		return () => window.cancelAnimationFrame(frame);
	}, [messageSignature]);

	function handleFeedScroll(): void {
		const feed = feedScroll.current;
		if (!feed) return;
		const isAwayFromBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight > 96;
		autoFollow.current = !isAwayFromBottom;
		setShowScrollToBottom(isAwayFromBottom);
	}

	function scrollToBottom(): void {
		autoFollow.current = true;
		setShowScrollToBottom(false);
		feedScroll.current?.scrollTo({ top: feedScroll.current.scrollHeight, behavior: "smooth" });
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
		for (const item of LOCAL_SLASH) {
			const match = message.match(item.match);
			if (!match) continue;
			if (item.id === "remember") {
				const body = (match[2] ?? "").trim();
				if (!body) {
					setAttachmentNotice("用法：/记住 要记住的内容");
					return true;
				}
				await onRemember(body);
				setAttachmentNotice("已写入记忆");
				return true;
			}
			if (item.id === "task") {
				onCreateTaskFromChat((match[2] ?? "").trim() || "定期检查并汇报工作区进展");
				return true;
			}
			if (item.kind === "nav") {
				const navMap: Record<string, ChatNavView> = {
					memory: "memory",
					tasks: "tasks",
					capabilities: "capabilities",
					security: "security",
					intelligence: "intelligence",
					daemon: "daemon",
				};
				const target = navMap[item.id];
				if (target) onNavigate(target);
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
		if (local?.id === "task") {
			onCreateTaskFromChat("");
			setDraft("");
			setSlashOpen(false);
			return;
		}
		if (local?.id === "remember") {
			setDraft("/记住 ");
		} else {
			setDraft(item.insert);
		}
		setSlashOpen(false);
		draftInput.current?.focus();
	}

	const submit = async (): Promise<void> => {
		const message = draft.trim();
		if ((!message && attachments.length === 0 && documents.length === 0) || isWorking) return;
		if (message.startsWith("/") && attachments.length === 0 && (await handleLocalSlash(message))) {
			setDraft("");
			setSlashOpen(false);
			return;
		}
		await onSend(message, attachments, documents);
		setDraft("");
		setAttachments([]);
		setDocuments([]);
		setAttachmentNotice(undefined);
	};

	return (
		<div className={`reference-workspace ${leftCollapsed ? "left-collapsed" : ""}`}>
			<aside className="reference-leftbar">
				<header className="reference-brand">
					<img className="reference-brand-mark" src="./openpi-mark.svg" alt="" />
					<strong>OpenPI</strong>
					<button
						type="button"
						className="reference-sidebar-toggle"
						title={leftCollapsed ? "展开侧栏" : "收起侧栏"}
						aria-label={leftCollapsed ? "展开侧栏" : "收起侧栏"}
						onClick={() => setLeftCollapsed((value) => !value)}
					>
						{leftCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
					</button>
				</header>
				<label className="reference-search">
					<Search size={14} />
					<input placeholder="Search" />
					<kbd>⌘K</kbd>
				</label>
				<div className="reference-sidebar-content">
					<div className="reference-label">
						<span>Projects</span>
						<div className="reference-section-actions">
							<button type="button" title="选择项目" aria-label="选择项目" onClick={() => void selectProject()}>
								<FolderPlus size={14} />
							</button>
						</div>
					</div>
					<div className={`reference-spaces ${showAllSpaces ? "expanded" : ""}`} ref={projectList}>
						{spaces.map(([cwd, spaceInstances], index) => (
							<div className="reference-project-group" key={cwd}>
								<div className={`reference-space ${cwd === workspace ? "selected" : ""}`}>
									<button
										type="button"
										className="reference-project-select"
										onClick={() =>
											onOpenProject(
												spaceInstances.find((instance) => instance.id === selectedInstanceId)?.id ??
													spaceInstances[0].id,
											)
										}
									>
										<span className={`reference-folder ${["blue", "cyan", "amber", "yellow"][index % 4]}`}>
											<Folder size={16} />
										</span>
										<span>
											<strong>{cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? cwd}</strong>
											<small>{shortWorkspacePath(cwd)}</small>
										</span>
									</button>
									<div className="reference-project-actions">
										<button
											type="button"
											className="reference-project-new-session"
											title="在此项目中新建 Cwork 会话"
											aria-label="在此项目中新建 Cwork 会话"
											onClick={() => onNewProjectSession(cwd)}
										>
											<Plus size={13} />
										</button>
										<Popover>
											<PopoverTrigger asChild>
												<button
													type="button"
													className="reference-project-more"
													title="项目操作"
													aria-label="项目操作"
												>
													<MoreHorizontal size={14} />
												</button>
											</PopoverTrigger>
											<PopoverContent className="reference-project-menu" align="end">
												<span className="reference-menu-label">项目</span>
												<button
													type="button"
													onClick={() =>
														onOpenProject(
															spaceInstances.find((instance) => instance.id === selectedInstanceId)
																?.id ?? spaceInstances[0].id,
														)
													}
												>
													<Folder size={14} /> 打开项目
												</button>
												<button type="button" onClick={() => onNewProjectSession(cwd)}>
													<Plus size={14} /> 新建 Cwork 会话
												</button>
												<div className="reference-menu-divider" />
												<button type="button" onClick={() => void selectProject()}>
													<FolderPlus size={14} /> 选择其他项目
												</button>
											</PopoverContent>
										</Popover>
									</div>
								</div>
								<div className="reference-project-sessions">
									{spaceInstances.map((instance) => (
										<button
											type="button"
											className={instance.id === selectedInstanceId ? "selected" : ""}
											key={instance.id}
											onClick={() => onOpenProject(instance.id)}
										>
											<span>{instanceTitle(instance, conversationTitles[instance.id])}</span>
											{instance.id === selectedInstanceId && <i />}
										</button>
									))}
								</div>
							</div>
						))}
					</div>
					{projectsOverflow && (
						<button type="button" className="reference-more" onClick={() => setShowAllSpaces((value) => !value)}>
							{showAllSpaces ? "收起项目" : "显示全部项目"} <ChevronRight size={14} />
						</button>
					)}
					<div className="reference-label recent">
						<span>Chats</span>
						<button type="button" title="新建会话" aria-label="新建会话" onClick={onNewConversation}>
							<Plus size={14} />
						</button>
					</div>
					<div className={`reference-sessions ${showAllSessions ? "expanded" : ""}`} ref={chatList}>
						{chatInstances.map((instance) => (
							<button
								type="button"
								className={instance.id === selectedInstanceId ? "selected" : ""}
								key={instance.id}
								onClick={() => onSelectConversation(instance.id)}
							>
								<span>{instanceTitle(instance, conversationTitles[instance.id])}</span>
								<small>{instance.status === "online" ? "Active" : statusLabel(instance.status)}</small>
								{instance.id === selectedInstanceId && <i />}
							</button>
						))}
					</div>
					{chatsOverflow && (
						<button
							type="button"
							className="reference-more"
							onClick={() => setShowAllSessions((value) => !value)}
						>
							{showAllSessions ? "收起对话" : "显示全部对话"} <ChevronRight size={14} />
						</button>
					)}
				</div>
				<footer className="reference-account">
					<span className="reference-avatar">H</span>
					<strong>Huaan</strong>
					<em>Pro</em>
					<button type="button" title="设置" aria-label="设置" onClick={onOpenSettings}>
						<Wrench size={15} />
					</button>
				</footer>
			</aside>

			<main className="reference-main">
				<header className="reference-main-header">
					<div className="reference-title">
						<span className="reference-title-folder">
							<Folder size={19} />
						</span>
						<div>
							<h1>
								{title} <Pencil size={14} />
							</h1>
							<p>{workspace ? `${shortWorkspacePath(workspace)} 工作空间` : "选择一个工作区"}</p>
						</div>
					</div>
					<div className="reference-header-actions">
						<span className="reference-active">
							<i /> {conversation?.state.isStreaming ? "Working" : "Active"}
						</span>
						<Popover>
							<PopoverTrigger asChild>
								<button type="button" title="更多会话操作" aria-label="更多会话操作">
									<MoreHorizontal size={18} />
								</button>
							</PopoverTrigger>
							<PopoverContent className="reference-header-menu" align="end">
								<span className="reference-menu-label">会话</span>
								<button type="button" disabled={!conversation} onClick={onRenameConversation}>
									<Pencil size={14} /> 重命名会话
								</button>
								<button type="button" disabled={!conversation} onClick={onExportConversation}>
									<Download size={14} /> 导出 Markdown
								</button>
								<div className="reference-menu-divider" />
								<button
									type="button"
									className="danger"
									disabled={!conversation}
									onClick={onDeleteConversation}
								>
									<Trash2 size={14} /> 删除会话
								</button>
							</PopoverContent>
						</Popover>
					</div>
				</header>
				<section className="reference-feed" ref={feedScroll} onScroll={handleFeedScroll}>
					<div className="reference-chat-view">
						{messages
							.filter((message) => message.role === "user" || message.role === "assistant")
							.map((message, index) => {
								const text = visibleMessageText(contentText(message.content));
								const isUser = message.role === "user";
								return (
									<div
										className={`${isUser ? "reference-user-card" : "reference-assistant-card"} ${message === optimisticMessage ? "pending" : ""}`}
										key={`${message.timestamp ?? "untimed"}-${message.role}-${index}`}
									>
										<div>
											{isUser ? (
												<p>{text}</p>
											) : text ? (
												<div className="reference-assistant-message">
													<MarkdownText text={text} />
												</div>
											) : (
												<p>正在生成…</p>
											)}
											{isUser && hasVisionContext(message.content) && (
												<span className="reference-vision-badge">
													<ImageIcon size={12} /> GLM-4.6V 视觉解析
												</span>
											)}
											{contentImages(message.content).length > 0 && (
												<div className="reference-message-images">
													{contentImages(message.content).map((image, imageIndex) => (
														<img
															src={`data:${image.mimeType};base64,${image.data}`}
															alt="已附加图片"
															key={`${image.mimeType}-${imageIndex}`}
														/>
													))}
												</div>
											)}
										</div>
									</div>
								);
							})}
					</div>
					{isWorking && (
						<div className="reference-streaming-indicator" aria-label="OpenPI 正在回复">
							<span />
							<span />
							<span />
						</div>
					)}
				</section>
				{showScrollToBottom && (
					<button
						type="button"
						className="reference-scroll-to-bottom"
						title="回到最新消息"
						aria-label="回到最新消息"
						onClick={scrollToBottom}
					>
						<ArrowDown size={16} />
					</button>
				)}
				<footer className="reference-composer">
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
						placeholder="Ask OpenPI anything..."
						rows={1}
						value={draft}
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
								if (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey)) {
									event.preventDefault();
									applySlashItem(slashItems[slashIndex] ?? slashItems[0]);
									return;
								}
								if (event.key === "Escape") {
									event.preventDefault();
									setSlashOpen(false);
									return;
								}
							}
							if (event.key === "Enter" && !event.shiftKey) {
								event.preventDefault();
								void submit().catch(() => undefined);
							}
						}}
					/>
					{attachmentNotice && <p className="reference-attachment-notice">{attachmentNotice}</p>}
					{usesVisionFallback && (
						<p className="reference-attachment-vision">
							<ImageIcon size={12} /> 将由 GLM-4.6V-Flash 解析图片
						</p>
					)}
					<div className="reference-composer-toolbar">
						<div className="reference-composer-primary">
							<Popover>
								<PopoverTrigger asChild>
									<button
										type="button"
										className="reference-composer-icon"
										title="更多操作"
										aria-label="更多操作"
									>
										<Plus size={16} />
									</button>
								</PopoverTrigger>
								<PopoverContent className="composer-plus-menu" side="top" align="start">
									<button type="button" onClick={() => void onRemember(draft)}>
										<BookOpen size={14} /> 写入记忆
									</button>
									<button type="button" onClick={() => onCreateTaskFromChat(draft)}>
										<ListTodo size={14} /> 创建任务
									</button>
								</PopoverContent>
							</Popover>
							<div className="reference-composer-mode-switch" aria-label="应用模式">
								<button
									type="button"
									className={appMode === "chat" ? "active" : ""}
									onClick={() => onAppModeChange("chat")}
								>
									<MessageSquare size={13} /> Chat
								</button>
								<button
									type="button"
									className={appMode === "code" ? "active" : ""}
									onClick={() => onAppModeChange("code")}
								>
									<TerminalSquare size={13} /> CWork
								</button>
							</div>
							<Popover open={modelMenuOpen} onOpenChange={setModelMenuOpen}>
								<PopoverTrigger asChild>
									<button
										type="button"
										className="reference-model-control"
										disabled={configuring || loadingModels || modelOptions.length === 0}
									>
										{shortModelName(
											conversation?.state.model?.name ?? conversation?.state.model?.id ?? "Model",
										)}
										<span>·</span>
										{conversation?.state.thinkingLevel ?? "medium"}
										<ChevronsUpDown size={12} />
									</button>
								</PopoverTrigger>
								<PopoverContent className="model-popover model-popover-wide" side="top" align="start">
									<div className="model-popover-section">
										<span className="model-popover-label">思考强度</span>
										<div className="thinking-row">
											{thinkingLevels.map((level) => (
												<button
													type="button"
													key={level}
													className={conversation?.state.thinkingLevel === level ? "active" : ""}
													disabled={configuring || loadingModels || !currentModel}
													onClick={() => {
														setModelMenuOpen(false);
														onThinkingLevelChange(level);
													}}
												>
													{level}
												</button>
											))}
										</div>
									</div>
									<div className="model-popover-section">
										<span className="model-popover-label">模型</span>
										<Command label="Select model" loop>
											<CommandInput placeholder="搜索模型" />
											<CommandList>
												<CommandEmpty>没有匹配的模型</CommandEmpty>
												{modelGroups.map(([provider, models]) => (
													<CommandGroup heading={provider} key={provider}>
														{models.map((model) => (
															<CommandItem
																value={`${model.provider}/${model.id}`}
																key={`${model.provider}/${model.id}`}
																onSelect={() => {
																	setModelMenuOpen(false);
																	onModelChange(model);
																}}
															>
																<span className="model-option-main">
																	<strong>{model.name}</strong>
																	<small>{model.id}</small>
																</span>
																{model.supportsImages && (
																	<span className="model-option-vision" title="支持图片输入">
																		<ImageIcon size={13} />
																	</span>
																)}
																{model.provider === currentModel?.provider &&
																	model.id === currentModel.id && <Check size={14} />}
															</CommandItem>
														))}
													</CommandGroup>
												))}
											</CommandList>
										</Command>
									</div>
								</PopoverContent>
							</Popover>
						</div>
						<div className="reference-composer-actions">
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
							<button
								type="button"
								className="reference-composer-icon"
								title="附加图片或文档"
								aria-label="附加图片或文档"
								onClick={() => attachmentInput.current?.click()}
							>
								<Paperclip size={15} />
							</button>
							<Popover open={contextPickerOpen} onOpenChange={setContextPickerOpen}>
								<PopoverTrigger asChild>
									<button
										type="button"
										className="reference-composer-icon"
										title="选择工作区文件"
										aria-label="选择工作区文件"
										disabled={!workspace || relatedFiles.length === 0}
									>
										<AtSign size={15} />
									</button>
								</PopoverTrigger>
								<PopoverContent className="reference-file-picker" side="top" align="end">
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
							<button
								type="button"
								className="reference-composer-icon"
								title="命令"
								aria-label="命令"
								onClick={() => {
									setDraft("/");
									setSlashOpen(true);
									draftInput.current?.focus();
								}}
							>
								<Slash size={15} />
							</button>
							<button
								type="button"
								className="reference-composer-icon"
								title="写入记忆"
								aria-label="写入记忆"
								onClick={() => void onRemember(draft)}
							>
								<BookOpen size={15} />
							</button>
							<button
								type="button"
								className={`reference-send ${isWorking ? "working" : ""}`}
								title={isWorking ? "停止生成" : "发送消息"}
								aria-label={isWorking ? "停止生成" : "发送消息"}
								disabled={!isWorking && !draft.trim() && attachments.length === 0 && documents.length === 0}
								onClick={() => {
									if (isWorking) onAbort();
									else void submit();
								}}
							>
								{isWorking ? <Square size={13} fill="currentColor" /> : <ArrowDown size={17} />}
							</button>
						</div>
					</div>
				</footer>
			</main>

			<aside className="reference-context">
				<header>
					<strong>Context</strong>
					<span>
						<Pin size={14} />
						<button type="button">
							<X size={15} />
						</button>
					</span>
				</header>
				<ReferenceContextCard title="Workspace">
					<div className="reference-context-workspace">
						<span className="reference-title-folder">
							<Folder size={22} />
						</span>
						<div>
							<strong>{workspace?.split(/[\\/]/).filter(Boolean).at(-1) ?? "No workspace"}</strong>
							<small>{workspace ? shortWorkspacePath(workspace) : "Select a conversation"}</small>
						</div>
					</div>
					<div className="reference-context-counts">
						<div>
							<strong>
								{workspaceSummary
									? `${workspaceSummary.fileCount}${workspaceSummary.truncated ? "+" : ""}`
									: "--"}
							</strong>
							<span>Files</span>
						</div>
						<div>
							<strong>{runningTools.length}</strong>
							<span>Tools</span>
						</div>
						<div>
							<strong>{memoryCount}</strong>
							<span>Memories</span>
						</div>
					</div>
				</ReferenceContextCard>
				<ReferenceContextCard title="Environment">
					<div className="reference-environment">
						<span>
							Agent <strong>{conversation?.instance.mode ?? "--"}</strong>
						</span>
						<span>
							Model <strong>{conversation?.state.model?.name ?? conversation?.state.model?.id ?? "--"}</strong>
						</span>
						<span>
							Session <strong>{conversation?.state.sessionId.slice(0, 8) ?? "--"}</strong>
						</span>
						<span>
							Status <strong>{conversation?.state.isStreaming ? "Working" : "Idle"}</strong>
						</span>
					</div>
				</ReferenceContextCard>
				<ReferenceContextCard title="会话用量">
					{stats ? (
						<div className="reference-usage">
							<div className="reference-context-usage">
								<div>
									<span>上下文占用</span>
									<strong>
										{contextPercent === undefined ? "--" : `${Math.round(contextPercent * 100)}%`}
									</strong>
								</div>
								<span>
									{contextWindow > 0
										? `${fmtTokens(contextTokens)} / ${fmtTokens(contextWindow)}`
										: "模型未提供窗口"}
								</span>
								<div className="reference-context-progress" aria-label="上下文占用">
									<span style={{ width: `${Math.round((contextPercent ?? 0) * 100)}%` }} />
								</div>
							</div>
							<div className="reference-token-grid">
								<span>
									输入 <strong>{fmtTokens(stats.tokens.input)}</strong>
								</span>
								<span>
									输出 <strong>{fmtTokens(stats.tokens.output)}</strong>
								</span>
								<span>
									缓存读 <strong>{fmtTokens(cacheRead)}</strong>
								</span>
								<span>
									缓存写 <strong>{fmtTokens(cacheWrite)}</strong>
								</span>
							</div>
							<div className="reference-usage-total">
								<span>
									缓存命中 <strong>{cacheHitPercent === undefined ? "--" : `${cacheHitPercent}%`}</strong>
								</span>
								<span>
									本会话费用 <strong>{fmtCost(stats.cost)}</strong>
								</span>
							</div>
							{providerBalance && (
								<div className="reference-provider-balance">
									账户余额{" "}
									<strong>
										{providerBalance.totalBalance.toFixed(2)} {providerBalance.currency}
									</strong>
								</div>
							)}
						</div>
					) : (
						<p className="reference-context-empty">正在读取会话统计…</p>
					)}
				</ReferenceContextCard>
				<ReferenceContextCard title="Running Tools">
					<div className="reference-tool-list">
						{runningTools.map((tool) => (
							<span key={tool.toolCallId}>
								<Terminal size={14} /> {tool.toolName} <em>Running</em>
							</span>
						))}
						{runningTools.length === 0 && (
							<span>
								<Terminal size={14} /> No tools running
							</span>
						)}
					</div>
				</ReferenceContextCard>
				<ReferenceContextCard title="Related Files">
					<div className="reference-file-list">
						{relatedFiles.slice(0, showAllFiles ? relatedFiles.length : 5).map((file, index) => (
							<span className={index === 0 ? "selected" : ""} key={file}>
								<FileText size={13} /> {file}
							</span>
						))}
						{relatedFiles.length === 0 && (
							<span>
								<FileText size={13} /> No workspace files
							</span>
						)}
					</div>
					<button
						type="button"
						className="reference-context-link"
						onClick={() => setShowAllFiles((value) => !value)}
					>
						{showAllFiles ? "Show Less" : `Show All (${workspaceSummary?.fileCount ?? 0})`}
					</button>
				</ReferenceContextCard>
				<ReferenceContextCard title="Memory">
					<label className="reference-memory-search">
						<Search size={12} />
						<input
							placeholder="Search memory"
							value={memoryQuery}
							onChange={(event) => setMemoryQuery(event.target.value)}
						/>
					</label>
					<div className="reference-memory-list">
						{visibleMemory.slice(0, 3).map((entry) => (
							<span key={entry}>{entry}</span>
						))}
					</div>
					<button type="button" className="reference-context-link">
						Show All ({memoryCount})
					</button>
				</ReferenceContextCard>
			</aside>
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

export function ConversationSidebar({
	conversations,
	projects,
	conversationTitles,
	selectedInstanceId,
	streamingInstances,
	query,
	onQueryChange,
	onSelect,
	onNew,
	creating,
	onRename,
	onDelete,
	includeStopped: _includeStopped,
	onIncludeStoppedChange: _onIncludeStoppedChange,
	stoppedCount: _stoppedCount = 0,
	onPruneStopped: _onPruneStopped,
	pruning: _pruning,
	totalCount: _totalCount,
	truncated: _truncated,
	showAll: _showAll,
	onShowAllChange: _onShowAllChange,
	activeView,
	tasks,
	runs,
	daemonRunning,
	onNavigate,
	userProfile,
	onEditProfile,
}: {
	conversations: AgentInstance[];
	projects: AgentInstance[];
	conversationTitles: Record<string, string>;
	selectedInstanceId?: string;
	streamingInstances?: Set<string>;
	query: string;
	onQueryChange(value: string): void;
	onSelect(instanceId: string): void;
	onNew(): void;
	creating: boolean;
	onRename(instance: AgentInstance): void;
	onDelete(instance: AgentInstance): void;
	includeStopped: boolean;
	onIncludeStoppedChange(value: boolean): void;
	stoppedCount?: number;
	onPruneStopped(): void;
	pruning?: boolean;
	totalCount: number;
	truncated: boolean;
	showAll: boolean;
	onShowAllChange(value: boolean): void;
	activeView: MoreView | "chat";
	tasks?: TaskDefinition[];
	runs?: TaskRun[];
	daemonRunning?: boolean;
	onNavigate?(view: MoreView | "chat"): void;
	userProfile?: { nickname?: string; avatarEmoji?: string };
	onEditProfile?(): void;
}) {
	const spaces = useMemo(() => {
		const seen = new Set<string>();
		return projects.filter((instance) => {
			const cwd = instance.cwd.trim();
			if (!cwd || seen.has(cwd)) return false;
			seen.add(cwd);
			return true;
		});
	}, [projects]);

	const renderConversationRow = (instance: AgentInstance) => (
		<div
			key={instance.id}
			className={`conversation-row ${selectedInstanceId === instance.id && activeView === "chat" ? "selected" : ""}`}
		>
			<button className="conversation-select" type="button" onClick={() => onSelect(instance.id)}>
				<span className="conversation-avatar">
					<MessageSquare size={15} />
				</span>
				<span className="conversation-copy">
					<strong>{instanceTitle(instance, conversationTitles[instance.id])}</strong>
					<span>{instance.mode === "code" ? "Coding workspace" : "Personal workspace"}</span>
				</span>
				<span className="conversation-status-indicator">
					<span className={`instance-dot ${instance.status}`} />
					{streamingInstances?.has(instance.id) && <span className="instance-working" aria-label="working" />}
				</span>
			</button>
			<span className="conversation-actions">
				<button type="button" title="重命名" aria-label="重命名" onClick={() => onRename(instance)}>
					<Pencil size={13} />
				</button>
				<button type="button" className="danger" title="删除" aria-label="删除" onClick={() => onDelete(instance)}>
					<Trash2 size={13} />
				</button>
			</span>
		</div>
	);

	return (
		<aside className="conversation-sidebar">
			{onNavigate && tasks && runs && (
				<SidebarHeader
					activeView={activeView}
					tasks={tasks}
					runs={runs}
					daemonRunning={daemonRunning ?? false}
					onNavigate={onNavigate}
				/>
			)}
			<div className="sidebar-title">
				<div className="brand-lockup">
					<span className="brand-copy">
						<strong>Spaces</strong>
					</span>
				</div>
				<button
					className="icon-button primary-icon"
					title="新对话"
					aria-label="新对话"
					disabled={creating}
					onClick={onNew}
				>
					{creating ? <RefreshCw size={16} className="spin" /> : <Plus size={17} />}
				</button>
			</div>
			<div className="search-box">
				<Search size={15} />
				<input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="搜索对话" />
			</div>
			<div className="reference-sidebar-scroll">
				<div className="sidebar-section-label reference-section-heading">
					<span>Spaces</span>
				</div>
				<div className="spaces-list">
					{spaces.map((space) => (
						<button
							type="button"
							className={`space-row ${selectedInstanceId === space.id ? "selected" : ""}`}
							key={space.id}
							onClick={() => onSelect(space.id)}
						>
							<span className="space-icon">
								<Folder size={16} />
							</span>
							<span className="space-copy">
								<strong>{shortWorkspacePath(space.cwd)}</strong>
								<small>~/{space.cwd.split(/[\\/]/).pop() ?? "workspace"}</small>
							</span>
							<span className="space-dot" />
						</button>
					))}
					{spaces.length === 0 && <span className="sidebar-inline-empty">还没有工作区</span>}
				</div>
				<button type="button" className="sidebar-more-row" onClick={() => onNavigate?.("capabilities")}>
					<span>More</span>
					<ChevronRight size={14} />
				</button>

				<div className="sidebar-section-label reference-section-heading recent-heading">
					<span>Recent Sessions</span>
					<button
						className="icon-button quiet"
						type="button"
						title="新建会话"
						aria-label="新建会话"
						onClick={onNew}
					>
						<Plus size={14} />
					</button>
				</div>
				<div className="conversation-list reference-session-list">
					{conversations.map((instance) => renderConversationRow(instance))}
					{conversations.length === 0 && (
						<div className="sidebar-empty">
							<MessageSquare size={20} />
							<strong>还没有对话</strong>
							<span>点 + 开始</span>
						</div>
					)}
				</div>

				{!spaces.length && !conversations.length && (
					<div className="sidebar-empty">
						<MessageSquare size={20} />
						<strong>还没有对话</strong>
						<span>点 + 开始</span>
					</div>
				)}
			</div>
			<div className="sidebar-account">
				<button
					type="button"
					className="account-avatar"
					title="编辑档案"
					aria-label="编辑档案"
					onClick={onEditProfile}
				>
					{userProfile?.avatarEmoji ?? (userProfile?.nickname ?? "U").slice(0, 1).toUpperCase()}
				</button>
				<div className="account-copy">
					<strong>{userProfile?.nickname ?? "用户"}</strong>
					<span>本地档案</span>
				</div>
				<button
					type="button"
					className="icon-button quiet"
					title="设置"
					aria-label="设置"
					onClick={() => onNavigate?.("capabilities")}
				>
					<Wrench size={16} />
				</button>
			</div>
		</aside>
	);
}

/** Local slash commands (OpenClaw-style: chat is the hub). */
const LOCAL_SLASH: Array<{
	id: string;
	match: RegExp;
	label: string;
	hint: string;
	kind: "action" | "nav" | "insert";
}> = [
	{
		id: "remember",
		match: /^\/(remember|记住)(?:\s+([\s\S]+))?$/i,
		label: "/记住",
		hint: "把内容写入记忆",
		kind: "action",
	},
	{
		id: "task",
		match: /^\/(task|任务)(?:\s+([\s\S]+))?$/i,
		label: "/任务",
		hint: "从对话创建定时任务",
		kind: "action",
	},
	{ id: "memory", match: /^\/(memory|记忆)\s*$/i, label: "/记忆", hint: "打开记忆页", kind: "nav" },
	{ id: "tasks", match: /^\/(tasks|任务列表)\s*$/i, label: "/任务列表", hint: "打开定时任务", kind: "nav" },
	{
		id: "capabilities",
		match: /^\/(capabilities|能力|skills|mcp)\s*$/i,
		label: "/能力",
		hint: "打开能力与扩展",
		kind: "nav",
	},
	{ id: "security", match: /^\/(security|安全)\s*$/i, label: "/安全", hint: "打开安全策略", kind: "nav" },
	{
		id: "intelligence",
		match: /^\/(intelligence|智能|intel)\s*$/i,
		label: "/智能",
		hint: "打开规划记录",
		kind: "nav",
	},
	{ id: "daemon", match: /^\/(daemon|runtime|运行时)\s*$/i, label: "/运行时", hint: "打开本地服务", kind: "nav" },
];

type ChatNavView = "tasks" | "capabilities" | "memory" | "security" | "intelligence" | "daemon";

const MEMORY_STARTERS: Array<{ type: string; key: string; value: string; label: string }> = [
	{
		type: "user",
		key: "reply-style",
		value: "偏好简洁中文：先结论，再必要细节；少套话。",
		label: "回复风格",
	},
	{
		type: "project",
		key: "openpi-context",
		value: "本仓库是 OpenPI monorepo；桌面端用 Electron，运行时走 orchestrator。",
		label: "项目上下文",
	},
	{
		type: "lesson",
		key: "dev-habit",
		value: "改完相关代码再跑针对性测试；不要为了过检查而降级功能。",
		label: "协作习惯",
	},
];

interface ParsedMemoryEntry {
	type: string;
	key: string;
	value: string;
	raw: string;
	parsed: boolean;
}

interface ParsedSecurityAudit {
	title: string;
	target?: string;
	decision?: string;
	reason?: string;
	timestamp?: string | number;
	raw: string;
	parsed: boolean;
}

export function parseMemoryEntry(raw: string): ParsedMemoryEntry {
	const match = raw.match(/^\[(user|feedback|project|lesson)\]\s+([^:]+):\s*(.*)$/i);
	if (!match) return { type: "unknown", key: "Unrecognized entry", value: raw, raw, parsed: false };
	return {
		type: match[1]?.toLowerCase() ?? "unknown",
		key: match[2]?.trim() ?? "Memory",
		value: match[3]?.trim() ?? "",
		raw,
		parsed: true,
	};
}

export function parseSecurityAudit(raw: string): ParsedSecurityAudit {
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!isRecord(parsed)) throw new Error("Audit entry is not an object");
		const title =
			typeof parsed.tool === "string"
				? parsed.tool
				: typeof parsed.action === "string"
					? parsed.action
					: typeof parsed.event === "string"
						? parsed.event
						: "Security event";
		return {
			title,
			target: typeof parsed.target === "string" ? parsed.target : undefined,
			decision: typeof parsed.decision === "string" ? parsed.decision : undefined,
			reason: typeof parsed.reason === "string" ? parsed.reason : undefined,
			timestamp:
				typeof parsed.timestamp === "string" || typeof parsed.timestamp === "number" ? parsed.timestamp : undefined,
			raw,
			parsed: true,
		};
	} catch {
		return { title: "Unparsed security event", raw, parsed: false };
	}
}

export function formatAuditTimestamp(value?: string | number): string {
	if (value === undefined) return "Time unavailable";
	const numericValue = typeof value === "number" && value < 1_000_000_000_000 ? value * 1_000 : value;
	const date = new Date(numericValue);
	if (Number.isNaN(date.getTime())) return String(value);
	return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function prettyJson(value: string): string {
	if (!value.trim()) return "选择一次规划以查看详情。";
	try {
		const parsed: unknown = JSON.parse(value);
		return JSON.stringify(parsed, null, 2);
	} catch {
		return value;
	}
}

export function parseCommand(command: string): { name: string; description: string } {
	const [name, ...description] = command.split(/\s+(?:\u2014|\u2013|-)\s+/);
	return { name: name?.trim() || command, description: description.join(" - ").trim() || "Conversation command" };
}

export function formatUptime(uptimeMs?: number): string {
	if (uptimeMs === undefined) return "Unavailable";
	const totalMinutes = Math.max(0, Math.floor(uptimeMs / 60_000));
	const days = Math.floor(totalMinutes / 1_440);
	const hours = Math.floor((totalMinutes % 1_440) / 60);
	const minutes = totalMinutes % 60;
	if (days > 0) return `${days}d ${hours}h`;
	if (hours > 0) return `${hours}h ${minutes}m`;
	return `${minutes}m`;
}

export function MemorySurface({
	workspace,
	entries,
	draft,
	scope = "project",
	meta,
	busy,
	onOpenSidebar,
	onRefresh,
	onScopeChange,
	onMaintain,
	onDraftChange,
	onSave,
	onSaveEntry,
	onDelete,
}: {
	workspace?: string;
	entries: string[];
	draft: { type: string; key: string; value: string; body?: string };
	scope?: "project" | "global";
	meta?: {
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
	};
	busy?: string;
	onOpenSidebar(): void;
	onRefresh(): void;
	onScopeChange?(scope: "project" | "global"): void;
	onMaintain?(): void;
	onDraftChange(field: "type" | "key" | "value" | "body", value: string): void;
	onSave(): void;
	onSaveEntry(memoryType: string, key: string, value: string): void;
	onDelete(memoryType: string, key: string): void;
}) {
	const [filter, setFilter] = useState("");
	const [typeFilter, setTypeFilter] = useState<string>("all");
	const parsedEntries = entries.map(parseMemoryEntry).filter((entry) => entry.parsed);
	const filteredEntries = parsedEntries.filter((entry) => {
		if (typeFilter !== "all" && entry.type !== typeFilter) return false;
		const q = filter.trim().toLowerCase();
		if (!q) return true;
		return (
			entry.key.toLowerCase().includes(q) ||
			entry.value.toLowerCase().includes(q) ||
			entry.type.toLowerCase().includes(q)
		);
	});
	const refreshing = busy === "memory-refresh";
	const seeding = busy === "write-memory";
	const maintaining = busy === "memory-maintain";
	const empty = parsedEntries.length === 0;
	const workspaceLabel = workspace ? shortWorkspacePath(workspace) : "未选择工作区";
	const scopeLabel = scope === "global" ? "全局 ~/.pi/memory" : `项目 · ${workspaceLabel}`;
	const proactiveOn = meta?.features?.proactiveInject !== false;
	const digestEntries = parsedEntries.filter((e) => e.key.startsWith("session-"));

	return (
		<section className="operations-surface memory-surface">
			<header className="surface-header operation-page-header">
				<button
					className="icon-button quiet mobile-only"
					title="打开对话列表"
					aria-label="打开对话列表"
					onClick={onOpenSidebar}
				>
					<Menu size={18} />
				</button>
				<div className="surface-heading">
					<strong>记忆</strong>
					<span>
						{scopeLabel}
						{proactiveOn ? " · 跨对话自动注入" : ""}
						{meta?.lastMaintainAt ? ` · 整理 ${formatAuditTimestamp(meta.lastMaintainAt)}` : ""}
					</span>
				</div>
				<div className="surface-actions">
					<div className="memory-scope-toggle">
						<button
							type="button"
							className={scope === "project" ? "active" : ""}
							onClick={() => onScopeChange?.("project")}
						>
							项目{meta?.projectCount !== undefined ? ` ${meta.projectCount}` : ""}
						</button>
						<button
							type="button"
							className={scope === "global" ? "active" : ""}
							onClick={() => onScopeChange?.("global")}
						>
							全局{meta?.globalCount !== undefined ? ` ${meta.globalCount}` : ""}
						</button>
					</div>
					{!empty && <span className="memory-count-pill">{parsedEntries.length} 条</span>}
					<button
						className="icon-button quiet"
						title="整理记忆（去重）"
						aria-label="整理记忆"
						disabled={maintaining}
						onClick={() => onMaintain?.()}
					>
						<Sparkles size={17} className={maintaining ? "spin" : undefined} />
					</button>
					<button
						className="icon-button quiet"
						title="刷新"
						aria-label="刷新"
						disabled={refreshing || (!workspace && scope === "project")}
						onClick={onRefresh}
					>
						<RefreshCw size={17} className={refreshing ? "spin" : undefined} />
					</button>
				</div>
			</header>
			<div className="operations-scroll">
				<div className="operations-content memory-content">
					<div className="memory-proactive-banner">
						<div className="memory-proactive-copy">
							<strong>{proactiveOn ? "跨对话自动召回已开启" : "自动召回已关闭"}</strong>
							<p>
								你不必说「去查记忆」。每轮对话会按当前问题自动注入相关长期记忆；偏好可同步到全局
								~/.pi/memory。会话结束会写 session 摘要，方便下次接上。
							</p>
						</div>
						<div className="memory-proactive-stats">
							<span className="memory-stat-pill">项目 {meta?.projectCount ?? "—"}</span>
							<span className="memory-stat-pill">全局 {meta?.globalCount ?? "—"}</span>
							{(meta?.archiveCount ?? 0) > 0 && (
								<span className="memory-stat-pill">归档 {meta?.archiveCount}</span>
							)}
							{(meta?.digestCount ?? digestEntries.length) > 0 && (
								<span className="memory-stat-pill">摘要 {meta?.digestCount ?? digestEntries.length}</span>
							)}
							{meta?.hasVectors && <span className="memory-stat-pill quiet">本地向量</span>}
							{meta?.hasLexicon && <span className="memory-stat-pill quiet">倒排索引</span>}
						</div>
						{meta?.latestDigest && <p className="memory-latest-digest">最近会话：{meta.latestDigest}</p>}
					</div>
					{empty ? (
						<div className="memory-empty-hero">
							<div className="memory-empty-copy">
								<span className="memory-empty-kicker">还是空白</span>
								<strong>先记几条，后面对话会自动用上</strong>
								<p>不用刻意提醒 AI「我之前说过」。写进记忆后，新对话会按内容自动注入。也可点下面一键写入。</p>
							</div>
							<div className="memory-starter-grid">
								{MEMORY_STARTERS.map((starter) => (
									<button
										key={starter.key}
										type="button"
										className="memory-starter-card"
										disabled={!workspace || seeding}
										onClick={() => onSaveEntry(starter.type, starter.key, starter.value)}
									>
										<span className={`memory-type ${starter.type}`}>{starter.label}</span>
										<strong>{starter.value}</strong>
										<span className="memory-starter-cta">{seeding ? "写入中…" : "一键记住"}</span>
									</button>
								))}
							</div>
							{!workspace && <p className="memory-empty-note">先选中左侧一个对话，记忆会写到对应工作区。</p>}
							<details className="memory-advanced">
								<summary>自己写一条</summary>
								<form
									className="memory-inline-form"
									onSubmit={(event) => {
										event.preventDefault();
										onSave();
									}}
								>
									<input
										value={draft.key}
										onChange={(event) => onDraftChange("key", event.target.value)}
										placeholder="简短键名，如 coding-style"
										disabled={!workspace || seeding}
									/>
									<textarea
										rows={3}
										value={draft.value}
										onChange={(event) => onDraftChange("value", event.target.value)}
										placeholder="用一句话写清楚要记住的事"
										disabled={!workspace || seeding}
									/>
									<button
										className="button primary"
										type="submit"
										disabled={!workspace || !draft.key.trim() || !draft.value.trim() || seeding}
									>
										{seeding ? <RefreshCw size={15} className="spin" /> : <Save size={15} />}
										保存
									</button>
								</form>
							</details>
						</div>
					) : (
						<div className="memory-filled">
							<div className="memory-toolbar">
								<input
									className="memory-filter"
									value={filter}
									onChange={(event) => setFilter(event.target.value)}
									placeholder="搜索键名或内容…"
								/>
								<div className="memory-type-filters">
									{(["all", "user", "feedback", "project", "lesson"] as const).map((type) => (
										<button
											key={type}
											type="button"
											className={typeFilter === type ? "active" : ""}
											onClick={() => setTypeFilter(type)}
										>
											{type === "all" ? "全部" : type}
										</button>
									))}
								</div>
								<span className="memory-filter-count">
									{filteredEntries.length}/{parsedEntries.length}
								</span>
							</div>
							<div className="memory-card-list">
								{filteredEntries.length === 0 ? (
									<p className="memory-empty-note">没有匹配的记忆。</p>
								) : (
									filteredEntries.map((entry, index) => (
										<article className="memory-card" key={`${entry.type}-${entry.key}-${index}`}>
											<header>
												<span className={`memory-type ${entry.type}`}>{entry.type}</span>
												<strong>{entry.key}</strong>
												<button
													className="icon-button quiet"
													type="button"
													title="载入编辑"
													aria-label="载入编辑"
													onClick={() => {
														onDraftChange("type", entry.type);
														onDraftChange("key", entry.key);
														onDraftChange("value", entry.value);
														onDraftChange("body", entry.value);
													}}
												>
													<Pencil size={14} />
												</button>
												<button
													className="icon-button quiet danger"
													type="button"
													title={`删除 ${entry.key}`}
													aria-label={`删除 ${entry.key}`}
													disabled={busy === "delete-memory"}
													onClick={() => onDelete(entry.type, entry.key)}
												>
													<Trash2 size={15} />
												</button>
											</header>
											<p>{entry.value}</p>
										</article>
									))
								)}
							</div>
							<form
								className="operation-panel memory-editor memory-editor-compact"
								onSubmit={(event) => {
									event.preventDefault();
									onSave();
								}}
							>
								<div className="operation-panel-title">
									<div>
										<h2>再记一条 / 编辑</h2>
										<span>写入当前工作区，跨对话仍然生效</span>
									</div>
									<Save size={16} />
								</div>
								<div className="operation-form">
									<label>
										分类
										<Select
											value={draft.type}
											onValueChange={(value) => onDraftChange("type", value)}
											disabled={!workspace || seeding}
										>
											<SelectTrigger className="operation-select">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="user">用户</SelectItem>
												<SelectItem value="feedback">反馈</SelectItem>
												<SelectItem value="project">项目</SelectItem>
												<SelectItem value="lesson">经验</SelectItem>
											</SelectContent>
										</Select>
									</label>
									<label>
										键名
										<input
											value={draft.key}
											onChange={(event) => onDraftChange("key", event.target.value)}
											placeholder="coding-style"
											disabled={!workspace || seeding}
										/>
									</label>
									<label>
										摘要（索引）
										<textarea
											rows={2}
											value={draft.value}
											onChange={(event) => onDraftChange("value", event.target.value)}
											placeholder="一句话写清楚"
											disabled={!workspace || seeding}
										/>
									</label>
									<label>
										正文（可选）
										<textarea
											rows={3}
											value={draft.body ?? ""}
											onChange={(event) => onDraftChange("body", event.target.value)}
											placeholder="更完整的说明，会写入主题文件"
											disabled={!workspace || seeding}
										/>
									</label>
									<button
										className="button primary"
										type="submit"
										disabled={!workspace || !draft.key.trim() || !draft.value.trim() || seeding}
									>
										{seeding ? <RefreshCw size={15} className="spin" /> : <Save size={15} />}
										保存
									</button>
								</div>
							</form>
						</div>
					)}
				</div>
			</div>
		</section>
	);
}

export function SecuritySurface({
	mode,
	audit,
	busy,
	onOpenSidebar,
	onModeChange,
	onRefresh,
}: {
	mode?: string;
	audit: string[];
	busy?: string;
	onOpenSidebar(): void;
	onModeChange(mode: string): void;
	onRefresh(): void;
}) {
	const auditEntries = audit.map(parseSecurityAudit);
	const blockedCount = auditEntries.filter((entry) => entry.decision?.toLowerCase() === "blocked").length;
	const modeMeta: Record<string, { label: string; description: string }> = {
		strict: { label: "严格", description: "高风险操作直接拒绝，适合无人值守" },
		confirm: { label: "确认", description: "敏感操作先问你，日常推荐" },
		permissive: { label: "宽松", description: "大多放行，只拦极端危险操作" },
		bypass: { label: "放开", description: "除非破坏系统/项目，否则全部放行" },
	};
	const activeModeMeta = mode ? modeMeta[mode] : undefined;
	const refreshing = busy === "security-refresh";
	return (
		<section className="operations-surface">
			<header className="surface-header operation-page-header">
				<button
					className="icon-button quiet mobile-only"
					title="对话列表"
					aria-label="对话列表"
					onClick={onOpenSidebar}
				>
					<Menu size={18} />
				</button>
				<div className="surface-heading">
					<strong>安全</strong>
					<span>系统级策略 · 对所有项目和新会话生效</span>
				</div>
				<div className="surface-actions">
					<button
						className="icon-button quiet"
						title="刷新"
						aria-label="刷新"
						disabled={refreshing}
						onClick={onRefresh}
					>
						<RefreshCw size={17} className={refreshing ? "spin" : undefined} />
					</button>
				</div>
			</header>
			<div className="operations-scroll">
				<div className="operations-content product-page">
					<section className="product-hero-card">
						<span className="operation-icon security">
							<ShieldCheck size={18} />
						</span>
						<div>
							<strong>{mode ? `当前策略：${activeModeMeta?.label ?? mode}` : "正在读取系统策略…"}</strong>
							<p>{activeModeMeta?.description ?? "从用户级配置读取安全策略"}</p>
						</div>
						{blockedCount > 0 && <span className="memory-count-pill">{blockedCount} 次拦截</span>}
					</section>
					<section className="security-policy product-section">
						<div className="security-policy-copy">
							<span>切换模式</span>
							<strong>改完立即对所有工作区生效</strong>
						</div>
						<div className="segmented security-modes" aria-label="安全模式">
							{(["strict", "confirm", "permissive", "bypass"] as const).map((candidate) => (
								<button
									type="button"
									className={mode === candidate ? "active" : ""}
									key={candidate}
									disabled={!mode || busy === "security-mode"}
									onClick={() => onModeChange(candidate)}
								>
									{modeMeta[candidate].label}
								</button>
							))}
						</div>
					</section>
					<div className="operation-panel security-audit">
						<div className="operation-panel-title">
							<div>
								<h2>最近决策</h2>
								<span>助手调用敏感工具时的放行 / 拦截记录</span>
							</div>
							<History size={16} />
						</div>
						<div className="operation-list">
							{auditEntries.length === 0 ? (
								<div className="product-empty">
									<ShieldCheck size={28} />
									<strong>还没有安全事件</strong>
									<span>当助手要执行删除、写敏感路径等操作时，记录会出现在这里。安静是好事。</span>
								</div>
							) : (
								auditEntries.map((entry, index) => {
									const decision = entry.decision?.toLowerCase();
									const tone =
										decision === "blocked" || decision === "denied"
											? "blocked"
											: decision === "allowed" || decision === "approved"
												? "allowed"
												: "neutral";
									const decisionZh =
										decision === "blocked" || decision === "denied"
											? "已拦截"
											: decision === "allowed" || decision === "approved"
												? "已放行"
												: decision === "confirmed"
													? "已确认"
													: entry.decision;
									return (
										<div className="audit-row" key={`${entry.raw}-${index}`}>
											<span className={`audit-mark ${tone}`}>
												<ShieldCheck size={15} />
											</span>
											<div className="audit-copy">
												<div>
													<strong>{entry.title}</strong>
													{entry.decision && (
														<span className={`audit-decision ${tone}`}>{decisionZh}</span>
													)}
												</div>
												<span>{entry.target ?? (entry.parsed ? "无目标" : entry.raw)}</span>
												{entry.reason && <small>{entry.reason}</small>}
											</div>
											<time>{formatAuditTimestamp(entry.timestamp)}</time>
										</div>
									);
								})
							)}
						</div>
					</div>
				</div>
			</div>
		</section>
	);
}

export function IntelligenceSurface({
	workspace,
	runs,
	commands,
	selectedRunId,
	detail,
	busy,
	onOpenSidebar,
	onRefresh,
	onSelectRun,
}: {
	workspace?: string;
	runs: string[];
	commands: string[];
	selectedRunId?: string;
	detail: string;
	busy?: string;
	onOpenSidebar(): void;
	onRefresh(): void;
	onSelectRun(runId: string): void;
}) {
	const parsedCommands = commands.map(parseCommand);
	const refreshing = busy === "intelligence-refresh";
	const workspaceLabel = workspace ? shortWorkspacePath(workspace) : "未选择工作区";
	return (
		<section className="operations-surface">
			<header className="surface-header operation-page-header">
				<button
					className="icon-button quiet mobile-only"
					title="对话列表"
					aria-label="对话列表"
					onClick={onOpenSidebar}
				>
					<Menu size={18} />
				</button>
				<div className="surface-heading">
					<strong>智能规划</strong>
					<span>复杂任务的计划与执行记录 · {workspaceLabel}</span>
				</div>
				<div className="surface-actions">
					{runs.length > 0 && <span className="memory-count-pill">{runs.length} 次规划</span>}
					<button
						className="icon-button quiet"
						title="刷新"
						aria-label="刷新"
						disabled={refreshing}
						onClick={onRefresh}
					>
						<RefreshCw size={17} className={refreshing ? "spin" : undefined} />
					</button>
				</div>
			</header>
			<div className="operations-scroll">
				<div className="operations-content intelligence-content product-page">
					{runs.length === 0 ? (
						<div className="product-empty large">
							<BrainCircuit size={32} />
							<strong>还没有规划记录</strong>
							<span>
								在对话里让助手做多步骤任务时，会在这里留下计划清单。也可以在聊天输入 <code>/intel</code>{" "}
								相关命令（若已启用）。
							</span>
							{parsedCommands.length > 0 && (
								<div className="command-grid empty-commands">
									{parsedCommands.slice(0, 6).map((command) => (
										<div className="command-row" key={`${command.name}-${command.description}`}>
											<code>{command.name}</code>
											<span>{command.description}</span>
										</div>
									))}
								</div>
							)}
						</div>
					) : (
						<>
							<div className="intelligence-workspace">
								<div className="operation-panel intelligence-runs">
									<div className="operation-panel-title">
										<div>
											<h2>规划历史</h2>
											<span>点一条查看详情</span>
										</div>
										<FileJson size={16} />
									</div>
									<div className="run-browser-list">
										{[...runs].reverse().map((runId) => (
											<button
												className={`intelligence-run-row ${selectedRunId === runId ? "selected" : ""}`}
												type="button"
												key={runId}
												onClick={() => onSelectRun(runId)}
											>
												<span className="run-document">
													<FileJson size={15} />
												</span>
												<span>
													<strong>{runId}</strong>
													<small>计划详情</small>
												</span>
												<ChevronRight size={15} />
											</button>
										))}
									</div>
								</div>
								<div className="operation-panel intelligence-detail">
									<div className="operation-panel-title">
										<div>
											<h2>{selectedRunId ?? "详情"}</h2>
											<span>{selectedRunId ? "结构化执行计划" : "从左侧选一条"}</span>
										</div>
										{busy === "intelligence-detail" ? (
											<RefreshCw size={16} className="spin" />
										) : (
											<TerminalSquare size={16} />
										)}
									</div>
									<pre>{prettyJson(detail)}</pre>
								</div>
							</div>
							{parsedCommands.length > 0 && (
								<div className="operation-panel command-panel">
									<div className="operation-panel-title">
										<div>
											<h2>对话命令</h2>
											<span>当前会话可用的斜杠命令</span>
										</div>
										<TerminalSquare size={16} />
									</div>
									<div className="command-grid">
										{parsedCommands.map((command) => (
											<div className="command-row" key={`${command.name}-${command.description}`}>
												<code>{command.name}</code>
												<span>{command.description}</span>
											</div>
										))}
									</div>
								</div>
							)}
						</>
					)}
				</div>
			</div>
		</section>
	);
}

export function DaemonSurface({
	snapshot,
	busy,
	onOpenSidebar,
	onStart,
	onStop,
	onRestart,
	onStopInstance,
	onPruneStopped,
}: {
	snapshot: DesktopSnapshot;
	busy?: string;
	onOpenSidebar(): void;
	onStart(): void;
	onStop(): void;
	onRestart(): void;
	onStopInstance(instanceId: string): void;
	onPruneStopped(): void;
}) {
	const activeTasks = snapshot.health?.tasksActive ?? snapshot.tasks.filter((task) => task.status === "active").length;
	const pausedTasks = snapshot.health?.tasksPaused ?? snapshot.tasks.filter((task) => task.status === "paused").length;
	const runningRuns = snapshot.health?.runsRunning ?? snapshot.runs.filter((run) => run.status === "running").length;
	const queuedRuns = snapshot.health?.runsQueued ?? snapshot.runs.filter((run) => run.status === "queued").length;
	const changingState =
		busy === "daemon-start" || busy === "daemon-stop" || busy === "daemon" || busy === "daemon-restart";
	const stats = snapshot.instanceStats;
	const healthMissing = snapshot.daemonRunning && !snapshot.health?.version && !snapshot.health?.uptimeMs;
	return (
		<section className="operations-surface">
			<header className="surface-header operation-page-header">
				<button
					className="icon-button quiet mobile-only"
					title="Open conversations"
					aria-label="Open conversations"
					onClick={onOpenSidebar}
				>
					<Menu size={18} />
				</button>
				<div className="surface-heading">
					<strong>运行时</strong>
					<span>后台服务是否在线，以及有多少助手进程</span>
				</div>
				<div className="surface-actions">
					<span className={`service-state header-state ${snapshot.daemonRunning ? "online" : "offline"}`}>
						<i />
						{snapshot.daemonRunning ? "在线" : "已停止"}
					</span>
				</div>
			</header>
			<div className="operations-scroll">
				<div className="operations-content product-page">
					<div className="daemon-status-band">
						<span className={`daemon-symbol ${snapshot.daemonRunning ? "online" : "offline"}`}>
							<Server size={20} />
						</span>
						<div>
							<span>本地服务</span>
							<strong>{snapshot.daemonRunning ? "可以正常对话与跑任务" : "服务已停止，对话会失败"}</strong>
							<small>{snapshot.health?.socketPath ?? "尚未连接本地 socket"}</small>
							{healthMissing && (
								<small className="health-hint">健康信息缺失：点「重启」加载当前 orchestrator 构建</small>
							)}
						</div>
						<div className="daemon-actions">
							{snapshot.daemonRunning ? (
								<>
									<button className="button" type="button" disabled={changingState} onClick={onRestart}>
										{busy === "daemon-restart" ? (
											<RefreshCw size={15} className="spin" />
										) : (
											<RefreshCw size={15} />
										)}
										重启
									</button>
									<button className="button danger" type="button" disabled={changingState} onClick={onStop}>
										{changingState && busy !== "daemon-restart" ? (
											<RefreshCw size={15} className="spin" />
										) : (
											<CircleStop size={15} />
										)}
										停止
									</button>
								</>
							) : (
								<button className="button primary" type="button" disabled={changingState} onClick={onStart}>
									{changingState ? <RefreshCw size={15} className="spin" /> : <Play size={15} />}
									启动服务
								</button>
							)}
						</div>
					</div>
					<div className="operations-metrics four">
						<div>
							<span>版本</span>
							<strong>{snapshot.health?.version ?? "—"}</strong>
						</div>
						<div>
							<span>运行时长</span>
							<strong>{snapshot.daemonRunning ? formatUptime(snapshot.health?.uptimeMs) : "已停止"}</strong>
						</div>
						<div>
							<span>定时任务</span>
							<strong>
								{activeTasks} 启用 <small>{pausedTasks} 暂停</small>
							</strong>
						</div>
						<div>
							<span>执行中</span>
							<strong>
								{runningRuns} 运行 <small>{queuedRuns} 排队</small>
							</strong>
						</div>
					</div>
					<div className="operation-panel daemon-instances">
						<div className="operation-panel-title">
							<div>
								<h2>助手进程</h2>
								<span>
									{stats
										? `${stats.active} 活跃 · ${stats.stopped} 已停 · 显示 ${stats.shown}`
										: `显示 ${snapshot.instances.length}`}
								</span>
							</div>
							{(stats?.stopped ?? 0) > 0 && (
								<button
									className="button"
									type="button"
									disabled={busy === "prune-stopped"}
									onClick={onPruneStopped}
								>
									{busy === "prune-stopped" ? <RefreshCw size={15} className="spin" /> : <Trash2 size={15} />}
									清理已停止
								</button>
							)}
						</div>
						<div className="operation-list">
							{snapshot.instances.length === 0 ? (
								<div className="operation-empty">
									<Server size={21} />
									<strong>还没有助手进程</strong>
									<span>新建或打开一个对话后，这里会出现对应进程。</span>
								</div>
							) : (
								snapshot.instances.map((instance) => (
									<div className="daemon-instance-row" key={instance.id}>
										<span className={`instance-symbol ${instance.status}`}>
											<Bot size={16} />
										</span>
										<div className="daemon-instance-body">
											<div className="daemon-instance-title">
												<strong>{instanceTitle(instance)}</strong>
												<span className={`instance-status ${instance.status}`}>
													{statusLabel(instance.status)}
												</span>
											</div>
											<div className="daemon-instance-meta" title={instance.cwd}>
												{shortWorkspacePath(instance.cwd)}
											</div>
											<code className="daemon-instance-id" title={instance.id}>
												{instance.id}
											</code>
										</div>
										{instance.status !== "stopped" && (
											<button
												className="icon-button quiet danger"
												type="button"
												title={`Stop ${instanceTitle(instance)}`}
												aria-label={`Stop ${instanceTitle(instance)}`}
												disabled={busy === "stop-instance"}
												onClick={() => onStopInstance(instance.id)}
											>
												<Square size={14} />
											</button>
										)}
									</div>
								))
							)}
						</div>
					</div>
				</div>
			</div>
		</section>
	);
}

export function ChatSurface({
	mode,
	workspace,
	conversation,
	selectedInstance,
	stats,
	providerBalance,
	optimisticMessage,
	modelOptions,
	loadingModels,
	draftRequest,
	configuring,
	sending,
	slashCommands = [],
	onSend,
	onError,
	onModelChange,
	onThinkingLevelChange,
	onAbort,
	onOpenSidebar,
	onToggleContext,
	activeTab,
	onTabChange,
	onRemember,
	onCreateTaskFromChat,
	onNavigate,
	onNewConversation,
	onRenameConversation,
	onExportConversation,
	turnMeta,
	appMode,
	onAppModeChange,
}: {
	mode: AgentMode;
	workspace?: string;
	conversation?: ConversationSnapshot;
	selectedInstance?: AgentInstance;
	stats?: ConversationStats;
	providerBalance?: { currency: string; totalBalance: number } | null;
	optimisticMessage?: ConversationMessage;
	modelOptions: ConversationModelOption[];
	loadingModels: boolean;
	draftRequest?: { id: string; text: string };
	configuring: boolean;
	sending: boolean;
	slashCommands?: string[];
	/** Run stats (TPS etc.) under the latest assistant reply */
	turnMeta?: string;
	onSend(message: string, images: ImageContent[]): Promise<void>;
	onError(message: string): void;
	onModelChange(model: ConversationModelOption): void;
	onThinkingLevelChange(level: ThinkingLevel): void;
	onAbort(): void;
	onOpenSidebar(): void;
	onToggleContext(): void;
	activeTab: "chat" | "activity";
	onTabChange(tab: "chat" | "activity"): void;
	onRemember(text: string): Promise<void> | void;
	onCreateTaskFromChat(prompt: string): void;
	onNavigate(view: ChatNavView): void;
	onNewConversation?(): void;
	onRenameConversation?(): void;
	onExportConversation?(): void;
	appMode: AppMode;
	onAppModeChange(mode: AppMode): void;
}) {
	const [draft, setDraft] = useState("");
	const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
	const [preparingImages, setPreparingImages] = useState(false);
	const [draggingImages, setDraggingImages] = useState(false);
	const [showScrollToBottom, setShowScrollToBottom] = useState(false);
	const [moreMenuOpen, setMoreMenuOpen] = useState(false);
	const [modelMenuOpen, setModelMenuOpen] = useState(false);
	const [slashOpen, setSlashOpen] = useState(false);
	const [slashIndex, setSlashIndex] = useState(0);
	const [toast, setToast] = useState<string>();
	const [speechState, setSpeechState] = useState<"idle" | "starting" | "listening">("idle");
	const [composerMode, setComposerMode] = useState<MediaComposerMode>("chat");
	const [mediaCapabilities, setMediaCapabilities] = useState<AgnesMediaCapabilities>();
	const [imageSize, setImageSize] = useState<AgnesImageSize>("2K");
	const [imageRatio, setImageRatio] = useState<AgnesImageRatio>("1:1");
	const [videoResolution, setVideoResolution] = useState<VideoResolution>("720p");
	const [videoRatio, setVideoRatio] = useState<VideoRatio>("16:9");
	const [videoFrames, setVideoFrames] = useState(121);
	const [mediaHistory, setMediaHistory] = useState<Record<string, GeneratedMediaItem[]>>(() =>
		loadMediaHistory(typeof window === "undefined" ? null : window.localStorage.getItem(MEDIA_HISTORY_STORAGE_KEY)),
	);
	const attachmentInput = useRef<HTMLInputElement>(null);
	const draftInput = useRef<HTMLTextAreaElement>(null);
	const conversationInstanceId = useRef(conversation?.instance.id);
	conversationInstanceId.current = conversation?.instance.id;
	const dragDepth = useRef(0);
	const messageScroll = useRef<HTMLDivElement>(null);
	const autoFollow = useRef(true);
	const pollingVideos = useRef(new Set<string>());
	const speechSessionId = useRef<string | undefined>(undefined);
	const speechShouldContinue = useRef(false);
	const speechBaseDraft = useRef("");
	const speechCommittedText = useRef("");
	const speechSessionFinalText = useRef("");
	const speechSessionInterimText = useRef("");
	const speechRestartTimer = useRef<number | undefined>(undefined);
	const speechErrorHandler = useRef(onError);
	speechErrorHandler.current = onError;
	const isStreaming = conversation?.state.isStreaming ?? false;
	const isWorking = isStreaming || optimisticMessage !== undefined;
	const storedMessages =
		conversation?.messages.filter((message) => ["user", "assistant", "toolResult"].includes(message.role)) ?? [];
	const messages = optimisticMessage ? [...storedMessages, optimisticMessage] : storedMessages;
	const mediaScope = conversation?.instance.id
		? `conversation:${conversation.instance.id}`
		: workspace
			? `workspace:${workspace}`
			: `mode:${mode}`;
	const mediaItems = mediaHistory[mediaScope] ?? [];
	const mediaSubmitting = mediaItems.some((item) => item.status === "generating");
	const mediaTimeline = mediaItems
		.map((item, index) => ({ key: `media:${item.id}`, timestamp: item.createdAt, index, media: item }))
		.sort((left, right) => left.timestamp - right.timestamp || left.index - right.index);
	const messageTimeline = messages.map((message, index) => ({
		key: `message:${message.timestamp ?? index}:${index}`,
		timestamp: message.timestamp ?? index,
		index,
		message,
	}));
	const threadItems = [...messageTimeline, ...mediaTimeline].sort(
		(left, right) => left.timestamp - right.timestamp || left.index - right.index,
	);
	const latestMessage = messages[messages.length - 1];
	const latestMessageContent = latestMessage
		? `${latestMessage.timestamp ?? ""}:${contentText(latestMessage.content)}:${contentImages(latestMessage.content)
				.map((image) => `${image.mimeType}:${image.data.length}`)
				.join(",")}`
		: "";
	const modelGroups = useMemo(() => {
		const groups = new Map<string, ConversationModelOption[]>();
		for (const model of modelOptions) {
			const providerModels = groups.get(model.provider) ?? [];
			providerModels.push(model);
			groups.set(model.provider, providerModels);
		}
		return [...groups];
	}, [modelOptions]);
	const currentModel = modelOptions.find(
		(model) => model.provider === conversation?.state.model?.provider && model.id === conversation.state.model.id,
	);
	// Prefer model-declared levels; never fall back to only the current value
	// (that made the UI look like only "high" existed).
	const availableThinkingLevels: ThinkingLevel[] =
		currentModel?.thinkingLevels && currentModel.thinkingLevels.length > 0
			? currentModel.thinkingLevels
			: thinkingLevelsForModel({ reasoning: true });
	const configurationDisabled = !conversation || isWorking || configuring;
	const supportsComposerImages = composerMode === "image" || composerMode === "chat";
	const canSubmit =
		composerMode === "chat"
			? draft.trim().length > 0 || attachments.length > 0
			: draft.trim().length > 0 && (composerMode !== "video" || attachments.length === 0);
	const latestMediaContent = mediaItems
		.map(
			(item) => `${item.id}:${item.status}:${item.progress ?? 0}:${item.image?.url ?? ""}:${item.video?.url ?? ""}`,
		)
		.join("|");
	const pendingVideoSignature = mediaItems
		.filter((item) => item.kind === "video" && (item.status === "queued" || item.status === "in_progress"))
		.map((item) => `${item.id}:${item.video?.videoId ?? ""}`)
		.join("|");

	const agentSlash = useMemo(
		() =>
			slashCommands.map((line) => {
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
		if (!slashQuery) return combined.slice(0, 12);
		return combined
			.filter(
				(item) =>
					item.label.toLowerCase().includes(slashQuery) ||
					item.hint.toLowerCase().includes(slashQuery) ||
					item.id.toLowerCase().includes(slashQuery),
			)
			.slice(0, 12);
	}, [agentSlash, localSlashItems, slashQuery]);

	useEffect(() => {
		const open = draft.startsWith("/") && !draft.includes("\n");
		setSlashOpen(open);
		if (open) setSlashIndex(0);
	}, [draft]);

	useEffect(() => {
		if (!toast) return;
		const timer = window.setTimeout(() => setToast(undefined), 2200);
		return () => window.clearTimeout(timer);
	}, [toast]);

	useEffect(() => {
		let disposed = false;
		void desktopApi
			.getMediaCapabilities()
			.then((capabilities) => {
				if (!disposed) setMediaCapabilities(capabilities);
			})
			.catch(() => {
				if (!disposed) setMediaCapabilities(undefined);
			});
		return () => {
			disposed = true;
		};
	}, []);

	useEffect(() => {
		try {
			window.localStorage.setItem(MEDIA_HISTORY_STORAGE_KEY, JSON.stringify(mediaHistory));
		} catch {
			// Remote URLs are persisted best-effort; generation remains usable when storage is full.
		}
	}, [mediaHistory]);

	useEffect(() => {
		if (!pendingVideoSignature) return;
		let disposed = false;
		const poll = async (): Promise<void> => {
			const pending = mediaItems.filter(
				(item) => item.kind === "video" && (item.status === "queued" || item.status === "in_progress"),
			);
			for (const item of pending) {
				const videoId = item.video?.videoId;
				if (!videoId || pollingVideos.current.has(item.id)) continue;
				pollingVideos.current.add(item.id);
				try {
					const video = await desktopApi.getVideo(videoId);
					if (disposed) return;
					updateMediaItem(mediaScope, item.id, (current) => ({
						...current,
						status: video.status,
						progress: video.progress,
						video: { ...current.video, ...video },
						error: video.status === "failed" ? mediaErrorMessage(video.error) : undefined,
					}));
				} catch {
					// Poll failures are transient. The next interval retries the same task.
				} finally {
					pollingVideos.current.delete(item.id);
				}
			}
		};
		void poll();
		const timer = window.setInterval(() => void poll(), 4_000);
		return () => {
			disposed = true;
			window.clearInterval(timer);
		};
	}, [mediaScope, pendingVideoSignature]);

	useEffect(() => {
		abortSpeechRecognition();
		autoFollow.current = true;
		setShowScrollToBottom(false);
		setMoreMenuOpen(false);
		setModelMenuOpen(false);
		setAttachments([]);
		setDraggingImages(false);
		setSlashOpen(false);
		dragDepth.current = 0;
	}, [conversation?.instance.id]);

	useEffect(() => () => abortSpeechRecognition(), []);

	useEffect(
		() =>
			desktopApi.onSpeechEvent((event) => {
				if (event.sessionId !== speechSessionId.current) return;
				if (event.type === "start") {
					if (speechShouldContinue.current) setSpeechState("listening");
					return;
				}
				if (event.type === "result") {
					speechSessionFinalText.current = event.isFinal ? event.transcript : "";
					speechSessionInterimText.current = event.isFinal ? "" : event.transcript;
					updateDraftFromSpeech();
					return;
				}
				if (event.type === "error") {
					speechShouldContinue.current = false;
					setSpeechState("idle");
					speechErrorHandler.current(event.message);
					return;
				}

				commitSpeechSession();
				speechSessionId.current = undefined;
				if (!speechShouldContinue.current) {
					setSpeechState("idle");
					return;
				}
				setSpeechState("starting");
				speechRestartTimer.current = window.setTimeout(() => {
					speechRestartTimer.current = undefined;
					beginSpeechRecognitionCycle();
				}, 120);
			}),
		[],
	);

	useEffect(() => {
		if (configurationDisabled) setModelMenuOpen(false);
	}, [configurationDisabled]);

	useEffect(() => {
		if (isWorking) abortSpeechRecognition();
	}, [isWorking]);

	useEffect(() => {
		if (!draftRequest) return;
		replaceDraft(draftRequest.text);
		draftInput.current?.focus();
	}, [draftRequest]);

	useEffect(() => {
		if (!autoFollow.current) return;
		const frame = window.requestAnimationFrame(() => {
			const scroll = messageScroll.current;
			if (scroll) scroll.scrollTop = scroll.scrollHeight;
		});
		return () => window.cancelAnimationFrame(frame);
	}, [latestMessageContent, latestMediaContent, isWorking]);

	function updateMediaItem(
		scope: string,
		itemId: string,
		update: (item: GeneratedMediaItem) => GeneratedMediaItem,
	): void {
		setMediaHistory((current) => ({
			...current,
			[scope]: (current[scope] ?? []).map((item) => (item.id === itemId ? update(item) : item)),
		}));
	}

	function appendMediaItem(scope: string, item: GeneratedMediaItem): void {
		setMediaHistory((current) => ({
			...current,
			[scope]: [...(current[scope] ?? []), item].slice(-40),
		}));
	}

	function handleMessageScroll(): void {
		const scroll = messageScroll.current;
		if (!scroll) return;
		const isAwayFromBottom = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight > 96;
		autoFollow.current = !isAwayFromBottom;
		setShowScrollToBottom(isAwayFromBottom);
	}

	function scrollToBottom(): void {
		autoFollow.current = true;
		setShowScrollToBottom(false);
		const scroll = messageScroll.current;
		if (scroll) scroll.scrollTop = scroll.scrollHeight;
	}

	function clearSpeechRestart(): void {
		if (speechRestartTimer.current === undefined) return;
		window.clearTimeout(speechRestartTimer.current);
		speechRestartTimer.current = undefined;
	}

	function resetSpeechSession(): void {
		speechSessionFinalText.current = "";
		speechSessionInterimText.current = "";
	}

	function updateDraftFromSpeech(): void {
		const currentSession = joinSpeechText(speechSessionFinalText.current, speechSessionInterimText.current);
		const transcript = joinSpeechText(speechCommittedText.current, currentSession);
		setDraft(joinSpeechText(speechBaseDraft.current, transcript));
	}

	function commitSpeechSession(): void {
		const currentSession = joinSpeechText(speechSessionFinalText.current, speechSessionInterimText.current);
		speechCommittedText.current = joinSpeechText(speechCommittedText.current, currentSession);
		resetSpeechSession();
		updateDraftFromSpeech();
	}

	function abortSpeechRecognition(): void {
		speechShouldContinue.current = false;
		clearSpeechRestart();
		setSpeechState("idle");
		const sessionId = speechSessionId.current;
		speechSessionId.current = undefined;
		if (sessionId) void desktopApi.stopSpeechRecognition(sessionId);
		resetSpeechSession();
	}

	function stopSpeechRecognition(): void {
		speechShouldContinue.current = false;
		clearSpeechRestart();
		setSpeechState("idle");
		const sessionId = speechSessionId.current;
		if (!sessionId) return;
		commitSpeechSession();
		speechSessionId.current = undefined;
		void desktopApi.stopSpeechRecognition(sessionId);
	}

	function beginSpeechRecognitionCycle(): void {
		if (!speechShouldContinue.current) return;
		if (!desktopApi.isNative) {
			speechShouldContinue.current = false;
			setSpeechState("idle");
			speechErrorHandler.current("语音输入仅支持 OpenPI 桌面端");
			return;
		}

		const sessionId = crypto.randomUUID();
		speechSessionId.current = sessionId;
		resetSpeechSession();
		void desktopApi.startSpeechRecognition(sessionId, navigator.language || "zh-CN").catch((caught) => {
			if (speechSessionId.current !== sessionId) return;
			speechSessionId.current = undefined;
			speechShouldContinue.current = false;
			setSpeechState("idle");
			speechErrorHandler.current(caught instanceof Error ? caught.message : "无法启动语音识别");
		});
	}

	function startSpeechRecognition(): void {
		if (!desktopApi.isNative) {
			speechErrorHandler.current("语音输入仅支持 OpenPI 桌面端");
			return;
		}
		speechBaseDraft.current = draft;
		speechCommittedText.current = "";
		resetSpeechSession();
		speechShouldContinue.current = true;
		setSpeechState("starting");
		setSlashOpen(false);
		beginSpeechRecognitionCycle();
	}

	function replaceDraft(value: string): void {
		abortSpeechRecognition();
		setDraft(value);
	}

	async function addImages(files: File[]): Promise<void> {
		if (preparingImages || files.length === 0) return;
		if (!supportsComposerImages) {
			onError("当前模式不支持图片输入");
			return;
		}
		const supportedFiles = files.filter((file) => SUPPORTED_IMAGE_TYPES.has(file.type));
		if (supportedFiles.length !== files.length) {
			onError("Only PNG, JPEG, GIF, and WebP images are supported");
		}
		const availableSlots = MAX_IMAGE_ATTACHMENTS - attachments.length;
		if (availableSlots <= 0) {
			onError(`A message can include at most ${MAX_IMAGE_ATTACHMENTS} images`);
			return;
		}
		if (supportedFiles.length > availableSlots) {
			onError(`Only the first ${availableSlots} image${availableSlots === 1 ? "" : "s"} were added`);
		}

		setPreparingImages(true);
		const startingConversationId = conversation?.instance.id;
		try {
			const prepared: ImageAttachment[] = [];
			let totalSize = attachments.reduce((total, image) => total + image.data.length, 0);
			for (const file of supportedFiles.slice(0, availableSlots)) {
				const image = await prepareImageAttachment(file);
				if (totalSize + image.data.length > MAX_TOTAL_IMAGE_BASE64_BYTES) {
					throw new Error("The total image payload cannot exceed 12 MB");
				}
				prepared.push(image);
				totalSize += image.data.length;
			}
			if (conversationInstanceId.current === startingConversationId) {
				setAttachments((current) => [...current, ...prepared]);
			}
		} catch (caught) {
			onError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setPreparingImages(false);
		}
	}

	function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>): void {
		const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
		if (files.length > 0) void addImages(files);
	}

	function handleDragEnter(event: DragEvent<HTMLDivElement>): void {
		if (!Array.from(event.dataTransfer.types).includes("Files")) return;
		event.preventDefault();
		dragDepth.current += 1;
		setDraggingImages(true);
	}

	function handleDragLeave(event: DragEvent<HTMLDivElement>): void {
		event.preventDefault();
		dragDepth.current = Math.max(0, dragDepth.current - 1);
		if (dragDepth.current === 0) setDraggingImages(false);
	}

	function handleDrop(event: DragEvent<HTMLDivElement>): void {
		const files = Array.from(event.dataTransfer.files);
		if (files.length === 0) return;
		event.preventDefault();
		dragDepth.current = 0;
		setDraggingImages(false);
		void addImages(files);
	}

	async function handleLocalSlash(raw: string): Promise<boolean> {
		const message = raw.trim();
		for (const item of LOCAL_SLASH) {
			const match = message.match(item.match);
			if (!match) continue;
			if (item.id === "remember") {
				const body = (match[2] ?? "").trim();
				if (!body) {
					onError("用法：/记住 要记住的内容");
					return true;
				}
				await onRemember(body);
				setToast("已写入记忆");
				return true;
			}
			if (item.id === "task") {
				const body = (match[2] ?? "").trim();
				onCreateTaskFromChat(body || "定期检查并汇报工作区进展");
				return true;
			}
			if (item.kind === "nav") {
				const navMap: Record<string, ChatNavView> = {
					memory: "memory",
					tasks: "tasks",
					capabilities: "capabilities",
					security: "security",
					intelligence: "intelligence",
					daemon: "daemon",
				};
				const target = navMap[item.id];
				if (target) onNavigate(target);
				return true;
			}
		}
		return false;
	}

	async function submit(): Promise<void> {
		const message = draft.trim();
		if (sending || isWorking || mediaSubmitting || preparingImages || !canSubmit) return;
		if (composerMode === "video" && attachments.length > 0) {
			onError("文生视频暂不接受本地图片，请先移除附件");
			return;
		}
		abortSpeechRecognition();
		if (composerMode === "chat" && message.startsWith("/") && attachments.length === 0) {
			const handled = await handleLocalSlash(message);
			if (handled) {
				setDraft("");
				setSlashOpen(false);
				return;
			}
		}
		const pendingAttachments = attachments;
		setDraft("");
		setAttachments([]);
		setSlashOpen(false);
		try {
			if (composerMode === "image") {
				await generateImage(message, pendingAttachments);
			} else if (composerMode === "video") {
				await generateVideo(message);
			} else {
				await onSend(
					message,
					pendingAttachments.map(({ data, mimeType }) => ({ type: "image", data, mimeType })),
				);
			}
		} catch {
			setDraft((current) => current || message);
			setAttachments((current) => (current.length > 0 ? current : pendingAttachments));
		}
	}

	async function generateImage(message: string, inputImages: ImageAttachment[]): Promise<void> {
		const itemId = crypto.randomUUID();
		const scope = mediaScope;
		appendMediaItem(scope, {
			id: itemId,
			kind: "image",
			prompt: message,
			model: mediaCapabilities?.imageModel ?? "agnes-image-2.1-flash",
			createdAt: Date.now(),
			status: "generating",
			settings: `${imageSize} · ${imageRatio}`,
		});
		try {
			const result = await desktopApi.generateImage({
				prompt: message,
				size: imageSize,
				ratio: imageRatio,
				images: inputImages.map((image) => `data:${image.mimeType};base64,${image.data}`),
			});
			const generated = result.images[0];
			if (!generated) throw new Error("Agnes 没有返回图片");
			updateMediaItem(scope, itemId, (current) => ({
				...current,
				model: result.model,
				status: "completed",
				progress: 100,
				image: generated,
			}));
		} catch (caught) {
			const messageText = caught instanceof Error ? caught.message : String(caught);
			updateMediaItem(scope, itemId, (current) => ({ ...current, status: "failed", error: messageText }));
			onError(messageText);
			throw caught;
		}
	}

	async function generateVideo(message: string): Promise<void> {
		const itemId = crypto.randomUUID();
		const scope = mediaScope;
		const dimensions = videoDimensions(videoResolution, videoRatio);
		appendMediaItem(scope, {
			id: itemId,
			kind: "video",
			prompt: message,
			model: mediaCapabilities?.videoModel ?? "agnes-video-v2.0",
			createdAt: Date.now(),
			status: "generating",
			progress: 0,
			settings: `${videoResolution} · ${videoRatio} · ${VIDEO_DURATION_OPTIONS.find((item) => item.frames === videoFrames)?.label ?? `${videoFrames} 帧`}`,
		});
		try {
			const video = await desktopApi.createVideo({
				prompt: message,
				...dimensions,
				numFrames: videoFrames,
				frameRate: 24,
			});
			updateMediaItem(scope, itemId, (current) => ({
				...current,
				model: video.model,
				status: video.status,
				progress: video.progress,
				video,
				error: video.status === "failed" ? mediaErrorMessage(video.error) : undefined,
			}));
		} catch (caught) {
			const messageText = caught instanceof Error ? caught.message : String(caught);
			updateMediaItem(scope, itemId, (current) => ({ ...current, status: "failed", error: messageText }));
			onError(messageText);
			throw caught;
		}
	}

	function applySlashItem(item: { id: string; label: string; insert: string }): void {
		abortSpeechRecognition();
		const local = LOCAL_SLASH.find((entry) => entry.id === item.id);
		if (local?.kind === "nav") {
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
		if (local?.id === "remember") {
			setDraft("/记住 ");
			setSlashOpen(false);
			draftInput.current?.focus();
			return;
		}
		setDraft(item.insert);
		setSlashOpen(false);
		draftInput.current?.focus();
	}

	// Status-bar metrics derived from session stats + the latest assistant message.
	const lastAssistant = [...(conversation?.messages ?? [])].reverse().find((m) => m.role === "assistant" && m.usage);
	const lastUsage = lastAssistant?.usage;
	const lastTotal = lastUsage ? lastUsage.input + lastUsage.cacheRead + lastUsage.cacheWrite : 0;
	const lastHit = lastTotal > 0 ? Math.round((lastUsage!.cacheRead / lastTotal) * 100) : undefined;
	const avgHit =
		stats && stats.tokens.total > 0 ? Math.round((stats.tokens.cacheRead / stats.tokens.total) * 100) : undefined;
	const lastCost = lastUsage?.cost?.total ?? 0;
	const ctxPercent = stats?.contextUsage ? Math.round(stats.contextUsage.percent * 100) : undefined;
	const compactThreshold = stats?.compaction
		? stats.compaction.reserveTokens + stats.compaction.keepRecentTokens
		: undefined;
	const fmtTokens = (n: number) =>
		n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(n);
	const fmtCost = (n: number) => (n >= 0.01 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`);
	const workspaceLabel = workspace ? workspace.split(/[\\/]/).pop() || workspace : "—";
	const titleText = conversation
		? instanceTitle(conversation.instance, conversation.state.sessionName)
		: selectedInstance
			? instanceTitle(selectedInstance, selectedInstance.label)
			: "新对话";
	const subtitleText = conversation
		? shortWorkspacePath(conversation.instance.cwd)
		: selectedInstance
			? shortWorkspacePath(selectedInstance.cwd)
			: "有什么需要我帮忙的？";

	return (
		<section className="chat-surface">
			<header className="surface-header">
				<button
					className="icon-button quiet mobile-only"
					title="Open conversations"
					aria-label="Open conversations"
					onClick={onOpenSidebar}
				>
					<Menu size={18} />
				</button>
				<div className="surface-heading chat-title">
					<strong>{titleText}</strong>
					<span>{subtitleText}</span>
				</div>
				<div className="surface-actions">
					{conversation && (
						<span className={`agent-state ${isWorking ? "working" : "ready"}`}>
							<span className="status-dot" />
							{isWorking ? "处理中" : "就绪"}
						</span>
					)}
					<button
						className="icon-button quiet context-toggle"
						title="上下文"
						aria-label="上下文"
						onClick={onToggleContext}
					>
						<PanelRight size={18} />
					</button>
				</div>
			</header>
			<div className="chat-toolbar" role="toolbar" aria-label="对话工具">
				<div className="chat-toolbar-left">
					{onNewConversation && (
						<button
							type="button"
							className="icon-button quiet"
							title="新建会话"
							aria-label="新建会话"
							onClick={onNewConversation}
						>
							<Plus size={15} />
						</button>
					)}
					{onRenameConversation && conversation && (
						<button
							type="button"
							className="icon-button quiet"
							title="重命名"
							aria-label="重命名"
							onClick={onRenameConversation}
						>
							<Pencil size={15} />
						</button>
					)}
				</div>
				<div className="chat-toolbar-center">
					<div className="chat-view-tabs" role="tablist" aria-label="对话视图">
						<button
							type="button"
							role="tab"
							aria-selected={activeTab === "chat"}
							className={activeTab === "chat" ? "active" : ""}
							onClick={() => onTabChange("chat")}
						>
							Chat
						</button>
						<button
							type="button"
							role="tab"
							aria-selected={activeTab === "activity"}
							className={activeTab === "activity" ? "active" : ""}
							onClick={() => onTabChange("activity")}
						>
							Activity
						</button>
					</div>
				</div>
				<div className="chat-toolbar-right">
					<button
						type="button"
						className="icon-button quiet"
						title="复制会话"
						aria-label="复制会话"
						onClick={() => {
							if (typeof navigator !== "undefined" && navigator.clipboard && conversation) {
								const lines = conversation.messages
									.map((m) => `${m.role === "user" ? "You" : "Assistant"}: ${contentText(m.content)}`)
									.join("\n\n");
								void navigator.clipboard.writeText(lines);
							}
						}}
					>
						<Copy size={15} />
					</button>
					{onExportConversation && conversation && (
						<button
							type="button"
							className="icon-button quiet"
							title="导出 HTML"
							aria-label="导出 HTML"
							onClick={onExportConversation}
						>
							<Download size={15} />
						</button>
					)}
					<button type="button" className="icon-button quiet" title="分享" aria-label="分享">
						<Share2 size={15} />
					</button>
					<button type="button" className="icon-button quiet" title="更多" aria-label="更多">
						<MoreHorizontal size={15} />
					</button>
				</div>
			</div>

			{activeTab === "activity" ? (
				<ActivityTimeline conversation={conversation} />
			) : (
				<div className="message-scroll" ref={messageScroll} onScroll={handleMessageScroll}>
					{threadItems.length > 0 ? (
						<div className="message-thread">
							{threadItems.map((item) =>
								"message" in item ? (
									<MessageItem
										key={item.key}
										message={item.message}
										hideAssistantTools={
											item.message.role === "assistant" && assistantToolsHaveResults(messages, item.index)
										}
									/>
								) : (
									<GeneratedMediaCard
										key={item.key}
										item={item.media}
										onSave={async (mediaItem) => {
											const source =
												mediaItem.kind === "image"
													? {
															url: mediaItem.image?.url,
															data: mediaItem.image?.data,
															mimeType: mediaItem.image?.mimeType,
															filename: `agnes-image-${mediaItem.id.slice(0, 8)}`,
														}
													: {
															url: mediaItem.video?.url,
															mimeType: "video/mp4",
															filename: `agnes-video-${mediaItem.id.slice(0, 8)}`,
														};
											try {
												await desktopApi.saveMedia(source);
											} catch (caught) {
												onError(caught instanceof Error ? caught.message : String(caught));
											}
										}}
										onDelete={(itemId) =>
											setMediaHistory((current) => ({
												...current,
												[mediaScope]: (current[mediaScope] ?? []).filter((entry) => entry.id !== itemId),
											}))
										}
									/>
								),
							)}
							{isWorking && (
								<div className="agent-progress">
									<span className="agent-avatar">
										<Bot size={16} />
									</span>
									<span className="thinking-dots">
										<i />
										<i />
										<i />
									</span>
									<span>正在思考…</span>
								</div>
							)}
							{!isWorking && turnMeta && (
								<div className="turn-meta" role="status">
									{turnMeta}
								</div>
							)}
						</div>
					) : (
						<div className="conversation-empty">
							<div className="empty-mark">π</div>
							<h1>{mode === "code" ? (workspace ? "CWork 已准备好" : "先选择一个项目") : "今天想做什么？"}</h1>
							<p className="conversation-empty-sub">
								{mode === "code"
									? workspace
										? "描述目标，CWork 会先检查项目再修改"
										: "点击左上角“选择项目”按钮开始"
									: "直接聊，或输入 / 打开命令"}
							</p>
							{mode === "code" && !workspace ? null : (
								<div className="starter-grid">
									<button
										type="button"
										onClick={() =>
											replaceDraft(
												mode === "code"
													? "检查这个项目当前状态，告诉我最需要先处理的代码问题。"
													: "帮我扫一眼这个项目，指出最该先做的一件事。",
											)
										}
									>
										{mode === "code" ? "检查项目状态" : "梳理项目重点"}
										<ChevronRight size={15} />
									</button>
									<button
										type="button"
										onClick={() =>
											replaceDraft(
												mode === "code"
													? "检查未提交改动，继续完成并验证它们。"
													: "继续这个工作区里未完成的改动。",
											)
										}
									>
										{mode === "code" ? "继续项目改动" : "接着上次的活"}
										<ChevronRight size={15} />
									</button>
									<button
										type="button"
										onClick={() =>
											replaceDraft(
												mode === "code"
													? "运行这个项目的相关测试和静态检查，定位失败原因并修复。"
													: "/任务 每周五汇总本周进展并给出下周建议",
											)
										}
									>
										{mode === "code" ? "修复检查失败" : "安排一个自动化"}
										<ChevronRight size={15} />
									</button>
								</div>
							)}
						</div>
					)}
				</div>
			)}

			<div className="composer-wrap">
				{toast && <div className="chat-toast">{toast}</div>}
				{showScrollToBottom && (
					<button className="scroll-to-bottom" title="滚到最新" aria-label="滚到最新" onClick={scrollToBottom}>
						<ArrowDown size={17} />
					</button>
				)}
				<div className="composer-mode-row">
					<div className="segmented mode-switch composer-mode-switch" aria-label="应用模式">
						<button
							type="button"
							className={appMode === "chat" ? "active" : ""}
							onClick={() => onAppModeChange("chat")}
						>
							<MessageSquare size={14} />
							Chat
						</button>
						<button
							type="button"
							className={appMode === "code" ? "active" : ""}
							onClick={() => onAppModeChange("code")}
						>
							<TerminalSquare size={14} />
							CWork
						</button>
					</div>
				</div>
				<div
					className={`composer ${isWorking ? "streaming" : ""} ${draggingImages ? "dragging" : ""} ${composerMode !== "chat" ? "media-composer" : ""}`}
					onDragEnter={handleDragEnter}
					onDragOver={(event) => {
						if (Array.from(event.dataTransfer.types).includes("Files")) event.preventDefault();
					}}
					onDragLeave={handleDragLeave}
					onDrop={handleDrop}
				>
					{composerMode !== "chat" && (
						<div className="media-mode-bar">
							<span className={`media-mode-icon ${composerMode}`}>
								{composerMode === "image" ? <WandSparkles size={15} /> : <Clapperboard size={15} />}
							</span>
							<strong>{composerMode === "image" ? "生成图片" : "生成视频"}</strong>
							<div className="media-mode-options">
								{composerMode === "image" ? (
									<>
										<label>
											<span>清晰度</span>
											<select
												value={imageSize}
												onChange={(event) => setImageSize(event.target.value as AgnesImageSize)}
											>
												{IMAGE_SIZE_OPTIONS.map((size) => (
													<option key={size}>{size}</option>
												))}
											</select>
										</label>
										<label>
											<span>比例</span>
											<select
												value={imageRatio}
												onChange={(event) => setImageRatio(event.target.value as AgnesImageRatio)}
											>
												{IMAGE_RATIO_OPTIONS.map((ratio) => (
													<option key={ratio}>{ratio}</option>
												))}
											</select>
										</label>
									</>
								) : (
									<>
										<label>
											<span>清晰度</span>
											<select
												value={videoResolution}
												onChange={(event) => setVideoResolution(event.target.value as VideoResolution)}
											>
												{VIDEO_RESOLUTION_OPTIONS.map((resolution) => (
													<option key={resolution}>{resolution}</option>
												))}
											</select>
										</label>
										<label>
											<span>比例</span>
											<select
												value={videoRatio}
												onChange={(event) => setVideoRatio(event.target.value as VideoRatio)}
											>
												{VIDEO_RATIO_OPTIONS.map((ratio) => (
													<option key={ratio}>{ratio}</option>
												))}
											</select>
										</label>
										<label>
											<span>时长</span>
											<select
												value={videoFrames}
												onChange={(event) => setVideoFrames(Number(event.target.value))}
											>
												{VIDEO_DURATION_OPTIONS.map((option) => (
													<option key={option.frames} value={option.frames}>
														{option.label}
													</option>
												))}
											</select>
										</label>
									</>
								)}
							</div>
							<button
								type="button"
								className="media-mode-close"
								title="返回对话"
								aria-label="返回对话"
								onClick={() => {
									setComposerMode("chat");
									setAttachments([]);
								}}
							>
								<X size={14} />
							</button>
						</div>
					)}
					{attachments.length > 0 && (
						<div className="composer-attachments">
							{attachments.map((image) => (
								<div className="composer-attachment" key={image.id}>
									<img src={`data:${image.mimeType};base64,${image.data}`} alt={image.name} />
									<button
										type="button"
										title={`移除 ${image.name}`}
										aria-label={`移除 ${image.name}`}
										onClick={() =>
											setAttachments((current) => current.filter((item) => item.id !== image.id))
										}
									>
										<X size={12} />
									</button>
								</div>
							))}
						</div>
					)}
					{slashOpen && slashItems.length > 0 && (
						<div className="slash-menu" role="listbox" aria-label="斜杠命令">
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
						value={draft}
						autoFocus
						onChange={(event) => replaceDraft(event.target.value)}
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
								// Enter / Tab pick slash item; plain Enter elsewhere is newline.
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
									setSlashOpen(false);
									return;
								}
							}
							// ⌘/Ctrl+Enter send; plain Enter inserts newline (default textarea).
							if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
								event.preventDefault();
								void submit();
							}
						}}
						placeholder={
							composerMode === "image"
								? "描述想生成的画面"
								: composerMode === "video"
									? "描述主体动作、镜头运动和场景"
									: "有什么需要帮忙的？Enter 换行 · ⌘Enter 发送 · / 命令"
						}
						rows={1}
					/>
					<div className="composer-footer">
						<div className="model-controls">
							<input
								ref={attachmentInput}
								className="attachment-input"
								type="file"
								accept="image/png,image/jpeg,image/gif,image/webp"
								multiple
								tabIndex={-1}
								onChange={(event) => {
									void addImages(Array.from(event.currentTarget.files ?? []));
									event.currentTarget.value = "";
								}}
							/>
							<Popover open={moreMenuOpen} onOpenChange={setMoreMenuOpen}>
								<PopoverTrigger asChild>
									<button
										className="model-control attachment-button"
										type="button"
										title="更多"
										aria-label="更多操作"
										disabled={isWorking}
									>
										<Plus size={16} />
									</button>
								</PopoverTrigger>
								<PopoverContent className="composer-plus-menu" side="top" align="start" sideOffset={8}>
									<button
										type="button"
										disabled={!mediaCapabilities?.configured || isWorking}
										title={
											mediaCapabilities?.configured ? "使用 Agnes Image 2.1 Flash" : "未配置 Agnes API Key"
										}
										onClick={() => {
											setMoreMenuOpen(false);
											abortSpeechRecognition();
											setComposerMode("image");
											setSlashOpen(false);
											draftInput.current?.focus();
										}}
									>
										<WandSparkles size={14} />
										生成图片
									</button>
									<button
										type="button"
										disabled={!mediaCapabilities?.configured || isWorking}
										title={mediaCapabilities?.configured ? "使用 Agnes Video V2.0" : "未配置 Agnes API Key"}
										onClick={() => {
											setMoreMenuOpen(false);
											abortSpeechRecognition();
											setComposerMode("video");
											setAttachments([]);
											setSlashOpen(false);
											draftInput.current?.focus();
										}}
									>
										<Clapperboard size={14} />
										生成视频
									</button>
									<button
										type="button"
										disabled={
											!supportsComposerImages ||
											(composerMode as MediaComposerMode) === "video" ||
											preparingImages ||
											attachments.length >= MAX_IMAGE_ATTACHMENTS
										}
										onClick={() => {
											setMoreMenuOpen(false);
											attachmentInput.current?.click();
										}}
									>
										<Paperclip size={14} />
										附加图片
									</button>
									<button
										type="button"
										disabled={!conversation}
										onClick={() => {
											setMoreMenuOpen(false);
											replaceDraft("/记住 ");
											draftInput.current?.focus();
										}}
									>
										<BookOpen size={14} />
										写入记忆
									</button>
									<button
										type="button"
										onClick={() => {
											setMoreMenuOpen(false);
											onCreateTaskFromChat(draft.trim());
										}}
									>
										<ListTodo size={14} />
										创建任务
									</button>
									<button
										type="button"
										onClick={() => {
											setMoreMenuOpen(false);
											replaceDraft("/");
											setSlashOpen(true);
											draftInput.current?.focus();
										}}
									>
										/ 命令菜单
									</button>
								</PopoverContent>
							</Popover>
							{composerMode === "chat" ? (
								<Popover open={modelMenuOpen} onOpenChange={setModelMenuOpen}>
									<PopoverTrigger asChild>
										<button
											className="model-control model-picker compact-picker"
											title="模型与思考"
											aria-label="模型与思考"
											disabled={configurationDisabled || loadingModels || modelOptions.length === 0}
										>
											<span className="model-picker-label">
												{shortModelName(
													conversation?.state.model?.name ?? conversation?.state.model?.id ?? "模型",
												)}
												<span className="model-picker-sep">·</span>
												{conversation?.state.thinkingLevel ?? "medium"}
											</span>
											<ChevronsUpDown size={12} />
										</button>
									</PopoverTrigger>
									<PopoverContent
										className="model-popover model-popover-wide"
										side="top"
										align="start"
										sideOffset={8}
										collisionPadding={12}
									>
										<div className="model-popover-section">
											<span className="model-popover-label">思考强度</span>
											<div className="thinking-row">
												{availableThinkingLevels.map((level) => (
													<button
														type="button"
														key={level}
														className={
															(conversation?.state.thinkingLevel ?? "medium") === level ? "active" : ""
														}
														disabled={configurationDisabled || loadingModels || !currentModel}
														onClick={() => onThinkingLevelChange(level)}
													>
														{level}
													</button>
												))}
											</div>
										</div>
										<div className="model-popover-section">
											<span className="model-popover-label">模型</span>
											<Command label="Select model" loop>
												<CommandInput placeholder="搜索模型" autoFocus />
												<CommandList>
													<CommandEmpty>没有匹配的模型</CommandEmpty>
													{modelGroups.map(([provider, models]) => (
														<CommandGroup heading={provider} key={provider}>
															{models.map((model) => {
																const selected =
																	model.provider === currentModel?.provider &&
																	model.id === currentModel.id;
																return (
																	<CommandItem
																		className={selected ? "selected" : ""}
																		value={`${model.provider}/${model.id}`}
																		keywords={[model.name, model.provider, model.id]}
																		key={`${model.provider}/${model.id}`}
																		onSelect={() => {
																			setModelMenuOpen(false);
																			if (!selected) onModelChange(model);
																		}}
																	>
																		<span className="model-option-main">
																			<strong>{model.name}</strong>
																			<small>{model.id}</small>
																		</span>
																		<span className="model-option-actions">
																			{model.supportsImages && (
																				<ImageIcon size={13} aria-label="Supports images" />
																			)}
																			<Check
																				className={
																					selected
																						? "model-option-check visible"
																						: "model-option-check"
																				}
																				size={14}
																			/>
																		</span>
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
							) : (
								<span className="model-control media-model-label">
									{composerMode === "image"
										? (mediaCapabilities?.imageModel ?? "agnes-image-2.1-flash")
										: (mediaCapabilities?.videoModel ?? "agnes-video-v2.0")}
								</span>
							)}
						</div>
						<div className="composer-actions">
							{composerMode === "chat" && (
								<button
									type="button"
									className={`speech-button ${speechState}`}
									title={speechState === "idle" ? "开始语音输入" : "停止语音输入"}
									aria-label={speechState === "idle" ? "开始语音输入" : "停止语音输入"}
									aria-pressed={speechState !== "idle"}
									disabled={isWorking || sending}
									onClick={speechState === "idle" ? startSpeechRecognition : stopSpeechRecognition}
								>
									<Mic size={16} />
								</button>
							)}
							{composerMode === "chat" && isStreaming ? (
								<button className="send-button stop" title="停止" aria-label="停止" onClick={onAbort}>
									<Square size={14} fill="currentColor" />
								</button>
							) : (
								<button
									className="send-button"
									title={
										composerMode === "image"
											? "生成图片"
											: composerMode === "video"
												? "生成视频"
												: "发送 (⌘Enter)"
									}
									aria-label={
										composerMode === "chat" ? "发送" : composerMode === "image" ? "生成图片" : "生成视频"
									}
									disabled={!canSubmit || sending || isWorking || mediaSubmitting || preparingImages}
									onClick={() => void submit()}
								>
									{mediaSubmitting ? (
										<RefreshCw size={15} className="spin" />
									) : composerMode === "image" ? (
										<WandSparkles size={16} />
									) : composerMode === "video" ? (
										<Clapperboard size={16} />
									) : (
										<Send size={16} />
									)}
								</button>
							)}
						</div>
					</div>
				</div>
			</div>
			<div className="chat-statusbar">
				<div className="statusbar-left">
					<span title={workspace ?? "项目目录"}>
						<Folder size={13} />
						{workspaceLabel}
					</span>
					<span title="当前模型">
						<Cpu size={13} />
						{conversation?.state.model?.id ?? "—"}
					</span>
				</div>
				<div className="statusbar-right">
					{lastHit !== undefined && <span title="本次命中率">本次 {lastHit}%</span>}
					{avgHit !== undefined && <span title="平均命中率">均 {avgHit}%</span>}
					{stats && <span title="会话 token">{fmtTokens(stats.tokens.total)} tok</span>}
					{lastTotal > 0 && <span title="本次 token">+{fmtTokens(lastTotal)}</span>}
					{lastCost > 0 && <span title="本次费用">{fmtCost(lastCost)}</span>}
					{stats && stats.cost > 0 && <span title="会话费用">共 {fmtCost(stats.cost)}</span>}
					{stats && <span title="对话轮数">{stats.userMessages} 轮</span>}
					{ctxPercent !== undefined && <span title="上下文占用">ctx {ctxPercent}%</span>}
					{compactThreshold !== undefined && <span title="压缩阈值">{fmtTokens(compactThreshold)} 阈</span>}
					{providerBalance && (
						<span title="账户余额">
							余额 {providerBalance.totalBalance.toFixed(2)} {providerBalance.currency}
						</span>
					)}
				</div>
			</div>
		</section>
	);
}

function shortModelName(name: string): string {
	const trimmed = name.trim();
	if (trimmed.length <= 18) return trimmed;
	return `${trimmed.slice(0, 16)}…`;
}

interface ActivityTimelineItem {
	key: string;
	kind: "tool" | "message" | "assistant";
	title: string;
	detail: string;
	timestamp?: number;
	error?: boolean;
}

function ActivityTimeline({ conversation }: { conversation?: ConversationSnapshot }) {
	const items: ActivityTimelineItem[] = (conversation?.messages ?? []).flatMap<ActivityTimelineItem>(
		(message, messageIndex) => {
			const calls = toolCalls(message);
			const text = contentText(message.content).trim();
			const timestamp = message.timestamp;
			const key = `${timestamp ?? messageIndex}-${messageIndex}`;
			if (message.role === "user" && text) {
				return [{ key, kind: "message" as const, title: "你", detail: text, timestamp }];
			}
			if (calls.length > 0) {
				return calls.map((call, callIndex) => ({
					key: `${key}-tool-${callIndex}`,
					kind: "tool" as const,
					title: call.name,
					detail: call.detail || "工具调用完成",
					timestamp,
					error: message.isError,
				}));
			}
			if (message.role === "assistant" && text) {
				return [{ key, kind: "assistant" as const, title: "OpenPI", detail: text, timestamp }];
			}
			return [];
		},
	);

	return (
		<div className="activity-scroll">
			<div className="activity-thread">
				{items.length > 0 ? (
					items.map((item) => (
						<article className={`activity-item ${item.kind} ${item.error ? "error" : ""}`} key={item.key}>
							<time>{formatTime(item.timestamp)}</time>
							<div className="activity-rail-dot" />
							<div className="activity-card">
								<header>
									<span className="activity-icon">
										{item.kind === "tool" ? (
											<Terminal size={15} />
										) : item.kind === "message" ? (
											<UserRound size={15} />
										) : (
											<Bot size={15} />
										)}
									</span>
									<strong>{item.title}</strong>
									{item.kind === "tool" && (
										<span className={`activity-state ${item.error ? "error" : ""}`}>
											{item.error ? "Failed" : "Completed"}
										</span>
									)}
								</header>
								<p>{item.detail}</p>
							</div>
						</article>
					))
				) : (
					<div className="activity-empty">
						<History size={28} />
						<strong>还没有执行记录</strong>
						<span>开始对话后，文件、终端和工具活动会显示在这里。</span>
					</div>
				)}
			</div>
		</div>
	);
}

export function MessageItem({
	message,
	hideAssistantTools = false,
}: {
	message: ConversationMessage;
	/** When true, skip in-message tool chips (toolResult rows already cover them). */
	hideAssistantTools?: boolean;
}) {
	const text = contentText(message.content);
	const images = contentImages(message.content);
	const calls = hideAssistantTools ? [] : toolCalls(message);
	const blockCounts = message.role !== "user" ? messageBlockCounts(message.content) : undefined;
	// toolResult must use the same avatar+stack grid as assistant messages,
	// otherwise rows sit full-bleed and misalign with in-message tool chips.
	if (message.role === "toolResult") {
		return (
			<article className="message assistant tool-result-message">
				<div className="message-avatar message-avatar-spacer" aria-hidden />
				<div className="message-stack">
					<div className="message-body">
						{calls.map((call, index) => (
							<details className={`tool-trace ${message.isError ? "error" : ""}`} key={`${call.name}-${index}`}>
								<summary>
									<span>
										<Wrench size={14} />
										{call.name}
									</span>
									<span className="tool-trace-status">
										{message.isError ? (
											<>
												<CircleStop size={13} className="trace-icon error" />
												失败
											</>
										) : (
											<>
												<Check size={13} className="trace-icon ok" />
												完成
											</>
										)}
										<ChevronRight size={14} />
									</span>
								</summary>
								{call.detail && <pre>{call.detail}</pre>}
								{images.length > 0 && <MessageImages images={images} />}
							</details>
						))}
					</div>
				</div>
			</article>
		);
	}
	const isUser = message.role === "user";
	// Empty assistant shells after tools are shown as toolResult rows — skip.
	if (!isUser && !text && images.length === 0 && !message.errorMessage && calls.length === 0) {
		return null;
	}

	// Build a compact trace badge like "2个工具 · 1段思考"
	let traceBadge: string | undefined;
	if (!isUser && blockCounts) {
		const parts: string[] = [];
		if (blockCounts.tools > 0) parts.push(`${blockCounts.tools}个工具`);
		if (blockCounts.thinking > 0) parts.push(`${blockCounts.thinking}段思考`);
		if (parts.length > 0) traceBadge = parts.join(" · ");
	}

	return (
		<article className={`message ${isUser ? "user" : "assistant"}`}>
			{!isUser && (
				<div className="message-avatar">
					<Bot size={14} />
				</div>
			)}
			<div className="message-stack">
				{!isUser && (
					<div className="message-meta">
						<strong>OpenPI</strong>
						{traceBadge && <span className="message-trace-badge">{traceBadge}</span>}
						<span>{formatTime(message.timestamp)}</span>
					</div>
				)}
				<div className="message-body">
					{images.length > 0 && <MessageImages images={images} />}
					{text && <div className="message-text">{isUser ? text : <MarkdownText text={text} />}</div>}
					{message.errorMessage && <div className="message-error">{message.errorMessage}</div>}
					{calls.map((call, index) => (
						<details className={`tool-trace ${message.isError ? "error" : ""}`} key={`${call.name}-${index}`}>
							<summary>
								<span>
									<Wrench size={14} />
									{call.name}
								</span>
								<span className="tool-trace-status">
									{message.isError ? (
										<>
											<CircleStop size={13} className="trace-icon error" />
											失败
										</>
									) : (
										<>
											<Check size={13} className="trace-icon ok" />
											完成
										</>
									)}
									<ChevronRight size={14} />
								</span>
							</summary>
							{call.detail && <pre>{call.detail}</pre>}
						</details>
					))}
				</div>
			</div>
		</article>
	);
}

export function MessageImages({ images }: { images: ImageContent[] }) {
	return (
		<div className="message-images">
			{images.map((image, index) => (
				<img
					key={`${image.mimeType}-${image.data.length}-${index}`}
					src={`data:${image.mimeType};base64,${image.data}`}
					alt={`Attachment ${index + 1}`}
					loading="lazy"
				/>
			))}
		</div>
	);
}

function GeneratedMediaCard({
	item,
	onSave,
	onDelete,
}: {
	item: GeneratedMediaItem;
	onSave(item: GeneratedMediaItem): Promise<void>;
	onDelete(itemId: string): void;
}) {
	const imageSource =
		item.image?.url ??
		(item.image?.data ? `data:${item.image.mimeType ?? "image/png"};base64,${item.image.data}` : undefined);
	const mediaUrl = item.kind === "image" ? item.image?.url : item.video?.url;
	const completed = item.status === "completed";
	const failed = item.status === "failed";
	const statusLabel =
		item.status === "generating"
			? "正在提交"
			: item.status === "queued"
				? "排队中"
				: item.status === "in_progress"
					? `生成中 ${Math.max(0, Math.min(100, item.progress ?? 0))}%`
					: completed
						? "已完成"
						: "失败";
	return (
		<article className={`generated-media-card ${item.kind} ${item.status}`}>
			<header>
				<span className={`generated-media-icon ${item.kind}`}>
					{item.kind === "image" ? <ImageIcon size={16} /> : <Clapperboard size={16} />}
				</span>
				<div>
					<strong>{item.kind === "image" ? "Agnes 生成图片" : "Agnes 生成视频"}</strong>
					<span>
						{item.model} · {item.settings}
					</span>
				</div>
				<span className={`generated-media-status ${item.status}`}>
					{!completed && !failed && <RefreshCw size={12} className="spin" />}
					{statusLabel}
				</span>
				<button
					type="button"
					className="generated-media-delete"
					title="从历史中移除"
					aria-label="从历史中移除"
					onClick={() => onDelete(item.id)}
				>
					<X size={14} />
				</button>
			</header>
			<p className="generated-media-prompt">{item.prompt}</p>
			{!completed && !failed && (
				<div className="generated-media-progress" aria-label={statusLabel}>
					<span style={{ width: `${Math.max(4, Math.min(100, item.progress ?? 4))}%` }} />
				</div>
			)}
			{failed && <div className="generated-media-error">{item.error ?? "媒体生成失败"}</div>}
			{completed && item.kind === "image" && imageSource && (
				<div className="generated-media-preview image-preview">
					<img src={imageSource} alt={item.prompt} loading="lazy" />
				</div>
			)}
			{completed && item.kind === "video" && item.video?.url && (
				<div className="generated-media-preview video-preview">
					<video src={item.video.url} controls preload="metadata" />
				</div>
			)}
			{completed && (imageSource || item.video?.url) && (
				<footer>
					<button type="button" onClick={() => void onSave(item)}>
						<Download size={14} />
						保存
					</button>
					{mediaUrl && (
						<a href={mediaUrl} target="_blank" rel="noreferrer">
							<ExternalLink size={14} />
							打开
						</a>
					)}
				</footer>
			)}
		</article>
	);
}

const fmtTokens = (n: number) =>
	n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(n);
const fmtCost = (n: number) => (n >= 0.01 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`);

function ContextProgressBar({ value, max, color = "var(--accent)" }: { value: number; max: number; color?: string }) {
	const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
	const warn = pct > 80;
	const danger = pct > 95;
	const barColor = danger ? "var(--danger)" : warn ? "var(--warn)" : color;
	return (
		<div className="ctx-progress-wrap">
			<div className="ctx-progress-bar">
				<div className="ctx-progress-fill" style={{ width: `${pct}%`, background: barColor }} />
			</div>
			<span className="ctx-progress-label">
				{fmtTokens(value)} / {fmtTokens(max)} ({Math.round(pct)}%)
			</span>
		</div>
	);
}

function TokenCompositionBar({
	tokens: t,
}: {
	tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
}) {
	const total = t.input + t.output + t.cacheRead + t.cacheWrite || 1;
	const segments = [
		{ key: "prompt", label: "提示词", value: t.input, color: "#d97757" },
		{ key: "reply", label: "回复", value: t.output, color: "#76c878" },
		{ key: "cacheR", label: "缓存读", value: t.cacheRead, color: "#4d8df6" },
		{ key: "cacheW", label: "缓存写", value: t.cacheWrite, color: "#8791a1" },
	].filter((s) => s.value > 0);
	return (
		<div className="token-composition">
			<div className="token-bar">
				{segments.map((s) => (
					<div
						key={s.key}
						className="token-bar-segment"
						style={{ width: `${(s.value / total) * 100}%`, background: s.color }}
						title={`${s.label}: ${fmtTokens(s.value)}`}
					/>
				))}
			</div>
			<div className="token-legend">
				{segments.map((s) => (
					<span key={s.key} className="token-legend-item">
						<span className="token-legend-dot" style={{ background: s.color }} />
						{s.label} {fmtTokens(s.value)}
					</span>
				))}
			</div>
		</div>
	);
}

function MetricCard({ label, value, unit }: { label: string; value: string; unit?: string }) {
	return (
		<div className="metric-card">
			<span className="metric-label">{label}</span>
			<span className="metric-value">
				{value}
				{unit && <span className="metric-unit">{unit}</span>}
			</span>
		</div>
	);
}

type ContextTab = "overview" | "files" | "changes" | "terminal";

const CONTEXT_TABS: Array<{ id: ContextTab; label: string; icon: typeof ListTodo }> = [
	{ id: "overview", label: "概览", icon: ListTodo },
	{ id: "files", label: "文件", icon: FileText },
	{ id: "changes", label: "改动", icon: GitBranch },
	{ id: "terminal", label: "终端", icon: Terminal },
];

function extractFilePaths(args: unknown): string[] {
	if (!args || typeof args !== "object") return [];
	const obj = args as Record<string, unknown>;
	const candidates = [
		obj.path,
		obj.file_path,
		obj.filePath,
		obj.target,
		obj.targetPath,
		obj.target_file,
		obj.notebook_path,
	];
	const out: string[] = [];
	for (const candidate of candidates) {
		if (typeof candidate === "string" && candidate.length > 0) {
			out.push(candidate);
		}
	}
	const command = obj.command;
	if (typeof command === "string") {
		const match = command.match(/(?:\s|\b)([A-Za-z0-9_./-]+\.[A-Za-z0-9]{1,8})/g);
		if (match) out.push(...match);
	}
	return out;
}

function extractFileChangeRecords(
	messages: ConversationMessage[] | undefined,
): Array<{ path: string; ts: number; tool: string }> {
	if (!messages) return [];
	const out: Array<{ path: string; ts: number; tool: string }> = [];
	for (const m of messages) {
		if (m.role !== "assistant") continue;
		if (!Array.isArray(m.content)) continue;
		for (const block of m.content) {
			if (!block || typeof block !== "object") continue;
			const b = block as { type?: string; name?: string; arguments?: unknown };
			if (b.type === "toolCall" && typeof b.name === "string") {
				const paths = extractFilePaths(b.arguments);
				for (const p of paths) {
					out.push({ path: p, ts: m.timestamp ?? 0, tool: b.name });
				}
			}
		}
	}
	const seen = new Set<string>();
	return out
		.slice()
		.sort((a, b) => b.ts - a.ts)
		.filter((entry) => {
			if (seen.has(entry.path)) return false;
			seen.add(entry.path);
			return true;
		});
}

function extractChangeSnippets(
	messages: ConversationMessage[] | undefined,
): Array<{ tool: string; summary: string; ts: number }> {
	if (!messages) return [];
	const out: Array<{ tool: string; summary: string; ts: number }> = [];
	for (const m of messages) {
		if (m.role !== "assistant") continue;
		if (!Array.isArray(m.content)) continue;
		for (const block of m.content) {
			if (!block || typeof block !== "object") continue;
			const b = block as { type?: string; name?: string; arguments?: unknown };
			if (b.type === "toolCall" && typeof b.name === "string") {
				const args = (b.arguments ?? {}) as Record<string, unknown>;
				const path = typeof args.path === "string" ? args.path : "";
				const command = typeof args.command === "string" ? args.command : "";
				let summary = "";
				if (b.name === "edit" || b.name === "write") {
					summary = path ? `${path}` : command;
				} else if (b.name === "bash" || b.name === "bash_execution") {
					summary = command.split("\n")[0] ?? command;
				} else if (b.name === "read") {
					summary = path;
				} else {
					summary = JSON.stringify(args).slice(0, 80);
				}
				if (summary) {
					out.push({ tool: b.name, summary, ts: m.timestamp ?? 0 });
				}
			}
		}
	}
	return out
		.slice()
		.sort((a, b) => b.ts - a.ts)
		.slice(0, 80);
}

export function ContextPanel({
	conversation,
	stats,
	capabilities,
	memoryEntries = [],
	onClose,
	onShowTasks,
}: {
	conversation?: ConversationSnapshot;
	stats?: ConversationStats;
	capabilities?: ConversationCapabilities;
	memoryEntries?: string[];
	onClose(): void;
	onShowTasks(): void;
}) {
	const [tab, setTab] = useState<ContextTab>("overview");

	// Context window
	const ctxUsage = stats?.contextUsage;
	const modelCtxWindow = conversation?.state.model?.contextWindow;
	const ctxTokens = ctxUsage?.tokens ?? 0;
	const ctxMax = ctxUsage?.contextWindow ?? modelCtxWindow ?? 0;

	const toolCount = stats?.toolCalls ?? 0;

	const fileEntries = extractFileChangeRecords(conversation?.messages);
	const changeEntries = extractChangeSnippets(conversation?.messages);
	const fileCount = fileEntries.length;
	const changeCount = changeEntries.length;
	const activeTools = capabilities?.tools.filter((tool) => tool.active).slice(0, 5) ?? [];

	return (
		<aside className="context-panel">
			<header>
				<strong>概览</strong>
				<button className="icon-button quiet context-close" title="关闭" aria-label="关闭" onClick={onClose}>
					<X size={16} />
				</button>
			</header>
			<nav className="context-tabs" role="tablist">
				{CONTEXT_TABS.map((entry) => {
					const Icon = entry.icon;
					let count: number | undefined;
					if (entry.id === "files") count = fileCount;
					if (entry.id === "changes") count = changeCount;
					return (
						<button
							key={entry.id}
							type="button"
							role="tab"
							aria-selected={tab === entry.id}
							className={`context-tab ${tab === entry.id ? "active" : ""}`}
							onClick={() => setTab(entry.id)}
						>
							<Icon size={13} />
							<span>{entry.label}</span>
							{count !== undefined && count > 0 && <span className="context-tab-count">{count}</span>}
						</button>
					);
				})}
			</nav>

			{tab === "overview" && (
				<>
					<section className="context-section">
						<div className="context-section-title">
							<span>Workspace</span>
						</div>
						<div className="context-workspace-card">
							<span className="context-workspace-icon">
								<Folder size={25} />
							</span>
							<div>
								<strong>
									{conversation?.instance.cwd ? shortWorkspacePath(conversation.instance.cwd) : "未选择工作区"}
								</strong>
								<span>{conversation?.instance.cwd ?? "选择一个工作区后开始"}</span>
							</div>
						</div>
						<div className="context-count-grid">
							<div>
								<strong>{fileCount || "—"}</strong>
								<span>Files</span>
							</div>
							<div>
								<strong>{toolCount || "—"}</strong>
								<span>Tools</span>
							</div>
							<div>
								<strong>{memoryEntries.length || "—"}</strong>
								<span>Memories</span>
							</div>
						</div>
					</section>

					<section className="context-section">
						<div className="context-section-title">
							<span>Environment</span>
						</div>
						<div className="context-fact-list">
							<div>
								<span>Platform</span>
								<strong>Desktop</strong>
							</div>
							<div>
								<span>Mode</span>
								<strong>{conversation?.instance.mode === "code" ? "Code" : "Work"}</strong>
							</div>
							<div>
								<span>Model</span>
								<strong>{conversation?.state.model?.name ?? conversation?.state.model?.id ?? "Default"}</strong>
							</div>
							<div>
								<span>Thinking</span>
								<strong>{conversation?.state.thinkingLevel ?? "—"}</strong>
							</div>
						</div>
					</section>

					<section className="context-section">
						<div className="context-section-title">
							<span>Active Tools</span>
							<span className="context-link" onClick={onShowTasks}>
								Manage Tools <ChevronRight size={13} />
							</span>
						</div>
						<div className="context-tool-list">
							{activeTools.length > 0 ? (
								activeTools.map((tool) => (
									<div className="context-tool-row" key={`${tool.sourceInfo.path}:${tool.name}`}>
										<span className="context-tool-icon">
											<Wrench size={13} />
										</span>
										<strong>{tool.name}</strong>
										<span className="context-online-dot" />
									</div>
								))
							) : (
								<div className="context-empty">当前会话暂无工具信息</div>
							)}
						</div>
					</section>

					<section className="context-section">
						<div className="context-section-title">
							<span>Related Files</span>
							<span className="context-link">{fileCount > 0 ? `Show All (${fileCount})` : "—"}</span>
						</div>
						<div className="context-file-list">
							{fileEntries.slice(0, 5).map((entry) => (
								<div className="context-file-row" key={entry.path}>
									<FileText size={14} />
									<span>{entry.path.split(/[\\/]/).pop() ?? entry.path}</span>
									{entry.tool === "edit" && <small>正在编辑</small>}
								</div>
							))}
							{fileCount === 0 && <div className="context-empty">还没有关联文件</div>}
						</div>
					</section>

					<section className="context-section">
						<div className="context-section-title">
							<span>Memory</span>
							<span className="context-link">
								{memoryEntries.length > 0 ? `Show All (${memoryEntries.length})` : "—"}
							</span>
						</div>
						<div className="context-memory-list">
							{memoryEntries.slice(0, 4).map((entry) => (
								<div className="context-memory-row" key={entry}>
									<strong>{entry.replace(/^\[[^\]]+\]\s*/, "").split(":")[0]}</strong>
									<span>{entry.includes(":") ? entry.slice(entry.indexOf(":") + 1).trim() : entry}</span>
								</div>
							))}
							{memoryEntries.length === 0 && <div className="context-empty">还没有可用记忆</div>}
						</div>
					</section>

					{ctxMax > 0 && (
						<section className="context-section context-advanced">
							<div className="context-section-title">
								<span>上下文窗口</span>
								<span className="ctx-window-pct">{Math.round((ctxTokens / ctxMax) * 100)}%</span>
							</div>
							<ContextProgressBar value={ctxTokens} max={ctxMax} />
						</section>
					)}
				</>
			)}

			{tab === "files" && (
				<section className="context-section">
					<div className="context-section-title">
						<span>本次会话涉及文件</span>
						<span className="context-muted">{fileCount} 个</span>
					</div>
					{fileCount === 0 ? (
						<div className="context-empty">
							<FileText size={17} />
							<span>尚无文件操作</span>
						</div>
					) : (
						<div className="file-list">
							{fileEntries.map((entry) => (
								<div className="file-row" key={entry.path}>
									<FileText size={13} />
									<span className="file-row-name" title={entry.path}>
										{entry.path.split("/").pop() || entry.path}
									</span>
									<span className="file-row-dir" title={entry.path}>
										{entry.path.includes("/") ? entry.path.slice(0, entry.path.lastIndexOf("/")) : ""}
									</span>
								</div>
							))}
						</div>
					)}
				</section>
			)}

			{tab === "changes" && (
				<section className="context-section">
					<div className="context-section-title">
						<span>本次会话改动</span>
						<span className="context-muted">{changeCount} 次</span>
					</div>
					{changeCount === 0 ? (
						<div className="context-empty">
							<GitBranch size={17} />
							<span>尚无工具改动</span>
						</div>
					) : (
						<div className="change-list">
							{changeEntries.map((entry, index) => (
								<div className="change-row" key={`${entry.ts}-${index}`}>
									<span className={`change-tool change-tool-${entry.tool}`}>{entry.tool}</span>
									<span className="change-summary" title={entry.summary}>
										{entry.summary}
									</span>
								</div>
							))}
						</div>
					)}
				</section>
			)}

			{tab === "terminal" && (
				<section className="context-section">
					<div className="context-section-title">
						<span>终端</span>
					</div>
					<div className="terminal-placeholder">
						<Terminal size={32} />
						<strong>终端面板即将开放</strong>
						<p>暂未在桌面接入 shell；后台任务日志在「运行时」页可看。</p>
					</div>
				</section>
			)}
		</aside>
	);
}

const BUILTIN_PROVIDER_IDS = new Set([
	"amazon-bedrock",
	"anthropic",
	"google",
	"openai",
	"azure-openai-responses",
	"deepseek",
	"github-copilot",
	"xai",
	"groq",
	"cerebras",
	"openrouter",
	"mistral",
	"perplexity",
	"together",
	"fireworks",
	"grok",
	"ollama",
]);

const API_TYPE_OPTIONS = [
	{ value: "openai-completions", label: "OpenAI Completions" },
	{ value: "anthropic-messages", label: "Anthropic Messages" },
	{ value: "openai-responses", label: "OpenAI Responses" },
] as const;

function VisionFallbackPanel({ onSaved }: { onSaved(): Promise<void> | void }) {
	const [config, setConfig] = useState<VisionFallbackConfig>();
	const [models, setModels] = useState<VisionFallbackModel[]>([]);
	const [apiKey, setApiKey] = useState("");
	const [model, setModel] = useState("glm-4.6v-flash");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string>();

	const refresh = useCallback(async (): Promise<void> => {
		try {
			const next = await desktopApi.getVisionFallback();
			setConfig(next);
			setModel(next.model);
			if (next.configured) {
				setModels(await desktopApi.getVisionFallbackModels());
			} else {
				setModels([]);
			}
			setError(undefined);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		}
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const save = async (): Promise<void> => {
		setSaving(true);
		try {
			const next = await desktopApi.configureVisionFallback({
				enabled: config?.enabled !== false,
				model,
				...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
			});
			setConfig(next);
			setModel(next.model);
			setApiKey("");
			setError(undefined);
			setModels(await desktopApi.getVisionFallbackModels());
			await onSaved();
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setSaving(false);
		}
	};

	const toggle = async (): Promise<void> => {
		if (!config?.configured) {
			setError("请先输入智谱 API Key");
			return;
		}
		setSaving(true);
		try {
			setConfig(await desktopApi.configureVisionFallback({ enabled: !config.enabled, model }));
			setError(undefined);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setSaving(false);
		}
	};

	return (
		<section className="vision-fallback-panel">
			<div className="vision-fallback-heading">
				<span className="vision-fallback-icon">
					<ImageIcon size={17} />
				</span>
				<div>
					<strong>智谱视觉补全</strong>
					<span>GLM-4.6V-Flash 为不支持图片的模型提供识图与 OCR</span>
				</div>
				<button
					type="button"
					className={`vision-fallback-toggle ${config?.enabled ? "active" : ""}`}
					aria-label={config?.enabled ? "关闭视觉补全" : "开启视觉补全"}
					title={config?.enabled ? "关闭视觉补全" : "开启视觉补全"}
					disabled={saving || !config?.configured}
					onClick={() => void toggle()}
				>
					<i />
				</button>
			</div>
			<div className="vision-fallback-body">
				<label className="model-form-field">
					<span>智谱 API Key</span>
					<input
						type="password"
						value={apiKey}
						placeholder={config?.configured ? "已配置，留空则不修改" : "输入 API Key"}
						onChange={(event) => setApiKey(event.target.value)}
					/>
				</label>
				<label className="model-form-field">
					<span>视觉模型</span>
					<select
						value={model}
						disabled={!config?.configured && !apiKey.trim()}
						onChange={(event) => setModel(event.target.value)}
					>
						{(models.length > 0
							? models
							: [
									{
										id: "glm-4.6v-flash",
										name: "GLM-4.6V Flash",
										inputPrice: 0,
										outputPrice: 0,
										priceLabel: "免费",
									},
								]
						).map((option) => (
							<option key={option.id} value={option.id}>
								{option.name} · {option.priceLabel}
							</option>
						))}
					</select>
				</label>
				<button
					type="button"
					className="primary"
					disabled={saving || (!apiKey.trim() && !config?.configured)}
					onClick={() => void save()}
				>
					{saving ? "保存中…" : config?.configured ? "更新配置" : "启用视觉补全"}
					<Save size={14} />
				</button>
			</div>
			{config?.configured && (
				<p className="vision-fallback-status">
					{config.enabled ? "已启用" : "已关闭"} · 图片发送给纯文本模型时将先由 GLM-4.6V-Flash 解析。
				</p>
			)}
			{error && <p className="vision-fallback-error">{error}</p>}
		</section>
	);
}

export function ModelProvidersPanel({ instanceId }: { instanceId?: string }) {
	const [providers, setProviders] = useState<Record<string, ModelProviderConfig>>({});
	const [authStatuses, setAuthStatuses] = useState<
		Record<string, { type?: string; source?: string; configured: boolean }>
	>({});
	const [loadingProviders, setLoadingProviders] = useState(true);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [isNew, setIsNew] = useState(false);
	const [formId, setFormId] = useState("");
	const [formName, setFormName] = useState("");
	const [formBaseUrl, setFormBaseUrl] = useState("");
	const [formApiKey, setFormApiKey] = useState("");
	const [formApi, setFormApi] = useState("openai-completions");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [loginBusy, setLoginBusy] = useState<string | null>(null);

	const loadProviders = useCallback(async () => {
		setLoadingProviders(true);
		setError(null);
		try {
			const data = await desktopApi.getModelProviders();
			setProviders(data);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setLoadingProviders(false);
		}
	}, []);

	const loadAuthStatus = useCallback(async () => {
		if (!instanceId) return;
		try {
			const statuses = await desktopApi.getProviderAuthStatus(instanceId);
			const map: Record<string, { type?: string; source?: string; configured: boolean }> = {};
			for (const entry of statuses) {
				map[entry.provider] = { type: entry.type, source: entry.source, configured: entry.configured };
			}
			setAuthStatuses(map);
		} catch {
			// ignore
		}
	}, [instanceId]);

	useEffect(() => {
		void loadProviders();
	}, [loadProviders]);

	useEffect(() => {
		void loadAuthStatus();
	}, [loadAuthStatus]);

	const handleLogin = async (provider: string) => {
		if (!instanceId) {
			setError("请先打开一个对话，再登录服务商。");
			return;
		}
		setLoginBusy(provider);
		setError(null);
		try {
			await desktopApi.providerLogin(instanceId, provider, "oauth");
			await loadAuthStatus();
			window.dispatchEvent(new Event("openpi:model-providers-changed"));
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setLoginBusy(null);
		}
	};

	const handleLogout = async (provider: string) => {
		if (!instanceId) return;
		setLoginBusy(provider);
		setError(null);
		try {
			await desktopApi.providerLogout(instanceId, provider);
			await loadAuthStatus();
			window.dispatchEvent(new Event("openpi:model-providers-changed"));
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setLoginBusy(null);
		}
	};

	const openAddForm = () => {
		setIsNew(true);
		setEditingId(null);
		setFormId("");
		setFormName("");
		setFormBaseUrl("");
		setFormApiKey("");
		setFormApi("openai-completions");
	};

	const openEditForm = (id: string) => {
		const config = providers[id];
		if (!config) return;
		setIsNew(false);
		setEditingId(id);
		setFormId(id);
		setFormName(config.name ?? "");
		setFormBaseUrl(config.baseUrl ?? "");
		setFormApiKey(config.apiKey ?? "");
		setFormApi(config.api ?? "openai-completions");
	};

	const cancelEdit = () => {
		setEditingId(null);
		setIsNew(false);
	};

	const handleSave = async () => {
		const targetId = isNew ? formId.trim() : editingId;
		if (!targetId) {
			setError("服务商 ID 不能为空");
			return;
		}
		setSaving(true);
		setError(null);
		try {
			const config: ModelProviderConfig = {};
			if (formName.trim()) config.name = formName.trim();
			if (formBaseUrl.trim()) config.baseUrl = formBaseUrl.trim();
			if (formApiKey.trim()) config.apiKey = formApiKey.trim();
			if (isNew || formApi !== "openai-completions") config.api = formApi;
			await desktopApi.saveModelProvider(targetId, config);
			await loadProviders();
			cancelEdit();
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setSaving(false);
		}
	};

	const handleDelete = async (id: string) => {
		if (!confirm(`确定删除服务商“${id}”？此操作不可恢复。`)) return;
		setError(null);
		try {
			await desktopApi.deleteModelProvider(id);
			await loadProviders();
			if (editingId === id) cancelEdit();
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		}
	};

	const providerEntries = Object.entries(providers);
	const builtinEntries = providerEntries.filter(([id]) => BUILTIN_PROVIDER_IDS.has(id));
	const customEntries = providerEntries.filter(([id]) => !BUILTIN_PROVIDER_IDS.has(id));
	const totalCount = providerEntries.length;

	return (
		<div className="model-providers-panel">
			{error && (
				<div className="model-providers-error">
					<X size={14} />
					<span>{error}</span>
					<button type="button" className="icon-button quiet" onClick={() => setError(null)} aria-label="关闭">
						<X size={12} />
					</button>
				</div>
			)}

			{editingId !== null || isNew ? (
				<div className="model-provider-form">
					<div className="model-form-header">
						<strong>{isNew ? "添加服务商" : `编辑 ${editingId}`}</strong>
						<button type="button" className="icon-button quiet" onClick={cancelEdit} aria-label="取消">
							<X size={16} />
						</button>
					</div>
					<div className="model-form-fields">
						<label className="model-form-field">
							<span>服务商 ID</span>
							<input
								type="text"
								value={formId}
								placeholder="例如: my-ollama"
								disabled={!isNew}
								onChange={(e) => setFormId(e.target.value)}
							/>
						</label>
						<label className="model-form-field">
							<span>显示名称</span>
							<input
								type="text"
								value={formName}
								placeholder="例如: My Ollama"
								onChange={(e) => setFormName(e.target.value)}
							/>
						</label>
						<label className="model-form-field">
							<span>Base URL</span>
							<input
								type="text"
								value={formBaseUrl}
								placeholder="https://api.example.com/v1"
								onChange={(e) => setFormBaseUrl(e.target.value)}
							/>
						</label>
						<label className="model-form-field">
							<span>API Key</span>
							<input
								type="password"
								value={formApiKey}
								placeholder="sk-..."
								onChange={(e) => setFormApiKey(e.target.value)}
							/>
						</label>
						<label className="model-form-field">
							<span>API 类型</span>
							<select value={formApi} onChange={(e) => setFormApi(e.target.value)}>
								{API_TYPE_OPTIONS.map((opt) => (
									<option key={opt.value} value={opt.value}>
										{opt.label}
									</option>
								))}
							</select>
						</label>
					</div>
					<div className="model-form-actions">
						<button
							type="button"
							className="primary"
							disabled={saving || !formId.trim()}
							onClick={() => void handleSave()}
						>
							{saving ? "保存中…" : "保存"}
							<Save size={14} />
						</button>
						<button type="button" onClick={cancelEdit}>
							取消
						</button>
					</div>
				</div>
			) : (
				<>
					<VisionFallbackPanel onSaved={loadProviders} />
					<div className="model-providers-toolbar">
						<span className="model-providers-count">{totalCount} 个服务商已配置</span>
						<button type="button" className="primary" onClick={openAddForm}>
							<Plus size={14} />
							添加服务商
						</button>
					</div>

					{loadingProviders ? (
						<div className="model-providers-loading">
							<RefreshCw size={18} className="spin" />
							<span>加载中…</span>
						</div>
					) : (
						<>
							{customEntries.length > 0 && (
								<section className="model-provider-group">
									<div className="model-provider-group-heading">
										<strong>自定义服务商</strong>
										<span>{customEntries.length}</span>
									</div>
									{customEntries.map(([id, config]) => (
										<article className="model-provider-row" key={id}>
											<div className="model-provider-icon custom">
												<Server size={16} />
											</div>
											<div className="model-provider-info">
												<strong>
													{config.name || id}
													{config.apiKey && <span className="model-api-key-badge">API Key</span>}
												</strong>
												<span>{config.baseUrl || "默认地址"}</span>
											</div>
											<div className="model-provider-actions">
												<button
													type="button"
													title="编辑"
													aria-label="编辑"
													onClick={() => openEditForm(id)}
												>
													<Pencil size={13} />
												</button>
												<button
													type="button"
													className="danger"
													title="删除"
													aria-label="删除"
													onClick={() => void handleDelete(id)}
												>
													<Trash2 size={13} />
												</button>
											</div>
										</article>
									))}
								</section>
							)}

							{builtinEntries.length > 0 && (
								<section className="model-provider-group">
									<div className="model-provider-group-heading">
										<strong>内置服务商</strong>
										<span>{builtinEntries.length}</span>
									</div>
									{builtinEntries.map(([id, config]) => (
										<article className="model-provider-row" key={id}>
											<div className="model-provider-icon builtin">
												<Server size={16} />
											</div>
											<div className="model-provider-info">
												<strong>
													{config.name || id}
													{config.apiKey && <span className="model-api-key-badge">API Key</span>}
													{authStatuses[id]?.type === "oauth" && (
														<span className="model-api-key-badge oauth">已登录</span>
													)}
												</strong>
												<span>
													{config.baseUrl || "默认地址"}
													{authStatuses[id]?.configured && !authStatuses[id]?.type && " · 已配置"}
												</span>
											</div>
											<div className="model-provider-actions">
												{instanceId && authStatuses[id]?.type === "oauth" ? (
													<button
														type="button"
														title="登出"
														aria-label="登出"
														disabled={loginBusy === id}
														onClick={() => void handleLogout(id)}
													>
														{loginBusy === id ? (
															<RefreshCw size={13} className="spin" />
														) : (
															<LogOut size={13} />
														)}
													</button>
												) : (
													<button
														type="button"
														title={instanceId ? "登录" : "先打开一个对话再登录"}
														aria-label="登录"
														disabled={loginBusy === id || !instanceId}
														onClick={() => void handleLogin(id)}
													>
														{loginBusy === id ? (
															<RefreshCw size={13} className="spin" />
														) : (
															<LogIn size={13} />
														)}
													</button>
												)}
												<button
													type="button"
													title="编辑"
													aria-label="编辑"
													onClick={() => openEditForm(id)}
												>
													<Pencil size={13} />
												</button>
											</div>
										</article>
									))}
								</section>
							)}

							{totalCount === 0 && (
								<div className="model-providers-empty">
									<Server size={28} />
									<strong>还没有配置服务商</strong>
									<span>点击“添加服务商”配置自定义 API 或设置内置服务商的密钥。</span>
								</div>
							)}
						</>
					)}
				</>
			)}
		</div>
	);
}

export function CapabilitiesSurface({
	conversation,
	capabilities,
	loading,
	busy,
	onClose,
	onReload,
	onUseSkill,
	onConfigureMcp,
	onInstallPackage,
	onRemoveMcp,
}: {
	conversation?: ConversationSnapshot;
	capabilities?: ConversationCapabilities;
	loading: boolean;
	busy?: string;
	onClose(): void;
	onReload(): void;
	onUseSkill(name: string): void;
	onConfigureMcp(): void;
	onInstallPackage(marketPackage: MarketplacePackage): void;
	onRemoveMcp(source: string, local: boolean): void;
}) {
	const [tab, setTab] = useState<CapabilityTab>("models");
	const [marketKind, setMarketKind] = useState<MarketplaceKind>("skills");
	const [marketQuery, setMarketQuery] = useState("");
	const [modelProviderCount, setModelProviderCount] = useState(0);

	// Load model provider count for tab badge
	useEffect(() => {
		desktopApi
			.getModelProviders()
			.then((providers) => {
				setModelProviderCount(Object.keys(providers).length);
			})
			.catch(() => {
				// ignore
			});
	}, [tab]);
	const mcpPackages =
		capabilities?.packages.filter((entry) => capabilities.mcp.packageSources.includes(entry.source)) ?? [];
	const mutationDisabled = !conversation || conversation.state.isStreaming || loading || Boolean(busy);
	const normalizedMarketQuery = marketQuery.trim().toLowerCase();
	const marketplacePackages = MARKETPLACE_PACKAGES.filter((marketPackage) => {
		if (marketPackage.kind !== marketKind) return false;
		if (!normalizedMarketQuery) return true;
		return `${marketPackage.name} ${marketPackage.packageName} ${marketPackage.publisher} ${marketPackage.description} ${marketPackage.tags.join(" ")}`
			.toLowerCase()
			.includes(normalizedMarketQuery);
	});
	const marketplaceCounts = {
		skills: MARKETPLACE_PACKAGES.filter((marketPackage) => marketPackage.kind === "skills").length,
		mcp: MARKETPLACE_PACKAGES.filter((marketPackage) => marketPackage.kind === "mcp").length,
		repositories: MARKETPLACE_PACKAGES.filter((marketPackage) => marketPackage.kind === "repositories").length,
	};
	const isInstalled = (marketPackage: MarketplacePackage): boolean => {
		const sourceIdentity = marketPackage.source.startsWith("git:")
			? `git:github.com/${marketPackage.packageName}`
			: `npm:${marketPackage.packageName}`;
		return (
			capabilities?.packages.some(
				(entry) => entry.source === sourceIdentity || entry.source.startsWith(`${sourceIdentity}@`),
			) ?? false
		);
	};
	const tabs: Array<{
		id: CapabilityTab;
		label: string;
		description: string;
		count: number;
		icon: typeof BookOpen;
	}> = [
		{ id: "models", label: "模型", description: "服务商与 API 配置", count: modelProviderCount, icon: Cpu },
		{
			id: "market",
			label: "市场",
			description: "安装技能、MCP 服务和工作流",
			count: MARKETPLACE_PACKAGES.length,
			icon: Store,
		},
		{
			id: "skills",
			label: "技能",
			description: "当前会话可调用的能力",
			count: capabilities?.skills.length ?? 0,
			icon: BookOpen,
		},
		{
			id: "mcp",
			label: "MCP",
			description: "外部服务与工具连接",
			count: capabilities?.mcp.tools.length ?? 0,
			icon: Cable,
		},
		{
			id: "extensions",
			label: "扩展",
			description: "已加载的本地扩展",
			count: capabilities?.extensions.length ?? 0,
			icon: Blocks,
		},
		{
			id: "tools",
			label: "工具",
			description: "当前会话已注册的工具",
			count: capabilities?.tools.length ?? 0,
			icon: Wrench,
		},
		{
			id: "packages",
			label: "已安装包",
			description: "项目与用户级依赖",
			count: capabilities?.packages.length ?? 0,
			icon: Package,
		},
	];
	const selectedTab = tabs.find((item) => item.id === tab) ?? tabs[0];

	return (
		<section className="capabilities-surface settings-surface">
			<header className="surface-header capability-page-header">
				<button className="icon-button quiet" title="返回聊天" aria-label="返回聊天" onClick={onClose}>
					<ArrowLeft size={18} />
				</button>
				<div className="surface-heading">
					<strong>设置</strong>
					<span>模型、扩展和本地工具</span>
				</div>
				<button
					className="icon-button"
					title="重新加载"
					aria-label="重新加载"
					disabled={mutationDisabled}
					onClick={onReload}
				>
					<RefreshCw size={16} className={loading ? "spin" : ""} />
				</button>
			</header>

			<div className="settings-workspace">
				<nav className="settings-navigation" role="tablist" aria-label="设置分类">
					<span className="settings-navigation-label">设置</span>
					{tabs.map((item) => {
						const Icon = item.icon;
						return (
							<button
								type="button"
								role="tab"
								aria-selected={tab === item.id}
								className={tab === item.id ? "active" : ""}
								key={item.id}
								onClick={() => setTab(item.id)}
							>
								<Icon size={16} />
								<span>{item.label}</span>
								{item.count > 0 && <em>{item.count}</em>}
							</button>
						);
					})}
				</nav>

				<div className="capability-content settings-content">
					<header className="settings-content-header">
						<div>
							<h1>{selectedTab.label}</h1>
							<p>{selectedTab.description}</p>
						</div>
						{conversation && tab !== "models" && (
							<span className="settings-session-label">
								{instanceTitle(conversation.instance, conversation.state.sessionName)}
							</span>
						)}
					</header>
					{tab === "models" ? (
						<ModelProvidersPanel instanceId={conversation?.instance.id} />
					) : !conversation ? (
						<div className="product-empty large">
							<Blocks size={32} />
							<strong>还没有选中对话</strong>
							<span>能力（技能、MCP、工具）挂在具体会话上。左侧新建或点开一个对话即可管理。</span>
						</div>
					) : loading && !capabilities ? (
						<div className="product-empty">
							<RefreshCw size={24} className="spin" />
							<strong>加载能力中…</strong>
						</div>
					) : capabilities ? (
						<>
							{capabilities.diagnostics.length > 0 && (
								<div className="capability-diagnostics">
									{capabilities.diagnostics.map((diagnostic, index) => (
										<div
											className={diagnostic.type}
											key={`${diagnostic.path ?? diagnostic.message}-${index}`}
										>
											<Bell size={14} />
											<span>
												<strong>{diagnostic.resource}</strong>
												{diagnostic.message}
											</span>
										</div>
									))}
								</div>
							)}

							{tab === "market" && (
								<div className="marketplace-workspace">
									<section className="settings-market-intro">
										<div>
											<span className="settings-market-kicker">
												<Store size={14} /> OpenPI Marketplace
											</span>
											<h2>
												{marketKind === "skills"
													? "为助手增加专业技能"
													: marketKind === "mcp"
														? "连接 MCP 外部工具"
														: "扩展自动化工作流"}
											</h2>
											<p>安装后会写入当前会话的配置。完成安装后重新加载即可查看可用能力。</p>
										</div>
										<div className="settings-market-summary">
											<span>
												<strong>{capabilities.packages.length}</strong>
												已安装
											</span>
											<span>
												<strong>{marketplaceCounts[marketKind]}</strong>
												可选
											</span>
										</div>
									</section>
									<div className="marketplace-controls settings-market-controls">
										<div className="settings-market-tabs" role="tablist" aria-label="市场分类">
											<button
												type="button"
												role="tab"
												aria-selected={marketKind === "skills"}
												className={marketKind === "skills" ? "active" : ""}
												onClick={() => setMarketKind("skills")}
											>
												<BookOpen size={14} /> 技能 <span>{marketplaceCounts.skills}</span>
											</button>
											<button
												type="button"
												role="tab"
												aria-selected={marketKind === "mcp"}
												className={marketKind === "mcp" ? "active" : ""}
												onClick={() => setMarketKind("mcp")}
											>
												<Cable size={14} /> MCP <span>{marketplaceCounts.mcp}</span>
											</button>
											<button
												type="button"
												role="tab"
												aria-selected={marketKind === "repositories"}
												className={marketKind === "repositories" ? "active" : ""}
												onClick={() => setMarketKind("repositories")}
											>
												<Github size={14} /> 工作流 <span>{marketplaceCounts.repositories}</span>
											</button>
										</div>
										<label className="search-box settings-market-search">
											<Search size={14} />
											<input
												aria-label="Search marketplace"
												value={marketQuery}
												onChange={(event) => setMarketQuery(event.target.value)}
												placeholder="搜索包"
											/>
										</label>
									</div>
									<div className="settings-market-grid">
										{marketplacePackages.map((marketPackage) => {
											const installed = isInstalled(marketPackage);
											const installing = busy === `install-market-${marketPackage.id}`;
											return (
												<article className="settings-market-card" key={marketPackage.id}>
													<header>
														<span
															className={`capability-icon ${marketPackage.kind === "skills" ? "skill" : marketPackage.kind === "mcp" ? "mcp" : "package"}`}
														>
															{marketPackage.kind === "skills" ? (
																<BookOpen size={17} />
															) : marketPackage.kind === "mcp" ? (
																<Cable size={17} />
															) : (
																<Github size={17} />
															)}
														</span>
														<div>
															<strong>{marketPackage.name}</strong>
															<span>{marketPackage.publisher}</span>
														</div>
														{installed && <span className="settings-market-installed">已安装</span>}
													</header>
													<p>{marketPackage.description}</p>
													<div className="marketplace-tags">
														{marketPackage.tags.map((tag) => (
															<span key={tag}>{tag}</span>
														))}
													</div>
													<footer>
														<code>v{marketPackage.version}</code>
														<button
															className={installed ? "button" : "button primary"}
															disabled={mutationDisabled || installed}
															onClick={() => onInstallPackage(marketPackage)}
														>
															{installing ? (
																<RefreshCw size={14} className="spin" />
															) : installed ? (
																<Check size={14} />
															) : (
																<Download size={14} />
															)}
															{installed ? "Installed" : "Install"}
														</button>
													</footer>
												</article>
											);
										})}
										{marketplacePackages.length === 0 && (
											<div className="capability-empty">
												<Store size={25} />
												<strong>没有匹配的包</strong>
											</div>
										)}
									</div>
								</div>
							)}

							{tab === "skills" && (
								<div className="settings-resource-workspace">
									<section className="settings-resource-banner">
										<div>
											<span className="settings-market-kicker">
												<BookOpen size={14} /> Skills
											</span>
											<strong>为当前助手添加专业工作流</strong>
											<p>安装的技能会在重新加载后显示在这里，并可通过斜杠命令调用。</p>
										</div>
										<button
											type="button"
											className="button primary"
											onClick={() => {
												setMarketKind("skills");
												setTab("market");
											}}
										>
											<Store size={14} /> 浏览技能市场
										</button>
									</section>
									<div className="capability-list">
										{capabilities.skills.map((skill) => (
											<article className="capability-row" key={skill.filePath}>
												<span className="capability-icon skill">
													<BookOpen size={17} />
												</span>
												<div className="capability-copy">
													<div>
														<strong>{skill.name}</strong>
														<span className="source-badge">{skill.sourceInfo.scope}</span>
														{skill.disableModelInvocation && (
															<span className="source-badge muted">manual</span>
														)}
													</div>
													<p>{skill.description}</p>
													<code>{skill.filePath}</code>
												</div>
												<button className="button" onClick={() => onUseSkill(skill.name)}>
													Use
												</button>
											</article>
										))}
										{capabilities.skills.length === 0 && (
											<div className="capability-empty">
												<BookOpen size={25} />
												<strong>还没有技能</strong>
											</div>
										)}
									</div>
								</div>
							)}

							{tab === "mcp" && (
								<div className="mcp-workspace">
									<section className="mcp-status-band">
										<span className={`capability-icon mcp ${capabilities.mcp.loaded ? "online" : ""}`}>
											<Cable size={19} />
										</span>
										<div>
											<strong>Pi MCP Adapter</strong>
											<span>
												{capabilities.mcp.loaded
													? "Loaded"
													: capabilities.mcp.configured
														? "Configured"
														: "Not installed"}
											</span>
										</div>
										<div className="capability-actions">
											{capabilities.mcp.loaded && (
												<button
													className="button"
													disabled={conversation.state.isStreaming}
													onClick={onConfigureMcp}
												>
													Setup
												</button>
											)}
											<button
												type="button"
												className="button"
												disabled={mutationDisabled}
												onClick={() => {
													setMarketKind("mcp");
													setTab("market");
												}}
											>
												<Store size={14} /> MCP 市场
											</button>
											{!capabilities.mcp.configured && (
												<button
													className="button primary"
													disabled={mutationDisabled}
													onClick={() => onInstallPackage(MCP_ADAPTER_MARKETPLACE_PACKAGE)}
												>
													{busy === `install-market-${MCP_ADAPTER_MARKETPLACE_PACKAGE.id}` ? (
														<RefreshCw size={14} className="spin" />
													) : (
														<Plus size={15} />
													)}
													Install
												</button>
											)}
											{mcpPackages.map((entry) => (
												<button
													className="icon-button danger"
													title="Remove MCP adapter"
													aria-label="Remove MCP adapter"
													disabled={mutationDisabled}
													key={`${entry.scope}:${entry.source}`}
													onClick={() => {
														if (window.confirm(`Remove ${entry.source}?`))
															onRemoveMcp(entry.source, entry.scope === "project");
													}}
												>
													{busy === "remove-mcp" ? (
														<RefreshCw size={15} className="spin" />
													) : (
														<Trash2 size={15} />
													)}
												</button>
											))}
										</div>
									</section>
									<div className="capability-metrics">
										<div>
											<span>Packages</span>
											<strong>{capabilities.mcp.packageSources.length}</strong>
										</div>
										<div>
											<span>Extensions</span>
											<strong>{capabilities.mcp.extensionPaths.length}</strong>
										</div>
										<div>
											<span>Commands</span>
											<strong>{capabilities.mcp.commands.length}</strong>
										</div>
										<div>
											<span>Tools</span>
											<strong>{capabilities.mcp.tools.length}</strong>
										</div>
									</div>
									{(capabilities.mcp.servers?.length ?? 0) > 0 && (
										<div className="capability-list compact">
											{capabilities.mcp.servers?.map((server) => (
												<div className="capability-row" key={server?.name ?? "unknown"}>
													<span
														className={`capability-icon mcp ${
															server?.status === "connected" ? "online" : ""
														}`}
													>
														<Cable size={16} />
													</span>
													<div className="capability-copy">
														<strong>{server?.name ?? "MCP server"}</strong>
														<code>
															{server?.status === "connected"
																? `${server?.toolCount ?? 0} tool(s)`
																: server?.status === "starting"
																	? "starting"
																	: (server?.error ?? "error")}
														</code>
													</div>
													<span className="active-indicator">{server?.status ?? "unknown"}</span>
												</div>
											))}
										</div>
									)}
									{capabilities.mcp.tools.length > 0 && (
										<div className="capability-list compact">
											{capabilities.mcp.tools.map((tool) => (
												<div className="capability-row" key={tool}>
													<span className="capability-icon tool">
														<Wrench size={16} />
													</span>
													<div className="capability-copy">
														<strong>{tool}</strong>
														<code>MCP tool</code>
													</div>
													<span className="active-indicator">Active</span>
												</div>
											))}
										</div>
									)}
								</div>
							)}

							{tab === "extensions" && (
								<div className="capability-list">
									{capabilities.extensions.map((extension) => (
										<article className="capability-row" key={extension.path}>
											<span className="capability-icon extension">
												<Blocks size={17} />
											</span>
											<div className="capability-copy">
												<div>
													<strong>{extension.sourceInfo.source}</strong>
													<span className="source-badge">{extension.sourceInfo.scope}</span>
												</div>
												<code>{extension.path}</code>
												<p>
													{extension.commands.length} commands · {extension.tools.length} tools
												</p>
											</div>
										</article>
									))}
									{capabilities.extensions.length === 0 && (
										<div className="capability-empty">
											<Blocks size={25} />
											<strong>还没有扩展</strong>
										</div>
									)}
								</div>
							)}

							{tab === "tools" && (
								<div className="capability-list compact">
									{capabilities.tools.map((tool) => (
										<article className="capability-row" key={`${tool.sourceInfo.path}:${tool.name}`}>
											<span className="capability-icon tool">
												<Wrench size={16} />
											</span>
											<div className="capability-copy">
												<div>
													<strong>{tool.name}</strong>
													<span className="source-badge">{tool.sourceInfo.source}</span>
												</div>
												<p>{tool.description}</p>
											</div>
											<span className={tool.active ? "active-indicator" : "active-indicator inactive"}>
												{tool.active ? "Active" : "Inactive"}
											</span>
										</article>
									))}
								</div>
							)}

							{tab === "packages" && (
								<div className="capability-list compact">
									{capabilities.packages.map((entry) => (
										<article className="capability-row" key={`${entry.scope}:${entry.source}`}>
											<span className="capability-icon package">
												<Package size={17} />
											</span>
											<div className="capability-copy">
												<div>
													<strong>{entry.source}</strong>
													<span className="source-badge">{entry.scope}</span>
													{entry.filtered && <span className="source-badge muted">filtered</span>}
												</div>
												{entry.installedPath && <code>{entry.installedPath}</code>}
											</div>
										</article>
									))}
									{capabilities.packages.length === 0 && (
										<div className="capability-empty">
											<Package size={25} />
											<strong>还没有配置包</strong>
										</div>
									)}
								</div>
							)}
						</>
					) : null}
				</div>
			</div>
		</section>
	);
}

export function TasksSurface({
	tasks,
	taskCount,
	selectedTask,
	taskRuns,
	selectedRun,
	filter,
	query,
	log,
	busy,
	onFilterChange,
	onQueryChange,
	onSelectTask,
	onSelectRun,
	onNew,
	onOpenSidebar,
	onRun,
	onPause,
	onDelete,
	onCancel,
	onLoadLog,
}: {
	tasks: TaskDefinition[];
	taskCount: number;
	selectedTask?: TaskDefinition;
	taskRuns: TaskRun[];
	selectedRun?: TaskRun;
	filter: TaskFilter;
	query: string;
	log?: string;
	busy?: string;
	onFilterChange(filter: TaskFilter): void;
	onQueryChange(value: string): void;
	onSelectTask(taskId: string): void;
	onSelectRun(runId: string): void;
	onNew(): void;
	onOpenSidebar(): void;
	onRun(taskId: string): Promise<unknown>;
	onPause(taskId: string, paused: boolean): Promise<unknown>;
	onDelete(taskId: string): Promise<unknown>;
	onCancel(runId: string): Promise<unknown>;
	onLoadLog(run: TaskRun, stream: "stdout" | "stderr"): Promise<void>;
}) {
	return (
		<section className="tasks-surface">
			<header className="surface-header task-page-header">
				<button
					className="icon-button quiet mobile-only"
					title="Open conversations"
					aria-label="Open conversations"
					onClick={onOpenSidebar}
				>
					<Menu size={18} />
				</button>
				<div className="surface-heading">
					<strong>定时任务</strong>
					<span>{taskCount === 0 ? "还没有自动化" : `${taskCount} 个任务`}</span>
				</div>
				<button type="button" className="button primary" onClick={onNew}>
					<Plus size={16} />
					新建任务
				</button>
			</header>
			<div className="tasks-workspace">
				<aside className="task-browser">
					<div className="search-box">
						<Search size={15} />
						<input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="搜索任务" />
					</div>
					<div className="segmented">
						{(
							[
								["all", "全部"],
								["active", "启用"],
								["paused", "暂停"],
							] as const
						).map(([value, label]) => (
							<button
								type="button"
								key={value}
								className={filter === value ? "active" : ""}
								onClick={() => onFilterChange(value)}
							>
								{label}
							</button>
						))}
					</div>
					<div className="task-list">
						{tasks.map((task) => (
							<button
								type="button"
								key={task.id}
								className={`task-row ${selectedTask?.id === task.id ? "selected" : ""}`}
								onClick={() => onSelectTask(task.id)}
							>
								<span className={`task-status ${task.status}`} />
								<span>
									<strong>{task.title}</strong>
									<small>{task.nextRunAt ? formatDate(task.nextRunAt) : "已暂停"}</small>
								</span>
								<ChevronRight size={15} />
							</button>
						))}
						{tasks.length === 0 && (
							<div className="product-empty compact">
								<Clock3 size={22} />
								<strong>没有任务</strong>
								<span>用定时任务做日报、巡检、提醒。点右上角「新建任务」。</span>
							</div>
						)}
					</div>
				</aside>

				<div className="task-detail">
					{selectedTask ? (
						<>
							<div className="task-detail-header">
								<div>
									<span className="eyebrow">自动化</span>
									<h1>{selectedTask.title}</h1>
									<p>{selectedTask.prompt}</p>
								</div>
								<div className="detail-actions">
									<button
										type="button"
										className="button primary"
										disabled={Boolean(busy)}
										onClick={() => void onRun(selectedTask.id)}
									>
										<Play size={15} />
										立即运行
									</button>
									<button
										type="button"
										className="icon-button"
										title={selectedTask.status === "active" ? "暂停" : "恢复"}
										aria-label={selectedTask.status === "active" ? "暂停" : "恢复"}
										onClick={() => void onPause(selectedTask.id, selectedTask.status === "active")}
									>
										{selectedTask.status === "active" ? <Pause size={17} /> : <Play size={17} />}
									</button>
									<button
										type="button"
										className="icon-button danger"
										title="删除"
										aria-label="删除"
										onClick={() => {
											if (window.confirm(`删除「${selectedTask.title}」？`)) void onDelete(selectedTask.id);
										}}
									>
										<Trash2 size={17} />
									</button>
								</div>
							</div>
							<div className="metadata-strip">
								<div>
									<span>状态</span>
									<strong className={`text-status ${selectedTask.status}`}>
										{statusLabel(selectedTask.status)}
									</strong>
								</div>
								<div>
									<span>计划</span>
									<strong>{scheduleLabel(selectedTask)}</strong>
								</div>
								<div>
									<span>下次运行</span>
									<strong>{formatDate(selectedTask.nextRunAt)}</strong>
								</div>
								<div>
									<span>工作区</span>
									<strong className="path">
										<Folder size={14} />
										{selectedTask.cwd ? shortWorkspacePath(selectedTask.cwd) : "默认"}
									</strong>
								</div>
							</div>
							<div className="task-run-grid">
								<section className="runs-panel">
									<div className="section-title">
										<div>
											<h2>运行历史</h2>
											<span>{taskRuns.length} 次</span>
										</div>
										<History size={17} />
									</div>
									<div className="run-list">
										{taskRuns.map((run) => (
											<button
												type="button"
												key={run.id}
												className={`run-row ${selectedRun?.id === run.id ? "selected" : ""}`}
												onClick={() => onSelectRun(run.id)}
											>
												<span className={`run-icon ${run.status}`}>
													{run.status === "succeeded" ? (
														<Check size={14} />
													) : run.status === "running" ? (
														<RefreshCw size={14} className="spin" />
													) : (
														<X size={14} />
													)}
												</span>
												<span>
													<strong>{statusLabel(run.status)}</strong>
													<small>
														{formatDate(run.startedAt ?? run.createdAt)} ·{" "}
														{run.trigger === "manual" ? "手动" : "定时"}
													</small>
												</span>
												<code>{run.id.slice(0, 8)}</code>
											</button>
										))}
										{taskRuns.length === 0 && (
											<div className="panel-empty">
												<TerminalSquare size={25} />
												<strong>还没有运行过</strong>
												<span>点「立即运行」试一次</span>
											</div>
										)}
									</div>
								</section>
								<section className="output-panel">
									<div className="section-title">
										<div>
											<h2>输出</h2>
											<span>{selectedRun?.id ?? "选一次运行"}</span>
										</div>
										{selectedRun?.status === "running" && (
											<button
												type="button"
												className="button danger"
												onClick={() => void onCancel(selectedRun.id)}
											>
												<CircleStop size={15} />
												取消
											</button>
										)}
									</div>
									{selectedRun ? (
										<>
											<div className="output-summary">
												<span className={`run-chip ${selectedRun.status}`}>
													{statusLabel(selectedRun.status)}
												</span>
												<span>退出码 {selectedRun.exitCode ?? "—"}</span>
												<span>{formatDate(selectedRun.finishedAt)}</span>
											</div>
											<div className="log-tabs">
												<button onClick={() => void onLoadLog(selectedRun, "stdout")}>stdout</button>
												<button onClick={() => void onLoadLog(selectedRun, "stderr")}>stderr</button>
											</div>
											<pre>{log ?? selectedRun.result ?? selectedRun.error ?? "暂无输出。"}</pre>
										</>
									) : (
										<div className="panel-empty">
											<TerminalSquare size={25} />
											<strong>选一次运行</strong>
										</div>
									)}
								</section>
							</div>
						</>
					) : (
						<div className="task-empty product-empty large">
							<ListTodo size={32} />
							<strong>还没选任务</strong>
							<span>从左侧选一个，或新建一个会自动跑的助手任务。</span>
							<button type="button" className="button primary" onClick={onNew}>
								<Plus size={16} />
								新建任务
							</button>
						</div>
					)}
				</div>
			</div>
		</section>
	);
}

export function ProviderAuthDialog({
	auth,
	busy,
	onClose,
	onOpenUrl,
	onDone,
}: {
	auth: {
		provider: string;
		url?: string;
		userCode?: string;
		status: "pending" | "completed" | "failed";
		message?: string;
	};
	busy: boolean;
	onClose(): void;
	onOpenUrl(url: string): void;
	onDone(): void;
}) {
	return (
		<div className="dialog-backdrop">
			<div className="dialog conversation-dialog auth-dialog">
				<div className="dialog-header">
					<div>
						<span className="eyebrow">服务商登录</span>
						<h2>{auth.provider}</h2>
					</div>
					<button
						type="button"
						className="icon-button quiet"
						title="关闭"
						aria-label="关闭"
						disabled={busy}
						onClick={onClose}
					>
						<X size={17} />
					</button>
				</div>

				{auth.status === "pending" && (
					<>
						<p className="ui-request-message">
							{auth.userCode ? (
								<>
									请在浏览器中打开下面的链接，并输入验证码：
									<strong className="auth-user-code">{auth.userCode}</strong>
								</>
							) : (
								"请在浏览器中完成授权。"
							)}
						</p>
						{auth.url && (
							<button
								type="button"
								className="button primary"
								disabled={busy}
								onClick={() => onOpenUrl(auth.url ?? "")}
							>
								<ExternalLink size={15} />
								打开浏览器
							</button>
						)}
						{auth.message && <p className="ui-request-message muted">{auth.message}</p>}
						<div className="auth-spinner-row">
							<RefreshCw size={15} className="spin" />
							<span>等待授权完成…</span>
						</div>
					</>
				)}

				{auth.status === "completed" && (
					<>
						<p className="ui-request-message">登录成功，模型列表已刷新。</p>
						<div className="dialog-actions">
							<button type="button" className="button primary" onClick={onDone}>
								完成
							</button>
						</div>
					</>
				)}

				{auth.status === "failed" && (
					<>
						<p className="ui-request-message error-text">登录失败：{auth.message ?? "未知错误"}</p>
						<div className="dialog-actions">
							<button type="button" className="button primary" onClick={onDone}>
								关闭
							</button>
						</div>
					</>
				)}
			</div>
		</div>
	);
}

export function EditProfileDialog({
	profile,
	busy,
	onClose,
	onSave,
}: {
	profile: { nickname?: string; avatarEmoji?: string };
	busy: boolean;
	onClose(): void;
	onSave(profile: { nickname?: string; avatarEmoji?: string }): Promise<void>;
}) {
	const [nickname, setNickname] = useState(profile.nickname ?? "");
	const [avatarEmoji, setAvatarEmoji] = useState(profile.avatarEmoji ?? "");
	return (
		<div
			className="dialog-backdrop"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget && !busy) onClose();
			}}
		>
			<form
				className="dialog conversation-dialog"
				onSubmit={(event) => {
					event.preventDefault();
					void onSave({ nickname: nickname.trim(), avatarEmoji: avatarEmoji.trim() || undefined });
				}}
			>
				<div className="dialog-header">
					<div>
						<span className="eyebrow">本地档案</span>
						<h2>编辑资料</h2>
					</div>
					<button
						type="button"
						className="icon-button quiet"
						title="关闭"
						aria-label="关闭"
						disabled={busy}
						onClick={onClose}
					>
						<X size={17} />
					</button>
				</div>
				<label>
					昵称
					<input
						autoFocus
						maxLength={40}
						value={nickname}
						onChange={(event) => setNickname(event.target.value)}
						placeholder="你的名字"
					/>
				</label>
				<label>
					头像表情
					<input
						maxLength={4}
						value={avatarEmoji}
						onChange={(event) => setAvatarEmoji(event.target.value)}
						placeholder="如 🧑💻"
					/>
				</label>
				<div className="dialog-actions">
					<button type="button" className="button" disabled={busy} onClick={onClose}>
						取消
					</button>
					<button className="button primary" disabled={busy || nickname.trim().length === 0}>
						{busy ? "保存中…" : "保存"}
					</button>
				</div>
			</form>
		</div>
	);
}

export function RenameConversationDialog({
	conversation,
	busy,
	onClose,
	onRename,
}: {
	conversation: AgentInstance;
	busy: boolean;
	onClose(): void;
	onRename(name: string): Promise<void>;
}) {
	const [name, setName] = useState(instanceTitle(conversation));
	return (
		<div
			className="dialog-backdrop"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget && !busy) onClose();
			}}
		>
			<form
				className="dialog conversation-dialog"
				onSubmit={(event) => {
					event.preventDefault();
					void onRename(name);
				}}
			>
				<div className="dialog-header">
					<div>
						<span className="eyebrow">对话</span>
						<h2>重命名</h2>
					</div>
					<button
						type="button"
						className="icon-button quiet"
						title="关闭"
						aria-label="关闭"
						disabled={busy}
						onClick={onClose}
					>
						<X size={17} />
					</button>
				</div>
				<label>
					名称
					<input autoFocus required value={name} onChange={(event) => setName(event.target.value)} />
				</label>
				<div className="dialog-actions">
					<button type="button" className="button" disabled={busy} onClick={onClose}>
						取消
					</button>
					<button className="button primary" disabled={busy || name.trim().length === 0}>
						{busy ? "保存中…" : "保存"}
					</button>
				</div>
			</form>
		</div>
	);
}

export function DeleteConversationDialog({
	conversation,
	busy,
	onClose,
	onDelete,
}: {
	conversation: AgentInstance;
	busy: boolean;
	onClose(): void;
	onDelete(): Promise<void>;
}) {
	return (
		<div
			className="dialog-backdrop"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget && !busy) onClose();
			}}
		>
			<div className="dialog conversation-dialog">
				<div className="dialog-header">
					<div>
						<span className="eyebrow danger-text">删除对话</span>
						<h2>{instanceTitle(conversation)}</h2>
					</div>
					<button
						type="button"
						className="icon-button quiet"
						title="关闭"
						aria-label="关闭"
						disabled={busy}
						onClick={onClose}
					>
						<X size={17} />
					</button>
				</div>
				<p className="destructive-dialog-copy">将永久删除此对话及其消息记录，无法恢复。</p>
				<div className="dialog-actions">
					<button type="button" className="button" disabled={busy} onClick={onClose}>
						取消
					</button>
					<button
						type="button"
						className="button danger destructive"
						disabled={busy}
						onClick={() => void onDelete()}
					>
						{busy ? "删除中…" : "删除"}
					</button>
				</div>
			</div>
		</div>
	);
}

export function ConversationUiDialog({
	request,
	busy,
	onRespond,
}: {
	request: BlockingConversationUiRequest;
	busy: boolean;
	onRespond(response: ConversationUiResponse): Promise<void>;
}) {
	const [value, setValue] = useState(request.method === "editor" ? (request.prefill ?? "") : "");
	const cancel = (): void => {
		const response: ConversationUiResponse =
			request.method === "confirm" ? { id: request.id, confirmed: false } : { id: request.id, cancelled: true };
		void onRespond(response);
	};

	return (
		<div className="dialog-backdrop">
			<form
				className="dialog agent-dialog"
				onSubmit={(event) => {
					event.preventDefault();
					if (request.method === "confirm") {
						void onRespond({ id: request.id, confirmed: true });
					} else if (request.method === "input" || request.method === "editor") {
						void onRespond({ id: request.id, value });
					}
				}}
			>
				<div className="dialog-header">
					<div>
						<span className="eyebrow">助手请求</span>
						<h2>{request.title}</h2>
					</div>
					<button
						type="button"
						className="icon-button quiet"
						title="取消"
						aria-label="取消"
						disabled={busy}
						onClick={cancel}
					>
						<X size={17} />
					</button>
				</div>
				{request.method === "select" && (
					<div className="ui-request-options">
						{request.options.map((option) => (
							<button
								type="button"
								key={option}
								disabled={busy}
								onClick={() => void onRespond({ id: request.id, value: option })}
							>
								<span>{option}</span>
								<ChevronRight size={16} />
							</button>
						))}
					</div>
				)}
				{request.method === "confirm" && <p className="ui-request-message">{request.message}</p>}
				{request.method === "input" && (
					<label>
						回复
						<input
							autoFocus
							value={value}
							placeholder={request.placeholder}
							onChange={(event) => setValue(event.target.value)}
						/>
					</label>
				)}
				{request.method === "editor" && (
					<label>
						内容
						<textarea autoFocus value={value} onChange={(event) => setValue(event.target.value)} rows={9} />
					</label>
				)}
				<div className="dialog-actions">
					<button type="button" className="button" disabled={busy} onClick={cancel}>
						取消
					</button>
					{request.method === "confirm" && (
						<button className="button primary" disabled={busy}>
							确认
						</button>
					)}
					{(request.method === "input" || request.method === "editor") && (
						<button className="button primary" disabled={busy}>
							提交
						</button>
					)}
				</div>
			</form>
		</div>
	);
}

export function CreateTaskDialog({
	onClose,
	onCreate,
	busy,
	initialTitle = "",
	initialPrompt = "",
	initialCwd = "",
}: {
	onClose(): void;
	onCreate(input: CreateTaskInput): Promise<void>;
	busy: boolean;
	initialTitle?: string;
	initialPrompt?: string;
	initialCwd?: string;
}) {
	const [kind, setKind] = useState<"once" | "cron">("once");
	const [title, setTitle] = useState(initialTitle);
	const [prompt, setPrompt] = useState(initialPrompt);
	const [cwd, setCwd] = useState(initialCwd);
	const [runAt, setRunAt] = useState("");
	const [cron, setCron] = useState("0 9 * * 5");
	useEffect(() => {
		setTitle(initialTitle);
		setPrompt(initialPrompt);
		setCwd(initialCwd);
	}, [initialTitle, initialPrompt, initialCwd]);
	return (
		<div
			className="dialog-backdrop"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) onClose();
			}}
		>
			<form
				className="dialog"
				onSubmit={(event) => {
					event.preventDefault();
					void onCreate({
						title,
						prompt,
						cwd: cwd || undefined,
						schedule:
							kind === "once"
								? { kind, runAt: new Date(runAt).toISOString() }
								: { kind, expression: cron, timezone: "UTC" },
					});
				}}
			>
				<div className="dialog-header">
					<div>
						<span className="eyebrow">自动化</span>
						<h2>新建任务</h2>
					</div>
					<button type="button" className="icon-button quiet" title="关闭" aria-label="关闭" onClick={onClose}>
						<X size={17} />
					</button>
				</div>
				<label>
					标题
					<input
						required
						value={title}
						onChange={(event) => setTitle(event.target.value)}
						placeholder="例如：周五进展汇总"
					/>
				</label>
				<label>
					要做什么
					<textarea
						required
						value={prompt}
						onChange={(event) => setPrompt(event.target.value)}
						placeholder="用自然语言描述助手每次该做什么"
						rows={5}
					/>
				</label>
				<label>
					工作目录（可选）
					<input value={cwd} onChange={(event) => setCwd(event.target.value)} placeholder="/path/to/project" />
				</label>
				<div className="field-group">
					<span>计划类型</span>
					<div className="segmented">
						<button type="button" className={kind === "once" ? "active" : ""} onClick={() => setKind("once")}>
							单次
						</button>
						<button type="button" className={kind === "cron" ? "active" : ""} onClick={() => setKind("cron")}>
							周期
						</button>
					</div>
				</div>
				{kind === "once" ? (
					<label>
						运行时间
						<input
							type="datetime-local"
							required
							value={runAt}
							onChange={(event) => setRunAt(event.target.value)}
						/>
					</label>
				) : (
					<label>
						Cron 表达式
						<input required value={cron} onChange={(event) => setCron(event.target.value)} />
						<small>五段 cron，按时区 UTC 解释</small>
					</label>
				)}
				<div className="dialog-actions">
					<button type="button" className="button" onClick={onClose}>
						取消
					</button>
					<button className="button primary" disabled={busy}>
						{busy ? "创建中…" : "创建"}
					</button>
				</div>
			</form>
		</div>
	);
}
