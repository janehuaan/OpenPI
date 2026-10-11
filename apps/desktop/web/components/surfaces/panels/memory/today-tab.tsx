import { useState } from "react";
import { Sun, Zap, ListTodo, Sparkles, ChevronRight, RefreshCw, Check } from "../../../icons.tsx";
import type { TodayBriefing, ActionCard, PersonalGoalRecord } from "../../../../lib/app-types.ts";
import { desktopApi } from "../../../../api.ts";

export function TodayTab({
	briefing,
	loading,
	onRefresh,
	onSwitchTab,
}: {
	briefing: TodayBriefing | null;
	loading: boolean;
	onRefresh: () => void;
	onSwitchTab: (tab: "goals" | "personal") => void;
}) {
	const [completingGoalId, setCompletingGoalId] = useState<string | null>(null);
	const [busyCardId, setBusyCardId] = useState<string | null>(null);

	const handleExecuteCard = async (card: ActionCard) => {
		setBusyCardId(card.id);
		try {
			const prompt =
				typeof card.payload?.prompt === "string" && card.payload.prompt.trim()
					? card.payload.prompt
					: card.summary;
			await desktopApi.executeThroughGateway(prompt, `proactive:${card.actionType}`);
			onRefresh();
		} catch {
			// ignore
		} finally {
			setBusyCardId(null);
		}
	};

	const handleDismissCard = async (card: ActionCard) => {
		setBusyCardId(card.id);
		try {
			await desktopApi.dismissActionCard(card.id);
			onRefresh();
		} catch {
			// ignore
		} finally {
			setBusyCardId(null);
		}
	};

	const handleAdvanceGoal = async (goal: PersonalGoalRecord) => {
		const nextProgress = Math.min(1.0, Number((goal.progress + 0.15).toFixed(2)));
		setCompletingGoalId(goal.id);
		try {
			await desktopApi.updatePersonalGoalProgress(
				goal.id,
				nextProgress,
				nextProgress >= 1.0 ? "completed" : "active",
			);
			onRefresh();
		} catch {
			// ignore
		} finally {
			setCompletingGoalId(null);
		}
	};

	const greeting = briefing?.greeting || "今日晨报与主动规划";
	const dailyFocus = briefing?.dailyFocus || "暂无主线目标";
	const activeGoals = briefing?.activeGoals || [];
	const actionCards = briefing?.actionCards || [];
	const keyMemories = briefing?.keyMemories || [];

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 960, margin: "0 auto" }}>
			{/* Top Header Card */}
			<div
				className="glass-card"
				style={{
					padding: "20px 24px",
					borderRadius: 14,
					background: "linear-gradient(135deg, rgba(245, 158, 11, 0.12), rgba(168, 85, 247, 0.08))",
					border: "1px solid rgba(245, 158, 11, 0.25)",
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					gap: 20,
				}}
			>
				<div style={{ display: "flex", alignItems: "center", gap: 16 }}>
					<div
						style={{
							width: 48,
							height: 48,
							borderRadius: "50%",
							background: "rgba(245, 158, 11, 0.2)",
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							color: "var(--accent)",
						}}
					>
						<Sun size={24} />
					</div>
					<div>
						<h3 style={{ margin: "0 0 4px", fontSize: 17, fontWeight: 700 }}>{greeting}</h3>
						<div style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>
							生成时间：{briefing?.date} · OpenPI Personal Agent OS 晨间态势自动聚合
						</div>
					</div>
				</div>
				<button
					type="button"
					className="button secondary"
					onClick={onRefresh}
					disabled={loading}
					style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
				>
					<RefreshCw size={13} className={loading ? "spin" : undefined} />
					<span>重新评估</span>
				</button>
			</div>

			{/* Daily Focus Banner */}
			<div
				className="glass-card"
				style={{
					padding: "16px 20px",
					borderRadius: 12,
					border: "1px solid rgba(99, 102, 241, 0.25)",
					background: "linear-gradient(135deg, rgba(99, 102, 241, 0.08), rgba(245, 158, 11, 0.04))",
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
				}}
			>
				<div style={{ display: "flex", alignItems: "center", gap: 12 }}>
					<span style={{ fontSize: 22 }}>🎯</span>
					<div>
						<div style={{ fontSize: 14, fontWeight: 650, color: "var(--text-primary)" }}>{dailyFocus}</div>
						<div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
							系统根据目标状态机与当前工程环境自主确立的最高优先级主线
						</div>
					</div>
				</div>
				<button
					type="button"
					className="button quiet"
					onClick={() => onSwitchTab("goals")}
					style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 4 }}
				>
					<span>所有目标</span>
					<ChevronRight size={12} />
				</button>
			</div>

			{/* 行动建议卡片 (Action Cards) */}
			<div>
				<div
					style={{
						fontSize: 12.5,
						fontWeight: 650,
						color: "var(--text-secondary)",
						textTransform: "uppercase",
						letterSpacing: "0.05em",
						marginBottom: 10,
						display: "flex",
						alignItems: "center",
						gap: 6,
					}}
				>
					<Zap size={13} style={{ color: "var(--accent)" }} />
					<span>主动建议卡片 (Action Cards)</span>
				</div>
				{actionCards.length === 0 ? (
					<div className="glass-card" style={{ padding: 20, textAlign: "center", color: "var(--text-secondary)" }}>
						暂无可执行的主动卡片，所有长程目标与环境均处于平稳状态。
					</div>
				) : (
					<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
						{actionCards.map((card) => (
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
								}}
							>
								<div>
									<div style={{ fontSize: 14, fontWeight: 650, color: "var(--text-primary)", marginBottom: 4 }}>
										{card.title}
									</div>
									<div style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.5 }}>
										{card.summary}
									</div>
								</div>
								<div
									style={{
										display: "flex",
										alignItems: "center",
										justifyContent: "space-between",
										paddingTop: 8,
										borderTop: "1px solid var(--border)",
									}}
								>
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
										{card.actionType}
									</span>
									<span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>卡片就绪</span>
									<div style={{ display: "flex", alignItems: "center", gap: 6 }}>
										<button
											type="button"
											className="button secondary"
											disabled={busyCardId === card.id}
											onClick={() => void handleExecuteCard(card)}
											style={{ fontSize: 11.5, padding: "3px 8px" }}
										>
											一键执行
										</button>
										<button
											type="button"
											className="button quiet"
											disabled={busyCardId === card.id}
											onClick={() => void handleDismissCard(card)}
											style={{ fontSize: 11.5, padding: "3px 8px" }}
										>
											忽略
										</button>
									</div>
								</div>
							</div>
						))}
					</div>
				)}
			</div>

			{/* 活跃长程目标 */}
			<div>
				<div
					style={{
						fontSize: 12.5,
						fontWeight: 650,
						color: "var(--text-secondary)",
						textTransform: "uppercase",
						letterSpacing: "0.05em",
						marginBottom: 10,
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
					}}
				>
					<div style={{ display: "flex", alignItems: "center", gap: 6 }}>
						<ListTodo size={13} style={{ color: "var(--accent)" }} />
						<span>活跃长程目标 ({activeGoals.length})</span>
					</div>
					<button
						type="button"
						className="button quiet"
						onClick={() => onSwitchTab("goals")}
						style={{ fontSize: 12, padding: "2px 6px" }}
					>
						进入目标面板
					</button>
				</div>
				{activeGoals.length === 0 ? (
					<div className="glass-card" style={{ padding: 20, textAlign: "center", color: "var(--text-secondary)" }}>
						当前没有活跃目标。可以在“目标规划”中创建跨会话的长程主线。
					</div>
				) : (
					<div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
						{activeGoals.map((goal) => (
							<div
								key={goal.id}
								className="glass-card"
								style={{
									padding: "14px 18px",
									borderRadius: 10,
									display: "flex",
									alignItems: "center",
									gap: 16,
								}}
							>
								<div style={{ flex: 1, minWidth: 0 }}>
									<div style={{ display: "flex", alignItems: "center", gap: 10 }}>
										<span style={{ fontSize: 13.5, fontWeight: 650 }}>{goal.title}</span>
										<span
											style={{
												fontSize: 11,
												padding: "1px 6px",
												borderRadius: 4,
												background: "rgba(34, 197, 94, 0.12)",
												color: "var(--success)",
												fontWeight: 600,
											}}
										>
											{Math.round(goal.progress * 100)}%
										</span>
									</div>
									{goal.description && (
										<div
											style={{
												fontSize: 12,
												color: "var(--text-secondary)",
												marginTop: 3,
												overflow: "hidden",
												textOverflow: "ellipsis",
												whiteSpace: "nowrap",
											}}
										>
											{goal.description}
										</div>
									)}
									<div
										style={{
											width: "100%",
											height: 4,
											borderRadius: 2,
											background: "var(--border)",
											marginTop: 8,
											overflow: "hidden",
										}}
									>
										<div
											style={{
												width: `${Math.min(100, Math.max(0, goal.progress * 100))}%`,
												height: "100%",
												background: "var(--accent)",
												borderRadius: 2,
												transition: "width 0.3s ease",
											}}
										/>
									</div>
								</div>
								<button
									type="button"
									className="button secondary"
									disabled={completingGoalId === goal.id}
									onClick={() => void handleAdvanceGoal(goal)}
									style={{ fontSize: 12, padding: "5px 10px", display: "inline-flex", alignItems: "center", gap: 4 }}
								>
									<Check size={12} />
									<span>+15% 推进</span>
								</button>
							</div>
						))}
					</div>
				)}
			</div>

			{/* 核心准则记忆摘要 (Key Memories) */}
			{keyMemories.length > 0 && (
				<div>
					<div
						style={{
							fontSize: 12.5,
							fontWeight: 650,
							color: "var(--text-secondary)",
							textTransform: "uppercase",
							letterSpacing: "0.05em",
							marginBottom: 10,
							display: "flex",
							alignItems: "center",
							justifyContent: "space-between",
						}}
					>
						<div style={{ display: "flex", alignItems: "center", gap: 6 }}>
							<Sparkles size={13} style={{ color: "var(--accent)" }} />
							<span>高置信个人准则与偏好 ({keyMemories.length})</span>
						</div>
						<button
							type="button"
							className="button quiet"
							onClick={() => onSwitchTab("personal")}
							style={{ fontSize: 12, padding: "2px 6px" }}
						>
							管理全部记忆
						</button>
					</div>
					<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 10 }}>
						{keyMemories.map((mem) => (
							<div
								key={mem.id}
								className="glass-card"
								style={{
									padding: "12px 14px",
									borderRadius: 8,
								}}
							>
								<div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
									<span
										style={{
											fontSize: 10.5,
											padding: "1px 6px",
											borderRadius: 4,
											background: "var(--accent-soft)",
											color: "var(--accent)",
											fontWeight: 600,
											textTransform: "uppercase",
										}}
									>
										{mem.category}
									</span>
									<span style={{ fontSize: 11, color: "var(--text-muted)" }}>
										重要度: {Math.round(mem.importance * 100)}%
									</span>
								</div>
								<div style={{ fontSize: 12.5, color: "var(--text-primary)", lineHeight: 1.45 }}>
									{mem.content}
								</div>
							</div>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
