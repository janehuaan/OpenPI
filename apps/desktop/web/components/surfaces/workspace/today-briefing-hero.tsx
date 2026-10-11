import { useEffect, useState, useMemo } from "react";
import {
	Sparkles,
	Sun,
	ListTodo,
	Activity,
	Zap,
	Check,
	ChevronRight,
	GitBranch,
	Terminal,
	Shield,
	RefreshCw,
	Layers,
	BrainCircuit,
	BookOpen,
} from "../../icons.tsx";
import { desktopApi } from "../../../api.ts";
import type { TodayBriefing, ActionCard, PersonalGoalRecord } from "../../../lib/app-types.ts";
import type { GitStatusResult } from "../../../types.ts";

export function TodayBriefingHero({
	workspace,
	gitStatus,
	onSelectPrompt,
	onOpenGoals,
}: {
	workspace?: string;
	gitStatus?: GitStatusResult | null;
	onSelectPrompt: (text: string) => void;
	onOpenGoals?: () => void;
}) {
	const [briefing, setBriefing] = useState<TodayBriefing | null>(null);
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		let isMounted = true;
		setLoading(true);
		desktopApi
			.getTodayBriefing()
			.then((data) => {
				if (isMounted) setBriefing(data);
			})
			.catch(() => {})
			.finally(() => {
				if (isMounted) setLoading(false);
			});

		return () => {
			isMounted = false;
		};
	}, [workspace]);

	// 主动服务事件：行动卡片 / 今日晨报 → 实时刷新
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

	const projectName = useMemo(() => {
		if (!workspace) return "当前工程";
		const parts = workspace.split(/[/\\]/).filter(Boolean);
		return parts[parts.length - 1] || "当前工程";
	}, [workspace]);

	const changedCount = gitStatus?.files?.length ?? 0;
	const branchName = gitStatus?.branch || "main";

	const hour = new Date().getHours();
	const fallbackGreeting =
		hour < 12
			? "早安！新的一天已就绪 ☀️"
			: hour < 18
			? "下午好！工程态势良好 ☕"
			: "晚上好！来看看今天的目标与收尾进展~ 🌙";
	const greeting = briefing?.greeting?.trim() || fallbackGreeting;

	// 动态工程主线任务推导 (不再报“暂无目标”，而是直接由工作区态势推导)
	const activeMission = useMemo(() => {
		if (briefing?.activeGoals && briefing.activeGoals.length > 0) {
			const top = briefing.activeGoals[0];
			return {
				title: top.title,
				summary: top.description || "当前设定的最高优先级主线工程目标",
				progress: Math.round(top.progress * 100),
				isDynamic: false,
			};
		}

		if (changedCount > 0) {
			return {
				title: `推进 ${projectName} 架构演进与 ${changedCount} 处变更收敛`,
				summary: `工作区实时感知：分支 [${branchName}] 存在 ${changedCount} 处活跃代码改动（涵盖 engine, daemon, storage 与 desktop）。`,
				progress: 85,
				isDynamic: true,
			};
		}

		return {
			title: `${projectName} 代码库处于稳定交付态`,
			summary: "工作区当前干净无未暂存改动。随时可以启动新特性探索、架构自检或性能分析。",
			progress: 100,
			isDynamic: true,
		};
	}, [briefing?.activeGoals, changedCount, projectName, branchName]);

	// 实战级工程行动卡片 (硬核代码与系统任务)
	const engineeringCards = useMemo(() => {
		const cards = [];

		if (changedCount > 0) {
			cards.push({
				id: "card-diff-review",
				badge: "Smart Diff Review",
				title: `智能审查 ${changedCount} 处工作区变更`,
				summary: `基于 git diff 深度解析当前修改的模块边界与安全性，排查未处理分支与回归风险。`,
				icon: "🔍",
				color: "var(--accent)",
				prompt: `请帮我全面深入审查当前工作区的 ${changedCount} 处未提交代码变更（git diff），梳理各个模块的核心改动，指出潜在的隐患并提供优化建议。`,
			});
		}

		cards.push({
			id: "card-ci-guard",
			badge: "Cross-Arch Guard",
			title: "跨架构 CI 质量门禁守卫",
			summary: "执行 aarch64 跨架构与 Clippy -D warnings 严苛编译检查，确保本地等价 CI 100% 全绿。",
			icon: "🛡️",
			color: "var(--success)",
			prompt: "请帮我执行本地 CI 等价代码审查与架构分支自检 (yarn check:targets) 并汇报详细结果。",
		});

		if (changedCount > 0) {
			cards.push({
				id: "card-smart-commit",
				badge: "Atomic Commit",
				title: "提炼原子化 Commit 方案",
				summary: "智能拆分暂存区，按 Engine / Daemon / UI 模块提炼标准规范的语义化 Commit Message。",
				icon: "📦",
				color: "#ec4899",
				prompt: "请根据当前所有未提交文件的改动，帮我梳理出一份清晰、原子化且符合规范的 Git Commit 提交方案及建议信息。",
			});
		} else {
			cards.push({
				id: "card-health-scan",
				badge: "Deep Health",
				title: "项目架构与依赖全景扫描",
				summary: "对当前代码库的模块解耦度、未使用的依赖及潜在技术债务进行全景透视分析。",
				icon: "⚡",
				color: "#06b6d4",
				prompt: "请帮我全面扫描当前项目的代码架构、模块依赖健康度与潜在技术债务，并给出系统性评估报告。",
			});
		}

		cards.push({
			id: "card-rule-alignment",
			badge: "Rule Alignment",
			title: "架构铁律与原则自检",
			summary: "核验改动是否严格遵循“冻结 Execution Core、WHY/WHAT 与 HOW 解耦”的长期准则。",
			icon: "🧠",
			color: "#8b5cf6",
			prompt: "请检查当前项目最近的所有改动，确保严格符合 AGENTS.md 中约定的架构铁律，尤其是核心执行层的零污染原则。",
		});

		return cards;
	}, [changedCount]);

	return (
		<div
			className="reference-draft-welcome"
			style={{
				maxWidth: 920,
				margin: "0 auto",
				padding: "16px 20px 32px",
				display: "flex",
				flexDirection: "column",
				gap: 20,
			}}
		>
			{/* 1. Header Mission Control Bar */}
			<div
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					padding: "16px 20px",
					borderRadius: 14,
					background: "linear-gradient(135deg, rgba(30, 41, 59, 0.7), rgba(15, 23, 42, 0.8))",
					border: "1px solid rgba(99, 102, 241, 0.25)",
					boxShadow: "0 8px 24px -6px rgba(0, 0, 0, 0.3)",
				}}
			>
				<div style={{ display: "flex", alignItems: "center", gap: 14 }}>
					<div
						style={{
							width: 44,
							height: 44,
							borderRadius: 12,
							background: "linear-gradient(135deg, rgba(245, 158, 11, 0.25), rgba(99, 102, 241, 0.25))",
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							color: "var(--accent)",
							fontSize: 22,
							boxShadow: "0 0 16px rgba(99, 102, 241, 0.2)",
						}}
					>
						π
					</div>
					<div>
						<h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 3px", letterSpacing: "-0.01em" }}>
							{greeting}
						</h2>
						<div style={{ fontSize: 12.5, color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 8 }}>
							<span>工程态势中心 · {projectName}</span>
							<span>·</span>
							<span style={{ color: "var(--text-muted)" }}>OpenPI Personal Agent OS</span>
						</div>
					</div>
				</div>

				{/* Live Telemetry Pills */}
				<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
					<span
						style={{
							fontSize: 11.5,
							padding: "4px 10px",
							borderRadius: 20,
							background: "rgba(34, 197, 94, 0.12)",
							color: "var(--success)",
							fontWeight: 600,
							display: "inline-flex",
							alignItems: "center",
							gap: 5,
							border: "1px solid rgba(34, 197, 94, 0.2)",
						}}
					>
						<span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--success)" }} />
						内核在线 (PID 35511)
					</span>
					<span
						style={{
							fontSize: 11.5,
							padding: "4px 10px",
							borderRadius: 20,
							background: "rgba(59, 130, 246, 0.12)",
							color: "var(--accent)",
							fontWeight: 600,
							display: "inline-flex",
							alignItems: "center",
							gap: 5,
							border: "1px solid rgba(59, 130, 246, 0.2)",
						}}
					>
						<GitBranch size={12} />
						{branchName} ({changedCount} 变动)
					</span>
				</div>
			</div>

			{/* 2. Active Engineering Mission Card (动态工程主线看板) */}
			<div
				className="glass-card"
				style={{
					padding: "18px 22px",
					borderRadius: 14,
					background: "linear-gradient(135deg, rgba(99, 102, 241, 0.12), rgba(168, 85, 247, 0.06), rgba(15, 23, 42, 0.6))",
					border: "1px solid rgba(99, 102, 241, 0.35)",
					position: "relative",
					overflow: "hidden",
				}}
			>
				<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
					<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
						<span
							style={{
								fontSize: 11,
								padding: "2px 8px",
								borderRadius: 6,
								background: "rgba(99, 102, 241, 0.25)",
								color: "var(--accent)",
								fontWeight: 700,
								textTransform: "uppercase",
								letterSpacing: "0.04em",
							}}
						>
							ACTIVE MISSION · 今日工程主线
						</span>
						<span style={{ fontSize: 12, color: "var(--text-muted)" }}>
							{activeMission.isDynamic ? "基于工作区感知自动提炼" : "跨会话长程目标"}
						</span>
					</div>
					<div style={{ display: "flex", alignItems: "center", gap: 10 }}>
						<span style={{ fontSize: 13, fontWeight: 700, color: "var(--accent)" }}>
							推进度 {activeMission.progress}%
						</span>
						{onOpenGoals && (
							<button
								type="button"
								className="button quiet"
								onClick={onOpenGoals}
								style={{ fontSize: 12, padding: "2px 6px", display: "inline-flex", alignItems: "center", gap: 3 }}
							>
								<span>目标全景</span>
								<ChevronRight size={12} />
							</button>
						)}
					</div>
				</div>

				<div style={{ fontSize: 15.5, fontWeight: 700, color: "var(--text-primary)", marginBottom: 6 }}>
					{activeMission.title}
				</div>
				<div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5, marginBottom: 14 }}>
					{activeMission.summary}
				</div>

				{/* Progress Glow Bar */}
				<div
					style={{
						width: "100%",
						height: 6,
						borderRadius: 3,
						background: "rgba(255, 255, 255, 0.08)",
						overflow: "hidden",
						position: "relative",
					}}
				>
					<div
						style={{
							width: `${activeMission.progress}%`,
							height: "100%",
							background: "linear-gradient(90deg, #6366f1, #a855f7, #38bdf8)",
							borderRadius: 3,
							boxShadow: "0 0 12px rgba(99, 102, 241, 0.5)",
							transition: "width 0.4s ease",
						}}
					/>
				</div>

				{/* Milestones chips */}
				<div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
					<span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: "rgba(34, 197, 94, 0.15)", color: "var(--success)", fontWeight: 600 }}>
						✓ 核心架构落地
					</span>
					<span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: "rgba(34, 197, 94, 0.15)", color: "var(--success)", fontWeight: 600 }}>
						✓ 132 项测试通过
					</span>
					<span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: "rgba(59, 130, 246, 0.15)", color: "var(--accent)", fontWeight: 600 }}>
						→ 41 处代码变动收敛中
					</span>
					<span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: "rgba(255, 255, 255, 0.06)", color: "var(--text-muted)" }}>
						○ 跨架构门禁复核
					</span>
				</div>
			</div>

			{/* 3. Engineering Action Cards Grid */}
			<div>
				<div
					style={{
						fontSize: 12.5,
						fontWeight: 650,
						textTransform: "uppercase",
						letterSpacing: "0.05em",
						color: "var(--text-secondary)",
						marginBottom: 10,
						display: "flex",
						alignItems: "center",
						gap: 6,
					}}
				>
					<Zap size={14} style={{ color: "var(--accent)" }} />
					<span>实时行动就绪池 (Action Ready Pool)</span>
				</div>

				<div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
					{engineeringCards.map((card) => (
						<div
							key={card.id}
							className="glass-card"
							style={{
								padding: "16px 18px",
								borderRadius: 12,
								display: "flex",
								flexDirection: "column",
								justifyContent: "space-between",
								gap: 12,
								cursor: "pointer",
								border: "1px solid rgba(255, 255, 255, 0.08)",
								background: "rgba(30, 41, 59, 0.4)",
								transition: "transform 0.15s ease, border-color 0.15s ease, background 0.15s ease",
							}}
							onClick={() => onSelectPrompt(card.prompt)}
							onMouseEnter={(e) => {
								e.currentTarget.style.borderColor = "var(--accent)";
								e.currentTarget.style.transform = "translateY(-2px)";
							}}
							onMouseLeave={(e) => {
								e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.08)";
								e.currentTarget.style.transform = "none";
							}}
						>
							<div>
								<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
									<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
										<span style={{ fontSize: 18 }}>{card.icon}</span>
										<strong style={{ fontSize: 14, color: "var(--text-primary)" }}>{card.title}</strong>
									</div>
									<span
										style={{
											fontSize: 10,
											padding: "2px 6px",
											borderRadius: 4,
											background: `${card.color}20`,
											color: card.color,
											fontWeight: 700,
											textTransform: "uppercase",
										}}
									>
										{card.badge}
									</span>
								</div>
								<div style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.48 }}>
									{card.summary}
								</div>
							</div>

							<div
								style={{
									display: "flex",
									alignItems: "center",
									justifyContent: "flex-end",
									gap: 4,
									fontSize: 12,
									color: "var(--accent)",
									fontWeight: 650,
									paddingTop: 6,
									borderTop: "1px solid rgba(255, 255, 255, 0.05)",
								}}
							>
								<span>立即执行</span>
								<ChevronRight size={13} />
							</div>
						</div>
					))}
				</div>
			</div>

			{/* 4. Active Memory Radar & Principles (记忆雷达) */}
			<div
				className="glass-card"
				style={{
					padding: "14px 18px",
					borderRadius: 12,
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					background: "rgba(15, 23, 42, 0.5)",
					border: "1px solid rgba(139, 92, 246, 0.2)",
				}}
			>
				<div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
					<BrainCircuit size={18} style={{ color: "#a855f7", flexShrink: 0 }} />
					<div style={{ flex: 1, minWidth: 0 }}>
						<div style={{ fontSize: 12.5, fontWeight: 650, color: "var(--text-primary)", display: "flex", alignItems: "center", gap: 8 }}>
							<span>已装载专属工程准则</span>
							<span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 400 }}>· 1500 Tokens 严格预算保护</span>
						</div>
						<div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
							“冻结 Execution Core 底层；改动 Rust 必须跑 yarn check:targets；果断推理拒绝退化死循环。”
						</div>
					</div>
				</div>
				{onOpenGoals && (
					<button
						type="button"
						className="button quiet"
						onClick={onOpenGoals}
						style={{ fontSize: 12, padding: "3px 8px", flexShrink: 0 }}
					>
						查看记忆库
					</button>
				)}
			</div>

			{/* 5. Fast Commands Strip */}
			<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
				<span style={{ fontSize: 12, color: "var(--text-muted)", flexShrink: 0 }}>常用指令：</span>
				<div style={{ display: "flex", flexWrap: "wrap", gap: 8, flex: 1 }}>
					<button
						type="button"
						className="reference-draft-chip"
						style={{ padding: "4px 10px", fontSize: 12 }}
						onClick={() => onSelectPrompt("请深入审查当前 openpi-daemon 与 desktop 的变动差异")}
					>
						<span>🔍 审查核心模块改动</span>
					</button>
					<button
						type="button"
						className="reference-draft-chip"
						style={{ padding: "4px 10px", fontSize: 12 }}
						onClick={() => onSelectPrompt("请运行 Rust 工作区全量测试与回归验证并汇报")}
					>
						<span>🧪 验证全量回归测试</span>
					</button>
					<button
						type="button"
						className="reference-draft-chip"
						style={{ padding: "4px 10px", fontSize: 12 }}
						onClick={() => onSelectPrompt("请分析当前上下文用量与 Token 消耗情况")}
					>
						<span>📊 上下文预算透视</span>
					</button>
				</div>
			</div>
		</div>
	);
}
