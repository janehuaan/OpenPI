import { useState, useEffect, useMemo } from "react";
import {
	Search,
	Bell,
	Settings,
	Home,
	Target,
	Clock3,
	Folder,
	BrainCircuit,
	Plus,
	Check,
	ArrowLeft,
	ArrowUp,
	Zap,
	FileText,
	MessageSquare,
	RefreshCw,
	GitBranch,
	CalendarClock,
	Cpu,
	Layers,
	ChevronRight,
	Shield,
	Terminal,
	Sparkles,
	MoreHorizontal,
	Paperclip,
	LogOut,
	User,
	BookOpen,
} from "../../icons.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "../../ui/popover";
import { desktopApi } from "../../../api.ts";
import type {
	AgentInstance,
	ConversationModelOption,
	GitStatusResult,
} from "../../../types.ts";
import type {
	TodayBriefing,
	PersonalGoalRecord,
	PersonalMemoryRecord,
	SafetyStatus,
	View,
} from "../../../lib/app-types.ts";
import { instanceTitle } from "../../../lib/helpers.ts";
import "./styles/today-os-dashboard.css";

interface TodayOsDashboardProps {
	workspace?: string;
	gitStatus?: GitStatusResult | null;
	userProfile?: { nickname?: string; avatarEmoji?: string; avatarUrl?: string };
	conversations?: AgentInstance[];
	projects?: AgentInstance[];
	selectedInstanceId?: string;
	activeModel?: {
		name?: string;
		provider?: string;
		id?: string;
		contextWindow?: number;
		maxTokens?: number;
		reasoning?: boolean;
	};
	onSelectConversation: (instanceId: string) => void;
	onOpenProject?: (instanceId: string) => void;
	onNewConversation: () => void;
	onNewTask: () => void;
	onNavigate: (view: View) => void;
	onSendPrompt: (prompt: string) => void;
	onOpenSettings: () => void;
	onOpenProfile: () => void;
}

