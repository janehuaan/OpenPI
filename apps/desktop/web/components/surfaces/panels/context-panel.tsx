import { useState } from "react";
import {
	ChevronRight,
	FileText,
	Folder,
	GitBranch,
	ListTodo,
	Terminal,
	Wrench,
	X,
} from "../../icons.tsx";
import { fmtTokens, shortWorkspacePath, thinkingLevelLabel } from "../../../lib/helpers";
import type {
	ConversationCapabilities,
	ConversationMessage,
	ConversationSnapshot,
	ConversationStats,
	RunningTool,
} from "../../../types";

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

export function TokenCompositionBar({
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

export function MetricCard({ label, value, unit }: { label: string; value: string; unit?: string }) {
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
	onOpenGit,
}: {
	conversation?: ConversationSnapshot;
	stats?: ConversationStats;
	capabilities?: ConversationCapabilities;
	memoryEntries?: string[];
	onClose(): void;
	onShowTasks(): void;
	onOpenGit?(): void;
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
	const activeTools = (capabilities?.tools ?? []).filter((tool) => tool.active).slice(0, 5);

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
							<span>工作空间</span>
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
								<span>文件数</span>
							</div>
							<div>
								<strong>{toolCount || "—"}</strong>
								<span>工具调用</span>
							</div>
							<div>
								<strong>{memoryEntries.length || "—"}</strong>
								<span>记忆沉淀</span>
							</div>
						</div>
					</section>

					<section className="context-section">
						<div className="context-section-title">
							<span>环境与配置</span>
						</div>
						<div className="context-fact-list">
							<div>
								<span>运行环境</span>
								<strong>macOS 桌面端</strong>
							</div>
							<div>
								<span>智能体模式</span>
								<strong>
									{conversation?.instance.mode === "code"
										? "Code 编程模式"
										: conversation?.instance.mode === "personal"
											? "Personal 个人模式"
											: "Chat 通用对话"}
								</strong>
							</div>
							<div>
								<span>主力模型</span>
								<strong>{conversation?.state.model?.name ?? conversation?.state.model?.id ?? "默认主力模型"}</strong>
							</div>
							<div>
								<span>思考深度</span>
								<strong>{thinkingLevelLabel(conversation?.state.thinkingLevel)}</strong>
							</div>
						</div>
					</section>

					<section className="context-section">
						<div className="context-section-title">
							<span>活跃工具</span>
							<span className="context-link" onClick={onShowTasks}>
								管理工具 <ChevronRight size={13} />
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
							<span>关联文件</span>
							<span className="context-link">{fileCount > 0 ? `查看全部 (${fileCount})` : "—"}</span>
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
							<span>会话记忆</span>
							<span className="context-link">
								{memoryEntries.length > 0 ? `查看全部 (${memoryEntries.length})` : "—"}
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
						{onOpenGit && (
							<button
								type="button"
								className="context-link"
								style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}
								onClick={onOpenGit}
							>
								版本管理 (Git) →
							</button>
						)}
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
