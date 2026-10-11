import { useState } from "react";
import type { SafetyStatus, InspectorTarget } from "../../../lib/app-types";
import {
	Target,
	Folder,
	BrainCircuit,
	Bot,
	Clock3,
	ExternalLink,
	ChevronRight,
	X,
	Activity,
} from "../../icons.tsx";

interface ContextInspectorProps {
	target?: InspectorTarget;
	safetyStatus?: SafetyStatus | null;
	workspace?: string;
	onClose?: () => void;
	onNavigate?: (view: any) => void;
}

export function ContextInspector({
	target = { kind: "conversation" },
	safetyStatus,
	workspace,
	onClose,
	onNavigate,
}: ContextInspectorProps) {
	const [activeTab, setActiveTab] = useState<"context" | "inspector">("context");

	const circuitState = safetyStatus?.circuitState?.state || "healthy";
	const isHealthy = circuitState.toLowerCase() === "healthy";

	const projectName =
		target.kind === "conversation"
			? target.projectName || workspace?.split(/[\\/]/).filter(Boolean).at(-1) || "OpenPI"
			: workspace?.split(/[\\/]/).filter(Boolean).at(-1) || "OpenPI";

	const goalTitle =
		target.kind === "goal"
			? target.goal.title
			: target.kind === "conversation"
				? target.goalTitle || "OpenPI Personal Agent OS"
				: target.kind === "activity"
					? target.goalTitle || "OpenPI Personal Agent OS"
					: "OpenPI Personal Agent OS";

	return (
		<aside className="pa-inspector-sidebar">
			{/* Top Tabs */}
			<div className="pa-inspector-header">
				<div className="pa-inspector-tabs">
					<button
						type="button"
						className={`pa-inspector-tab ${activeTab === "context" ? "active" : ""}`}
						onClick={() => setActiveTab("context")}
					>
						上下文
					</button>
					<button
						type="button"
						className={`pa-inspector-tab ${activeTab === "inspector" ? "active" : ""}`}
						onClick={() => setActiveTab("inspector")}
					>
						检查器
					</button>
				</div>
				<div className="pa-inspector-actions">
					<button
						type="button"
						className="pa-inspector-icon-btn"
						title="在新窗口中查看"
						onClick={() => onNavigate?.("agent")}
					>
						<ExternalLink size={14} />
					</button>
					{onClose && (
						<button
							type="button"
							className="pa-inspector-icon-btn close-btn"
							title="关闭侧边栏"
							onClick={onClose}
						>
							<X size={14} />
						</button>
					)}
				</div>
			</div>

			<div className="pa-inspector-content">
				{activeTab === "context" ? (
					<>
						{/* 1. 当前目标 */}
						<section className="pa-inspector-section">
							<div className="pa-section-label-row">
								<Target size={14} className="pa-section-icon" />
								<span className="pa-section-label">当前目标</span>
							</div>
							<div className="pa-goal-card">
								<div className="pa-goal-title">{goalTitle}</div>
								<div className="pa-progress-row">
									<div className="pa-progress-bar">
										<div className="pa-progress-fill" style={{ width: "72%" }} />
									</div>
									<span className="pa-progress-text">72%</span>
								</div>
								<div className="pa-goal-desc">
									将 OpenPI 从执行框架升级为个人 Agent 操作系统。
								</div>
							</div>
						</section>

						{/* 2. 当前项目 */}
						<section className="pa-inspector-section">
							<div className="pa-section-label-row">
								<Folder size={14} className="pa-section-icon" />
								<span className="pa-section-label">当前项目</span>
							</div>
							<div
								className="pa-project-card"
								onClick={() => onNavigate?.("projects")}
							>
								<div className="pa-project-title-row">
									<span className="pa-project-title">{projectName}</span>
									<ChevronRight size={13} className="pa-chevron" />
								</div>
								<div className="pa-project-desc">个人项目 · 主要开发仓库</div>
							</div>
						</section>

						{/* 3. 相关记忆 */}
						<section className="pa-inspector-section">
							<div className="pa-section-label-row">
								<BrainCircuit size={14} className="pa-section-icon" />
								<span className="pa-section-label">相关记忆</span>
							</div>
							<div className="pa-memories-list">
								<div className="pa-memory-item">
									<div className="pa-memory-header">
										<div className="pa-memory-icon-wrap green">
											<BrainCircuit size={12} />
										</div>
										<span className="pa-memory-title">用户偏好</span>
										<span className="pa-memory-tag">偏好</span>
									</div>
									<div className="pa-memory-desc">简洁、可靠性、优先考虑长期价值</div>
								</div>

								<div className="pa-memory-item">
									<div className="pa-memory-header">
										<div className="pa-memory-icon-wrap green">
											<BrainCircuit size={12} />
										</div>
										<span className="pa-memory-title">技术栈</span>
										<span className="pa-memory-tag">技术</span>
									</div>
									<div className="pa-memory-desc">JavaScript / TypeScript</div>
								</div>

								<div className="pa-memory-item">
									<div className="pa-memory-header">
										<div className="pa-memory-icon-wrap green">
											<BrainCircuit size={12} />
										</div>
										<span className="pa-memory-title">决策记录</span>
										<span className="pa-memory-tag">经验</span>
									</div>
									<div className="pa-memory-desc">不修改执行核心，优先组合能力</div>
								</div>
							</div>
						</section>

						{/* 4. 智能体状态 */}
						<section className="pa-inspector-section">
							<div className="pa-section-label-row">
								<Bot size={14} className="pa-section-icon" />
								<span className="pa-section-label">智能体状态</span>
								<span className="pa-status-badge running">
									● 运行中
								</span>
							</div>
							<div className="pa-metrics-card">
								<div className="pa-metric-item">
									<div className="pa-metric-label-row">
										<span>CPU</span>
										<span>12%</span>
									</div>
									<div className="pa-progress-bar small">
										<div className="pa-progress-fill" style={{ width: "12%" }} />
									</div>
								</div>

								<div className="pa-metric-item">
									<div className="pa-metric-label-row">
										<span>内存</span>
										<span>1.4 GB / 16 GB</span>
									</div>
									<div className="pa-progress-bar small">
										<div className="pa-progress-fill" style={{ width: "8.7%" }} />
									</div>
								</div>

								<div className="pa-metric-item">
									<div className="pa-metric-label-row">
										<span>LLM 今日使用</span>
										<span>38k tokens</span>
									</div>
									<div className="pa-progress-bar small">
										<div className="pa-progress-fill" style={{ width: "38%" }} />
									</div>
								</div>
							</div>
						</section>

						{/* 5. 相关活动 */}
						<section className="pa-inspector-section">
							<div
								className="pa-activity-link-card"
								onClick={() => onNavigate?.("activity")}
							>
								<div className="pa-activity-left">
									<Clock3 size={14} className="pa-section-icon" />
									<span className="pa-activity-label">相关活动</span>
								</div>
								<ChevronRight size={14} className="pa-chevron" />
							</div>
						</section>
					</>
				) : (
					/* Inspector Tab */
					<div className="pa-inspector-secondary">
						<div className="pa-inspector-card">
							<div className="pa-section-label-row">
								<Activity size={14} className="pa-section-icon" />
								<span className="pa-section-label">运行时诊断</span>
							</div>
							<div className="pa-metric-desc" style={{ marginTop: 8 }}>
								执行核心状态：{isHealthy ? "Healthy (健康)" : circuitState}
							</div>
							<div className="pa-metric-desc">
								保护机制：十大不变量监控中 · 离散确定性门禁生效
							</div>
						</div>
					</div>
				)}
			</div>
		</aside>
	);
}
