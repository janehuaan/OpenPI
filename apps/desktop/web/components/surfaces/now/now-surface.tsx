import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
	Activity,
	AlertCircle,
	ArrowUp,
	BookOpen,
	BrainCircuit,
	Check,
	ChevronRight,
	Clock3,
	Folder,
	GitBranch,
	RefreshCw,
	Sparkles,
	Target,
	Zap,
} from "../../icons.tsx";
import type { AgentInstance, GitStatusResult, RunningTool, TaskRun } from "../../../types.ts";
import type { View } from "../../../lib/app-types.ts";
import { actionCardRepo, formatClock, useAgentOS } from "../../../lib/agent-os.ts";
import { instanceTitle } from "../../../lib/helpers.ts";

/**
 * NOW —— Agent OS 的默认主屏（世界状态）。
 *
 * 它回答的是「Agent 现在知道什么 / 正在做什么 / 建议什么」，而不是复述一段对话记录。
 * Chat 退居为一个「下达指令的仪器」：底部指令条会把内容交给对话面板处理。
 *
 * 全部数据来自真实 IPC（active 目标 / 高置信记忆 / 行动卡片 / 任务运行 / Git 状态），
 * 不做任何演示数据兜底；无数据时显式呈现空状态。
 */

interface NowSurfaceProps {
	workspace?: string;
	gitStatus?: GitStatusResult | null;
	gitLoading?: boolean;
	userProfile?: { nickname?: string; avatarEmoji?: string; avatarUrl?: string };
	instances?: AgentInstance[];
	taskRuns?: TaskRun[];
	isStreaming?: boolean;
	runningTools?: RunningTool[];
	onNavigate: (view: View) => void;
	onSendPrompt: (prompt: string) => void;
	onRefreshGit?: () => void;
	onOpenSettings: () => void;
}

const CARD_STYLE: CSSProperties = {
	background: "var(--bg-elevated)",
	border: "1px solid var(--border)",
	borderRadius: 12,
	boxShadow: "var(--shadow-soft)",
};

function basename(path?: string): string {
	if (!path) return "";
	const parts = path.split(/[/\\]/).filter(Boolean);
	return parts.at(-1) ?? path;
}

function SectionTitle({ title, hint, onMore }: { title: string; hint?: string; onMore?: () => void }) {
	return (
		<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "0 0 10px" }}>
			<div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
				<span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text)" }}>{title}</span>
				{hint && <span style={{ fontSize: 11.5, color: "var(--text-tertiary)" }}>{hint}</span>}
			</div>
			{onMore && (
				<button
					type="button"
					onClick={onMore}
					style={{
						display: "inline-flex",
						alignItems: "center",
						gap: 2,
						border: "none",
						background: "transparent",
						color: "var(--accent)",
						fontSize: 11.5,
						fontWeight: 600,
						cursor: "pointer",
						padding: 0,
					}}
				>
					查看全部
					<ChevronRight size={12} />
				</button>
			)}
		</div>
	);
}

function KnownCard({
	icon,
	label,
	value,
	detail,
	onClick,
}: {
	icon: ReactNode;
	label: string;
	value: string;
	detail?: string;
	onClick?: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			style={{
				...CARD_STYLE,
				padding: "12px 14px",
				display: "flex",
				flexDirection: "column",
				gap: 6,
				alignItems: "flex-start",
				textAlign: "left",
				cursor: onClick ? "pointer" : "default",
				minWidth: 0,
			}}
		>
			<div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text-tertiary)" }}>
				{icon}
				<span style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: "0.02em" }}>{label}</span>
			</div>
			<div style={{ fontSize: 17, fontWeight: 700, color: "var(--text)", lineHeight: 1.2 }}>{value}</div>
			{detail && (
				<div
					style={{
						fontSize: 11.5,
						color: "var(--text-secondary)",
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap",
						maxWidth: "100%",
					}}
				>
					{detail}
				</div>
			)}
		</button>
	);
}

function EmptyRow({ text }: { text: string }) {
	return (
		<div style={{ ...CARD_STYLE, padding: "14px 16px", fontSize: 12.5, color: "var(--text-tertiary)" }}>{text}</div>
	);
}

