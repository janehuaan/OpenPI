// Barrel export for desktop surfaces and dialogs

// Dialogs
export { ProviderAuthDialog } from "./dialogs/provider-auth-dialog";
export { EditProfileDialog } from "./dialogs/edit-profile-dialog";
export { RenameConversationDialog } from "./dialogs/rename-conversation-dialog";
export { DeleteConversationDialog } from "./dialogs/delete-conversation-dialog";
export { DeleteProjectDialog, type DeleteProjectTarget } from "./dialogs/delete-project-dialog";
export { ConversationUiDialog } from "./dialogs/conversation-ui-dialog";
export { CreateTaskDialog } from "./dialogs/create-task-dialog";
export { QuickSaveMemoryDialog, type QuickSaveMemoryDialogProps } from "./dialogs/quick-save-memory-dialog";

// Panels
export { ContextPanel, TokenCompositionBar, MetricCard } from "./panels/context-panel";
export {
	MemorySurface,
	parseMemoryEntry,
	formatAuditTimestamp,
	prettyJson,
	type ParsedMemoryEntry,
	MEMORY_STARTERS,
} from "./panels/memory-surface";
export { IntelligenceSurface, parseCommand, formatUptime } from "./panels/intelligence-surface";
export { DaemonSurface } from "./panels/daemon-surface";
export { CapabilitiesSurface, ModelProvidersPanel } from "./panels/capabilities-surface";
export { TasksSurface } from "./panels/tasks-surface";
export { GitSurface } from "./panels/git-surface";

// HUD
export { FloatingHud } from "./hud/floating-hud";

// Workspace
export { ReferenceWorkspacePreview } from "./workspace/workspace-preview";
export { ComposerStatusDock, type TokenStatsData } from "./workspace/composer-status-dock";
export { AgentActionChain } from "./workspace/action-chain";
export { ReasoningBlock } from "./workspace/reasoning-block";
export { ChatLiveTools } from "./workspace/live-tools";
export { ModeTabBar, type AppMode } from "./workspace/mode-tab-bar";
export { TurnProgressRow } from "./workspace/turn-progress-row";

// Sidebar
export { ConversationSidebar } from "./sidebar/conversation-sidebar";
export { AppRail, type MoreView, MORE_ITEMS } from "./sidebar/app-rail";
export { SidebarHeader } from "./sidebar/sidebar-header";

// Chat
export { ChatSurface } from "./chat/chat-surface";
export { MessageItem } from "./chat/message-item";
export { MessageImages } from "./chat/message-images";
