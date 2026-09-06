import {
	Fragment,
	type ClipboardEvent,
	type DragEvent,
	type KeyboardEvent,
	type ReactNode,
	useCallback,
	useEffect,
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
import { draftStore } from "../../../lib/draft-store";
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
} from "../../../types";
import { MiniDiffView } from "../../diff-viewer";
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
	History,
	Image as ImageIcon,
	ListTodo,
	LogIn,
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
	Quote,
	RefreshCw,
	Save,
	Search,
	Send,
	Server,
	Share2,
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
} from "../../icons.tsx";
import { ClaudeCodeRecapCard } from "../../recap-card";
import { TodoPanel } from "../../todo-panel";
import type { TodoState, GitStatusResult } from "../../../types";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "../../ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "../../ui/popover";
import type { DeleteProjectTarget } from "../dialogs/delete-project-dialog";
import { AgentActionChain } from "./action-chain";
import type { AppMode } from "./mode-tab-bar";
import { ReasoningBlock } from "./reasoning-block";
import { TurnProgressRow } from "./turn-progress-row";
import { ComposerStatusDock } from "./composer-status-dock";

type ChatNavView = "tasks" | "capabilities" | "memory" | "intelligence" | "daemon" | "git";

function shortModelName(name: string): string {
	const trimmed = name.trim();
	if (trimmed.length <= 18) return trimmed;
	return `${trimmed.slice(0, 16)}…`;
}

function hasVisionContext(content: unknown): boolean {
	return contentText(content).includes("<openpi-vision-context");
}