export function TodayOsDashboard({
	workspace,
	gitStatus,
	userProfile,
	conversations = [],
	projects = [],
	selectedInstanceId,
	activeModel,
	onSelectConversation,
	onOpenProject,
	onNewConversation,
	onNewTask,
	onNavigate,
	onSendPrompt,
	onOpenSettings,
	onOpenProfile,
}: TodayOsDashboardProps) {
	const [briefing, setBriefing] = useState<TodayBriefing | null>(null);
	const [goals, setGoals] = useState<PersonalGoalRecord[]>([]);
	const [memories, setMemories] = useState<PersonalMemoryRecord[]>([]);
	const [safetyStatus, setSafetyStatus] = useState<SafetyStatus | null>(null);
	const [globalSearch, setGlobalSearch] = useState("");
	const [dockInput, setDockInput] = useState("");
	const [leftSearch, setLeftSearch] = useState("");
	const [now, setNow] = useState(new Date());

	// 时钟定时更新
	useEffect(() => {
		const timer = setInterval(() => setNow(new Date()), 30000);
		return () => clearInterval(timer);
	}, []);

	// 主动服务事件：行动卡片 / 今日晨报 → 实时刷新简报
	useEffect(() => {
		const handler = () => {
			desktopApi
				.getTodayBriefing()
				.then((data) => {
					if (data) setBriefing(data);
				})
				.catch(() => {});
		};
		window.addEventListener("openpi:proactive", handler);
		return () => window.removeEventListener("openpi:proactive", handler);
	}, []);

	// 获取后端真实简报与数据
	useEffect(() => {
		let active = true;
		desktopApi
			.getTodayBriefing()
			.then((data) => {
				if (active && data) setBriefing(data);
			})
			.catch(() => {});

		desktopApi
			.getSafetyStatus()
			.then((status) => {
				if (active && status) setSafetyStatus(status);
			})
			.catch(() => {});

		// 这两个 IPC 返回 `{ goals }` / `{ memories }` 包装对象，不是裸数组。
		desktopApi
			.listPersonalGoals("active")
			.then((res) => {
				if (active && Array.isArray(res?.goals)) setGoals(res.goals);
			})
			.catch(() => {});

		desktopApi
			.listPersonalMemories(undefined, 0.7)
			.then((res) => {
				if (active && Array.isArray(res?.memories)) setMemories(res.memories);
			})
			.catch(() => {});

		return () => {
			active = false;
		};
	}, [workspace]);

	// 日期与问候格式化
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

	const rawName = userProfile?.nickname || "Jane";
	const userName = rawName === "Janehuaan" ? "Jane" : rawName;
	const hour = now.getHours();
	const greeting =
		hour < 12 ? `早安，${userName}` : hour < 18 ? `下午好，${userName}` : `晚上好，${userName}`;

	// 熔断器状态与防御计算
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

	// 核心主线目标数据
	const activeGoal = useMemo(() => {
		if (goals.length > 0) {
			const g = goals[0];
			return {
				title: g.title,
				description:
					g.description ||
					"构建一个真正属于你的个人智能系统，让 OpenPI 不只是工具，而是你的长期工作伙伴。",
				progress: Math.round(g.progress * 100),
				stage: "Personal Intelligence Layer",
				deadline: g.deadline || "2026-10-30",
				priority: "高",
				nextActionTitle: "设计 Decision Engine",
				nextActionDesc: "定义决策对象与策略，建立事件→决策→行动的闭环",
			};
		}
		return {
			title: "OpenPI Personal Agent OS",
			description:
				"构建一个真正属于你的个人智能系统，让 OpenPI 不只是工具，而是你的长期工作伙伴。",
			progress: 72,
			stage: "Personal Intelligence Layer",
			deadline: "2026-10-30",
			priority: "高",
			nextActionTitle: "设计 Decision Engine",
			nextActionDesc: "定义决策对象与策略，建立事件→决策→行动的闭环",
		};
	}, [goals]);

	// 统计指标
	const stats = useMemo(() => {
		const activeGoalsCount = goals.filter((g) => g.status === "active").length;
		const completedGoalsCount = goals.filter((g) => g.status === "completed").length;
		const blockedGoalsCount = goals.filter((g) => g.status === "blocked").length;
		const streamingCount = conversations.filter((c) => c.status === "online" || c.status === "starting").length;

		return {
			todoCount: activeGoalsCount + (briefing?.actionCards?.length || 2),
			inProgressCount: activeGoalsCount + streamingCount || (goals.length > 0 ? activeGoalsCount : 2),
			completedCount: completedGoalsCount || (goals.length > 0 ? completedGoalsCount : 5),
			attentionCount: blockedGoalsCount || (safetyStatus?.circuitState?.state !== "healthy" ? 1 : 0),
		};
	}, [goals, conversations, briefing, safetyStatus]);

	// 最近项目列表展示
	const displayProjects = useMemo(() => {
		if (projects.length > 0) {
			return projects.slice(0, 4).map((p, idx) => {
				const parts = (p.cwd || "").split(/[/\\]/).filter(Boolean);
				const name = p.label || parts[parts.length - 1] || p.id;
				const statusText = idx < 2 ? `● 进行中 · ${idx + 2}/${idx + 5}` : `待处理 · 0/${idx + 6}`;
				return {
					id: p.id,
					name,
					desc: statusText,
				};
			});
		}
		return [
			{ id: "p1", name: "OpenPI Personal Agent OS", desc: "● 进行中 · 3/6" },
			{ id: "p2", name: "DiPlay", desc: "● 进行中 · 2/5" },
			{ id: "p3", name: "agnes-harness-main", desc: "待处理 · 0/8" },
			{ id: "p4", name: "SillyTavern-release", desc: "待处理 · 0/6" },
		];
	}, [projects]);

	// 最近会话列表展示
	const displaySessions = useMemo(() => {
		if (conversations.length > 0) {
			return conversations.slice(0, 5).map((c) => ({
				id: c.id,
				title: c.label || instanceTitle(c) || "会话",
				time: c.lastSeenAt ? c.lastSeenAt.slice(11, 16) : "刚刚",
			}));
		}
		return [
			{ id: "s1", title: "设计 Decision Engine", time: "23:14" },
			{ id: "s2", title: "Memory 架构方案", time: "22:36" },
			{ id: "s3", title: "OpenClaw 集成方案", time: "21:12" },
			{ id: "s4", title: "DeepSeek 模型对比", time: "19:48" },
			{ id: "s5", title: "Rust 重构讨论", time: "18:20" },
		];
	}, [conversations]);

	// 键盘 Enter 发送搜索
	const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Enter" && globalSearch.trim()) {
			onSendPrompt(globalSearch.trim());
			setGlobalSearch("");
		}
	};

	// 底部常驻框 Enter 发送
	const handleDockKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Enter" && dockInput.trim()) {
			onSendPrompt(dockInput.trim());
			setDockInput("");
		}
	};

	// 点击继续工作
	const handleContinueWork = () => {
		onSendPrompt(
			`继续推进 ${activeGoal.title}：${activeGoal.nextActionTitle}。${activeGoal.nextActionDesc}`,
		);
	};

	return (
		<div className="today-os-root">
			{/* 顶部全局导航栏 */}
			<header className="today-os-topbar">
				<div className="today-os-topbar-left">
					<div className="today-os-window-controls">
						<span className="today-os-dot red" />
						<span className="today-os-dot yellow" />
						<span className="today-os-dot green" />
					</div>
					<div className="today-os-brand" onClick={() => onNavigate("today")}>
						<div className="today-os-brand-logo">
							<Zap size={14} />
						</div>
						<div className="today-os-brand-titles">
							<span className="today-os-brand-name">OpenPI</span>
							<span className="today-os-brand-tag">Personal Agent OS</span>
						</div>
					</div>
				</div>

				<div className="today-os-topbar-center">
					<div className="today-os-search-input-wrap">
						<Search size={14} />
						<input
							type="text"
							placeholder="搜索项目、目标、记忆、文件、会话..."
							value={globalSearch}
							onChange={(e) => setGlobalSearch(e.target.value)}
							onKeyDown={handleSearchKeyDown}
						/>
						<span className="today-os-kbd">⌘ K</span>
					</div>
				</div>

				<div className="today-os-topbar-right">
					<button
						className="today-os-icon-btn"
						title="通知与动态中心"
						onClick={() => onNavigate("activity")}
					>
						<Bell size={16} />
						<span className="today-os-badge-dot" />
					</button>
				</div>
			</header>

			{/* 主三栏视窗布局 */}
			<div className="today-os-layout-body">
				{/* 左侧导航栏 */}
				<aside className="today-os-left-sidebar">
					{/* 左侧搜索框 */}
					<div className="today-os-sidebar-search-wrap">
						<Search size={13} />
						<input
							type="text"
							placeholder="搜索..."
							value={leftSearch}
							onChange={(e) => setLeftSearch(e.target.value)}
						/>
					</div>

					{/* 5 个一级导航 */}
					<nav className="today-os-nav-group">
						<div
							className="today-os-nav-item active"
							onClick={() => onNavigate("today")}
						>
							<div className="today-os-nav-item-icon">
								<Home size={16} />
							</div>
							<div className="today-os-nav-item-text">
								<span className="today-os-nav-item-title">今日</span>
								<span className="today-os-nav-item-desc">我的工作空间</span>
							</div>
						</div>

						<div
							className="today-os-nav-item"
							onClick={() => onNavigate("goals")}
						>
							<div className="today-os-nav-item-icon">
								<Target size={16} />
							</div>
							<div className="today-os-nav-item-text">
								<span className="today-os-nav-item-title">目标</span>
								<span className="today-os-nav-item-desc">长期目标与规划</span>
							</div>
						</div>

						<div
							className="today-os-nav-item"
							onClick={() => onNavigate("activity")}
						>
							<div className="today-os-nav-item-icon">
								<Clock3 size={16} />
							</div>
							<div className="today-os-nav-item-text">
								<span className="today-os-nav-item-title">活动</span>
								<span className="today-os-nav-item-desc">最近发生的事情</span>
							</div>
						</div>

						<div
							className="today-os-nav-item"
							onClick={() => onNavigate("projects")}
						>
							<div className="today-os-nav-item-icon">
								<Folder size={16} />
							</div>
							<div className="today-os-nav-item-text">
								<span className="today-os-nav-item-title">项目</span>
								<span className="today-os-nav-item-desc">正在进行的项目</span>
							</div>
						</div>

						<div
							className="today-os-nav-item"
							onClick={() => onNavigate("memory")}
						>
							<div className="today-os-nav-item-icon">
								<BrainCircuit size={16} />
							</div>
							<div className="today-os-nav-item-text">
								<span className="today-os-nav-item-title">记忆</span>
								<span className="today-os-nav-item-desc">我的知识与偏好</span>
							</div>
						</div>

						<div
							className="today-os-nav-item"
							onClick={() => onNavigate("agent")}
						>
							<div className="today-os-nav-item-icon">
								<Shield size={16} />
							</div>
							<div className="today-os-nav-item-text">
								<span className="today-os-nav-item-title">智能体</span>
								<span className="today-os-nav-item-desc">状态与安全控制</span>
							</div>
						</div>
					</nav>

					<div className="today-os-sidebar-scrollable">
						<div className="today-os-sidebar-divider" />

					{/* 最近项目 */}
					<div className="today-os-section-title-row">
						<span>最近项目</span>
						<button
							className="today-os-section-add-btn"
							title="新建或关联项目"
							onClick={onNewConversation}
						>
							<Plus size={14} />
						</button>
					</div>

					<div className="today-os-project-list">
						{displayProjects.map((proj, idx) => (
							<div
								key={proj.id}
								className={`today-os-project-item ${idx === 0 ? "selected" : ""}`}
								onClick={() => {
									if (onOpenProject) onOpenProject(proj.id);
									else onSelectConversation(proj.id);
								}}
							>
								<div className="today-os-project-info">
									<Folder size={14} color={idx === 0 ? "#f97316" : "#64748b"} />
									<div className="today-os-project-titles">
										<span className="today-os-project-name">{proj.name}</span>
										<span
											className="today-os-project-desc"
											style={{ color: idx < 2 ? "#fb923c" : "#64748b" }}
										>
											{proj.desc}
										</span>
									</div>
								</div>
							</div>
						))}
					</div>

					<div className="today-os-sidebar-divider" />

					{/* 最近会话 */}
					<div className="today-os-section-title-row">
						<span>最近会话</span>
						<button
							className="today-os-section-add-btn"
							title="开启新会话"
							onClick={onNewConversation}
						>
							<Plus size={14} />
						</button>
					</div>

					<div className="today-os-session-list">
						{displaySessions.map((sess) => (
							<div
								key={sess.id}
								className="today-os-session-item"
								onClick={() => onSelectConversation(sess.id)}
							>
								<div className="today-os-project-info">
									<MessageSquare size={13} color="#64748b" />
									<span className="today-os-project-name">{sess.title}</span>
								</div>
								<span className="today-os-session-time">{sess.time}</span>
							</div>
						))}
					</div>
					</div>

					{/* 底部个人与伴侣中枢卡片 */}
					<div className="today-os-profile-footer-pinned">
						<Popover>
							<PopoverTrigger asChild>
								<div
									className="today-os-profile-footer"
									title="点击打开个人画像与系统设置"
								>
									<div className="today-os-profile-info">
										<div className="today-os-profile-avatar">
											<img src="/assets/jane-avatar.jpg" alt="Jane" />
										</div>
										<div className="today-os-profile-status">
											<span className="today-os-profile-name">{userName}</span>
											<span className="today-os-profile-dot">● 在线</span>
										</div>
									</div>
									<div className="today-os-profile-trigger-icon">
										<MoreHorizontal size={14} color="#94a3b8" />
									</div>
								</div>
							</PopoverTrigger>
							<PopoverContent className="today-os-profile-popover" side="top" align="start">
								<div className="today-os-profile-popover-header">
									<div className="today-os-popover-avatar">
										<img src="/assets/jane-avatar.jpg" alt="Jane" />
									</div>
									<div>
										<div className="today-os-popover-name">{userName}</div>
										<div className="today-os-popover-desc">Personal Agent OS · 在线</div>
									</div>
								</div>
								<div className="today-os-profile-popover-divider" />
								<button
									type="button"
									className="today-os-popover-item"
									onClick={onOpenProfile}
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
					</div>
				</aside>

				{/* 中间核心 Hub 操作台 */}
				<main className="today-os-center-hub">
					{/* 暮光山峰大片 Hero Banner */}
					<section className="today-os-hero-banner">
						<div className="today-os-hero-header-row">
							<span className="today-os-pill-badge">
								<Zap size={13} /> OpenPI · Personal Agent OS
							</span>
							<div className="today-os-hero-date-weather">
								<span>{formattedDateTime}</span>
								<span className="today-os-weather-pill">⛅ 26°C 多云</span>
							</div>
						</div>

						<div className="today-os-hero-greeting-block">
							<h1 className="today-os-hero-title">{greeting}</h1>
							<p className="today-os-hero-subtitle">
								当前有 <strong className="highlight-cyan">2</strong> 个目标正在推进，
								<span className="highlight-orange"> 1 </span>个需要你的关注。
							</p>
						</div>

						{/* 当前主线目标卡片 (1:1 复刻设计图两栏质感) */}
						<div className="today-os-mission-card">
							<div className="today-os-mission-left-col">
								<div className="today-os-mission-top-tags">
									<span className="today-os-mission-status-pill">
										<Target size={12} /> 当前目标
									</span>
									<span className="today-os-mission-count-pill">
										进行中 2
									</span>
								</div>

								<h2 className="today-os-mission-title">{activeGoal.title}</h2>
								<p className="today-os-mission-desc">{activeGoal.description}</p>

								<div className="today-os-progress-wrap">
									<div className="today-os-progress-bar-bg">
										<div
											className="today-os-progress-bar-fill"
											style={{ width: `${activeGoal.progress}%` }}
										/>
									</div>
									<span className="today-os-progress-percent">
										{activeGoal.progress}%
									</span>
								</div>

								<div className="today-os-mission-meta-row">
									<span className="today-os-meta-chip">👤 个人</span>
									<span className="today-os-meta-chip">📅 预计 {activeGoal.deadline}</span>
									<span className="today-os-meta-chip priority">
										⚡ 优先级: <span className="today-os-tag-danger">{activeGoal.priority}</span>
									</span>
								</div>
							</div>

							<div className="today-os-mission-right-col">
								<div className="today-os-next-box">
									<div className="today-os-next-step-item">
										<div className="today-os-next-icon-wrap orange">
											<FileText size={13} />
										</div>
										<div className="today-os-next-item-texts">
											<span className="today-os-next-item-label">当前阶段</span>
											<span className="today-os-next-item-value">{activeGoal.stage}</span>
										</div>
									</div>

									<div className="today-os-next-step-item">
										<div className="today-os-next-icon-wrap orange">
											<Target size={13} />
										</div>
										<div className="today-os-next-item-texts">
											<span className="today-os-next-item-label">下一步</span>
											<span className="today-os-next-item-value">{activeGoal.nextActionTitle}</span>
										</div>
									</div>

									<button
										className="today-os-cta-orange-btn"
										onClick={handleContinueWork}
									>
										<span>继续工作 →</span>
										<div className="today-os-cta-circle-arrow">
											<ChevronRight size={13} />
										</div>
									</button>
								</div>
							</div>
						</div>
					</section>

					{/* 4 统计卡片网格 */}
					<div className="today-os-stats-grid">
						<div className="today-os-stat-card">
							<div className="today-os-stat-header">
								<span className="today-os-stat-number">{stats.todoCount}</span>
								<div className="today-os-stat-icon-wrap orange">
									<CalendarClock size={16} />
								</div>
							</div>
							<span className="today-os-stat-label">个重要事项</span>
							<span className="today-os-stat-footer">1 个待处理</span>
						</div>

						<div className="today-os-stat-card">
							<div className="today-os-stat-header">
								<span className="today-os-stat-number">{stats.inProgressCount}</span>
								<div className="today-os-stat-icon-wrap blue">
									<Shield size={16} />
								</div>
							</div>
							<span className="today-os-stat-label">个进行中任务</span>
							<span className="today-os-stat-footer" style={{ color: "#38bdf8", cursor: "pointer" }} onClick={() => onNavigate("goals")}>
								查看任务 →
							</span>
						</div>

						<div className="today-os-stat-card">
							<div className="today-os-stat-header">
								<span className="today-os-stat-number">{stats.completedCount}</span>
								<div className="today-os-stat-icon-wrap green">
									<Check size={16} />
								</div>
							</div>
							<span className="today-os-stat-label">个已完成任务</span>
							<span className="today-os-stat-footer" style={{ color: "#10b981" }}>+2% 较昨日</span>
						</div>

						<div className="today-os-stat-card">
							<div className="today-os-stat-header">
								<span className="today-os-stat-number">{stats.attentionCount}</span>
								<div className="today-os-stat-icon-wrap red">
									<Target size={16} />
								</div>
							</div>
							<span className="today-os-stat-label">个需要关注</span>
							<span className="today-os-stat-footer">设计决策引擎</span>
						</div>
					</div>

					{/* AI 正在做什么工作流 */}
					<section className="today-os-section-box">
						<div className="today-os-section-header">
							<div className="today-os-section-title-wrap">
								<span className="today-os-section-heading">AI 正在做什么</span>
								<span className="today-os-section-tag">实时动态</span>
							</div>
							<span
								className="today-os-section-link"
								onClick={() => onNavigate("activity")}
							>
								查看全部 →
							</span>
						</div>

						<div className="today-os-pipeline-track">
							<div className="today-os-pipeline-step">
								<div className="today-os-pipeline-step-head">
									<span>分析需求</span>
									<Check size={12} color="#10b981" />
								</div>
								<span className="today-os-pipeline-step-desc">理解目标与上下文约束</span>
								<span className="today-os-pipeline-step-status">已就绪</span>
							</div>

							<span className="today-os-pipeline-arrow">→</span>

							<div className="today-os-pipeline-step">
								<div className="today-os-pipeline-step-head">
									<span>制定方案</span>
									<Check size={12} color="#10b981" />
								</div>
								<span className="today-os-pipeline-step-desc">决策评估与资源预扣</span>
								<span className="today-os-pipeline-step-status">通过</span>
							</div>

							<span className="today-os-pipeline-arrow">→</span>

							<div className={`today-os-pipeline-step ${conversations.some((c) => c.status === "online" || c.status === "starting") ? "active" : ""}`}>
								<div className="today-os-pipeline-step-head">
									<span>调用 Agent</span>
									<Zap size={12} color={conversations.some((c) => c.status === "online" || c.status === "starting") ? "#f97316" : "#10b981"} />
								</div>
								<span className="today-os-pipeline-step-desc">
									{conversations.some((c) => c.status === "online" || c.status === "starting") ? "并行执行子任务与工具调用" : "执行核心与工具已就绪"}
								</span>
								<span className="today-os-pipeline-step-status">
									{conversations.some((c) => c.status === "online" || c.status === "starting") ? "● 进行中" : "待命中"}
								</span>
							</div>

							<span className="today-os-pipeline-arrow">→</span>

							<div className="today-os-pipeline-step">
								<div className="today-os-pipeline-step-head">
									<span>代码审查</span>
									<FileText size={12} color="#64748b" />
								</div>
								<span className="today-os-pipeline-step-desc">质量巡检与双盲质检</span>
								<span className="today-os-pipeline-step-status">待开始</span>
							</div>

							<span className="today-os-pipeline-arrow">→</span>

							<div className="today-os-pipeline-step">
								<div className="today-os-pipeline-step-head">
									<span>提交结果</span>
									<Check size={12} color="#64748b" />
								</div>
								<span className="today-os-pipeline-step-desc">日志入账与偏好沉淀</span>
								<span className="today-os-pipeline-step-status">待开始</span>
							</div>
						</div>
					</section>

					{/* 建议行动 */}
					<section className="today-os-section-box">
						<div className="today-os-section-header">
							<div className="today-os-section-title-wrap">
								<span className="today-os-section-heading">建议行动</span>
								<span className="today-os-section-tag">基于你的行为与状态</span>
							</div>
							<span
								className="today-os-section-link"
								onClick={() => onNavigate("goals")}
							>
								更多建议 →
							</span>
						</div>

						<div className="today-os-actions-grid">
							<div className="today-os-action-card">
								<div className="today-os-action-head">
									<Terminal size={15} color="#f97316" />
									<span>工程质量守护</span>
								</div>
								<p className="today-os-action-desc">
									检查最近修改的代码并运行测试，确保稳定性。
								</p>
								<button
									className="today-os-action-btn primary"
									onClick={() => onSendPrompt("请帮我运行项目的全套测试，并检查代码规范与稳定性。")}
								>
									立即执行 →
								</button>
							</div>

							<div className="today-os-action-card">
								<div className="today-os-action-head">
									<BrainCircuit size={15} color="#38bdf8" />
									<span>完善 Memory 架构</span>
								</div>
								<p className="today-os-action-desc">
									补全记忆分类规则与持久化方案。
								</p>
								<button
									className="today-os-action-btn"
									onClick={() => onSendPrompt("请帮我分析当前的 Memory 架构设计与分类规则。")}
								>
									开始分析 →
								</button>
							</div>

							<div className="today-os-action-card">
								<div className="today-os-action-head">
									<Target size={15} color="#a855f7" />
									<span>更新项目计划</span>
								</div>
								<p className="today-os-action-desc">
									根据当前进度调整下一阶段目标。
								</p>
								<button
									className="today-os-action-btn"
									onClick={() => onNavigate("goals")}
								>
									查看详情 →
								</button>
							</div>
						</div>
					</section>

					{/* 底部常驻智能输入框 */}
					<div className="today-os-bottom-dock">
						<input
							type="text"
							className="today-os-dock-input"
							placeholder="告诉我你想做什么，或者选择一个建议..."
							value={dockInput}
							onChange={(e) => setDockInput(e.target.value)}
							onKeyDown={handleDockKeyDown}
						/>

						<div className="today-os-dock-tools-row">
							<div className="today-os-dock-tools-left">
								<button className="today-os-icon-btn" title="提及会话或文件">
									@
								</button>
								<div className="today-os-dock-model-pill" onClick={onOpenSettings}>
									<Zap size={11} color="#f97316" />
									<span>{activeModel?.name || "DeepSeek V4.1 Flash"}</span>
									<span>∨</span>
								</div>
								<Sparkles size={14} color="#64748b" />
							</div>

							<div className="today-os-dock-tools-right">
								<div className="today-os-agent-action-pill" onClick={() => onSendPrompt(dockInput || "请帮我制定今日工作计划")}>
									<span>让 Agent 为你工作</span>
								</div>
								<button
									className="today-os-send-arrow-btn"
									title="发送"
									onClick={() => {
										if (dockInput.trim()) {
											onSendPrompt(dockInput.trim());
											setDockInput("");
										}
									}}
								>
									<ArrowUp size={15} />
								</button>
							</div>
						</div>
					</div>
				</main>

				{/* 右侧 Agent 状态 & 上下文 HUD */}
				<aside className="today-os-right-hud">
					{/* Agent 状态 */}
					<div className="today-os-hud-section">
						<div className="today-os-hud-header">
							<span className="today-os-hud-title">Agent 状态</span>
							<span
								className="today-os-hud-status-badge"
								style={{
									color: circuitBadge.color,
									background: circuitBadge.bg,
									borderColor: circuitBadge.color,
								}}
							>
								{circuitBadge.text}
							</span>
						</div>

						<div className="today-os-agent-id-card">
							<div className="today-os-agent-id-logo">
								<Zap size={16} />
							</div>
							<div className="today-os-agent-id-text">
								<span className="today-os-agent-id-name">OpenPI</span>
								<span className="today-os-agent-id-role">Personal Agent</span>
							</div>
						</div>

						<div className="today-os-hud-working-note">
							<Sparkles size={12} color="#fb923c" />
							<span>“我正在为你的目标而工作。”</span>
						</div>

						<div className="today-os-kv-table">
							<div className="today-os-kv-row">
								<span className="today-os-kv-key">🎯 当前目标</span>
								<span className="today-os-kv-value">{activeGoal.title}</span>
							</div>
							<div className="today-os-kv-row">
								<span className="today-os-kv-key">📝 当前任务</span>
								<span className="today-os-kv-value">{activeGoal.nextActionTitle}</span>
							</div>
							<div className="today-os-kv-row">
								<span className="today-os-kv-key">➡️ 下一步</span>
								<span className="today-os-kv-value">{activeGoal.nextActionDesc}</span>
							</div>
						</div>
					</div>

					<div className="today-os-sidebar-divider" />

					{/* 能力概览 */}
					<div className="today-os-hud-section">
						<div className="today-os-hud-header">
							<span className="today-os-hud-title">能力概览</span>
							<ChevronRight size={13} color="#64748b" />
						</div>
						<div className="today-os-caps-row">
							<span className="today-os-cap-pill">规划</span>
							<span className="today-os-cap-pill">记忆</span>
							<span className="today-os-cap-pill">决策</span>
							<span className="today-os-cap-pill">执行</span>
							<span className="today-os-cap-pill">学习</span>
						</div>
					</div>

					<div className="today-os-sidebar-divider" />

					{/* 上下文信息 */}
					<div className="today-os-hud-section">
						<span className="today-os-hud-title">上下文信息</span>
						<div className="today-os-kv-table">
							<div className="today-os-kv-row">
								<span className="today-os-kv-key">相关项目</span>
								<span className="today-os-kv-value">OpenPI Personal Agent OS (1个)</span>
							</div>
							<div className="today-os-kv-row">
								<span className="today-os-kv-key">相关记忆</span>
								<span className="today-os-kv-value">3 条</span>
							</div>
						</div>

						<div className="today-os-chip-wrap">
							{memories.length > 0 ? (
								memories.slice(0, 4).map((m) => (
									<span
										key={m.id}
										className="today-os-chip"
										title={`${m.content}\n[置信度: ${Math.round(m.confidence * 100)}%] 点击可回滚撤销此偏好`}
										onClick={async () => {
											if (window.confirm(`是否回滚并撤销该条个人偏好？\n\n"${m.content}"`)) {
												try {
													await desktopApi.rollbackPreference(m.id);
													setMemories((prev) => prev.filter((item) => item.id !== m.id));
												} catch (err) {
													console.error(err);
												}
											}
										}}
									>
										{m.category}: {m.content.slice(0, 8)}... ↺
									</span>
								))
							) : (
								<>
									<span className="today-os-chip" onClick={() => onNavigate("memory")}>
										个人偏好
									</span>
									<span className="today-os-chip" onClick={() => onNavigate("memory")}>
										目标规划
									</span>
									<span className="today-os-chip" onClick={() => onNavigate("memory")}>
										技术栈
									</span>
									<span className="today-os-chip" onClick={() => onNavigate("memory")}>
										设计风格
									</span>
								</>
							)}
						</div>

						<div className="today-os-kv-table" style={{ marginTop: 4 }}>
							<div className="today-os-kv-row">
								<span className="today-os-kv-key">当前环境</span>
								<span className="today-os-kv-value">macOS 26.7 · 1024K ctx ●</span>
							</div>
						</div>
					</div>

					<div className="today-os-sidebar-divider" />

					{/* 会话与资源 */}
					<div className="today-os-hud-section">
						<div className="today-os-hud-header">
							<span className="today-os-hud-title">会话与资源</span>
							<span className="today-os-hud-dot-live">● 运行中</span>
						</div>
						<div className="today-os-kv-table">
							<div className="today-os-kv-row">
								<span className="today-os-kv-key">模型</span>
								<span className="today-os-kv-value dropdown">
									{activeModel?.name || "DeepSeek V4.1 Flash"} ∨
								</span>
							</div>
							<div className="today-os-kv-row">
								<span className="today-os-kv-key">上下文窗口</span>
								<span className="today-os-kv-value">1M</span>
							</div>
						</div>

						{/* 输入 / 输出 Meter 进度条 (1:1 复刻设计图) */}
						<div className="today-os-meter-group">
							<div className="today-os-meter-row">
								<span className="today-os-meter-label">输入</span>
								<div className="today-os-meter-bar-bg">
									<div className="today-os-meter-fill blue" style={{ width: "45%" }} />
								</div>
								<span className="today-os-meter-val">45.2K</span>
							</div>
							<div className="today-os-meter-row">
								<span className="today-os-meter-label">输出</span>
								<div className="today-os-meter-bar-bg">
									<div className="today-os-meter-fill cyan" style={{ width: "20%" }} />
								</div>
								<span className="today-os-meter-val">12.6K</span>
							</div>
						</div>

						{/* 缓存命中与费用指标 (1:1 复刻设计图) */}
						<div className="today-os-meter-stats-row">
							<div className="today-os-meter-stat">
								<span className="today-os-meter-stat-label">缓存命中</span>
								<span className="today-os-meter-stat-num">66.5K</span>
							</div>
							<div className="today-os-meter-stat">
								<span className="today-os-meter-stat-label">预估费用</span>
								<span className="today-os-meter-stat-num orange">$0.0043</span>
							</div>
						</div>

						{/* 分层预算安全防护报告 (v1.1) */}
						<div className="today-os-kv-table" style={{ marginTop: 8 }}>
							<div className="today-os-kv-row">
								<span className="today-os-kv-key">个人智能 (30%)</span>
								<span className="today-os-kv-value">
									{safetyStatus
										? `${Math.round(safetyStatus.budgetReport.personal_used / 1000)}k / ${Math.round(safetyStatus.budgetReport.personal_limit / 1000)}k`
										: "0k / 30k"}
								</span>
							</div>
							<div className="today-os-kv-row">
								<span className="today-os-kv-key">核心执行 (70%)</span>
								<span className="today-os-kv-value">
									{safetyStatus
										? `${Math.round(safetyStatus.budgetReport.execution_used / 1000)}k / ${Math.round(safetyStatus.budgetReport.execution_limit / 1000)}k`
										: "0k / 70k"}
								</span>
							</div>
							<div className="today-os-kv-row">
								<span className="today-os-kv-key">执行硬顶</span>
								<span className="today-os-kv-value">
									{safetyStatus
										? `≤${Math.round(safetyStatus.constraints.timeoutMs / 1000)}s · ${safetyStatus.constraints.memoryLimitMb}MB`
										: "≤60s · 512MB"}
								</span>
							</div>
						</div>
					</div>

					<div className="today-os-sidebar-divider" />

					{/* 快速入口 */}
					<div className="today-os-hud-section">
						<div className="today-os-hud-header">
							<span className="today-os-hud-title">快速入口</span>
							<span
								className="today-os-section-link"
								onClick={() => onNavigate("tasks")}
							>
								查看全部 →
							</span>
						</div>

						<div className="today-os-hud-grid-2x2">
							<div className="today-os-hud-grid-item" onClick={onNewTask}>
								<span className="today-os-hud-grid-title">+ 新建任务</span>
								<span className="today-os-hud-grid-sub">快速创建任务</span>
							</div>
							<div className="today-os-hud-grid-item" onClick={() => onSendPrompt("打开终端执行调试")}>
								<span className="today-os-hud-grid-title">💻 调试 / 终端</span>
								<span className="today-os-hud-grid-sub">打开终端</span>
							</div>
							<div className="today-os-hud-grid-item" onClick={() => onNavigate("memory")}>
								<span className="today-os-hud-grid-title">🧠 添加记忆</span>
								<span className="today-os-hud-grid-sub">记录重要信息</span>
							</div>
							<div className="today-os-hud-grid-item" onClick={() => onSendPrompt("请帮我处理附加的文件")}>
								<span className="today-os-hud-grid-title">📁 上传文件</span>
								<span className="today-os-hud-grid-sub">处理文件</span>
							</div>
						</div>
					</div>

					<div className="today-os-sidebar-divider" />

					{/* 近期记忆 */}
					<div className="today-os-hud-section">
						<div className="today-os-hud-header">
							<span className="today-os-hud-title">近期记忆</span>
							<span
								className="today-os-section-link"
								onClick={() => onNavigate("memory")}
							>
								查看全部 →
							</span>
						</div>

						<div className="today-os-recent-mem-list">
							<div className="today-os-recent-mem-row">
								<div className="today-os-recent-mem-left">
									<FileText size={12} color="#64748b" />
									<span className="today-os-recent-mem-text">
										用户不希望 UI 有明显 AI 味
									</span>
								</div>
								<div style={{ display: "flex", alignItems: "center", gap: 6 }}>
									<span className="today-os-mem-tag pref">偏好</span>
									<span className="today-os-recent-mem-date">10-07</span>
								</div>
							</div>

							<div className="today-os-recent-mem-row">
								<div className="today-os-recent-mem-left">
									<Target size={12} color="#64748b" />
									<span className="today-os-recent-mem-text">
										继续推进 OpenPI 重构计划
									</span>
								</div>
								<div style={{ display: "flex", alignItems: "center", gap: 6 }}>
									<span className="today-os-mem-tag goal">目标</span>
									<span className="today-os-recent-mem-date">10-06</span>
								</div>
							</div>

							<div className="today-os-recent-mem-row">
								<div className="today-os-recent-mem-left">
									<Shield size={12} color="#64748b" />
									<span className="today-os-recent-mem-text">
										不引入 Milvus
									</span>
								</div>
								<div style={{ display: "flex", alignItems: "center", gap: 6 }}>
									<span className="today-os-mem-tag decision">决策</span>
									<span className="today-os-recent-mem-date">10-05</span>
								</div>
							</div>
						</div>
					</div>
				</aside>
			</div>
		</div>
	);
}
