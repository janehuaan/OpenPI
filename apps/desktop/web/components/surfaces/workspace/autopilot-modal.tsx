import { useEffect, useRef, useState } from "react";
import type { AutoPilotStep, AutoPilotTask } from "../../../types";
import { desktopApi } from "../../../api";
import {
	AlertCircle,
	Check,
	ChevronRight,
	FileCode,
	GitBranch,
	Play,
	RefreshCw,
	Sliders,
	Terminal,
	Trash,
	X,
	Zap,
} from "../../icons";
import { MiniDiffView } from "../../diff-viewer";

export function AutoPilotModal({
	workspaceCwd,
	initialPrompt = "",
	autoStart = false,
	onClose,
}: {
	workspaceCwd?: string;
	initialPrompt?: string;
	autoStart?: boolean;
	onClose: () => void;
}) {
	const [prompt, setPrompt] = useState(initialPrompt);
	const [testCommand, setTestCommand] = useState("");
	const [maxIterations, setMaxIterations] = useState(3);
	const [task, setTask] = useState<AutoPilotTask | null>(null);
	const [loading, setLoading] = useState(false);
	const [actionLoading, setActionLoading] = useState(false);
	const [statusMessage, setStatusMessage] = useState<string | null>(null);
	const [viewTab, setViewTab] = useState<"pipeline" | "logs" | "diff">("pipeline");
	const logsEndRef = useRef<HTMLDivElement>(null);
	const autoStartedRef = useRef(false);

	useEffect(() => {
		const unsub = desktopApi.onAutoPilotEvent?.(({ task: updatedTask }) => {
			setTask((prev) => {
				if (!prev || prev.taskId === updatedTask.taskId) {
					return updatedTask;
				}
				return prev;
			});
		});
		return () => {
			if (unsub) unsub();
		};
	}, []);

	useEffect(() => {
		if (viewTab === "logs") {
			logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
		}
	}, [task?.logs, viewTab]);

	const handleStart = async (customPrompt?: string) => {
		const p = (typeof customPrompt === "string" ? customPrompt : prompt).trim();
		if (!p || loading) return;

		setLoading(true);
		setStatusMessage(null);
		try {
			const res = await desktopApi.startAutoPilotTask({
				cwd: workspaceCwd,
				prompt: p,
				testCommand: testCommand.trim() || undefined,
				maxIterations,
			});
			if (res) {
				setTask(res);
			}
		} catch (err: any) {
			setStatusMessage(`启动失败: ${err.message || String(err)}`);
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		if (autoStart && initialPrompt.trim() && !autoStartedRef.current) {
			autoStartedRef.current = true;
			void handleStart(initialPrompt.trim());
		}
	}, [autoStart, initialPrompt]);

	const handleMerge = async () => {
		if (!task || actionLoading) return;
		setActionLoading(true);
		setStatusMessage(null);
		try {
			const res = await desktopApi.mergeAutoPilotTask({ taskId: task.taskId });
			if (res.success) {
				setStatusMessage("已成功将分支改动原子合并至主工作区！");
				setTask((prev) => (prev ? { ...prev, status: "merged" } : null));
			} else {
				setStatusMessage(`合并失败: ${res.error || "未知冲突"}`);
			}
		} catch (err: any) {
			setStatusMessage(`合并失败: ${err.message || String(err)}`);
		} finally {
			setActionLoading(false);
		}
	};

	const handleDiscard = async () => {
		if (!task || actionLoading) return;
		if (!confirm("确定要丢弃该 Auto-Pilot 任务与隔离分支的全部改动吗？")) return;
		setActionLoading(true);
		setStatusMessage(null);
		try {
			const res = await desktopApi.discardAutoPilotTask({ taskId: task.taskId });
			if (res.success) {
				setStatusMessage("已丢弃隔离分支并清理 Worktree 空间。");
				setTask((prev) => (prev ? { ...prev, status: "discarded" } : null));
			} else {
				setStatusMessage(`丢弃失败: ${res.error || "清理异常"}`);
			}
		} catch (err: any) {
			setStatusMessage(`丢弃失败: ${err.message || String(err)}`);
		} finally {
			setActionLoading(false);
		}
	};

	const handleContinueHealing = async () => {
		if (!task || actionLoading) return;
		setActionLoading(true);
		setStatusMessage(null);
		try {
			const updated = await desktopApi.continueAutoPilotTask({
				taskId: task.taskId,
				additionalIterations: 3,
			});
			if (updated) {
				setTask(updated);
				setStatusMessage("已启动追加轮次持续自愈！系统正深入排查并解决剩余问题。");
			}
		} catch (err: any) {
			setStatusMessage(`继续自愈失败: ${err.message || String(err)}`);
		} finally {
			setActionLoading(false);
		}
	};

	const renderStepIcon = (step: AutoPilotStep) => {
		if (step.status === "passed") {
			return <Check size={16} className="text-emerald-500" />;
		}
		if (step.status === "running") {
			return <RefreshCw size={16} className="text-blue-500 animate-spin" />;
		}
		if (step.status === "failed") {
			return <AlertCircle size={16} className="text-rose-500" />;
		}
		return <span className="w-2.5 h-2.5 rounded-full bg-slate-500 opacity-40 inline-block" />;
	};

	return (
		<div className="autopilot-modal-overlay" onClick={onClose}>
			<div className="autopilot-modal-card" onClick={(e) => e.stopPropagation()}>
				{/* Header */}
				<div className="autopilot-header">
					<div className="autopilot-title-group">
						<div className="autopilot-badge">
							<Zap size={15} />
							<span>Auto-Pilot</span>
						</div>
						<h2 className="autopilot-title">自主交付与测试自愈引擎</h2>
					</div>
					<button type="button" className="autopilot-close-btn" onClick={onClose}>
						<X size={18} />
					</button>
				</div>

				<div className="autopilot-subtitle">
					基于独立 Git Worktree 运行，零污染主工作区，自动化执行单元测试并提供报错闭环自愈修复。
				</div>

				{statusMessage && <div className="autopilot-status-banner">{statusMessage}</div>}

				{/* Content Area */}
				<div className="autopilot-body">
					{!task ? (
						<form
							onSubmit={(e) => {
								e.preventDefault();
								void handleStart();
							}}
							className="autopilot-form"
						>
							<div className="autopilot-field">
								<label className="autopilot-label">交付目标与需求描述 (Prompt)</label>
								<textarea
									rows={4}
									className="autopilot-textarea"
									placeholder="例如：重构用户登录鉴权中间件，补充单元测试并确保全部通过；或者：添加深色模式切换并修复所有构建报错..."
									value={prompt}
									onChange={(e) => setPrompt(e.target.value)}
									required
								/>
							</div>

							<div className="autopilot-row-2">
								<div className="autopilot-field flex-1">
									<label className="autopilot-label">测试执行命令 (可选，自动检测)</label>
									<input
										type="text"
										className="autopilot-input"
										placeholder="例如：npm test、pytest 或 cargo test（留空则自动识别）"
										value={testCommand}
										onChange={(e) => setTestCommand(e.target.value)}
									/>
								</div>

								<div className="autopilot-field w-36">
									<label className="autopilot-label">自愈轮次上限</label>
									<select
										className="autopilot-select"
										value={maxIterations}
										onChange={(e) => setMaxIterations(Number(e.target.value))}
									>
										<option value={1}>1 轮尝试</option>
										<option value={2}>2 轮自愈</option>
										<option value={3}>3 轮自愈 (推荐)</option>
										<option value={5}>5 轮深度自愈</option>
									</select>
								</div>
							</div>

							<div className="autopilot-submit-row">
								<button type="button" className="autopilot-btn-secondary" onClick={onClose}>
									取消
								</button>
								<button type="submit" className="autopilot-btn-primary" disabled={loading || !prompt.trim()}>
									{loading ? (
										<>
											<RefreshCw size={15} className="animate-spin" />
											正在初始化工作区...
										</>
									) : (
										<>
											<Play size={15} />
											启动 Auto-Pilot 独立交付
										</>
									)}
								</button>
							</div>
						</form>
					) : (
						<div className="autopilot-task-view">
							{/* Sub-tabs if diff or logs are available */}
							<div className="autopilot-tabs-bar">
								<button
									type="button"
									className={`autopilot-tab-btn ${viewTab === "pipeline" ? "active" : ""}`}
									onClick={() => setViewTab("pipeline")}
								>
									<Sliders size={14} />
									执行流水线 ({task.steps.filter((s) => s.status === "passed").length}/{task.steps.length})
								</button>
								<button
									type="button"
									className={`autopilot-tab-btn ${viewTab === "logs" ? "active" : ""}`}
									onClick={() => setViewTab("logs")}
								>
									<Terminal size={14} />
									运行日志 ({task.logs?.length ?? 0})
								</button>
								{task.diff && (
									<button
										type="button"
										className={`autopilot-tab-btn ${viewTab === "diff" ? "active" : ""}`}
										onClick={() => setViewTab("diff")}
									>
										<FileCode size={14} />
										变更 Diff ({task.changedFiles?.length ?? 0} 个文件)
									</button>
								)}
								<div className="autopilot-branch-tag">
									<GitBranch size={13} />
									<span>{task.branch}</span>
								</div>
							</div>

							{viewTab === "pipeline" && (
								<div className="autopilot-stepper">
									{task.discoveredIssues && task.discoveredIssues.length > 0 && (
										<div className="autopilot-issues-summary">
											<div className="autopilot-issues-title">
												<AlertCircle size={14} />
												<span>
													全维问题雷达探测到 {task.discoveredIssues.length} 项问题 (已持续自愈至第{" "}
													{task.currentIteration}/{task.maxIterations} 轮)
												</span>
											</div>
											<div className="autopilot-issues-tags">
												{task.discoveredIssues.map((iss, i) => (
													<span key={i} className={`autopilot-issue-tag tag-${iss.dimension}`}>
														[{iss.dimension.toUpperCase()}] {iss.summary}
													</span>
												))}
											</div>
										</div>
									)}
									{task.steps.map((step, idx) => (
										<div key={step.id} className={`autopilot-step-card status-${step.status}`}>
											<div className="autopilot-step-header">
												<div className="autopilot-step-icon-box">{renderStepIcon(step)}</div>
												<span className="autopilot-step-title">{step.name}</span>
												<span className={`autopilot-step-badge badge-${step.status}`}>{step.status}</span>
											</div>
											{step.detail && <div className="autopilot-step-detail">{step.detail}</div>}
											{step.error && (
												<div className="autopilot-step-error">
													<pre>{step.error}</pre>
												</div>
											)}
										</div>
									))}
								</div>
							)}

							{viewTab === "logs" && (
								<div className="autopilot-logs-area">
									<div className="autopilot-logs-header">
										<div className="autopilot-logs-header-left">
											<Terminal size={13} className="text-cyan-400" />
											<span className="autopilot-logs-header-title">Worktree 独立 Agent 执行日志终端</span>
										</div>
										<div className="autopilot-logs-header-right">
											{task.sessionId && (
												<span className="autopilot-logs-session-id">Session: {task.sessionId.slice(0, 8)}</span>
											)}
											<span className="autopilot-logs-count">{task.logs?.length ?? 0} 行</span>
										</div>
									</div>
									<div className="autopilot-logs-content">
										{!task.logs || task.logs.length === 0 ? (
											<div className="autopilot-logs-empty">
												<RefreshCw size={16} className="animate-spin text-blue-400 mb-2" />
												<span>等待 Agent 启动与首批工具调用日志...</span>
											</div>
										) : (
											<div className="autopilot-logs-list">
												{task.logs.map((log, idx) => {
													const isTool = log.includes("[Agent 工具调用]") || log.includes("[Tool]");
													const isError =
														log.includes("❌") || log.includes("Error:") || log.includes("FAIL") || log.includes("失败");
													const isSuccess =
														log.includes("✅") || log.includes("PASS") || log.includes("成功") || log.includes("通过");
													const isSelfHealing = log.includes("自愈") || log.includes("回灌");
													let lineClass = "autopilot-log-line";
													if (isTool) lineClass += " log-tool";
													else if (isError) lineClass += " log-error";
													else if (isSuccess) lineClass += " log-success";
													else if (isSelfHealing) lineClass += " log-healing";

													return (
														<div key={idx} className={lineClass}>
															<span className="autopilot-log-num">{idx + 1}</span>
															<span className="autopilot-log-text">{log}</span>
														</div>
													);
												})}
												<div ref={logsEndRef} />
											</div>
										)}
									</div>
								</div>
							)}

							{viewTab === "diff" && (
								<div className="autopilot-diff-area">
									{task.diff ? (
										<MiniDiffView diffText={task.diff} workspaceCwd={task.worktreePath} />
									) : (
										<div className="autopilot-empty-diff">暂无改动差异</div>
									)}
								</div>
							)}

							{/* Actions Footer */}
							<div className="autopilot-actions-bar">
								{task.discoveredIssues &&
									task.discoveredIssues.length > 0 &&
									(task.status === "ready_for_review" || task.status === "failed") && (
										<button
											type="button"
											className="autopilot-btn-continue"
											onClick={handleContinueHealing}
											disabled={actionLoading}
											title="所谓的无人值守，就是不断去发现问题，一直到解决好为止"
										>
											{actionLoading ? (
												<RefreshCw size={14} className="animate-spin" />
											) : (
												<Zap size={14} />
											)}
											继续深入自愈 (解决剩余 {task.discoveredIssues.length} 个问题)
										</button>
									)}

								{task.status === "ready_for_review" && (
									<>
										<button
											type="button"
											className="autopilot-btn-discard"
											onClick={handleDiscard}
											disabled={actionLoading}
										>
											<Trash size={14} />
											丢弃改动
										</button>
										<button
											type="button"
											className="autopilot-btn-merge"
											onClick={handleMerge}
											disabled={actionLoading}
										>
											{actionLoading ? (
												<RefreshCw size={14} className="animate-spin" />
											) : (
												<Check size={14} />
											)}
											一键合并到主工作区 (Merge)
										</button>
									</>
								)}

								{(task.status === "merged" || task.status === "discarded" || task.status === "failed") && (
									<button
										type="button"
										className="autopilot-btn-primary"
										onClick={() => {
											setTask(null);
											setPrompt("");
											setStatusMessage(null);
										}}
									>
										开启新一轮交付
									</button>
								)}
							</div>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
