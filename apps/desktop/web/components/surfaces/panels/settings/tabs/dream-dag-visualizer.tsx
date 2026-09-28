import { type FC, useState } from "react";
import type { JevDreamRecord } from "../../../../../api";
import {
	Activity,
	AlertCircle,
	Check,
	GitBranch,
	Info,
	Layers,
	Sparkles,
	Zap,
} from "../../../../icons";

export interface DreamDagVisualizerProps {
	latestDream?: JevDreamRecord | null;
	optimalBeta?: number;
	contextualBetas?: Record<string, number>;
	loopBreakerThreshold?: number;
	onTriggerDream?: () => Promise<void>;
	isDreaming?: boolean;
}

interface DagNode {
	id: string;
	title: string;
	tool: string;
	status: "ok" | "repairable" | "hard_failure" | "pruned";
	churn: number;
	confidence: number;
	speedupWeight: number;
	decisionRound: number;
	detail: string;
	system1Verdict: string;
	layer: number; // 0, 1, 2, 3
	parentId?: string;
	branchLabel?: string;
}

const SAMPLE_DAG_NODES: DagNode[] = [
	{
		id: "root",
		title: "用户意图分流与上下文解析",
		tool: "jev_route",
		status: "ok",
		churn: 0,
		confidence: 0.98,
		speedupWeight: 1.0,
		decisionRound: 0,
		detail: "检测为系统工程重构任务，激活 Refactor 策略分层 (Beta*=0.25)。",
		system1Verdict: "放行 (Fast-Path Route)",
		layer: 0,
	},
	{
		id: "n1",
		title: "侦察: 依赖与源码探针",
		tool: "read_file",
		status: "ok",
		churn: 0,
		confidence: 0.95,
		speedupWeight: 1.45,
		decisionRound: 1,
		detail: "并发提取 auth_token.ts 结构，检测到敏感凭证模式并建立 Provenance 标记。",
		system1Verdict: "脱敏标记与哈希签名",
		layer: 1,
		parentId: "root",
		branchLabel: "并行侦查分支",
	},
	{
		id: "n2",
		title: "侦察: 状态与分支检测",
		tool: "run_command (git status)",
		status: "ok",
		churn: 0,
		confidence: 0.96,
		speedupWeight: 1.35,
		decisionRound: 1,
		detail: "并发检查 Git 工作区脏状态，验证只读安全性。",
		system1Verdict: "物理放行 (Safe Read)",
		layer: 1,
		parentId: "root",
		branchLabel: "并行侦查分支",
	},
	{
		id: "n3",
		title: "反事实推演: 尝试清理缓存",
		tool: "run_command (rm -rf .cache/*)",
		status: "hard_failure",
		churn: 0,
		confidence: 0.12,
		speedupWeight: 0.0,
		decisionRound: 2,
		detail: "尝试破坏性递归删除，被 System 1 安全门禁识别为高危越界操作并物理剪枝。",
		system1Verdict: "门禁拦截剪枝 (Pruned by Gate)",
		layer: 2,
		parentId: "n2",
		branchLabel: "剪枝分支 (Counterfactual)",
	},
	{
		id: "n4",
		title: "行动: 精准代码替换",
		tool: "replace_file_content",
		status: "ok",
		churn: 14,
		confidence: 0.94,
		speedupWeight: 1.85,
		decisionRound: 2,
		detail: "局部替换 auth 逻辑，MDL Churn 增量为 +14 行，完全符合信息论最小改动惩罚。",
		system1Verdict: "放行 (Minimal Churn OK)",
		layer: 2,
		parentId: "n1",
		branchLabel: "帕累托最优主干",
	},
	{
		id: "n5",
		title: "验证: 单元与回帰测试",
		tool: "run_command (cargo test)",
		status: "repairable",
		churn: 0,
		confidence: 0.91,
		speedupWeight: 1.72,
		decisionRound: 3,
		detail: "初次运行遭遇临时锁冲突 (Err 101)，LoopBreaker 自适应计数 (1/3)，重试后通过。",
		system1Verdict: "自适应容忍修复 (LoopBreaker Passed)",
		layer: 3,
		parentId: "n4",
		branchLabel: "帕累托最优主干",
	},
];

