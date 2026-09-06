import { useMemo } from "react";
import type { TaskDefinition, TaskRun, TaskStepDefinition } from "../../../types";
import { Check, Clock3, RefreshCw, X, Zap } from "../../icons.tsx";

export interface TaskDagFlowProps {
	task: TaskDefinition;
	run?: TaskRun;
}

interface StepNode {
	id: string;
	title: string;
	prompt: string;
	dependsOn: string[];
	status: "pending" | "running" | "succeeded" | "failed" | "skipped";
}

export function TaskDagFlow({ task, run }: TaskDagFlowProps) {
	const hasSteps = Array.isArray(task.steps) && task.steps.length > 0;

	// Multi-step topological graph
	const nodes: StepNode[] = useMemo(() => {
		if (!hasSteps || !task.steps) return [];
		return task.steps.map((step: TaskStepDefinition) => {
			let status: StepNode["status"] = "pending";
			if (run) {
				if (run.status === "succeeded") {
					status = "succeeded";
				} else if (run.status === "failed") {
					status = "failed";
				} else if (run.status === "running") {
					status = "running";
				}
			}
			return {
				id: step.id,
				title: step.title || `步骤 ${step.id}`,
				prompt: step.prompt,
				dependsOn: step.dependsOn || [],
				status,
			};
		});
	}, [hasSteps, task.steps, run]);

	// Standard lifecycle stages for single-prompt tasks
	const canonicalStages = useMemo(() => {
		const isRunning = run?.status === "running";
		const isSucceeded = run?.status === "succeeded";
		const isFailed = run?.status === "failed";

		return [
			{
				id: "trigger",
				title: "计划触发",
				desc: task.schedule.kind === "cron" ? `Cron ${task.schedule.expression}` : "单次 / 手动触发",
				status: run ? "succeeded" : "pending",
			},
			{
				id: "setup",
				title: "环境准备",
				desc: "隔离运行环境与凭据装载",
				status: run ? (isRunning ? "running" : isSucceeded || isFailed ? "succeeded" : "pending") : "pending",
			},
			{
				id: "execute",
				title: "Agent 推理执行",
				desc: "模型自主推理与工具调用链",
				status: isRunning ? "running" : isSucceeded ? "succeeded" : isFailed ? "failed" : "pending",
			},
			{
				id: "settle",
				title: "结果审计与沉淀",
				desc: "输出日志、事件审计与持久化",
				status: isSucceeded ? "succeeded" : isFailed ? "failed" : "pending",
			},
		];
	}, [task, run]);

	return (
		<div className="task-dag-flow-container">
			<div className="task-dag-flow-header">
				<div className="task-dag-flow-title">
					<Zap size={14} className="dag-header-icon" />
					<strong>{hasSteps ? "步骤依赖流程图 (DAG Flow)" : "任务生命周期流水线 (Pipeline)"}</strong>
				</div>
				<span className="task-dag-flow-badge">
					{hasSteps ? `${nodes.length} 个执行步骤` : "标准自主循环"}
				</span>
			</div>

			{hasSteps ? (
				<div className="task-dag-nodes-row">
					{nodes.map((node, index) => (
						<div key={node.id} className="dag-node-wrapper">
							<div className={`dag-node-card status-${node.status}`}>
								<div className="dag-node-top">
									<span className="dag-node-index">{index + 1}</span>
									<span className="dag-node-title" title={node.title}>{node.title}</span>
									<span className={`dag-node-status-icon ${node.status}`}>
										{node.status === "succeeded" ? (
											<Check size={12} />
										) : node.status === "running" ? (
											<RefreshCw size={12} className="spinning" />
										) : node.status === "failed" ? (
											<X size={12} />
										) : (
											<Clock3 size={12} />
										)}
									</span>
								</div>
								<p className="dag-node-prompt" title={node.prompt}>{node.prompt}</p>
								{node.dependsOn.length > 0 && (
									<div className="dag-node-deps">
										<span>依赖:</span>
										{node.dependsOn.map((dep) => (
											<code key={dep}>{dep}</code>
										))}
									</div>
								)}
							</div>
							{index < nodes.length - 1 && (
								<div className="dag-node-connector">
									<div className="dag-connector-line" />
									<div className="dag-connector-arrow">▶</div>
								</div>
							)}
						</div>
					))}
				</div>
			) : (
				<div className="task-dag-pipeline-row">
					{canonicalStages.map((stage, index) => (
						<div key={stage.id} className="pipeline-stage-wrapper">
							<div className={`pipeline-stage-card status-${stage.status}`}>
								<div className="pipeline-stage-top">
									<div className={`pipeline-stage-dot status-${stage.status}`}>
										{stage.status === "succeeded" ? (
											<Check size={11} />
										) : stage.status === "running" ? (
											<RefreshCw size={11} className="spinning" />
										) : stage.status === "failed" ? (
											<X size={11} />
										) : (
											<span>{index + 1}</span>
										)}
									</div>
									<strong>{stage.title}</strong>
								</div>
								<p>{stage.desc}</p>
							</div>
							{index < canonicalStages.length - 1 && (
								<div className={`pipeline-stage-connector ${stage.status === "succeeded" ? "completed" : ""}`}>
									<div className="pipeline-line" />
								</div>
							)}
						</div>
					))}
				</div>
			)}
		</div>
	);
}
