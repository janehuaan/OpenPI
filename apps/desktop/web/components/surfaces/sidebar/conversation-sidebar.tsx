import { useMemo, useState } from "react";
import {
	ChevronRight,
	Folder,
	MessageSquare,
	MoreHorizontal,
	Pencil,
	Plus,
	RefreshCw,
	Search,
	Trash2,
	UserRound,
	Wrench,
} from "../../icons.tsx";
import {
	formatConversationTime,
	formatDate,
	groupConversationsByDate,
	instanceTitle,
	shortWorkspacePath,
} from "../../../lib/helpers";
import type { AgentInstance, TaskDefinition, TaskRun } from "../../../types";
import type { MoreView } from "./app-rail";
import { SidebarHeader } from "./sidebar-header";

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

	const conversationGroups = useMemo(
		() => groupConversationsByDate(conversations),
		[conversations],
	);

	const renderConversationRow = (instance: AgentInstance) => {
		const isStreaming = streamingInstances?.has(instance.id);
		const isOnline = instance.status === "online" || isStreaming;
		const timeStr = formatConversationTime(instance.lastSeenAt || instance.createdAt);
		return (
			<div
				key={instance.id}
				className={`conversation-row ${selectedInstanceId === instance.id && activeView === "chat" ? "selected" : ""}`}
			>
				<button className="conversation-select" type="button" onClick={() => onSelect(instance.id)}>
					<span className="conversation-avatar">
						<MessageSquare size={15} />
					</span>
					<span className="conversation-copy">
						<span className="conversation-title-row">
							<strong>{instanceTitle(instance, conversationTitles[instance.id])}</strong>
							{timeStr && <span className="conversation-time-tag">{timeStr}</span>}
						</span>
						<span>{instance.mode === "code" ? "Coding workspace" : "Personal workspace"}</span>
					</span>
					{isOnline && (
						<span className="conversation-status-indicator" title={isStreaming ? "正在回复" : "在线"}>
							<span className={`instance-dot ${isStreaming ? "working" : "online"}`} />
						</span>
					)}
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
	};

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
				<input value={query ?? ""} onChange={(event) => onQueryChange(event.target.value)} placeholder="搜索对话" />
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
					{conversationGroups.map((group) => (
						<div className="sidebar-date-group" key={group.key}>
							<div className="sidebar-date-group-header">
								<span>{group.title}</span>
								<span className="sidebar-date-group-count">{group.items.length}</span>
							</div>
							<div className="sidebar-date-group-items">
								{group.items.map((instance) => renderConversationRow(instance))}
							</div>
						</div>
					))}
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