export function ReferenceWorkspacePreview({
	projectInstances,
	chatInstances,
	selectedInstanceId,
	conversation,
	conversationTitles,
	workspaceSummary,
	runningTools,
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
	slashCommands,
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
	gitStatus,
	gitLoading,
	onRefreshGit,
	onOpenGit,
	extraDataSlot,
	prefillDraft,
}: {
	projectInstances: AgentInstance[];
	chatInstances: AgentInstance[];
	selectedInstanceId?: string;
	conversation?: ConversationSnapshot;
	conversationTitles: Record<string, string>;
	workspaceSummary?: WorkspaceSummary;
	runningTools: RunningTool[];
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
	gitStatus?: GitStatusResult | null;
	gitLoading?: boolean;
	onRefreshGit?: () => void;
	onOpenGit?: () => void;
	extraDataSlot?: ReactNode;
	prefillDraft?: { id: string; text: string; images?: string[] };
}) {
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
	const toggleProjectCollapsed = (cwd: string, e: React.MouseEvent) => {
		e.stopPropagation();
		setCollapsedProjects((prev) => ({ ...prev, [cwd]: !prev[cwd] }));
	};
	const [memoryQuery, setMemoryQuery] = useState("");
	const attachmentInput = useRef<HTMLInputElement>(null);
	const draftInput = useRef<HTMLTextAreaElement>(null);
	const feedScroll = useRef<HTMLElement>(null);
	const projectList = useRef<HTMLDivElement>(null);
	const chatList = useRef<HTMLDivElement>(null);
	const autoFollow = useRef(true);
	const [contextPanelOpen, setContextPanelOpen] = useState(false);
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
	const isWorking = Boolean(conversation?.state.isStreaming || sending || optimisticMessage || runningTools.length > 0);
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

	const currentModel = modelOptions.find(
		(model) => model.provider === conversation?.state.model?.provider && model.id === conversation.state.model.id,
	);
	const usesVisionFallback =
		attachments.length > 0 &&
		currentModel?.supportsImages === false &&
		visionFallback?.enabled === true &&
		visionFallback.configured;
	const supportsThinking = modelSupportsReasoning(currentModel ?? conversation?.state.model);
	const thinkingLevels = currentModel?.thinkingLevels ?? thinkingLevelsForModel({ reasoning: supportsThinking });
	const modelGroups = useMemo(() => {
		const currentProvider = (currentModel?.provider ?? conversation?.state.model?.provider ?? "").toLowerCase();
		const currentId = currentModel?.id ?? conversation?.state.model?.id ?? "";

		const groups = new Map<string, ConversationModelOption[]>();
		for (const model of modelOptions) {
			const list = groups.get(model.provider) ?? [];
			list.push(model);
			groups.set(model.provider, list);
		}

		// Sort models within each provider:
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

				return a.name.localeCompare(b.name, "zh-CN", { numeric: true, sensitivity: "base" });
			});
		}

		const entries = [...groups.entries()];
		const priority = ["agnes", "agnes-cn", "anthropic", "openai", "google", "deepseek", "qwen", "zhipu", "sensenova", "商汤"];

		entries.sort(([pA], [pB]) => {
			const lowerA = pA.toLowerCase();
			const lowerB = pB.toLowerCase();
			// 1. Current active provider is ALWAYS first!
			if (lowerA === currentProvider) return -1;
			if (lowerB === currentProvider) return 1;

			// 2. Known priority providers
			const idxA = priority.indexOf(lowerA);
			const idxB = priority.indexOf(lowerB);
			if (idxA !== -1 && idxB !== -1) return idxA - idxB;
			if (idxA !== -1) return -1;
			if (idxB !== -1) return 1;

			return pA.localeCompare(pB, "zh-CN");
		});

		return entries;
	}, [modelOptions, currentModel, conversation?.state.model]);
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
	const visibleMemory = memoryEntries.filter((entry) =>
		entry.toLowerCase().includes(memoryQuery.trim().toLowerCase()),
	);

	const modelId = conversation?.state.model?.id || currentModel?.id || "";
	const rawCtx = currentModel?.contextWindow ?? conversation?.state.model?.contextWindow;
	const rawMax = currentModel?.maxTokens ?? conversation?.state.model?.maxTokens;

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
	const cacheRead = stats?.tokens.cacheRead ?? 0;
	const cacheWrite = stats?.tokens.cacheWrite ?? 0;
	const cacheEligibleTokens = (stats?.tokens.input ?? 0) + cacheRead;
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
		const isAwayFromBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight > 160;
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
			if (conversation?.instance.id) {
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
			if (args && conversation?.instance.id) {
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
			const inTokens = stats?.tokens.input ?? 0;
			const outTokens = stats?.tokens.output ?? 0;
			const cacheR = stats?.tokens.cacheRead ?? 0;
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

	return (
		<div
			className={`reference-workspace ${sidebarOpen === false ? "left-collapsed" : ""} ${!contextPanelOpen ? "context-collapsed" : ""}`}
		>
			<aside className="reference-leftbar">
				<header className="reference-brand">
					<div className="reference-brand-left">
						<img className="reference-brand-mark" src="./openpi-mark.svg" alt="" />
						<strong>OpenPI</strong>
					</div>
					<div className="reference-brand-actions">
						<button
							type="button"
							className="reference-new-chat-top-btn"
							title="新建会话 (⌘N)"
							aria-label="新建会话"
							onClick={() => {
								onNewConversation();
								draftInput.current?.focus();
							}}
						>
							<Plus size={15} />
						</button>
						{onToggleSidebar && (
							<button
								type="button"
								className="reference-toggle-sidebar-btn"
								title={sidebarOpen === false ? "展开侧边栏 (⌘B)" : "折叠侧边栏 (⌘B)"}
								aria-label={sidebarOpen === false ? "展开侧边栏" : "折叠侧边栏"}
								onClick={onToggleSidebar}
							>
								{sidebarOpen === false ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
							</button>
						)}
					</div>
				</header>
				<label className="reference-search">
					<Search size={14} />
					<input
						placeholder="搜索对话或项目 (⌘K)"
						value={sidebarSearch ?? ""}
						onChange={(e) => setSidebarSearch(e.target.value)}
					/>
					<kbd>⌘K</kbd>
				</label>
				<div className="reference-sidebar-content">
					<div className="reference-nav-bar">
						<button
							type="button"
							className="reference-nav-item"
							title="版本管理 (Git 变更与差异对比)"
							onClick={onOpenGit || (() => onNavigate("git"))}
						>
							<GitBranch size={14} />
							<span>版本管理</span>
							{Boolean(gitStatus?.files?.length) && gitStatus?.files && (
								<span className="reference-nav-count">{gitStatus.files.length}</span>
							)}
						</button>
						<button
							type="button"
							className="reference-nav-item"
							title="长期记忆库"
							onClick={() => onNavigate("memory")}
						>
							<BookOpen size={14} />
							<span>长期记忆</span>
							{memoryCount > 0 && <span className="reference-nav-count">{memoryCount}</span>}
						</button>
						<button
							type="button"
							className="reference-nav-item"
							title="自动化定时任务"
							onClick={() => onNavigate("tasks")}
						>
							<ListTodo size={14} />
							<span>定时任务</span>
						</button>
					</div>

					<div className="reference-label">
						<span>Projects</span>
						<div className="reference-section-actions">
							<button type="button" title="选择项目" aria-label="选择项目" onClick={() => void selectProject()}>
								<FolderPlus size={14} />
							</button>
						</div>
					</div>
					<div className={`reference-spaces ${showAllSpaces ? "expanded" : ""}`} ref={projectList}>
						{spaces.map(([cwd, spaceInstances]) => {
							const isCollapsed = Boolean(collapsedProjects[cwd]);
							const isCurrentWorkspace = cwd === workspace;
							return (
								<div className="reference-project-group" key={cwd}>
									<div className={`reference-space ${isCurrentWorkspace ? "selected" : ""}`}>
										<button
											type="button"
											className="reference-project-toggle"
											title={isCollapsed ? "展开会话" : "收起会话"}
											aria-label={isCollapsed ? "展开会话" : "收起会话"}
											onClick={(e) => toggleProjectCollapsed(cwd, e)}
										>
											{isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
										</button>
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
											<span className="reference-folder">
												<Folder size={14} />
											</span>
											<span className="reference-project-meta">
												<strong>{cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? cwd}</strong>
												<small>{shortWorkspacePath(cwd)}</small>
											</span>
										</button>
										<div className="reference-project-actions">
											<button
												type="button"
												className="reference-project-new-session"
												title="在此项目中新建 Code 会话"
												aria-label="在此项目中新建 Code 会话"
												onClick={(e) => {
													e.stopPropagation();
													onNewProjectSession(cwd);
												}}
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
														<Plus size={14} /> 新建 Code 会话
													</button>
													<div className="reference-menu-divider" />
													<button type="button" onClick={() => void selectProject()}>
														<FolderPlus size={14} /> 选择其他项目
													</button>
													<button
														type="button"
														className="danger"
														onClick={() => {
															const projectName = cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? cwd;
															onRemoveProject?.({
																cwd,
																projectName,
																sessionCount: spaceInstances.length,
																instances: spaceInstances,
															});
														}}
													>
														<FolderMinus size={14} /> 移除项目
													</button>
												</PopoverContent>
											</Popover>
										</div>
									</div>
									{!isCollapsed && (
										<div className="reference-project-sessions">
											{spaceInstances.map((instance) => {
												const isSelected = instance.id === selectedInstanceId;
												return (
													<div
														className={`reference-project-session-row ${isSelected ? "selected" : ""}`}
														key={instance.id}
													>
														<button
															type="button"
															className={`reference-project-session-item ${isSelected ? "selected" : ""}`}
															onClick={() => onOpenProject(instance.id)}
														>
															<MessageSquare size={12} className="reference-session-icon" />
															<span className="reference-session-title">
																{instanceTitle(instance, conversationTitles[instance.id])}
															</span>
															{instance.status === "online" && <span className="instance-active-dot" />}
														</button>
														<div className="reference-session-actions">
															<button
																type="button"
																title="重命名"
																aria-label="重命名"
																onClick={(e) => {
																	e.stopPropagation();
																	onRenameConversation?.(instance);
																}}
															>
																<Pencil size={12} />
															</button>
															<button
																type="button"
																className="danger"
																title="删除"
																aria-label="删除"
																onClick={(e) => {
																	e.stopPropagation();
																	onDeleteConversation?.(instance);
																}}
															>
																<Trash2 size={12} />
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
					</div>
					{projectsOverflow && (
						<button type="button" className="reference-more" onClick={() => setShowAllSpaces((value) => !value)}>
							{showAllSpaces ? "收起项目" : "显示全部项目"} <ChevronRight size={14} />
						</button>
					)}
					<div className="reference-label recent">
						<span>Chats</span>
						<span className="reference-label-count">({filteredChats.length})</span>
						<button
							type="button"
							title="新建会话"
							aria-label="新建会话"
							onClick={() => {
								onNewConversation();
								draftInput.current?.focus();
							}}
						>
							<Plus size={14} />
						</button>
					</div>
					<div className={`reference-sessions reference-session-grouped-list ${showAllSessions ? "expanded" : ""}`} ref={chatList}>
						{chatGroups.map((group) => (
							<div className="sidebar-date-group" key={group.key}>
								<div className="sidebar-date-group-header">
									<span>{group.title}</span>
								</div>
								<div className="sidebar-date-group-items">
									{group.items.map((instance) => {
										const isSelected = instance.id === selectedInstanceId;
										const timeStr = formatConversationTime(instance.lastSeenAt || instance.createdAt);
										return (
											<div
												className={`reference-session-row ${isSelected ? "selected" : ""}`}
												key={instance.id}
											>
												<button
													type="button"
													className="reference-session-select"
													onClick={() => onSelectConversation(instance.id)}
												>
													<div className="reference-session-icon-wrap">
														<MessageSquare size={13} className="reference-session-icon" />
														{instance.status === "online" && <span className="instance-active-dot" />}
													</div>
													<span className="reference-session-title">
														{instanceTitle(instance, conversationTitles[instance.id])}
													</span>
													{timeStr && <span className="reference-session-time">{timeStr}</span>}
												</button>
												<div className="reference-session-actions">
													<button
														type="button"
														title="重命名"
														aria-label="重命名"
														onClick={(e) => {
															e.stopPropagation();
															onRenameConversation?.(instance);
														}}
													>
														<Pencil size={12} />
													</button>
													<button
														type="button"
														className="danger"
														title="删除"
														aria-label="删除"
														onClick={(e) => {
															e.stopPropagation();
															onDeleteConversation?.(instance);
														}}
													>
														<Trash2 size={12} />
													</button>
												</div>
											</div>
										);
									})}
								</div>
							</div>
						))}
						{filteredChats.length === 0 && (
							<div className="sidebar-inline-empty">
								{sidebarSearch ? "没有匹配的会话" : "还没有对话"}
							</div>
						)}
					</div>
				</div>
				<footer className="reference-account">
					<span className="reference-avatar">H</span>
					<strong>Huaan</strong>
					<em>Pro</em>
					<div className="reference-account-actions">
						<button
							type="button"
							className="reference-account-btn"
							title="版本管理 (Git)"
							aria-label="版本管理"
							onClick={onOpenGit || (() => onNavigate("git"))}
						>
							<GitBranch size={15} />
						</button>
						<button
							type="button"
							className="reference-account-btn"
							title="设置"
							aria-label="设置"
							onClick={onOpenSettings}
						>
							<Wrench size={15} />
						</button>
					</div>
				</footer>
			</aside>

			<main className="reference-main">
				<header className="reference-main-header">
					<div className="reference-title">
						{sidebarOpen === false && onToggleSidebar && (
							<button
								type="button"
								className="reference-header-icon-btn reference-toggle-sidebar"
								title="展开侧边栏 (⌘B)"
								aria-label="展开侧边栏"
								onClick={onToggleSidebar}
							>
								<PanelLeftOpen size={16} />
							</button>
						)}
						<span className="reference-title-folder">
							<Folder size={17} />
						</span>
						<div>
							<h1>
								{title}
								{Boolean(selectedInstance || conversation) && (
									<button
										type="button"
										className="reference-title-rename-btn"
										title="重命名会话"
										aria-label="重命名会话"
										onClick={() => onRenameConversation?.(selectedInstance ?? conversation?.instance)}
									>
										<Pencil size={13} />
									</button>
								)}
							</h1>
							<p>{workspace ? `${shortWorkspacePath(workspace)} 工作区` : "未选择工作区"}</p>
						</div>
					</div>
					<div className="reference-header-actions">
						{conversation?.state.isStreaming && (
							<span className="reference-streaming-badge">
								<RefreshCw size={12} className="spin" />
								<span>处理中…</span>
							</span>
						)}
						<button
							type="button"
							className="reference-header-icon-btn"
							title="导出为 Markdown (⌘⇧E)"
							aria-label="导出为 Markdown"
							disabled={!conversation}
							onClick={onExportConversation}
						>
							<Download size={16} />
						</button>
						<button
							type="button"
							className={`reference-header-icon-btn ${contextPanelOpen ? "active" : ""}`}
							title={contextPanelOpen ? "隐藏上下文面板 (⌘I)" : "显示上下文面板 (⌘I)"}
							aria-label="切换上下文面板"
							onClick={() => setContextPanelOpen((prev) => !prev)}
						>
							<PanelRight size={16} />
						</button>
						<Popover>
							<PopoverTrigger asChild>
								<button type="button" className="reference-header-icon-btn" title="更多操作" aria-label="更多操作">
									<MoreHorizontal size={16} />
								</button>
							</PopoverTrigger>
							<PopoverContent className="reference-header-menu" align="end">
								<span className="reference-menu-label">快捷导航</span>
								<button type="button" onClick={onOpenGit || (() => onNavigate("git"))}>
									<GitBranch size={14} /> 版本管理 (Git)
								</button>
								<button type="button" onClick={() => onNavigate("memory")}>
									<BookOpen size={14} /> 长期记忆库
								</button>
								<button type="button" onClick={() => onNavigate("tasks")}>
									<ListTodo size={14} /> 定时任务
								</button>
								<div className="reference-menu-divider" />
								<span className="reference-menu-label">会话操作</span>
								<button
									type="button"
									disabled={!conversation}
									onClick={() => onRenameConversation?.(selectedInstance ?? conversation?.instance)}
								>
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
									onClick={() => onDeleteConversation?.(selectedInstance ?? conversation?.instance)}
								>
									<Trash2 size={14} /> 删除会话
								</button>
							</PopoverContent>
						</Popover>
					</div>
				</header>
				<section className="reference-feed" ref={feedScroll} onScroll={handleFeedScroll}>
					<div className="reference-chat-view">
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
								<div className="reference-draft-quickstarts">
									<button
										type="button"
										className="reference-draft-chip"
										onClick={() => setDraft("帮我检查当前项目的代码结构并提出优化建议")}
									>
										🔍 审查项目架构
									</button>
									<button
										type="button"
										className="reference-draft-chip"
										onClick={() => setDraft("编写一个单元测试来覆盖核心逻辑")}
									>
										🧪 编写单元测试
									</button>
									<button
										type="button"
										className="reference-draft-chip"
										onClick={() => setDraft("解释当前项目的构建与打包配置流程")}
									>
										📦 构建与打包解析
									</button>
								</div>
							</div>
						)}
						{feedItems.map((item) => {
							if (item.kind === "user") {
								const text = visibleMessageText(contentText(item.message.content));
								return (
									<Fragment key={`${item.message.timestamp ?? "untimed"}-user-${item.index}`}>
										{item.turnNumber > 1 && (
											<div className="reference-turn-separator">
												<span className="turn-separator-badge">第 {item.turnNumber} 轮对话</span>
											</div>
										)}
										<div className="reference-message-row user">
											<div
												className={`reference-user-card ${item.message === optimisticMessage ? "pending" : ""}`}
											>
												<p>{text}</p>
												{hasVisionContext(item.message.content) && (
													<span className="reference-vision-badge">
														<ImageIcon size={12} /> GLM-4.6V 视觉解析
													</span>
												)}
												{contentImages(item.message.content).length > 0 && (
													<div className="reference-message-images">
														{contentImages(item.message.content).map((image, imageIndex) => (
															<img
																src={`data:${image.mimeType};base64,${image.data}`}
																alt="已附加图片"
																key={`${image.mimeType}-${imageIndex}`}
															/>
														))}
													</div>
												)}
												{text && onRemember && (
													<div className="reference-user-actions" role="toolbar" aria-label="用户消息操作">
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
											{item.reasoning && (
												<ReasoningBlock reasoning={item.reasoning} isWorking={isWorking && isLastActions} />
											)}
											{(item.actions.length > 0 || (isLatestActions && isWorking && runningTools.length > 0)) && (
												<AgentActionChain
													actions={item.actions}
													runningTools={isLatestActions && isWorking ? runningTools : []}
													isWorking={isWorking && isLastActions}
												/>
											)}
										</div>
									</div>
								);
							}

							if (item.kind === "assistant") {
								const text = visibleMessageText(contentText(item.message.content));
								return (
									<div className="reference-message-row assistant" key={`${item.message.timestamp ?? "untimed"}-assistant-${item.index}`}>
										<div
											className={`reference-assistant-card ${item.message === optimisticMessage ? "pending" : ""}`}
										>
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
												<div className="reference-assistant-message">
													<MarkdownText text={text} streaming={isWorking && item.isLastAssistantMessage} />
												</div>
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
												<div className="reference-message-images">
													{contentImages(item.message.content).map((image, imageIndex) => (
														<img
															src={`data:${image.mimeType};base64,${image.data}`}
															alt="已附加图片"
															key={`${image.mimeType}-${imageIndex}`}
														/>
													))}
												</div>
											)}
											{item.isLatestAssistant && (
												<ClaudeCodeRecapCard
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
													</div>
												) : (
													<div className="reference-error-box">{item.message.errorMessage}</div>
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
									/>
								</div>
							)}
						<TurnProgressRow progress={turnProgress} />
						{isWorking && runningTools.length === 0 && !turnProgress && (
							<div className="reference-streaming-indicator" aria-label="OpenPI 正在回复">
								<span />
								<span />
								<span />
							</div>
						)}
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
						placeholder="发送消息给 OpenPI，或输入 / 查看命令…"
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
								if (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey)) {
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
							if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
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
							<Popover open={modelMenuOpen} onOpenChange={setModelMenuOpen}>
								<PopoverTrigger asChild>
									<button
										type="button"
										className="reference-model-control"
										disabled={configuring || loadingModels || modelOptions.length === 0}
									>
										<span className="reference-model-name">
											{shortModelName(
												conversation?.state.model?.name ?? conversation?.state.model?.id ?? "Model",
											)}
										</span>
										{supportsThinking && conversation?.state.thinkingLevel && conversation.state.thinkingLevel !== "off" && (
											<>
												<span className="reference-model-sep">·</span>
												<span className="reference-model-thinking">
													{conversation.state.thinkingLevel}
												</span>
											</>
										)}
										<ChevronsUpDown size={12} className="reference-model-chevron" />
									</button>
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
															(conversation?.state.thinkingLevel ?? getHighestThinkingLevel(currentModel)) === level
																? "active"
																: ""
														}
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
									)}
									<div className="model-popover-section">
										<span className="model-popover-label">模型</span>
										<Command label="Select model" loop>
											<CommandInput placeholder="搜索模型" />
											<CommandList>
												<CommandEmpty>没有匹配的模型</CommandEmpty>
												{modelGroups.map(([provider, models]) => (
													<CommandGroup heading={provider} key={provider}>
														{models.map((model) => {
															const isCurrent =
																model.provider.toLowerCase() ===
																	(currentModel?.provider ?? conversation?.state.model?.provider ?? "").toLowerCase() &&
																model.id === (currentModel?.id ?? conversation?.state.model?.id);
															return (
																<CommandItem
																	value={`${model.provider}/${model.id}`}
																	keywords={[model.name, model.provider, model.id]}
																	key={`${model.provider}/${model.id}`}
																	data-active-model={isCurrent ? "true" : undefined}
																	className={`ui-command-item ${isCurrent ? "model-item-current active" : ""}`}
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
						</div>
						<div className="reference-composer-actions">
							{workspace && relatedFiles.length > 0 && (
								<Popover open={contextPickerOpen} onOpenChange={setContextPickerOpen}>
									<PopoverTrigger asChild>
										<button
											type="button"
											className="reference-composer-icon"
											title="选择工作区文件 (@)"
											aria-label="选择工作区文件"
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
							)}
							{isWorking ? (
								<>
									{draft.trim() || attachments.length > 0 || documents.length > 0 ? (
										<>
											<button
												type="button"
												className="reference-send steer-button"
												title="实时干预 Agent (⌘Enter)"
												aria-label="实时干预"
												onClick={() => void submitSteer()}
											>
												<Sparkles size={14} />
												<span>干预</span>
											</button>
											<button
												type="button"
												className="reference-send queue-button"
												title="排队至下一轮 (⇧⌘Enter)"
												aria-label="排队"
												onClick={() => void submitFollowUp()}
											>
												<Clock3 size={14} />
											</button>
										</>
									) : null}
									<button
										type="button"
										className="reference-send working"
										title="停止生成"
										aria-label="停止生成"
										onClick={onAbort}
									>
										<Square size={13} fill="currentColor" />
									</button>
								</>
							) : (
								<button
									type="button"
									className="reference-send"
									title="发送消息 (⌘Enter)"
									aria-label="发送消息"
									disabled={!draft.trim() && attachments.length === 0 && documents.length === 0}
									onClick={() => void submit()}
								>
									<ArrowUp size={16} />
								</button>
							)}
						</div>
					</div>
					<ComposerStatusDock
						gitStatus={gitStatus}
						loading={gitLoading}
						onRefreshGit={onRefreshGit}
						onOpenGit={onOpenGit || (() => onNavigate("git"))}
						tokenStats={{
							inputTokens: stats?.tokens.input ?? 0,
							outputTokens: stats?.tokens.output ?? 0,
							totalTokens: stats?.tokens.total ?? ((stats?.tokens.input ?? 0) + (stats?.tokens.output ?? 0)),
							contextTokens: contextTokens,
							contextWindow: contextWindow,
							contextPercent: contextPercent,
							cacheRead: cacheRead,
							cacheWrite: cacheWrite,
							cacheHitPercent: cacheHitPercent,
							cost: stats?.cost ?? 0,
							isWorking: isWorking,
						}}
						onOpenContextPanel={() => setContextPanelOpen((prev) => !prev)}
						extraDataSlot={extraDataSlot}
					/>
				</div>
			</footer>
			</main>

			<aside className="reference-context">
				<header>
					<strong>Context</strong>
					<span>
						<Pin size={14} />
						<button
							type="button"
							title="关闭面板"
							aria-label="关闭面板"
							onClick={() => setContextPanelOpen(false)}
						>
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
							<strong style={{ textTransform: "capitalize" }}>{conversation?.instance.mode || "Work"}</strong>
							<span>Mode</span>
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
							Agent <strong style={{ textTransform: "capitalize" }}>{conversation?.instance.mode ?? "--"}</strong>
						</span>
						<span>
							Model <strong>{currentModel?.name ?? conversation?.state.model?.name ?? conversation?.state.model?.id ?? "--"}</strong>
						</span>
						<span>
							上下文窗口 <strong>{contextWindow > 0 ? fmtTokens(contextWindow) : "--"}</strong>
						</span>
						{maxTokens > 0 && (
							<span>
								最大输出 <strong>{fmtTokens(maxTokens)}</strong>
							</span>
						)}
						<span>
							Session <strong>{conversation?.state.sessionId.slice(0, 8) ?? "--"}</strong>
						</span>
						<span>
							Status{" "}
							<strong className={`ref-status-indicator ${conversation?.state.isStreaming ? "working" : "idle"}`}>
								<span className="ref-status-dot" /> {conversation?.state.isStreaming ? "Working" : "Idle"}
							</strong>
						</span>
					</div>
				</ReferenceContextCard>
				<ReferenceContextCard title="会话用量">
					{stats ? (
						<div className="reference-usage">
							<div className="reference-context-usage">
								<div>
									<span>上下文占用</span>
									<strong className={contextPercent && contextPercent > 0.8 ? "usage-warn" : ""}>
										{contextPercent === undefined ? "--" : `${(contextPercent * 100).toFixed(contextPercent * 100 < 10 ? 1 : 0)}%`}
									</strong>
								</div>
								<span>
									{contextWindow > 0
										? `${fmtTokens(contextTokens)} / ${fmtTokens(contextWindow)}`
										: "模型未提供窗口"}
								</span>
								<div className="reference-context-progress" aria-label="上下文占用">
									<span
										className={contextPercent && contextPercent > 0.8 ? "warn" : ""}
										style={{ width: `${Math.round((contextPercent ?? 0) * 100)}%` }}
									/>
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
				{runningTools.length > 0 && (
					<ReferenceContextCard title="Running Tools">
						<div className="reference-tool-list">
							{runningTools.map((tool, idx) => (
								<span key={`${tool.toolCallId || "tool"}-${idx}`}>
									<Terminal size={14} /> {tool.toolName} <em>Running</em>
								</span>
							))}
						</div>
					</ReferenceContextCard>
				)}
				<ReferenceContextCard title="Related Files">
					<div className="reference-file-list">
						{relatedFiles.slice(0, showAllFiles ? relatedFiles.length : 5).map((file) => {
							const basename = file.split(/[\\/]/).pop() ?? file;
							const dirname = file.includes("/") || file.includes("\\")
								? file.slice(0, Math.max(file.lastIndexOf("/"), file.lastIndexOf("\\")))
								: "";
							return (
								<button
									type="button"
									className="reference-file-item"
									key={file}
									title={`点击以 @${file} 填入输入框`}
									onClick={() => {
										setDraft((c) => (c ? `${c} @${file}` : `@${file} `));
										draftInput.current?.focus();
									}}
								>
									{renderFileIcon(basename)}
									<span className="reference-file-name">{basename}</span>
									{dirname ? (
										<span className="reference-file-dir" title={dirname}>
											{dirname}
										</span>
									) : null}
								</button>
							);
						})}
						{relatedFiles.length === 0 && (
							<span className="reference-file-empty">
								<FileText size={13} /> 暂无可用的工作区文件
							</span>
						)}
					</div>
					{relatedFiles.length > 5 && (
						<button
							type="button"
							className="reference-context-link"
							onClick={() => setShowAllFiles((value) => !value)}
						>
							{showAllFiles ? "收起 (Show Less)" : `显示全部 (${relatedFiles.length})`}
						</button>
					)}
				</ReferenceContextCard>
				<ReferenceContextCard title="Memory">
					<label className="reference-memory-search">
						<Search size={12} />
						<input
							placeholder="Search memory"
							value={memoryQuery ?? ""}
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
				{gitStatus?.isRepo && (
					<ReferenceContextCard title="Git 仓库">
						<div className="reference-git-card">
							<div className="reference-git-row">
								<GitBranch size={14} />
								<strong className="reference-git-branch">{gitStatus.branch || "main"}</strong>
								<span className="reference-git-badge">
									{gitStatus.files.length === 0 ? "工作区干净" : `${gitStatus.files.length} 处变更`}
								</span>
							</div>
							{gitStatus.upstream && (
								<small className="reference-git-upstream">
									{gitStatus.upstream} {gitStatus.ahead > 0 && `↑${gitStatus.ahead}`} {gitStatus.behind > 0 && `↓${gitStatus.behind}`}
								</small>
							)}
							<button
								type="button"
								className="reference-context-link"
								onClick={onOpenGit || (() => onNavigate("git"))}
							>
								打开版本管理面板 →
							</button>
						</div>
					</ReferenceContextCard>
				)}
			</aside>
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


