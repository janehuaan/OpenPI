import {
	Fragment,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ClipboardEvent,
	type DragEvent,
	type KeyboardEvent,
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

type ChatNavView = "tasks" | "capabilities" | "memory" | "intelligence" | "daemon";
import { isDiffContent } from "../../../lib/diff";
import {
	assistantToolsHaveResults,
	contentImages,
	contentText,
	fmtCost,
	fmtTokens,
	formatDate,
	formatTime,
	getHighestThinkingLevel,
	instanceTitle,
	isConversationMessage,
	isDocumentFile,
	isRecord,
	LOCAL_SLASH,
	messageBlockCounts,
	messageReasoning,
	modelSupportsReasoning,
	parseCommand,
	prepareDocumentAttachment,
	prepareImageAttachment,
	shortWorkspacePath,
	thinkingLevelsForModel,
	toolCalls,
	visibleMessageText,
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
	WorkspaceSummary,
} from "../../../types";
import { MiniDiffView } from "../../diff-viewer";
import {
	ArrowDown,
	ArrowLeft,
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
import type { TodoState } from "../../../types";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "../../ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "../../ui/popover";
import { ChatLiveTools } from "../workspace/live-tools";
import type { AppMode } from "../workspace/mode-tab-bar";
import { TurnProgressRow } from "../workspace/turn-progress-row";
import { MessageItem } from "./message-item";

export function ChatSurface({
	mode,
	workspace,
	conversation,
	selectedInstance,
	stats,
	providerBalance,
	optimisticMessage,
	turnProgress,
	modelOptions,
	loadingModels,
	draftRequest,
	configuring,
	sending,
	slashCommands = [],
	onSend,
	onSteer,
	onFollowUp,
	onError,
	runningTools = [],
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
	turnProgress?: TurnProgress;
	modelOptions: ConversationModelOption[];
	loadingModels: boolean;
	draftRequest?: { id: string; text: string };
	configuring: boolean;
	sending: boolean;
	runningTools?: RunningTool[];
	slashCommands?: string[];
	/** Run stats (TPS etc.) under the latest assistant reply */
	turnMeta?: string;
	onSend(message: string, images: ImageContent[]): Promise<void>;
	onSteer?(message: string, images: ImageContent[]): Promise<void> | void;
	onFollowUp?(message: string, images: ImageContent[]): Promise<void> | void;
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

	const workingStartedAtRef = useRef<number>(0);
	useEffect(() => {
		if (isWorking) {
			workingStartedAtRef.current = Date.now();
		}
	}, [isWorking]);

	const handleSafeAbort = useCallback(() => {
		// Prevent accidental misfires: ignore abort clicks within 800ms of generation start
		if (Date.now() - workingStartedAtRef.current < 800) {
			console.warn("[ChatSurface] Ignored rapid abort click within 800ms grace period");
			return;
		}
		onAbort();
	}, [onAbort]);

	const rawConversationMessages = conversation?.messages ?? [];
	let pendingRecalled: Array<{ type: string; key: string; value: string }> | undefined;
	const storedMessages: ConversationMessage[] = [];
	for (const msg of rawConversationMessages) {
		const customType = (msg as any).customType || (msg as any).details?.customType;
		if (customType === "openpi-memory:snapshot" || (msg as any).type === "custom_message") {
			const recalled = (msg as any).details?.recalled;
			if (Array.isArray(recalled) && recalled.length > 0) {
				pendingRecalled = recalled;
			}
			continue;
		}
		if (msg.role === "assistant") {
			const withRecalled: ConversationMessage =
				msg.recalledMemories && msg.recalledMemories.length > 0
					? msg
					: pendingRecalled && pendingRecalled.length > 0
						? { ...msg, recalledMemories: pendingRecalled }
						: msg;
			pendingRecalled = undefined;
			storedMessages.push(withRecalled);
		} else if (["user", "toolResult"].includes(msg.role)) {
			storedMessages.push(msg);
		}
	}
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
	const currentModel = modelOptions.find(
		(model) => model.provider === conversation?.state.model?.provider && model.id === conversation.state.model.id,
	);
	const supportsThinking = modelSupportsReasoning(currentModel ?? conversation?.state.model);
	const availableThinkingLevels: ThinkingLevel[] =
		currentModel?.thinkingLevels && currentModel.thinkingLevels.length > 0
			? currentModel.thinkingLevels
			: thinkingLevelsForModel({ reasoning: supportsThinking });
	const modelGroups = useMemo(() => {
		const currentProvider = (currentModel?.provider ?? conversation?.state.model?.provider ?? "").toLowerCase();
		const currentId = currentModel?.id ?? conversation?.state.model?.id ?? "";

		const groups = new Map<string, ConversationModelOption[]>();
		for (const model of modelOptions) {
			const providerModels = groups.get(model.provider) ?? [];
			providerModels.push(model);
			groups.set(model.provider, providerModels);
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
		(document.activeElement as HTMLElement)?.blur();
		draftInput.current?.focus();
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

	async function submitSteer(): Promise<void> {
		const message = draft.trim();
		if (!message || sending || mediaSubmitting || preparingImages) return;
		abortSpeechRecognition();
		const pendingAttachments = attachments;
		setDraft("");
		setAttachments([]);
		setSlashOpen(false);
		try {
			if (onSteer) {
				await onSteer(
					message,
					pendingAttachments.map(({ data, mimeType }) => ({ type: "image", data, mimeType })),
				);
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

	async function submitFollowUp(): Promise<void> {
		const message = draft.trim();
		if (!message || sending || mediaSubmitting || preparingImages) return;
		abortSpeechRecognition();
		const pendingAttachments = attachments;
		setDraft("");
		setAttachments([]);
		setSlashOpen(false);
		try {
			if (onFollowUp) {
				await onFollowUp(
					message,
					pendingAttachments.map(({ data, mimeType }) => ({ type: "image", data, mimeType })),
				);
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
		setDraft(item.insert ?? "");
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
					title="打开对话列表"
					aria-label="打开对话列表"
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
										onRemember={onRemember ? (rememberText) => void onRemember(rememberText) : undefined}
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
							{runningTools.length > 0 && <ChatLiveTools tools={runningTools} />}
							<TurnProgressRow progress={turnProgress} />
							{isWorking && !turnProgress && (
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
							className={appMode === "personal" ? "active" : ""}
							onClick={() => onAppModeChange("personal")}
						>
							<Sparkles size={14} />
							Personal
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
												value={imageSize ?? "2K"}
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
												value={imageRatio ?? "1:1"}
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
												value={videoResolution ?? "720p"}
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
												value={videoRatio ?? "16:9"}
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
												value={videoFrames ?? 125}
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
						value={draft ?? ""}
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
									event.stopPropagation();
									setSlashOpen(false);
									return;
								}
							}
							// ⌘/Ctrl+Enter send; when isWorking, triggers real-time steer!
							if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
								event.preventDefault();
								if (isWorking && draft.trim()) {
									if (event.shiftKey) {
										void submitFollowUp();
									} else {
										void submitSteer();
									}
								} else {
									void submit();
								}
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
												{supportsThinking && conversation?.state.thinkingLevel && conversation.state.thinkingLevel !== "off" && (
													<>
														<span className="model-picker-sep">·</span>
														{conversation.state.thinkingLevel}
													</>
												)}
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
										{supportsThinking && (
											<div className="model-popover-section">
												<span className="model-popover-label">思考强度</span>
												<div className="thinking-row">
													{availableThinkingLevels.map((level) => (
														<button
															type="button"
															key={level}
															className={
																(conversation?.state.thinkingLevel ?? getHighestThinkingLevel(currentModel)) === level ? "active" : ""
															}
															disabled={configurationDisabled || loadingModels || !currentModel}
															onClick={() => onThinkingLevelChange(level)}
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
												<CommandInput placeholder="搜索模型" autoFocus />
												<CommandList>
													<CommandEmpty>没有匹配的模型</CommandEmpty>
													{modelGroups.map(([provider, models]) => (
														<CommandGroup heading={provider} key={provider}>
															{models.map((model) => {
																const selected =
																	model.provider.toLowerCase() ===
																		(currentModel?.provider ?? conversation?.state.model?.provider ?? "").toLowerCase() &&
																	model.id === (currentModel?.id ?? conversation?.state.model?.id);
																return (
																	<CommandItem
																		className={`ui-command-item ${selected ? "model-item-current selected active" : ""}`}
																		data-active-model={selected ? "true" : undefined}
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
																				<ImageIcon size={13} aria-label="支持多模态图片" />
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
							{composerMode === "chat" && isWorking ? (
								<>
									{draft.trim() ? (
										<>
											<button
												type="button"
												className="send-button steer-button"
												title="实时干预 Agent (⌘Enter)"
												aria-label="实时干预"
												disabled={sending}
												onClick={() => void submitSteer()}
											>
												<Sparkles size={14} />
												<span>干预</span>
											</button>
											<button
												type="button"
												className="send-button queue-button"
												title="排队至下一轮 (⇧⌘Enter)"
												aria-label="排队"
												disabled={sending}
												onClick={() => void submitFollowUp()}
											>
												<Clock3 size={14} />
											</button>
										</>
									) : null}
									<button
										type="button"
										tabIndex={-1}
										className="send-button stop"
										title="停止运行"
										aria-label="停止"
										onClick={handleSafeAbort}
									>
										<Square size={13} fill="currentColor" />
									</button>
								</>
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

/** Minimal inline renderer for assistant content blocks (thinking, tool calls, text, images) — interleaved in-order. */

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

