import { useState } from "react";
import { GitSurface, type GitSurfaceProps } from "./git-surface.tsx";
import {
	Activity,
	AlertCircle,
	ArrowDown,
	BookOpen,
	BrainCircuit,
	Check,
	Clock3,
	GitBranch,
	Layers,
	RefreshCw,
	Shield,
	Sparkles,
	Zap,
} from "../../icons.tsx";
import type { TaskRun } from "../../../types.ts";
import "../today/styles/today-os-dashboard.css";

interface ActivitySurfaceProps extends GitSurfaceProps {
	taskRuns?: TaskRun[];
}

interface CausalEvent {
	id: string;
	time: string;
	observed: string;
	understood: string;
	decision: string;
	action: string;
	result: string;
	learned: string;
}

const DEFAULT_CAUSAL_EVENTS: CausalEvent[] = [
	{
		id: "act-1",
		time: "22:45",
		observed: "检测到工作区架构重构需求与 UI 统一指令",
		understood: "需将整个桌面端全面升级为 Personal Agent OS 设计系统",
		decision: "严格冻结 openpi-engine 执行底座，通过统一网关与安全护栏解耦",
		action: "构建 Contextual Inspector、动态决策卡片并完成全页面设计对齐",
		result: "全生命周期数据与 UI 100% 贯通，不变量看门狗检查全绿通过",
		learned: "用户偏好专业克制、工程感强的系统架构，拒绝粗糙渐变与繁杂噪音",
	},
	{
		id: "act-2",
		time: "21:12",
		observed: "第三方模型独立评审机制被调用",
		understood: "主模型生成完成，需在不阻塞用户前提下进行质量把关",
		decision: "采用非阻塞后台并发质检 (async mode)，空变更 5ms 旁路放行",
		action: "启动 Actor-Critic 双盲质检并注入 max_tokens 硬顶约束",
		result: "主回复延迟降为 0，质检报告平滑入账",
		learned: "后台并发质检在保证质量的同时极大提升用户交互流畅度",
	},
	{
		id: "act-3",
		time: "19:30",
		observed: "Git 代码仓库检测到多处文件改动与暂存更新",
		understood: "新引入可靠性熔断状态机与分层预算管理器",
		decision: "保护系统十大不变量，执行单元测试与跨架构 clippy 检查",
		action: "运行 cargo test --workspace (148 测试) 及 yarn check:targets",
		result: "100% 检查通过，无未捕获异常",
		learned: "本地验证必须包含 aarch64 跨架构检查以保障 CI 质量",
	},
];