export function NowSurface({
	workspace,
	gitStatus,
	gitLoading,
	userProfile,
	instances = [],
	taskRuns = [],
	isStreaming = false,
	runningTools = [],
	onNavigate,
	onSendPrompt,
	onRefreshGit,
	onOpenSettings,
}: NowSurfaceProps) {
	const { goals, memories, openCards, activity, loading, reload, executeCard, dismissCard } = useAgentOS({
		taskRuns,
	});
	const [draft, setDraft] = useState("");
	const [now, setNow] = useState(() => new Date());
	const [busyCardId, setBusyCardId] = useState<string>();
	const [notice, setNotice] = useState<string>();
	const scrollRef = useRef<HTMLDivElement>(null);

	// 落地页从顶部开始：webview 会恢复上一次的滚动位置，导致首屏看不到状态头。
	useEffect(() => {
		scrollRef.current?.scrollTo({ top: 0 });
	}, []);

	useEffect(() => {
		const timer = setInterval(() => setNow(new Date()), 30_000);
		return () => clearInterval(timer);
	}, []);

	useEffect(() => {
		if (!notice) return;
		const timer = setTimeout(() => setNotice(undefined), 4200);
		return () => clearTimeout(timer);
	}, [notice]);

	const userName = userProfile?.nickname?.trim() || "Jane";
	const hour = now.getHours();
	const greeting = hour < 12 ? `早安，${userName}` : hour < 18 ? `下午好，${userName}` : `晚上好，${userName}`;
	const dateText = useMemo(() => {
		const days = ["日", "一", "二", "三", "四", "五", "六"];
		const mm = String(now.getMonth() + 1).padStart(2, "0");
		const dd = String(now.getDate()).padStart(2, "0");
		const hh = String(now.getHours()).padStart(2, "0");
		const mi = String(now.getMinutes()).padStart(2, "0");
		return `${now.getFullYear()}年${mm}月${dd}日 星期${days[now.getDay()]} ${hh}:${mi}`;
	}, [now]);

	// ── 世界状态推导（全部来自真实数据） ────────────────────────────────
	const runningInstances = useMemo(
		() => instances.filter((instance) => instance.status === "online" || instance.status === "starting"),
		[instances],
	);
	const liveRuns = useMemo(
		() => taskRuns.filter((run) => run.status === "running" || run.status === "queued"),
		[taskRuns],
	);
	const isWorking = isStreaming || runningTools.length > 0 || liveRuns.length > 0;
	const status = isWorking ? "working" : openCards.length > 0 ? "confirm" : "idle";
	const statusMeta =
		status === "working"
			? { label: "执行中", color: "var(--warn, #f59e0b)" }
			: status === "confirm"
				? { label: "待你确认", color: "var(--warn, #f59e0b)" }
				: { label: "待命", color: "var(--accent)" };
	const statusDetail = isWorking
		? runningTools.length > 0
			? `正在执行 ${runningTools.length} 个工具：${runningTools
					.map((tool) => tool.toolName)
					.slice(0, 3)
					.join("、")}`
			: liveRuns.length > 0
				? `正在运行 ${liveRuns.length} 个后台任务`
				: "正在组织回复…"
		: openCards.length > 0
			? `后台观察中发现 ${openCards.length} 项待你裁决`
			: "待命中 · 后台持续观察工作区（文件 / Git / 心跳）";

	const changedFiles = gitStatus?.isRepo ? gitStatus.files.length : 0;
	const projectName = basename(workspace) || "未选择工作区";
	const topGoal = goals[0];
	const topGoalPercent = topGoal ? Math.round((topGoal.progress ?? 0) * 100) : 0;

	const submitDraft = () => {
		const text = draft.trim();
		if (!text) return;
		setDraft("");
		onSendPrompt(text);
	};

	const handleExecuteCard = async (cardId: string) => {
		const card = openCards.find((item) => item.id === cardId);
		if (!card) return;
		setBusyCardId(cardId);
		try {
			const result = await executeCard(card);
			setNotice(
				result.success
					? `已通过统一网关执行：${result.message || card.title}`
					: `执行被拦下：${result.message}`,
			);
		} finally {
			setBusyCardId(undefined);
		}
	};

	const handleDismissCard = async (cardId: string) => {
		const card = openCards.find((item) => item.id === cardId);
		if (!card) return;
		setBusyCardId(cardId);
		try {
			await dismissCard(card);
			setNotice(`已忽略：${card.title}`);
		} finally {
			setBusyCardId(undefined);
		}
	};

	const elapsed = (iso?: string): string => {
		if (!iso) return "";
		const started = new Date(iso).getTime();
		if (Number.isNaN(started)) return "";
		const seconds = Math.max(0, Math.round((now.getTime() - started) / 1000));
		if (seconds < 60) return `${seconds}s`;
		if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
		return `${Math.round(seconds / 3600)}h`;
	};

	return (
		<div
			style={{
				flex: 1,
				height: "100%",
				display: "flex",
				flexDirection: "column",
				background: "var(--bg)",
				color: "var(--text)",
				overflow: "hidden",
			}}
		>
			<div ref={scrollRef} style={{ flex: 1, overflowY: "auto" }}>
				<div style={{ maxWidth: 1000, margin: "0 auto", padding: "24px 32px 28px" }}>
					{/* ── Agent 常驻状态头 ── */}
					<header style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
						<div className={`pa-orb pa-orb-${status}`} style={{ width: 46, height: 46 }}>
							<span className="pa-orb-core" style={{ width: 30, height: 30 }} />
							<span className="pa-orb-ring" />
						</div>
						<div style={{ flex: 1, minWidth: 0 }}>
							<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
								<span style={{ fontSize: 19, fontWeight: 700, color: "var(--text)" }}>{greeting}</span>
								<span
									style={{
										fontSize: 10.5,
										fontWeight: 600,
										padding: "1px 8px",
										borderRadius: 999,
										border: `1px solid ${statusMeta.color}`,
										color: statusMeta.color,
										background: "var(--bg-muted)",
									}}
								>
									● {statusMeta.label}
								</span>
							</div>
							<div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: 3 }}>{statusDetail}</div>
							<div style={{ fontSize: 11.5, color: "var(--text-tertiary)", marginTop: 2 }}>
								{dateText} · 26°C 新加坡
							</div>
						</div>
						<button
							type="button"
							onClick={() => void reload()}
							title="刷新世界状态"
							style={{
								display: "inline-flex",
								alignItems: "center",
								gap: 5,
								padding: "6px 10px",
								borderRadius: 9,
								border: "1px solid var(--border)",
								background: "var(--bg-elevated)",
								color: "var(--text-secondary)",
								fontSize: 11.5,
								cursor: "pointer",
							}}
						>
							<RefreshCw size={12} />
							{loading ? "同步中" : "刷新"}
						</button>
					</header>
					{/* ── 我知道 ── */}
					<section style={{ marginBottom: 22 }}>
						<SectionTitle title="我知道" hint="Agent 对当前世界状态的结构化认知" />
						<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10 }}>
							<KnownCard
								icon={<Folder size={13} />}
								label="当前工作区"
								value={projectName}
								detail={workspace || "尚未选择工程目录"}
								onClick={() => onNavigate("projects")}
							/>
							<KnownCard
								icon={<GitBranch size={13} />}
								label="未提交变更"
								value={gitStatus?.isRepo ? `${changedFiles} 个文件` : "非 Git 仓库"}
								detail={
									gitStatus?.isRepo
										? `${gitStatus.branch}${gitStatus.ahead ? ` · 领先 ${gitStatus.ahead}` : ""}${
												gitStatus.behind ? ` · 落后 ${gitStatus.behind}` : ""
											}`
										: gitLoading
											? "正在读取仓库状态…"
											: "工作区不是 Git 仓库"
								}
								onClick={() => (onRefreshGit ? onRefreshGit() : onNavigate("activity"))}
							/>
							<KnownCard
								icon={<Target size={13} />}
								label="活跃目标"
								value={goals.length > 0 ? `${goals.length} 个` : "未设定"}
								detail={topGoal ? `${topGoal.title} · 已完成 ${topGoalPercent}%` : "还没有长程目标，去「目标」创建一个"}
								onClick={() => onNavigate("goals")}
							/>
							<KnownCard
								icon={<BrainCircuit size={13} />}
								label="高置信记忆"
								value={`${memories.length} 条`}
								detail={memories[0]?.content?.slice(0, 42) || "置信度 ≥ 0.7 的长期记忆"}
								onClick={() => onNavigate("memory")}
							/>
						</div>
					</section>
					{/* ── 我在做 ── */}
					<section style={{ marginBottom: 22 }}>
						<SectionTitle title="我在做" hint="正在运行的会话与后台任务" onMore={() => onNavigate("activity")} />
						{isWorking || runningInstances.length > 0 ? (
							<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
								{runningTools.length > 0 && (
									<div style={{ ...CARD_STYLE, padding: "12px 14px" }}>
										<div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
											<Zap size={13} color="var(--warn, #f59e0b)" />
											<span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text)" }}>
												正在执行 {runningTools.length} 个工具
											</span>
										</div>
										<div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
											{runningTools.slice(0, 6).map((tool) => (
												<span
													key={tool.toolCallId}
													style={{
														fontSize: 11,
														padding: "2px 8px",
														borderRadius: 6,
														background: "var(--bg-muted)",
														border: "1px solid var(--border)",
														color: "var(--text-secondary)",
													}}
												>
													{tool.toolName} · {tool.status}
												</span>
											))}
										</div>
									</div>
								)}
								{isStreaming && runningTools.length === 0 && (
									<div style={{ ...CARD_STYLE, padding: "12px 14px", fontSize: 12.5, color: "var(--text-secondary)" }}>
										<span style={{ color: "var(--accent)", fontWeight: 600 }}>● 正在组织回复…</span>
									</div>
								)}
								{liveRuns.map((run) => (
									<div
										key={run.id}
										style={{ ...CARD_STYLE, padding: "12px 14px", display: "flex", alignItems: "center", gap: 10 }}
									>
										<Clock3 size={13} color="var(--accent)" />
										<div style={{ flex: 1, minWidth: 0 }}>
											<div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text)" }}>
												后台任务 {run.taskId}
											</div>
											<div style={{ fontSize: 11.5, color: "var(--text-tertiary)", marginTop: 2 }}>
												{run.trigger === "scheduled" ? "定时触发" : "手动触发"} · 已运行{" "}
												{elapsed(run.startedAt || run.createdAt) || "—"}
												{run.pid ? ` · PID ${run.pid}` : ""}
											</div>
										</div>
										<span
											style={{
												fontSize: 10.5,
												fontWeight: 600,
												padding: "2px 8px",
												borderRadius: 6,
												background: "var(--warn-soft, rgba(245, 158, 11, 0.14))",
												color: "var(--warn, #f59e0b)",
											}}
										>
											{run.status}
										</span>
									</div>
								))}
								{runningInstances.map((instance) => (
									<div
										key={instance.id}
										style={{
											...CARD_STYLE,
											padding: "12px 14px",
											display: "flex",
											alignItems: "center",
											gap: 10,
											cursor: "pointer",
										}}
										onClick={() => onNavigate("projects")}
									>
										<Activity size={13} color="var(--ok, #10b981)" />
										<div style={{ flex: 1, minWidth: 0 }}>
											<div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text)" }}>
												{instanceTitle(instance)}
											</div>
											<div style={{ fontSize: 11.5, color: "var(--text-tertiary)", marginTop: 2 }}>
												{instance.mode} · {basename(instance.cwd) || "无工作区"}
											</div>
										</div>
										<span style={{ fontSize: 10.5, color: "var(--ok, #10b981)", fontWeight: 600 }}>● 在线</span>
									</div>
								))}
							</div>
						) : (
							<EmptyRow text="当前空闲 —— 后台正在观察工作区，有值得出手的事会主动冒泡。" />
						)}
					</section>
					{/* ── 我建议 ── */}
					<section style={{ marginBottom: 22 }}>
						<SectionTitle
							title="我建议"
							hint="主动决策产生的行动卡片 · 执行走统一网关（受权限 / 预算 / 熔断约束）"
						/>
						{openCards.length > 0 ? (
							<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
								{openCards.map((card) => (
									<div key={card.id} style={{ ...CARD_STYLE, padding: "14px 16px" }}>
										<div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
											<AlertCircle size={14} color="var(--warn, #f59e0b)" style={{ marginTop: 2 }} />
											<div style={{ flex: 1, minWidth: 0 }}>
												<div style={{ fontSize: 13, fontWeight: 650, color: "var(--text)" }}>{card.title}</div>
												<div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 3 }}>
													{card.summary}
												</div>
												<div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 4 }}>
													{card.actionType}{actionCardRepo(card) ? ` · ${actionCardRepo(card)}` : ""} · {formatClock(card.createdAt)}
												</div>
											</div>
										</div>
										<div style={{ display: "flex", gap: 8, marginTop: 10 }}>
											<button
												type="button"
												disabled={busyCardId === card.id}
												onClick={() => void handleExecuteCard(card.id)}
												style={{
													padding: "5px 12px",
													borderRadius: 8,
													border: "1px solid var(--accent)",
													background: "var(--accent-soft)",
													color: "var(--accent)",
													fontSize: 12,
													fontWeight: 600,
													cursor: busyCardId === card.id ? "wait" : "pointer",
												}}
											>
												{busyCardId === card.id ? "执行中…" : "一键执行"}
											</button>
											<button
												type="button"
												disabled={busyCardId === card.id}
												onClick={() => void handleDismissCard(card.id)}
												style={{
													padding: "5px 12px",
													borderRadius: 8,
													border: "1px solid var(--border)",
													background: "transparent",
													color: "var(--text-secondary)",
													fontSize: 12,
													cursor: "pointer",
												}}
											>
												忽略
											</button>
										</div>
									</div>
								))}
							</div>
						) : (
							<EmptyRow text="暂无待裁决建议 —— Agent 正在后台观察，发现值得出手的事会主动冒泡。" />
						)}
					</section>
					{/* ── 最近活动 ── */}
					<section>
						<SectionTitle title="最近活动" hint="行动卡片与任务运行的真实时间线" onMore={() => onNavigate("activity")} />
						{activity.length > 0 ? (
							<div style={{ ...CARD_STYLE, padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
								{activity.map((item) => (
									<div key={item.id} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
										<span style={{ fontSize: 11, color: "var(--text-tertiary)", width: 40, flexShrink: 0, paddingTop: 1 }}>
											{item.time}
										</span>
										<span
											style={{
												width: 6,
												height: 6,
												borderRadius: 999,
												marginTop: 5,
												flexShrink: 0,
												background:
													item.kind === "card" ? "var(--warn, #f59e0b)" : "var(--ok, #10b981)",
											}}
										/>
										<div style={{ minWidth: 0 }}>
											<div style={{ fontSize: 12.5, color: "var(--text)", fontWeight: 550 }}>{item.label}</div>
											{item.detail && (
												<div
													style={{
														fontSize: 11.5,
														color: "var(--text-tertiary)",
														marginTop: 2,
														overflow: "hidden",
														textOverflow: "ellipsis",
														whiteSpace: "nowrap",
													}}
												>
													{item.detail}
												</div>
											)}
										</div>
									</div>
								))}
							</div>
						) : (
							<EmptyRow text="还没有活动记录 —— 事件总线一旦捕捉到工作区变化就会出现在这里。" />
						)}
					</section>




				</div>
			</div>

			{/* ── 指令条：Chat 降级为「下达指令的仪器」 ── */}
			<div style={{ borderTop: "1px solid var(--border)", padding: "12px 32px 18px", background: "var(--bg)" }}>
				<div style={{ maxWidth: 1000, margin: "0 auto" }}>
					{notice && (
						<div
							style={{
								display: "flex",
								alignItems: "center",
								gap: 6,
								marginBottom: 8,
								fontSize: 11.5,
								color: "var(--accent)",
							}}
						>
							<Check size={12} />
							<span>{notice}</span>
						</div>
					)}
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: 10,
							background: "var(--bg-elevated)",
							border: "1px solid var(--border)",
							borderRadius: 14,
							padding: "9px 10px 9px 14px",
							boxShadow: "var(--shadow-soft)",
						}}
					>
						<Sparkles size={14} color="var(--accent)" />
						<input
							type="text"
							value={draft}
							onChange={(event) => setDraft(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter") submitDraft();
							}}
							placeholder="对 OpenPI 说点什么，或点上面的建议 —— 这会交给对话面板执行"
							style={{
								flex: 1,
								border: "none",
								outline: "none",
								background: "transparent",
								color: "var(--text)",
								fontSize: 13,
								minWidth: 0,
							}}
						/>
						<button
							type="button"
							onClick={submitDraft}
							disabled={!draft.trim()}
							title="交给对话面板执行"
							style={{
								width: 30,
								height: 30,
								borderRadius: 999,
								border: "none",
								display: "inline-flex",
								alignItems: "center",
								justifyContent: "center",
								background: draft.trim() ? "var(--accent)" : "var(--bg-muted)",
								color: draft.trim() ? "#fff" : "var(--text-tertiary)",
								cursor: draft.trim() ? "pointer" : "default",
							}}
						>
							<ArrowUp size={15} />
						</button>
					</div>
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: 12,
							marginTop: 8,
							fontSize: 11,
							color: "var(--text-tertiary)",
						}}
					>
						<button
							type="button"
							onClick={() => onNavigate("chat")}
							style={{
								border: "none",
								background: "transparent",
								color: "var(--text-tertiary)",
								fontSize: 11,
								cursor: "pointer",
								display: "inline-flex",
								alignItems: "center",
								gap: 4,
								padding: 0,
							}}
						>
							<BookOpen size={11} />
							打开对话面板
						</button>
						<button
							type="button"
							onClick={onOpenSettings}
							style={{
								border: "none",
								background: "transparent",
								color: "var(--text-tertiary)",
								fontSize: 11,
								cursor: "pointer",
								display: "inline-flex",
								alignItems: "center",
								gap: 4,
								padding: 0,
							}}
						>
							<Zap size={11} />
							模型与系统设置
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}