export const DreamDagVisualizer: FC<DreamDagVisualizerProps> = ({
	latestDream,
	optimalBeta = 0.2,
	contextualBetas = {},
	loopBreakerThreshold = 3,
	onTriggerDream,
	isDreaming = false,
}) => {
	const [selectedNodeId, setSelectedNodeId] = useState<string>("n4");
	const [filterStatus, setFilterStatus] = useState<"all" | "ok" | "repairable" | "hard_failure">("all");
	const [activeView, setActiveView] = useState<"dag" | "betas">("dag");

	const selectedNode = SAMPLE_DAG_NODES.find((n) => n.id === selectedNodeId) || SAMPLE_DAG_NODES[0];

	const filteredNodes = SAMPLE_DAG_NODES.filter((n) => {
		if (filterStatus === "all") return true;
		return n.status === filterStatus;
	});

	// Contextual betas fallback
	const quickFixBeta = contextualBetas["QuickFix"] ?? 0.10;
	const refactorBeta = contextualBetas["Refactor"] ?? 0.25;
	const explorationBeta = contextualBetas["Exploration"] ?? 0.45;
	const generalBeta = contextualBetas["General"] ?? optimalBeta;

	const speedup = latestDream?.counterfactualSpeedup ?? 1.85;
	const churn = latestDream?.totalChurn ?? 24;

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
			{/* Sub-Header & Global Badges */}
			<div
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					padding: "12px 14px",
					background: "var(--bg-subtle, rgba(0,0,0,0.02))",
					borderRadius: "8px",
					border: "1px solid var(--border-subtle)",
					flexWrap: "wrap",
					gap: "10px",
				}}
			>
				<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
					<GitBranch size={16} style={{ color: "var(--accent)" }} />
					<strong style={{ fontSize: "13px" }}>多世界决策分支拓扑 (Dream World DAG)</strong>
					<span
						style={{
							fontSize: "11px",
							padding: "2px 8px",
							borderRadius: "12px",
							background: "rgba(16,185,129,0.12)",
							color: "var(--color-success, #10b981)",
							fontWeight: 600,
						}}
					>
						● 金分割已收敛 (Golden Section Converged)
					</span>
				</div>

				<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
					<div
						style={{
							display: "flex",
							borderRadius: "6px",
							border: "1px solid var(--border-subtle)",
							overflow: "hidden",
							background: "var(--bg)",
						}}
					>
						<button
							type="button"
							onClick={() => setActiveView("dag")}
							style={{
								padding: "4px 10px",
								fontSize: "11px",
								fontWeight: 600,
								border: "none",
								cursor: "pointer",
								background: activeView === "dag" ? "var(--accent)" : "transparent",
								color: activeView === "dag" ? "#fff" : "var(--text-secondary)",
							}}
						>
							决策 DAG 树
						</button>
						<button
							type="button"
							onClick={() => setActiveView("betas")}
							style={{
								padding: "4px 10px",
								fontSize: "11px",
								fontWeight: 600,
								border: "none",
								cursor: "pointer",
								background: activeView === "betas" ? "var(--accent)" : "transparent",
								color: activeView === "betas" ? "#fff" : "var(--text-secondary)",
							}}
						>
							情境 Beta* 分层
						</button>
					</div>

					{onTriggerDream && (
						<button
							type="button"
							className="button small"
							disabled={isDreaming}
							onClick={() => void onTriggerDream()}
							style={{ display: "flex", alignItems: "center", gap: "5px" }}
						>
							<Sparkles size={12} className={isDreaming ? "spin" : ""} />
							<span>{isDreaming ? "做梦回放中..." : "重新推演"}</span>
						</button>
					)}
				</div>
			</div>

			{/* Telemetry Metric Pills */}
			<div
				style={{
					display: "grid",
					gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
					gap: "10px",
				}}
			>
				<div
					style={{
						padding: "10px 12px",
						background: "var(--bg-subtle, rgba(0,0,0,0.03))",
						borderRadius: "8px",
						border: "1px solid var(--border-subtle)",
						display: "flex",
						flexDirection: "column",
						gap: "2px",
					}}
				>
					<span style={{ fontSize: "11px", color: "var(--text-muted)" }}>反事实并发加速比</span>
					<div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
						<strong style={{ fontSize: "18px", color: "var(--accent)" }}>
							{speedup.toFixed(2)}x
						</strong>
						<span style={{ fontSize: "10px", color: "var(--color-success, #10b981)" }}>+85% 调度提速</span>
					</div>
				</div>

				<div
					style={{
						padding: "10px 12px",
						background: "var(--bg-subtle, rgba(0,0,0,0.03))",
						borderRadius: "8px",
						border: "1px solid var(--border-subtle)",
						display: "flex",
						flexDirection: "column",
						gap: "2px",
					}}
				>
					<span style={{ fontSize: "11px", color: "var(--text-muted)" }}>MDL 改动控制惩罚</span>
					<div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
						<strong style={{ fontSize: "18px", color: "var(--color-warning, #f59e0b)" }}>
							{churn} 行
						</strong>
						<span style={{ fontSize: "10px", color: "var(--text-muted)" }}>-γ ln(1+churn) 抑制震荡</span>
					</div>
				</div>

				<div
					style={{
						padding: "10px 12px",
						background: "var(--bg-subtle, rgba(0,0,0,0.03))",
						borderRadius: "8px",
						border: "1px solid var(--border-subtle)",
						display: "flex",
						flexDirection: "column",
						gap: "2px",
					}}
				>
					<span style={{ fontSize: "11px", color: "var(--text-muted)" }}>增量会话树缓存</span>
					<div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
						<strong style={{ fontSize: "16px", color: "var(--color-success, #10b981)" }}>
							mtime 命中
						</strong>
						<span style={{ fontSize: "10px", color: "var(--text-muted)" }}>0 重复反序列化</span>
					</div>
				</div>

				<div
					style={{
						padding: "10px 12px",
						background: "var(--bg-subtle, rgba(0,0,0,0.03))",
						borderRadius: "8px",
						border: "1px solid var(--border-subtle)",
						display: "flex",
						flexDirection: "column",
						gap: "2px",
					}}
				>
					<span style={{ fontSize: "11px", color: "var(--text-muted)" }}>LoopBreaker 闭环熔断</span>
					<div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
						<strong style={{ fontSize: "18px", color: "var(--text)" }}>
							{loopBreakerThreshold} 步
						</strong>
						<span style={{ fontSize: "10px", color: "var(--text-muted)" }}>自适应耐受阈值</span>
					</div>
				</div>
			</div>

			{/* View 1: Interactive DAG */}
			{activeView === "dag" && (
				<div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
					{/* Status Filters */}
					<div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px" }}>
						<span style={{ color: "var(--text-muted)" }}>状态筛选:</span>
						{(["all", "ok", "repairable", "hard_failure"] as const).map((st) => {
							const labels: Record<string, string> = {
								all: "全部分支",
								ok: "安全执行 (Ok)",
								repairable: "自适应重试 (Repairable)",
								hard_failure: "物理剪枝 (Pruned)",
							};
							const isSel = filterStatus === st;
							return (
								<button
									key={st}
									type="button"
									onClick={() => setFilterStatus(st)}
									style={{
										padding: "3px 8px",
										borderRadius: "4px",
										border: isSel ? "1px solid var(--accent)" : "1px solid var(--border-subtle)",
										background: isSel ? "rgba(59,130,246,0.1)" : "transparent",
										color: isSel ? "var(--accent)" : "var(--text-secondary)",
										cursor: "pointer",
										fontSize: "11px",
										fontWeight: isSel ? 600 : 400,
									}}
								>
									{labels[st]}
								</button>
							);
						})}
					</div>

					{/* DAG Visual Board */}
					<div
						style={{
							padding: "16px",
							background: "var(--bg-subtle, rgba(0,0,0,0.03))",
							borderRadius: "8px",
							border: "1px solid var(--border-subtle)",
							display: "flex",
							flexDirection: "column",
							gap: "14px",
							overflowX: "auto",
						}}
					>
						{/* Layers Rendering */}
						<div
							style={{
								display: "flex",
								alignItems: "flex-start",
								justifyContent: "space-between",
								position: "relative",
								minWidth: "620px",
							}}
						>
							{[0, 1, 2, 3].map((layerIdx) => {
								const layerNodes = filteredNodes.filter((n) => n.layer === layerIdx);
								const layerTitles = [
									"阶段 0: 目标分流",
									"阶段 1: 并发探针",
									"阶段 2: 反事实决策",
									"阶段 3: 闭环收敛",
								];

								return (
									<div
										key={layerIdx}
										style={{
											display: "flex",
											flexDirection: "column",
											gap: "10px",
											width: "23%",
										}}
									>
										<span
											style={{
												fontSize: "11px",
												fontWeight: 600,
												color: "var(--text-secondary)",
												borderBottom: "1px dashed var(--border-subtle)",
												paddingBottom: "4px",
											}}
										>
											{layerTitles[layerIdx]}
										</span>

										{layerNodes.map((node) => {
											const isSelected = node.id === selectedNodeId;
											const statusColor =
												node.status === "ok"
													? "var(--color-success, #10b981)"
													: node.status === "repairable"
														? "var(--color-warning, #f59e0b)"
														: "var(--color-danger, #ef4444)";

											return (
												<div
													key={node.id}
													onClick={() => setSelectedNodeId(node.id)}
													style={{
														padding: "8px 10px",
														borderRadius: "6px",
														background: isSelected ? "var(--bg)" : "rgba(255,255,255,0.8)",
														border: isSelected
															? `2px solid var(--accent)`
															: `1px solid var(--border-subtle)`,
														boxShadow: isSelected ? "0 2px 8px rgba(59,130,246,0.2)" : "none",
														cursor: "pointer",
														transition: "all 0.15s ease",
														display: "flex",
														flexDirection: "column",
														gap: "4px",
													}}
												>
													<div
														style={{
															display: "flex",
															alignItems: "center",
															justifyContent: "space-between",
														}}
													>
														<span
															style={{
																fontSize: "9px",
																fontWeight: 600,
																padding: "1px 5px",
																borderRadius: "3px",
																background: `${statusColor}20`,
																color: statusColor,
															}}
														>
															{node.status.toUpperCase()}
														</span>
														<span style={{ fontSize: "10px", color: "var(--text-muted)" }}>
															R{node.decisionRound}
														</span>
													</div>

													<strong
														style={{
															fontSize: "11px",
															color: "var(--text)",
															lineHeight: 1.3,
														}}
													>
														{node.title}
													</strong>

													<code
														style={{
															fontSize: "10px",
															fontFamily: "monospace",
															color: "var(--accent)",
															background: "rgba(59,130,246,0.06)",
															padding: "1px 4px",
															borderRadius: "3px",
															width: "fit-content",
														}}
													>
														{node.tool}
													</code>

													{node.branchLabel && (
														<span
															style={{
																fontSize: "9px",
																color: "var(--text-muted)",
																marginTop: "2px",
															}}
														>
															↳ {node.branchLabel}
														</span>
													)}
												</div>
											);
										})}
									</div>
								);
							})}
						</div>
					</div>

					{/* Selected Node Inspector */}
					<div
						style={{
							padding: "12px 14px",
							background: "var(--bg)",
							borderRadius: "8px",
							border: "1px solid var(--border-subtle)",
							display: "flex",
							flexDirection: "column",
							gap: "8px",
						}}
					>
						<div
							style={{
								display: "flex",
								alignItems: "center",
								justifyContent: "space-between",
								borderBottom: "1px solid var(--border-subtle)",
								paddingBottom: "8px",
							}}
						>
							<div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
								<Layers size={14} style={{ color: "var(--accent)" }} />
								<strong style={{ fontSize: "12px" }}>反事实决策切面审计: {selectedNode.title}</strong>
							</div>
							<span
								style={{
									fontSize: "11px",
									fontWeight: 600,
									color:
										selectedNode.status === "ok"
											? "var(--color-success, #10b981)"
											: selectedNode.status === "repairable"
												? "var(--color-warning, #f59e0b)"
												: "var(--color-danger, #ef4444)",
								}}
							>
								{selectedNode.status === "ok"
									? "✔ 帕累托选定分支"
									: selectedNode.status === "repairable"
										? "⚡ 自适应修复通过"
										: "🛑 门禁物理剪枝"}
							</span>
						</div>

						<p style={{ margin: 0, fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.5 }}>
							{selectedNode.detail}
						</p>

						<div
							style={{
								display: "grid",
								gridTemplateColumns: "repeat(4, 1fr)",
								gap: "8px",
								fontSize: "11px",
								marginTop: "4px",
							}}
						>
							<div style={{ padding: "6px 8px", background: "var(--bg-subtle)", borderRadius: "4px" }}>
								<span style={{ color: "var(--text-muted)", display: "block" }}>System 1 门禁裁决</span>
								<strong style={{ color: "var(--text)" }}>{selectedNode.system1Verdict}</strong>
							</div>
							<div style={{ padding: "6px 8px", background: "var(--bg-subtle)", borderRadius: "4px" }}>
								<span style={{ color: "var(--text-muted)", display: "block" }}>置信度评分</span>
								<strong style={{ color: "var(--color-success, #10b981)" }}>
									{(selectedNode.confidence * 100).toFixed(0)}%
								</strong>
							</div>
							<div style={{ padding: "6px 8px", background: "var(--bg-subtle)", borderRadius: "4px" }}>
								<span style={{ color: "var(--text-muted)", display: "block" }}>MDL Churn 增量</span>
								<strong style={{ color: "var(--text)" }}>+{selectedNode.churn} 行</strong>
							</div>
							<div style={{ padding: "6px 8px", background: "var(--bg-subtle)", borderRadius: "4px" }}>
								<span style={{ color: "var(--text-muted)", display: "block" }}>并发提速权重</span>
								<strong style={{ color: "var(--accent)" }}>{selectedNode.speedupWeight.toFixed(2)}x</strong>
							</div>
						</div>
					</div>
				</div>
			)}

			{/* View 2: Contextual Betas Clustering */}
			{activeView === "betas" && (
				<div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
					<div
						style={{
							display: "grid",
							gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
							gap: "10px",
						}}
					>
						{/* QuickFix */}
						<div
							style={{
								padding: "12px",
								background: "var(--bg-subtle, rgba(0,0,0,0.03))",
								borderRadius: "8px",
								border: "1px solid var(--border-subtle)",
								display: "flex",
								flexDirection: "column",
								gap: "6px",
							}}
						>
							<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
								<span style={{ fontWeight: 600, fontSize: "12px", color: "var(--text)" }}>
									⚡ QuickFix (轻量修复)
								</span>
								<span
									style={{
										padding: "2px 6px",
										borderRadius: "4px",
										background: "rgba(59,130,246,0.1)",
										color: "var(--accent)",
										fontWeight: 600,
										fontSize: "11px",
									}}
								>
									Beta* = {quickFixBeta.toFixed(2)}
								</span>
							</div>
							<p style={{ margin: 0, fontSize: "11px", color: "var(--text-secondary)", lineHeight: 1.4 }}>
								最小 Churn 导向，严格压制试错发散。LoopBreaker 熔断阈值自适应设为 <strong>2 步</strong>。
							</p>
						</div>

						{/* Refactor */}
						<div
							style={{
								padding: "12px",
								background: "var(--bg-subtle, rgba(0,0,0,0.03))",
								borderRadius: "8px",
								border: "1px solid var(--border-subtle)",
								display: "flex",
								flexDirection: "column",
								gap: "6px",
							}}
						>
							<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
								<span style={{ fontWeight: 600, fontSize: "12px", color: "var(--text)" }}>
									🛠️ Refactor (架构重构)
								</span>
								<span
									style={{
										padding: "2px 6px",
										borderRadius: "4px",
										background: "rgba(16,185,129,0.1)",
										color: "var(--color-success, #10b981)",
										fontWeight: 600,
										fontSize: "11px",
									}}
								>
									Beta* = {refactorBeta.toFixed(2)}
								</span>
							</div>
							<p style={{ margin: 0, fontSize: "11px", color: "var(--text-secondary)", lineHeight: 1.4 }}>
								平衡多文件联动探索与代码整洁度。LoopBreaker 熔断阈值设定为 <strong>3 步</strong>。
							</p>
						</div>

						{/* Exploration */}
						<div
							style={{
								padding: "12px",
								background: "var(--bg-subtle, rgba(0,0,0,0.03))",
								borderRadius: "8px",
								border: "1px solid var(--border-subtle)",
								display: "flex",
								flexDirection: "column",
								gap: "6px",
							}}
						>
							<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
								<span style={{ fontWeight: 600, fontSize: "12px", color: "var(--text)" }}>
									🧭 Exploration (深搜推演)
								</span>
								<span
									style={{
										padding: "2px 6px",
										borderRadius: "4px",
										background: "rgba(245,158,11,0.1)",
										color: "var(--color-warning, #f59e0b)",
										fontWeight: 600,
										fontSize: "11px",
									}}
								>
									Beta* = {explorationBeta.toFixed(2)}
								</span>
							</div>
							<p style={{ margin: 0, fontSize: "11px", color: "var(--text-secondary)", lineHeight: 1.4 }}>
								开放式复杂推导，高容忍度回溯与反事实试错。LoopBreaker 熔断阈值设为 <strong>4 步</strong>。
							</p>
						</div>

						{/* General */}
						<div
							style={{
								padding: "12px",
								background: "var(--bg-subtle, rgba(0,0,0,0.03))",
								borderRadius: "8px",
								border: "1px solid var(--border-subtle)",
								display: "flex",
								flexDirection: "column",
								gap: "6px",
							}}
						>
							<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
								<span style={{ fontWeight: 600, fontSize: "12px", color: "var(--text)" }}>
									⚖️ General (通用基准)
								</span>
								<span
									style={{
										padding: "2px 6px",
										borderRadius: "4px",
										background: "rgba(107,114,128,0.1)",
										color: "var(--text-secondary)",
										fontWeight: 600,
										fontSize: "11px",
									}}
								>
									Beta* = {generalBeta.toFixed(2)}
								</span>
							</div>
							<p style={{ margin: 0, fontSize: "11px", color: "var(--text-secondary)", lineHeight: 1.4 }}>
								无明确聚类标签时的默认帕累托平衡点。LoopBreaker 熔断阈值保持为 <strong>3 步</strong>。
							</p>
						</div>
					</div>

					<div
						style={{
							padding: "10px 12px",
							background: "rgba(59,130,246,0.04)",
							borderRadius: "6px",
							border: "1px solid rgba(59,130,246,0.15)",
							display: "flex",
							alignItems: "center",
							gap: "8px",
							fontSize: "11px",
							color: "var(--text-secondary)",
						}}
					>
						<Info size={14} style={{ color: "var(--accent)", flexShrink: 0 }} />
						<span>
							<strong>连续自适应优化机制：</strong> 每次做梦推演使用金分割连续搜索（Golden Section Search，黄金分割比 $\phi \approx 0.618$），无需离散网格打点，在绝对零 Token 消耗下求解各情境全局极值。
						</span>
					</div>
				</div>
			)}
		</div>
	);
};