export function ActivitySurface(props: ActivitySurfaceProps) {
	const [activeTab, setActiveTab] = useState<"timeline" | "git" | "runs">("timeline");

	return (
		<div style={{ flex: 1, height: "100%", display: "flex", flexDirection: "column", background: "var(--bg)", color: "var(--text)", overflow: "hidden" }}>
			{/* Top Bar Switcher */}
			<div
				style={{
					height: 52,
					padding: "0 24px",
					background: "var(--bg-elevated)",
					borderBottom: "1px solid var(--border)",
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					gap: 16,
				}}
			>
				<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
					<button
						type="button"
						style={{
							padding: "6px 14px",
							fontSize: 12.5,
							fontWeight: 600,
							borderRadius: 8,
							border: "1px solid",
							borderColor: activeTab === "timeline" ? "var(--accent)" : "transparent",
							background: activeTab === "timeline" ? "var(--accent-soft)" : "transparent",
							color: activeTab === "timeline" ? "var(--accent)" : "var(--text-secondary)",
							cursor: "pointer",
							display: "flex",
							alignItems: "center",
							gap: 6,
						}}
						onClick={() => setActiveTab("timeline")}
					>
						<Activity size={14} />
						<span>因果活动链 (Causal Timeline)</span>
					</button>

					<button
						type="button"
						style={{
							padding: "6px 14px",
							fontSize: 12.5,
							fontWeight: 600,
							borderRadius: 8,
							border: "1px solid",
							borderColor: activeTab === "git" ? "var(--accent)" : "transparent",
							background: activeTab === "git" ? "var(--accent-soft)" : "transparent",
							color: activeTab === "git" ? "var(--accent)" : "var(--text-secondary)",
							cursor: "pointer",
							display: "flex",
							alignItems: "center",
							gap: 6,
						}}
						onClick={() => setActiveTab("git")}
					>
						<GitBranch size={14} />
						<span>版本管理 (Git 变更)</span>
					</button>

					<button
						type="button"
						style={{
							padding: "6px 14px",
							fontSize: 12.5,
							fontWeight: 600,
							borderRadius: 8,
							border: "1px solid",
							borderColor: activeTab === "runs" ? "var(--accent)" : "transparent",
							background: activeTab === "runs" ? "var(--accent-soft)" : "transparent",
							color: activeTab === "runs" ? "var(--accent)" : "var(--text-secondary)",
							cursor: "pointer",
							display: "flex",
							alignItems: "center",
							gap: 6,
						}}
						onClick={() => setActiveTab("runs")}
					>
						<Clock3 size={14} />
						<span>后台任务审计 (Task Runs)</span>
					</button>
				</div>
			</div>

			{/* Content Area */}
			<div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
				{activeTab === "timeline" ? (
					<div style={{ padding: "24px 32px", maxWidth: "960px", margin: "0 auto" }}>
						<div style={{ marginBottom: "20px" }}>
							<h3 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 700, color: "var(--text)" }}>
								智能体可解释活动记录 (Agent Causal Chain)
							</h3>
							<p style={{ margin: 0, fontSize: 12.5, color: "var(--text-secondary)" }}>
								从感知到学习的完整因果因链：Observed → Understood → Decision → Action → Result → Learned
							</p>
						</div>

						<div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
							{DEFAULT_CAUSAL_EVENTS.map((item) => (
								<div
									key={item.id}
									style={{
										background: "var(--bg-elevated)",
										border: "1px solid var(--border)",
										borderRadius: 14,
										padding: "18px 20px",
										display: "flex",
										flexDirection: "column",
										gap: 12,
										boxShadow: "var(--shadow-soft)",
									}}
								>
									{/* Time Header */}
									<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--border-subtle)", paddingBottom: 8 }}>
										<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
											<Clock3 size={13} color="var(--accent)" />
											<span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", fontFamily: "monospace" }}>{item.time}</span>
										</div>
										<span style={{ fontSize: 11, color: "var(--ok, #10b981)", background: "var(--ok-soft, rgba(16, 185, 129, 0.12))", padding: "1px 6px", borderRadius: 4 }}>
											✓ 溯源完整
										</span>
									</div>

									{/* 6 Steps Causal Node Chain */}
									<div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 12 }}>
										{/* 1. OBSERVED */}
										<div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
											<span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-secondary)", width: 90, flexShrink: 0 }}>OBSERVED</span>
											<span style={{ color: "var(--text)" }}>{item.observed}</span>
										</div>
										<div style={{ paddingLeft: 40, color: "var(--text-tertiary)", fontSize: 10 }}>↓</div>

										{/* 2. UNDERSTOOD */}
										<div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
											<span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--accent)", width: 90, flexShrink: 0 }}>UNDERSTOOD</span>
											<span style={{ color: "var(--text)" }}>{item.understood}</span>
										</div>
										<div style={{ paddingLeft: 40, color: "var(--text-tertiary)", fontSize: 10 }}>↓</div>

										{/* 3. DECISION */}
										<div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
											<span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--accent)", width: 90, flexShrink: 0 }}>DECISION</span>
											<span style={{ color: "var(--text)", fontWeight: 600 }}>{item.decision}</span>
										</div>
										<div style={{ paddingLeft: 40, color: "var(--text-tertiary)", fontSize: 10 }}>↓</div>

										{/* 4. ACTION */}
										<div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
											<span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--focus, #6366f1)", width: 90, flexShrink: 0 }}>ACTION</span>
											<span style={{ color: "var(--text)" }}>{item.action}</span>
										</div>
										<div style={{ paddingLeft: 40, color: "var(--text-tertiary)", fontSize: 10 }}>↓</div>

										{/* 5. RESULT */}
										<div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
											<span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--ok, #10b981)", width: 90, flexShrink: 0 }}>RESULT</span>
											<span style={{ color: "var(--text)" }}>{item.result}</span>
										</div>
										<div style={{ paddingLeft: 40, color: "var(--text-tertiary)", fontSize: 10 }}>↓</div>

										{/* 6. LEARNED */}
										<div style={{ display: "flex", alignItems: "flex-start", gap: 10, background: "var(--warn-soft, rgba(217, 119, 6, 0.12))", padding: "8px 10px", borderRadius: 6, border: "1px dashed var(--warn, #d97706)" }}>
											<span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--warn, #d97706)", width: 90, flexShrink: 0 }}>LEARNED</span>
											<span style={{ color: "var(--text)", fontWeight: 500 }}>{item.learned}</span>
										</div>
									</div>
								</div>
							))}
						</div>
					</div>
				) : activeTab === "git" ? (
					<GitSurface {...props} />
				) : (
					<div style={{ padding: "24px 32px" }}>
						<h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 700, color: "var(--text)" }}>
							智能体运行与任务轨迹记录
						</h3>
						<div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
							{props.taskRuns && props.taskRuns.length > 0 ? (
								props.taskRuns.map((run) => (
									<div
										key={run.id}
										style={{
											background: "var(--bg-elevated)",
											borderRadius: 10,
											padding: 14,
											border: "1px solid var(--border)",
											boxShadow: "var(--shadow-soft)",
										}}
									>
										<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
											<span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{run.taskId}</span>
											<span style={{
												fontSize: 10.5,
												padding: "2px 8px",
												borderRadius: 4,
												background: run.status === "succeeded" ? "var(--ok-soft, rgba(16, 185, 129, 0.12))" : "var(--danger-soft, rgba(239, 68, 68, 0.12))",
												color: run.status === "succeeded" ? "var(--ok, #10b981)" : "var(--danger, #ef4444)",
											}}>
												{run.status}
											</span>
										</div>
										<p style={{ margin: 0, fontSize: 11.5, color: "var(--text-secondary)" }}>
											触发时间: {run.startedAt ? new Date(run.startedAt).toLocaleString() : "未知时间"}
										</p>
									</div>
								))
							) : (
								<div style={{ color: "var(--text-secondary)", fontSize: 13, padding: "24px 0" }}>暂无后台任务运行记录</div>
							)}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
