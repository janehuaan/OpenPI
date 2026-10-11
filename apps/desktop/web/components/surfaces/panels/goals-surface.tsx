import { useState, useEffect } from "react";
import {
	Target,
	ListTodo,
	Plus,
	Trash2,
	Check,
	RefreshCw,
	X,
	Play,
	Clock3,
	AlertCircle,
	Shield,
	ChevronRight,
	Sparkles,
} from "../../icons.tsx";
import type { PersonalGoalRecord } from "../../../lib/app-types.ts";
import { desktopApi } from "../../../api.ts";
import "../today/styles/today-os-dashboard.css";

interface GoalsSurfaceProps {
	workspace?: string;
	onStartGoalWork?: (goalTitle: string) => void;
	onClose?: () => void;
}

export function GoalsSurface({ workspace, onStartGoalWork, onClose }: GoalsSurfaceProps) {
	const [goals, setGoals] = useState<PersonalGoalRecord[]>([]);
	const [loading, setLoading] = useState(false);
	const [statusFilter, setStatusFilter] = useState<string>("all");
	const [showNewGoal, setShowNewGoal] = useState(false);
	const [newTitle, setNewTitle] = useState("");
	const [newDescription, setNewDescription] = useState("");
	const [newPriority, setNewPriority] = useState(1);
	const [newCriteria, setNewCriteria] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [updatingGoalId, setUpdatingGoalId] = useState<string | null>(null);

	const loadGoals = async () => {
		setLoading(true);
		try {
			// `list_personal_goals` 返回的是 `{ goals: [...] }` 包装对象，不是裸数组。
			const res = await desktopApi.listPersonalGoals(statusFilter === "all" ? undefined : statusFilter);
			if (Array.isArray(res?.goals)) {
				setGoals(res.goals);
			}
		} catch {
			// ignore
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		void loadGoals();
	}, [statusFilter]);

	const handleCreateGoal = async () => {
		if (!newTitle.trim()) return;
		setSubmitting(true);
		try {
			const criteriaList = newCriteria
				.split("\n")
				.map((s) => s.trim())
				.filter(Boolean);

			const newGoal: PersonalGoalRecord = {
				id: `goal-${Date.now()}`,
				title: newTitle.trim(),
				description: newDescription.trim() || null,
				status: "active",
				priority: newPriority,
				source: "user",
				progress: 0.0,
				constraints: [],
				successCriteria: criteriaList,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			};

			await desktopApi.upsertPersonalGoal(newGoal);
			setNewTitle("");
			setNewDescription("");
			setNewCriteria("");
			setShowNewGoal(false);
			void loadGoals();
		} catch {
			// ignore
		} finally {
			setSubmitting(false);
		}
	};

	const handleUpdateProgress = async (goal: PersonalGoalRecord, delta: number) => {
		const nextProgress = Math.min(1.0, Math.max(0.0, Number((goal.progress + delta).toFixed(2))));
		setUpdatingGoalId(goal.id);
		try {
			await desktopApi.updatePersonalGoalProgress(
				goal.id,
				nextProgress,
				nextProgress >= 1.0 ? "completed" : goal.status === "completed" ? "active" : goal.status,
			);
			void loadGoals();
		} catch {
			// ignore
		} finally {
			setUpdatingGoalId(null);
		}
	};

	const handleDeleteGoal = async (id: string) => {
		try {
			await desktopApi.deletePersonalGoal(id);
			void loadGoals();
		} catch {
			// ignore
		}
	};

	const activeCount = goals.filter((g) => g.status === "active").length;
	const completedCount = goals.filter((g) => g.status === "completed").length;
	const blockedCount = goals.filter((g) => g.status === "blocked").length;

	return (
		<div style={{ flex: 1, height: "100%", overflowY: "auto", padding: "24px 32px", background: "var(--bg)", color: "var(--text)" }}>
			{/* Top Hero Bar */}
			<div
				style={{
					background: "var(--bg-elevated)",
					border: "1px solid var(--border)",
					borderRadius: 14,
					padding: "20px 24px",
					marginBottom: 20,
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					boxShadow: "var(--shadow-soft)",
				}}
			>
				<div>
					<div style={{ display: "flex", alignItems: "center", gap: 10 }}>
						<div
							style={{
								width: 32,
								height: 32,
								borderRadius: 8,
								background: "var(--accent-soft)",
								color: "var(--accent)",
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
							}}
						>
							<Target size={18} />
						</div>
						<h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "var(--text)" }}>
							长期目标与长程规划 (Goals Management)
						</h2>
					</div>
					<p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--text-secondary)" }}>
						跨会话持久化与状态机流转 · 约束守护与多阶段演进 · 驱动 Agent 在长期任务中持续自驱推进
					</p>
				</div>
				<div style={{ display: "flex", gap: 10, alignItems: "center" }}>
					<button
						type="button"
						style={{
							width: 34,
							height: 34,
							borderRadius: 8,
							border: "1px solid var(--border)",
							background: "var(--bg-elevated)",
							color: "var(--text-secondary)",
							cursor: "pointer",
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
						}}
						onClick={() => void loadGoals()}
						disabled={loading}
						title="刷新目标列表"
					>
						<RefreshCw size={14} className={loading ? "spin" : undefined} />
					</button>
					<button
						type="button"
						style={{
							height: 34,
							padding: "0 14px",
							fontSize: 12.5,
							fontWeight: 600,
							borderRadius: 8,
							border: "none",
							background: "var(--accent)",
							color: "var(--accent-contrast, #ffffff)",
							cursor: "pointer",
							display: "flex",
							alignItems: "center",
							gap: 6,
						}}
						onClick={() => setShowNewGoal((prev) => !prev)}
					>
						<Plus size={14} />
						<span>新建主线目标</span>
					</button>
				</div>
			</div>

			{/* Filter Tabs & Quick Counters */}
			<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
				<div style={{ display: "flex", gap: 8 }}>
					{[
						{ id: "all", label: `全部 (${goals.length})` },
						{ id: "active", label: `进行中 (${activeCount})` },
						{ id: "completed", label: `已完成 (${completedCount})` },
						{ id: "blocked", label: `阻塞待办 (${blockedCount})` },
					].map((tab) => (
						<button
							key={tab.id}
							type="button"
							style={{
								padding: "6px 14px",
								fontSize: 12.5,
								fontWeight: 600,
								borderRadius: 8,
								border: "1px solid",
								borderColor: statusFilter === tab.id ? "var(--accent)" : "var(--border)",
								background: statusFilter === tab.id ? "var(--accent-soft)" : "var(--bg-elevated)",
								color: statusFilter === tab.id ? "var(--accent)" : "var(--text-secondary)",
								cursor: "pointer",
								transition: "all 0.15s ease",
							}}
							onClick={() => setStatusFilter(tab.id)}
						>
							{tab.label}
						</button>
					))}
				</div>
			</div>

			{/* Create Goal Dialog Drawer */}
			{showNewGoal && (
				<div
					style={{
						background: "var(--bg-elevated)",
						border: "1px solid var(--border)",
						borderRadius: 12,
						padding: "20px 24px",
						marginBottom: 20,
						boxShadow: "var(--shadow)",
					}}
				>
					<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
						<h4 style={{ margin: 0, fontSize: 14.5, fontWeight: 700, color: "var(--text)", display: "flex", alignItems: "center", gap: 6 }}>
							<Sparkles size={15} color="var(--accent)" /> 创建长程主线目标
						</h4>
						<button
							type="button"
							style={{ background: "none", border: "none", color: "var(--text-tertiary)", cursor: "pointer" }}
							onClick={() => setShowNewGoal(false)}
						>
							<X size={14} />
						</button>
					</div>
					<div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
						<input
							type="text"
							placeholder="目标标题 (例如: OpenPI Personal Agent OS 全量进化)"
							value={newTitle}
							onChange={(e) => setNewTitle(e.target.value)}
							style={{
								background: "var(--bg-muted)",
								border: "1px solid var(--border)",
								borderRadius: 8,
								padding: "8px 12px",
								color: "var(--text)",
								fontSize: 13,
								outline: "none",
							}}
						/>
						<textarea
							placeholder="目标描述与核心愿景 (可选)..."
							rows={3}
							value={newDescription}
							onChange={(e) => setNewDescription(e.target.value)}
							style={{
								background: "var(--bg-muted)",
								border: "1px solid var(--border)",
								borderRadius: 8,
								padding: "8px 12px",
								color: "var(--text)",
								fontSize: 13,
								outline: "none",
								resize: "vertical",
							}}
						/>
						<textarea
							placeholder="验收标准 (每行一条)..."
							rows={2}
							value={newCriteria}
							onChange={(e) => setNewCriteria(e.target.value)}
							style={{
								background: "var(--bg-muted)",
								border: "1px solid var(--border)",
								borderRadius: 8,
								padding: "8px 12px",
								color: "var(--text)",
								fontSize: 13,
								outline: "none",
								resize: "vertical",
							}}
						/>
						<div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 4 }}>
							<button
								type="button"
								style={{
									padding: "6px 14px",
									borderRadius: 8,
									background: "var(--bg-muted)",
									border: "1px solid var(--border)",
									color: "var(--text-secondary)",
									cursor: "pointer",
								}}
								onClick={() => setShowNewGoal(false)}
							>
								取消
							</button>
							<button
								type="button"
								style={{
									height: 32,
									padding: "0 16px",
									fontSize: 13,
									fontWeight: 600,
									borderRadius: 8,
									border: "none",
									background: "var(--accent)",
									color: "var(--accent-contrast, #ffffff)",
									cursor: "pointer",
								}}
								disabled={submitting || !newTitle.trim()}
								onClick={() => void handleCreateGoal()}
							>
								{submitting ? "创建中..." : "保存目标"}
							</button>
						</div>
					</div>
				</div>
			)}

			{/* Goals Card Grid */}
			<div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
				{goals.map((goal) => {
					const pct = Math.round(goal.progress * 100);
					const isCompleted = goal.status === "completed";
					const isBlocked = goal.status === "blocked";
					return (
						<div
							key={goal.id}
							style={{
								background: "var(--bg-elevated)",
								border: "1px solid var(--border)",
								borderRadius: 12,
								padding: "18px 22px",
								display: "flex",
								flexDirection: "column",
								gap: 12,
								boxShadow: "var(--shadow-soft)",
							}}
						>
							<div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
								<div style={{ flex: 1 }}>
									<div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
										<span
											style={{
												padding: "2px 8px",
												borderRadius: 5,
												fontSize: 11,
												fontWeight: 700,
												background: isCompleted
													? "var(--ok-soft, rgba(16, 185, 129, 0.12))"
													: isBlocked
													? "var(--danger-soft, rgba(239, 68, 68, 0.12))"
													: "var(--accent-soft)",
												color: isCompleted ? "var(--ok, #10b981)" : isBlocked ? "var(--danger, #ef4444)" : "var(--accent)",
												border: "1px solid",
												borderColor: isCompleted
													? "var(--ok, #10b981)"
													: isBlocked
													? "var(--danger, #ef4444)"
													: "var(--accent)",
											}}
										>
											{goal.status.toUpperCase()}
										</span>
										<span style={{ fontSize: 11, color: "var(--text-secondary)" }}>优先级: P{goal.priority}</span>
										<span style={{ fontSize: 11, color: "var(--text-secondary)" }}>来源: {goal.source}</span>
									</div>
									<h3 style={{ margin: "0 0 6px", fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
										{goal.title}
									</h3>
									{goal.description && (
										<p style={{ margin: 0, fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5 }}>
											{goal.description}
										</p>
									)}
								</div>

								{/* Actions */}
								<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
									{onStartGoalWork && (
										<button
											type="button"
											style={{
												height: 32,
												padding: "0 12px",
												fontSize: 12,
												fontWeight: 600,
												borderRadius: 8,
												border: "none",
												background: "var(--accent)",
												color: "var(--accent-contrast, #ffffff)",
												cursor: "pointer",
												display: "flex",
												alignItems: "center",
												gap: 6,
											}}
											onClick={() => onStartGoalWork(goal.title)}
											title="在 Chat 中启动 Agent 推进此目标"
										>
											<Play size={11} fill="currentColor" />
											<span>启动推进</span>
										</button>
									)}
									<button
										type="button"
										style={{
											width: 32,
											height: 32,
											borderRadius: 8,
											border: "1px solid var(--danger-soft, #fecaca)",
											background: "var(--danger-soft, #fee2e2)",
											color: "var(--danger, #ef4444)",
											cursor: "pointer",
											display: "flex",
											alignItems: "center",
											justifyContent: "center",
										}}
										title="删除目标"
										onClick={() => void handleDeleteGoal(goal.id)}
									>
										<Trash2 size={13} />
									</button>
								</div>
							</div>

							{/* Progress Bar & Stepper */}
							<div style={{ display: "flex", alignItems: "center", gap: 14 }}>
								<div style={{ flex: 1, height: 6, background: "var(--border)", borderRadius: 3, overflow: "hidden" }}>
									<div
										style={{
											width: `${pct}%`,
											height: "100%",
											background: isCompleted ? "var(--ok, #10b981)" : "var(--accent)",
											transition: "width 0.3s ease",
										}}
									/>
								</div>
								<span style={{ fontSize: 12.5, fontWeight: 700, color: isCompleted ? "var(--ok, #10b981)" : "var(--accent)", minWidth: 42 }}>
									{pct}%
								</span>
								<div style={{ display: "flex", gap: 4 }}>
									<button
										type="button"
										style={{
											padding: "2px 8px",
											borderRadius: 4,
											border: "1px solid var(--border)",
											background: "var(--bg-muted)",
											color: "var(--text-secondary)",
											fontSize: 11,
											cursor: "pointer",
										}}
										onClick={() => void handleUpdateProgress(goal, -0.1)}
									>
										-10%
									</button>
									<button
										type="button"
										style={{
											padding: "2px 8px",
											borderRadius: 4,
											border: "1px solid var(--border)",
											background: "var(--bg-muted)",
											color: "var(--text-secondary)",
											fontSize: 11,
											cursor: "pointer",
										}}
										onClick={() => void handleUpdateProgress(goal, 0.1)}
									>
										+10%
									</button>
								</div>
							</div>

							{/* Success Criteria */}
							{goal.successCriteria && goal.successCriteria.length > 0 && (
								<div style={{ background: "var(--bg-muted)", border: "1px solid var(--border-subtle)", borderRadius: 8, padding: "8px 12px" }}>
									<span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)" }}>验收标准 (Criteria):</span>
									<div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
										{goal.successCriteria.map((c, i) => (
											<div key={i} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text)" }}>
												<Check size={12} color="var(--ok, #10b981)" />
												<span>{c}</span>
											</div>
										))}
									</div>
								</div>
							)}

							<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, fontSize: 11.5, background: "var(--bg-muted)", border: "1px solid var(--border-subtle)", padding: "10px 12px", borderRadius: 8 }}>
								<div>
									<span style={{ color: "var(--text-secondary)", fontWeight: 600 }}>WHY (愿景与初衷):</span>
									<div style={{ color: "var(--text)", marginTop: 2 }}>从被动执行框架进化为懂用户、长记忆、高可靠的 Personal Agent OS。</div>
								</div>
								<div>
									<span style={{ color: "var(--text-secondary)", fontWeight: 600 }}>NEXT ACTION (下一步动作):</span>
									<div style={{ color: "var(--accent)", marginTop: 2 }}>推进可靠性熔断状态机与分层预算闭环。</div>
								</div>
							</div>
						</div>
					);
				})}

				{goals.length === 0 && !loading && (
					<div style={{ textAlign: "center", padding: "40px 20px", color: "var(--text-secondary)" }}>
						<Target size={36} style={{ opacity: 0.4, marginBottom: 10 }} />
						<p style={{ margin: 0, fontSize: 14 }}>当前分类下暂无目标，点击右上角“新建主线目标”创建！</p>
					</div>
				)}
			</div>
		</div>
	);
}
