import { useEffect, useState } from "react";
import {
	Archive,
	ArrowLeft,
	BookOpen,
	Check,
	FileText,
	Layers,
	Menu,
	Pencil,
	RefreshCw,
	RotateCcw,
	Save,
	Sparkles,
	Trash2,
	X,
	Zap,
} from "../../icons.tsx";
import { desktopApi } from "../../../api";
import type { ArchivedMemoryEntry } from "../../../types";
import {
	formatAuditTimestamp,
	parseMemoryEntry,
	prettyJson,
	shortWorkspacePath,
	type ParsedMemoryEntry,
} from "../../../lib/helpers";
import { MarkdownText } from "../../../lib/markdown";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/select";

export { formatAuditTimestamp, parseMemoryEntry, prettyJson };
export type { ParsedMemoryEntry };

export const MEMORY_STARTERS: Array<{ type: string; key: string; value: string; label: string }> = [
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

type MemorySurfaceTab = "handbook" | "index" | "rollout" | "skills" | "entries";

export function MemorySurface({
	workspace,
	entries,
	draft,
	scope = "project",
	meta,
	busy,
	onOpenSidebar,
	onClose,
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
	onClose?(): void;
	onRefresh(): void;
	onScopeChange?(scope: "project" | "global"): void;
	onMaintain?(): void;
	onDraftChange(field: "type" | "key" | "value" | "body", value: string): void;
	onSave(): void;
	onSaveEntry(memoryType: string, key: string, value: string): void;
	onDelete(memoryType: string, key: string): void;
}) {
	const [activeTab, setActiveTab] = useState<MemorySurfaceTab>("handbook");
	const [filter, setFilter] = useState("");
	const [typeFilter, setTypeFilter] = useState<string>("all");

	// Codex Memory Hub State
	const [hubData, setHubData] = useState<{
		summary: string;
		handbook: string;
		rolloutSummaries: Array<{ slug: string; fileName: string; date: string; content: string }>;
		skills: Array<{ name: string; content: string }>;
		stats: { pending: number; running: number; completed: number; failed: number; unconsolidatedStage1: number };
		recentJobs: any[];
	} | null>(null);
	const [loadingHub, setLoadingHub] = useState(false);
	const [isEditingHandbook, setIsEditingHandbook] = useState(false);
	const [handbookDraft, setHandbookDraft] = useState("");
	const [savingHandbook, setSavingHandbook] = useState(false);
	const [consolidating, setConsolidating] = useState(false);
	const [expandedRollout, setExpandedRollout] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);

	const loadHub = async () => {
		setLoadingHub(true);
		try {
			const data = await desktopApi.getMemoryHub(workspace);
			setHubData(data);
			setHandbookDraft(data.handbook || "");
		} catch {
			// ignore
		} finally {
			setLoadingHub(false);
		}
	};

	useEffect(() => {
		void loadHub();
	}, [workspace]);

	const handleConsolidateNow = async () => {
		setConsolidating(true);
		try {
			await desktopApi.triggerMemoryConsolidation(true);
			setNotice("已触发全局整理任务，正在后台异步提炼与合并...");
			setTimeout(() => {
				void loadHub();
				onRefresh();
			}, 1500);
		} catch {
			setNotice("触发失败，请稍后重试");
		} finally {
			setConsolidating(false);
			setTimeout(() => setNotice(null), 4000);
		}
	};

	const handleSaveHandbook = async () => {
		setSavingHandbook(true);
		try {
			await desktopApi.saveMemoryHandbook(handbookDraft, workspace);
			setIsEditingHandbook(false);
			setNotice("知识手册保存成功，已同步触发全局索引重构！");
			await loadHub();
		} catch {
			setNotice("保存手册失败，请重试");
		} finally {
			setSavingHandbook(false);
			setTimeout(() => setNotice(null), 3500);
		}
	};

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
	const refreshing = busy === "memory-refresh" || loadingHub;
	const seeding = busy === "write-memory";
	const maintaining = busy === "memory-maintain";
	const empty = parsedEntries.length === 0;
	const workspaceLabel = workspace ? shortWorkspacePath(workspace) : "全局";
	const scopeLabel = scope === "global" ? "用户全局 (~/.openpi/memories)" : `项目级 (${workspaceLabel})`;

	const [showArchive, setShowArchive] = useState(false);
	const [archivedEntries, setArchivedEntries] = useState<ArchivedMemoryEntry[]>([]);
	const [loadingArchive, setLoadingArchive] = useState(false);
	const [restoringKey, setRestoringKey] = useState<string | null>(null);

	const loadArchive = async () => {
		setLoadingArchive(true);
		try {
			const res = await desktopApi.listArchivedMemory(workspace, scope);
			setArchivedEntries(res || []);
		} catch {
			setArchivedEntries([]);
		} finally {
			setLoadingArchive(false);
		}
	};

	const handleRestore = async (entry: ArchivedMemoryEntry) => {
		setRestoringKey(entry.key);
		try {
			await desktopApi.restoreArchivedMemory(workspace, scope, {
				type: entry.type,
				key: entry.key,
				value: entry.value,
				body: entry.body,
			});
			setNotice(`已恢复条目: ${entry.key}`);
			setTimeout(() => setNotice(null), 3000);
			await loadArchive();
			onRefresh();
		} catch {
			setNotice(`恢复失败: ${entry.key}`);
			setTimeout(() => setNotice(null), 3000);
		} finally {
			setRestoringKey(null);
		}
	};

	return (
		<section className="operation-panel-page">
			<header className="operation-page-header">
				{onClose && (
					<button
						type="button"
						className="icon-button quiet"
						title="返回对话"
						aria-label="返回对话"
						onClick={onClose}
					>
						<ArrowLeft size={16} />
					</button>
				)}
				<div className="surface-heading">
					<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
						<strong>两阶段长期记忆中枢 (Memory Hub)</strong>
						<span
							style={{
								fontSize: 11,
								padding: "2px 6px",
								borderRadius: 4,
								background: "var(--accent-soft)",
								color: "var(--accent)",
								fontWeight: 600,
							}}
						>
							Codex Architecture
						</span>
					</div>
					<span>
						文件型知识手册 + 渐进式检索 · 当前作用域：{scopeLabel}
					</span>
				</div>
				<div className="surface-actions">
					{hubData?.stats && (
						<div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--text-secondary)", marginRight: 6 }}>
							<span
								style={{
									display: "inline-flex",
									alignItems: "center",
									gap: 4,
									padding: "3px 8px",
									borderRadius: 12,
									background: hubData.stats.unconsolidatedStage1 > 0 ? "rgba(245, 158, 11, 0.12)" : "rgba(34, 197, 94, 0.12)",
									color: hubData.stats.unconsolidatedStage1 > 0 ? "var(--warning)" : "var(--success)",
									fontWeight: 550,
								}}
							>
								{hubData.stats.unconsolidatedStage1 > 0 ? (
									<>待合并: {hubData.stats.unconsolidatedStage1} 轮会话</>
								) : (
									<>✓ 全局记忆已最新</>
								)}
							</span>
							{hubData.stats.running > 0 && (
								<span
									style={{
										display: "inline-flex",
										alignItems: "center",
										gap: 4,
										padding: "3px 8px",
										borderRadius: 12,
										background: "rgba(59, 130, 246, 0.12)",
										color: "var(--accent)",
										fontWeight: 550,
									}}
								>
									<RefreshCw size={11} className="spin" />
									Worker 执行中
								</span>
							)}
						</div>
					)}
					<button
						type="button"
						className="button secondary"
						onClick={handleConsolidateNow}
						disabled={consolidating}
						title="手动触发 Phase 2 全局整合并提炼技能"
						style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
					>
						{consolidating ? <RefreshCw size={13} className="spin" /> : <Sparkles size={13} />}
						<span>立即全局整理</span>
					</button>
					<button
						type="button"
						className="button secondary"
						onClick={() => {
							onRefresh();
							void loadHub();
						}}
						disabled={refreshing}
						title="刷新记忆数据"
					>
						<RefreshCw size={14} className={refreshing ? "spin" : undefined} />
					</button>
					<button type="button" className="button secondary rail-toggle" onClick={onOpenSidebar}>
						<Menu size={15} />
					</button>
				</div>
			</header>

			{notice && (
				<div
					style={{
						padding: "8px 16px",
						background: "var(--accent-soft)",
						color: "var(--accent)",
						fontSize: 12.5,
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
						borderBottom: "1px solid var(--border)",
					}}
				>
					<span>{notice}</span>
					<button
						type="button"
						onClick={() => setNotice(null)}
						style={{ background: "none", border: "none", color: "inherit", cursor: "pointer" }}
					>
						<X size={13} />
					</button>
				</div>
			)}

			{/* 5-Tab Navigation Bar */}
			<div className="memory-tabs-bar">
				<button
					type="button"
					onClick={() => setActiveTab("handbook")}
					className={`context-tab ${activeTab === "handbook" ? "active" : ""}`}
				>
					<BookOpen size={14} />
					<span>知识手册 (MEMORY.md)</span>
				</button>
				<button
					type="button"
					onClick={() => setActiveTab("index")}
					className={`context-tab ${activeTab === "index" ? "active" : ""}`}
				>
					<FileText size={14} />
					<span>认知索引 (Prompt 常驻)</span>
				</button>
				<button
					type="button"
					onClick={() => setActiveTab("rollout")}
					className={`context-tab ${activeTab === "rollout" ? "active" : ""}`}
				>
					<Layers size={14} />
					<span>会话证据归档 ({hubData?.rolloutSummaries.length ?? 0})</span>
				</button>
				<button
					type="button"
					onClick={() => setActiveTab("skills")}
					className={`context-tab ${activeTab === "skills" ? "active" : ""}`}
				>
					<Zap size={14} />
					<span>进化技能库 ({hubData?.skills.length ?? 0})</span>
				</button>
				<button
					type="button"
					onClick={() => setActiveTab("entries")}
					className={`context-tab ${activeTab === "entries" ? "active" : ""}`}
				>
					<Archive size={14} />
					<span>结构化条目 ({parsedEntries.length})</span>
				</button>
			</div>

			<div className="operation-panel-body" style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "24px 28px" }}>
				{/* ----------------- TAB 1: HANDBOOK (MEMORY.md) ----------------- */}
				{activeTab === "handbook" && (
					<div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 960, margin: "0 auto" }}>
						<div
							className="glass-card"
							style={{
								display: "flex",
								alignItems: "center",
								justifyContent: "space-between",
								padding: "16px 22px",
							}}
						>
							<div>
								<h3 style={{ margin: 0, fontSize: 14.5, fontWeight: 650 }}>长期知识手册 (Handbook)</h3>
								<p style={{ margin: "3px 0 0", fontSize: 12.5, color: "var(--text-secondary)" }}>
									由 Stage 1 与 Phase 2 自动提炼与去重，Agent 按需通过文件读取工具读取。支持白盒透明直接编辑。
								</p>
							</div>
							<div style={{ display: "flex", gap: 8 }}>
								{isEditingHandbook ? (
									<>
										<button
											type="button"
											className="button secondary"
											onClick={() => {
												setIsEditingHandbook(false);
												setHandbookDraft(hubData?.handbook || "");
											}}
										>
											取消
										</button>
										<button
											type="button"
											className="button primary"
											onClick={handleSaveHandbook}
											disabled={savingHandbook}
											style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
										>
											{savingHandbook ? <RefreshCw size={13} className="spin" /> : <Save size={13} />}
											<span>保存修改</span>
										</button>
									</>
								) : (
									<button
										type="button"
										className="button secondary"
										onClick={() => setIsEditingHandbook(true)}
										style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
									>
										<Pencil size={13} />
										<span>编辑手册</span>
									</button>
								)}
							</div>
						</div>

						{isEditingHandbook ? (
							<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
								<textarea
									className="glass-card"
									value={handbookDraft}
									onChange={(e) => setHandbookDraft(e.target.value)}
									rows={22}
									style={{
										width: "100%",
										fontFamily: "var(--font-mono, monospace)",
										fontSize: 13,
										lineHeight: 1.6,
										padding: 20,
										color: "var(--text)",
										resize: "vertical",
									}}
									placeholder="# OpenPI Knowledge Handbook..."
								/>
							</div>
						) : (
							<div
								className="glass-card"
								style={{
									padding: "28px 32px",
									lineHeight: 1.65,
								}}
							>
								{hubData?.handbook ? (
									<MarkdownText text={hubData.handbook} />
								) : (
									<div style={{ textAlign: "center", padding: "40px 20px", color: "var(--text-tertiary)" }}>
										<BookOpen size={32} style={{ opacity: 0.4, marginBottom: 10 }} />
										<p style={{ margin: 0, fontSize: 13.5 }}>暂无长期知识手册内容</p>
										<p style={{ margin: "4px 0 16px", fontSize: 12 }}>
											进行几轮对话后，系统会自动提炼，或点击上方“编辑手册”自行编写
										</p>
										<button
											type="button"
											className="button primary"
											onClick={() => {
												setIsEditingHandbook(true);
												setHandbookDraft(
													"# OpenPI Knowledge Handbook\n\n## User Preferences & Habits\n- 偏好简洁回答\n\n## Architecture & Conventions\n- 项目遵循两阶段记忆规范\n\n## Troubleshooting Lessons\n- macOS ditto 解决符号链接打包问题\n",
												);
											}}
										>
											初始化标准模板
										</button>
									</div>
								)}
							</div>
						)}
					</div>
				)}

				{/* ----------------- TAB 2: INDEX (memory_summary.md) ----------------- */}
				{activeTab === "index" && (
					<div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 960, margin: "0 auto" }}>
						<div
							className="glass-card"
							style={{
								padding: "16px 20px",
								display: "flex",
								alignItems: "flex-start",
								gap: 14,
							}}
						>
							<Sparkles size={18} style={{ color: "var(--accent)", flexShrink: 0, marginTop: 2 }} />
							<div>
								<strong style={{ fontSize: 13.5, color: "var(--accent)" }}>
									常驻 Prompt 认知路由表 (Progressive Disclosure)
								</strong>
								<p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5 }}>
									本文件仅占用 <strong>约 200-350 Tokens</strong> 自动注入到每个新 Turn 的系统提示词中。它仅作为“认知目录”，让 Agent 知道当前掌握了哪些知识模块。当具体任务需要用到对应知识时，Agent 会自主通过工具读取 <code>MEMORY.md</code> 的相应章节。
								</p>
							</div>
						</div>

						<div
							className="glass-card"
							style={{
								padding: "24px 28px",
								lineHeight: 1.65,
							}}
						>
							{hubData?.summary ? (
								<MarkdownText text={hubData.summary} />
							) : (
								<div style={{ textAlign: "center", padding: "40px 20px", color: "var(--text-tertiary)" }}>
									<FileText size={32} style={{ opacity: 0.4, marginBottom: 10 }} />
									<p style={{ margin: 0, fontSize: 13.5 }}>索引目录尚未生成</p>
									<p style={{ margin: "4px 0 16px", fontSize: 12 }}>
										点击右上角“立即全局整理”，系统将根据当前知识库自动合成超紧凑索引
									</p>
									<button
										type="button"
										className="button primary"
										onClick={handleConsolidateNow}
										disabled={consolidating}
									>
										一键生成索引
									</button>
								</div>
							)}
						</div>
					</div>
				)}

				{/* ----------------- TAB 3: ROLLOUT SUMMARIES ----------------- */}
				{activeTab === "rollout" && (
					<div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 960, margin: "0 auto" }}>
						<div
							className="glass-card"
							style={{
								padding: "16px 20px",
							}}
						>
							<h3 style={{ margin: 0, fontSize: 14, fontWeight: 650 }}>会话回溯与证据链归档 (Rollout Summaries)</h3>
							<p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--text-secondary)" }}>
								Stage 1 在每轮会话结束后自动异步提取，归档到 <code>~/.openpi/memories/rollout_summaries/</code>，提供事实溯源支撑。
							</p>
						</div>

						{hubData?.rolloutSummaries && hubData.rolloutSummaries.length > 0 ? (
							<div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
								{hubData.rolloutSummaries.map((item) => {
									const isExpanded = expandedRollout === item.fileName;
									return (
										<div
											key={item.fileName}
											className="glass-card"
											style={{
												padding: "18px 22px",
											}}
										>
											<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
												<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
													<span
														style={{
															fontSize: 11,
															padding: "2px 6px",
															borderRadius: 4,
															background: "var(--bg-muted)",
															color: "var(--text-secondary)",
															fontWeight: 600,
														}}
													>
														{item.date}
													</span>
													<strong style={{ fontSize: 13.5 }}>{item.slug}</strong>
												</div>
												<button
													type="button"
													className="button secondary"
													onClick={() => setExpandedRollout(isExpanded ? null : item.fileName)}
													style={{ fontSize: 11.5, padding: "3px 8px" }}
												>
													{isExpanded ? "收起" : "展开全文"}
												</button>
											</div>

											{isExpanded ? (
												<div style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
													<MarkdownText text={item.content} />
												</div>
											) : (
												<p
													style={{
														margin: 0,
														fontSize: 12.5,
														color: "var(--text-secondary)",
														lineHeight: 1.5,
														display: "-webkit-box",
														WebkitLineClamp: 2,
														WebkitBoxOrient: "vertical",
														overflow: "hidden",
													}}
												>
													{item.content.split("## Extracted Raw Memories")[0].replace(/#.*\n/, "").trim()}
												</p>
											)}
										</div>
									);
								})}
							</div>
						) : (
							<div style={{ textAlign: "center", padding: "40px 20px", color: "var(--text-tertiary)" }}>
								<Layers size={32} style={{ opacity: 0.4, marginBottom: 10 }} />
								<p style={{ margin: 0, fontSize: 13.5 }}>尚无会话归档记录</p>
								<p style={{ margin: "4px 0 0", fontSize: 12 }}>
									与 Agent 完成对话后，系统将自动归档结构化会话总结
								</p>
							</div>
						)}
					</div>
				)}

				{/* ----------------- TAB 4: SKILLS ----------------- */}
				{activeTab === "skills" && (
					<div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 960, margin: "0 auto" }}>
						<div
							className="glass-card"
							style={{
								padding: "16px 20px",
							}}
						>
							<h3 style={{ margin: 0, fontSize: 14, fontWeight: 650 }}>自进化技能库 (Synthesized Skills)</h3>
							<p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--text-secondary)" }}>
								从重复排障与执行成功经验中提炼的标准可执行规约（存储在 <code>~/.openpi/memories/skills/</code>），从静态记忆蜕变为生产力。
							</p>
						</div>

						{hubData?.skills && hubData.skills.length > 0 ? (
							<div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
								{hubData.skills.map((skill) => (
									<div
										key={skill.name}
										className="glass-card"
										style={{
											padding: "18px 22px",
										}}
									>
										<div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
											<Zap size={15} style={{ color: "var(--accent)" }} />
											<strong style={{ fontSize: 14 }}>{skill.name}</strong>
											<span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
												skills/{skill.name}/SKILL.md
											</span>
										</div>
										<div style={{ padding: 12, borderRadius: 6, background: "var(--bg-muted)" }}>
											<MarkdownText text={skill.content} />
										</div>
									</div>
								))}
							</div>
						) : (
							<div style={{ textAlign: "center", padding: "40px 20px", color: "var(--text-tertiary)" }}>
								<Zap size={32} style={{ opacity: 0.4, marginBottom: 10 }} />
								<p style={{ margin: 0, fontSize: 13.5 }}>暂无自动生成的自进化技能</p>
								<p style={{ margin: "4px 0 0", fontSize: 12 }}>
									当某一类排错或构建操作被重复验证多次时，全局整理会自动提炼为可复用标准技能
								</p>
							</div>
						)}
					</div>
				)}

				{/* ----------------- TAB 5: ENTRIES (LEGACY VIEW) ----------------- */}
				{activeTab === "entries" && (
					<div style={{ maxWidth: 1000, margin: "0 auto" }}>
						<div
							style={{
								display: "flex",
								alignItems: "center",
								justifyContent: "space-between",
								marginBottom: 16,
								gap: 12,
							}}
						>
							<div style={{ display: "flex", gap: 8, flex: 1 }}>
								<input
									value={filter}
									onChange={(e) => setFilter(e.target.value)}
									placeholder="搜索条目键名或内容..."
									style={{
										padding: "7px 12px",
										borderRadius: 6,
										border: "1px solid var(--border)",
										background: "var(--bg-card)",
										color: "var(--text)",
										fontSize: 12.5,
										flex: 1,
									}}
								/>
								<Select value={typeFilter} onValueChange={setTypeFilter}>
									<SelectTrigger style={{ width: 130 }}>
										<SelectValue placeholder="所有分类" />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="all">所有分类</SelectItem>
										<SelectItem value="user">用户偏好</SelectItem>
										<SelectItem value="feedback">纠错反馈</SelectItem>
										<SelectItem value="project">项目决策</SelectItem>
										<SelectItem value="lesson">排障经验</SelectItem>
									</SelectContent>
								</Select>
							</div>
							<div style={{ display: "flex", gap: 8 }}>
								<button
									type="button"
									className="button secondary"
									onClick={() => {
										setShowArchive(!showArchive);
										if (!showArchive) void loadArchive();
									}}
									style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
								>
									<Archive size={13} />
									<span>归档库 ({archivedEntries.length})</span>
								</button>
							</div>
						</div>

						{showArchive && (
							<div
								style={{
									padding: 16,
									borderRadius: 8,
									border: "1px dashed var(--border)",
									background: "var(--bg-muted)",
									marginBottom: 16,
								}}
							>
								<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
									<strong style={{ fontSize: 13 }}>软删除归档记录</strong>
									<button type="button" className="button secondary" onClick={() => setShowArchive(false)}>
										关闭
									</button>
								</div>
								{loadingArchive ? (
									<div style={{ textAlign: "center", padding: 12 }}><RefreshCw size={14} className="spin" /></div>
								) : archivedEntries.length === 0 ? (
									<p style={{ margin: 0, fontSize: 12, color: "var(--text-tertiary)" }}>暂无已归档条目</p>
								) : (
									<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
										{archivedEntries.map((a) => (
											<div
												key={a.key}
												style={{
													display: "flex",
													alignItems: "center",
													justifyContent: "space-between",
													padding: "8px 12px",
													borderRadius: 6,
													background: "var(--bg-card)",
												}}
											>
												<div>
													<span style={{ fontSize: 11, color: "var(--text-tertiary)", marginRight: 6 }}>[{a.type}]</span>
													<strong style={{ fontSize: 12.5 }}>{a.key}</strong>
													<p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--text-secondary)" }}>{a.value}</p>
												</div>
												<button
													type="button"
													className="button secondary"
													onClick={() => handleRestore(a)}
													disabled={restoringKey === a.key}
													style={{ fontSize: 11.5 }}
												>
													<RotateCcw size={12} /> 恢复
												</button>
											</div>
										))}
									</div>
								)}
							</div>
						)}

						{filteredEntries.length === 0 ? (
							<div style={{ textAlign: "center", padding: "40px 20px", color: "var(--text-tertiary)" }}>
								<p>未找到匹配条目</p>
							</div>
						) : (
							<div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
								{filteredEntries.map((entry) => (
									<div
										key={`${entry.type}-${entry.key}`}
										style={{
											display: "flex",
											alignItems: "flex-start",
											justifyContent: "space-between",
											padding: "12px 16px",
											borderRadius: 8,
											border: "1px solid var(--border)",
											background: "var(--bg-card)",
										}}
									>
										<div style={{ flex: 1, marginRight: 12 }}>
											<div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
												<span
													style={{
														fontSize: 10.5,
														padding: "1px 5px",
														borderRadius: 4,
														background: "var(--bg-muted)",
														color: "var(--text-secondary)",
														fontWeight: 600,
													}}
												>
													{entry.type}
												</span>
												<strong style={{ fontSize: 13 }}>{entry.key}</strong>
											</div>
											<p style={{ margin: 0, fontSize: 12.5, color: "var(--text)", lineHeight: 1.5 }}>
												{entry.value}
											</p>
										</div>
										<button
											type="button"
											className="button secondary"
											onClick={() => onDelete(entry.type, entry.key)}
											title="删除此条"
											style={{ padding: "4px 8px", color: "var(--danger)" }}
										>
											<Trash2 size={13} />
										</button>
									</div>
								))}
							</div>
						)}
					</div>
				)}
			</div>
		</section>
	);
}
