import { useState } from "react";
import { ListTodo, Plus, Trash2, Check, RefreshCw, X } from "../../../icons.tsx";
import type { PersonalGoalRecord } from "../../../../lib/app-types.ts";
import { desktopApi } from "../../../../api.ts";

export function GoalsTab({
	goals,
	loading,
	onRefresh,
}: {
	goals: PersonalGoalRecord[];
	loading: boolean;
	onRefresh: () => void;
}) {
	const [statusFilter, setStatusFilter] = useState<string>("all");
	const [showNewGoal, setShowNewGoal] = useState(false);
	const [newTitle, setNewTitle] = useState("");
	const [newDescription, setNewDescription] = useState("");
	const [newPriority, setNewPriority] = useState(1);
	const [newCriteria, setNewCriteria] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [updatingGoalId, setUpdatingGoalId] = useState<string | null>(null);

	const filteredGoals = goals.filter((g) => {
		if (statusFilter === "all") return true;
		return g.status === statusFilter;
	});

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
			onRefresh();
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
			onRefresh();
		} catch {
			// ignore
		} finally {
			setUpdatingGoalId(null);
		}
	};

	const handleDeleteGoal = async (id: string) => {
		try {
			await desktopApi.deletePersonalGoal(id);
			onRefresh();
		} catch {
			// ignore
		}
	};

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 960, margin: "0 auto" }}>
			{/* Header bar */}
			<div
				className="glass-card"
				style={{
					padding: "16px 22px",
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					gap: 16,
				}}
			>
				<div>
					<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
						<ListTodo size={18} style={{ color: "var(--accent)" }} />
						<h3 style={{ margin: 0, fontSize: 15, fontWeight: 650 }}>长程目标规划 (Goal Manager)</h3>
					</div>
					<p style={{ margin: "4px 0 0", fontSize: 12.5, color: "var(--text-secondary)" }}>
						跨会话持久化与状态机流转 · 自动驱动 Agent 在会话中定向推进
					</p>
				</div>
				<div style={{ display: "flex", gap: 8 }}>
					<button
						type="button"
						className="button secondary"
						onClick={onRefresh}
						disabled={loading}
						title="刷新"
					>
						<RefreshCw size={13} className={loading ? "spin" : undefined} />
					</button>
					<button
						type="button"
						className="button primary"
						onClick={() => setShowNewGoal((prev) => !prev)}
						style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
					>
						<Plus size={14} />
						<span>新建目标</span>
					</button>
				</div>
			</div>

			{/* Filter Tabs */}
			<div style={{ display: "flex", gap: 8 }}>
				{[
					{ id: "all", label: `全部 (${goals.length})` },
					{ id: "active", label: `进行中 (${goals.filter((g) => g.status === "active").length})` },
					{ id: "completed", label: `已完成 (${goals.filter((g) => g.status === "completed").length})` },
					{ id: "blocked", label: `阻塞 (${goals.filter((g) => g.status === "blocked").length})` },
					{ id: "draft", label: `草稿 (${goals.filter((g) => g.status === "draft").length})` },
				].map((tab) => (
					<button
						key={tab.id}
						type="button"
						className={`context-tab ${statusFilter === tab.id ? "active" : ""}`}
						onClick={() => setStatusFilter(tab.id)}
						style={{ fontSize: 12, padding: "5px 12px" }}
					>
						{tab.label}
					</button>
				))}
			</div>

			{/* New Goal Form Card */}
			{showNewGoal && (
				<div
					className="glass-card"
					style={{
						padding: "18px 22px",
						borderRadius: 12,
						border: "1px solid var(--accent)",
						display: "flex",
						flexDirection: "column",
						gap: 12,
					}}
				>
					<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
						<h4 style={{ margin: 0, fontSize: 14, fontWeight: 650 }}>新建长程目标</h4>
						<button
							type="button"
							className="icon-button quiet"
							onClick={() => setShowNewGoal(false)}
						>
							<X size={14} />
						</button>
					</div>
					<div>
						<label style={{ display: "block", fontSize: 12, color: "var(--text-secondary)", marginBottom: 4 }}>
							目标主线名称
						</label>
						<input
							type="text"
							value={newTitle}
							onChange={(e) => setNewTitle(e.target.value)}
							placeholder="例如：重构模型质检模块支持异步并发质检"
							style={{
								width: "100%",
								padding: "8px 12px",
								borderRadius: 6,
								border: "1px solid var(--border)",
								background: "var(--bg-card)",
								color: "var(--text-primary)",
								fontSize: 13,
							}}
						/>
					</div>
					<div>
						<label style={{ display: "block", fontSize: 12, color: "var(--text-secondary)", marginBottom: 4 }}>
							详细描述与背景
						</label>
						<textarea
							value={newDescription}
							onChange={(e) => setNewDescription(e.target.value)}
							placeholder="说明为什么要做、核心价值与关注点..."
							rows={2}
							style={{
								width: "100%",
								padding: "8px 12px",
								borderRadius: 6,
								border: "1px solid var(--border)",
								background: "var(--bg-card)",
								color: "var(--text-primary)",
								fontSize: 13,
								resize: "vertical",
							}}
						/>
					</div>
					<div style={{ display: "flex", gap: 16 }}>
						<div style={{ flex: 1 }}>
							<label style={{ display: "block", fontSize: 12, color: "var(--text-secondary)", marginBottom: 4 }}>
								优先级 (1-5，数值越小越优先)
							</label>
							<input
								type="number"
								min={1}
								max={5}
								value={newPriority}
								onChange={(e) => setNewPriority(Number(e.target.value) || 1)}
								style={{
									width: "100%",
									padding: "8px 12px",
									borderRadius: 6,
									border: "1px solid var(--border)",
									background: "var(--bg-card)",
									color: "var(--text-primary)",
									fontSize: 13,
								}}
							/>
						</div>
						<div style={{ flex: 2 }}>
							<label style={{ display: "block", fontSize: 12, color: "var(--text-secondary)", marginBottom: 4 }}>
								验收标准 (一行一条)
							</label>
							<input
								type="text"
								value={newCriteria}
								onChange={(e) => setNewCriteria(e.target.value)}
								placeholder="单元测试通过; 架构跨架构全绿"
								style={{
									width: "100%",
									padding: "8px 12px",
									borderRadius: 6,
									border: "1px solid var(--border)",
									background: "var(--bg-card)",
									color: "var(--text-primary)",
									fontSize: 13,
								}}
							/>
						</div>
					</div>
					<div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
						<button
							type="button"
							className="button secondary"
							onClick={() => setShowNewGoal(false)}
						>
							取消
						</button>
						<button
							type="button"
							className="button primary"
							disabled={!newTitle.trim() || submitting}
							onClick={handleCreateGoal}
						>
							{submitting ? "正在创建..." : "确认创建"}
						</button>
					</div>
				</div>
			)}

			{/* Goals List */}
			{filteredGoals.length === 0 ? (
				<div className="glass-card" style={{ padding: 32, textAlign: "center", color: "var(--text-secondary)" }}>
					暂无符合条件的长程目标。
				</div>
			) : (
				<div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
					{filteredGoals.map((goal) => {
						const isUpdating = updatingGoalId === goal.id;
						const statusColor =
							goal.status === "completed"
								? "var(--success)"
								: goal.status === "blocked"
								? "var(--danger)"
								: "var(--accent)";

						return (
							<div
								key={goal.id}
								className="glass-card"
								style={{
									padding: "16px 20px",
									borderRadius: 12,
									display: "flex",
									flexDirection: "column",
									gap: 12,
								}}
							>
								<div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
									<div style={{ flex: 1 }}>
										<div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
											<span
												style={{
													fontSize: 10.5,
													padding: "2px 6px",
													borderRadius: 4,
													background: `${statusColor}20`,
													color: statusColor,
													fontWeight: 650,
													textTransform: "uppercase",
												}}
											>
												{goal.status}
											</span>
											<span
												style={{
													fontSize: 11,
													padding: "1px 6px",
													borderRadius: 4,
													background: "var(--bg-muted)",
													color: "var(--text-muted)",
												}}
											>
												P{goal.priority}
											</span>
											<strong style={{ fontSize: 14.5 }}>{goal.title}</strong>
										</div>
										{goal.description && (
											<div style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.5 }}>
												{goal.description}
											</div>
										)}
									</div>
									<div style={{ display: "flex", alignItems: "center", gap: 6 }}>
										<button
											type="button"
											className="button quiet danger"
											onClick={() => handleDeleteGoal(goal.id)}
											title="删除目标"
											style={{ padding: "4px 8px" }}
										>
											<Trash2 size={13} />
										</button>
									</div>
								</div>

								{/* Progress Bar & Buttons */}
								<div style={{ display: "flex", alignItems: "center", gap: 14 }}>
									<div style={{ flex: 1 }}>
										<div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, marginBottom: 4 }}>
											<span style={{ color: "var(--text-secondary)" }}>推进度</span>
											<span style={{ fontWeight: 650, color: statusColor }}>
												{Math.round(goal.progress * 100)}%
											</span>
										</div>
										<div
											style={{
												width: "100%",
												height: 6,
												borderRadius: 3,
												background: "var(--border)",
												overflow: "hidden",
											}}
										>
											<div
												style={{
													width: `${Math.min(100, Math.max(0, goal.progress * 100))}%`,
													height: "100%",
													background: statusColor,
													borderRadius: 3,
													transition: "width 0.25s ease",
												}}
											/>
										</div>
									</div>

									{/* Increment / Decrement / Complete */}
									<div style={{ display: "flex", gap: 4 }}>
										<button
											type="button"
											className="button secondary"
											disabled={isUpdating || goal.progress >= 1.0}
											onClick={() => handleUpdateProgress(goal, 0.1)}
											style={{ fontSize: 11.5, padding: "3px 8px" }}
										>
											+10%
										</button>
										<button
											type="button"
											className="button secondary"
											disabled={isUpdating || goal.progress <= 0.0}
											onClick={() => handleUpdateProgress(goal, -0.1)}
											style={{ fontSize: 11.5, padding: "3px 8px" }}
										>
											-10%
										</button>
										{goal.status !== "completed" && (
											<button
												type="button"
												className="button secondary"
												disabled={isUpdating}
												onClick={() => handleUpdateProgress(goal, 1.0 - goal.progress)}
												style={{ fontSize: 11.5, padding: "3px 8px", display: "inline-flex", alignItems: "center", gap: 3 }}
											>
												<Check size={11} />
												<span>结项</span>
											</button>
										)}
									</div>
								</div>

								{/* Success Criteria */}
								{goal.successCriteria.length > 0 && (
									<div style={{ display: "flex", flexWrap: "wrap", gap: 6, paddingTop: 4 }}>
										{goal.successCriteria.map((c, i) => (
											<span
												key={i}
												style={{
													fontSize: 11,
													padding: "2px 8px",
													borderRadius: 12,
													background: "var(--bg-muted)",
													color: "var(--text-secondary)",
												}}
											>
												✓ {c}
											</span>
										))}
									</div>
								)}
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
