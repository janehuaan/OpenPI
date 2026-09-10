import { useMemo, useState } from "react";
import {
	Bot,
	Check,
	ChevronRight,
	Clock3,
	Cpu,
	Plus,
	RefreshCw,
	Sparkles,
	Terminal,
	Users,
	Wrench,
	X,
} from "../../icons";
import {
	type SwarmMember,
	type SwarmRole,
	type SwarmTaskStep,
	type SwarmWorkflow,
	SWARM_ROLE_META,
} from "../../../lib/swarm-types";

export function SwarmCanvas({
	workflow,
	isOpen,
	onClose,
	onAssignTask,
}: {
	workflow: SwarmWorkflow;
	isOpen: boolean;
	onClose(): void;
	onAssignTask?(member: SwarmMember, defaultPrompt?: string): void;
}) {
	const [activeTab, setActiveTab] = useState<"lanes" | "pipeline">("lanes");
	const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);

	const members = workflow.members;
	const steps = workflow.steps;

	// Group steps by memberId
	const stepsByMember = useMemo(() => {
		const map: Record<string, SwarmTaskStep[]> = {};
		for (const m of members) {
			map[m.id] = [];
		}
		for (const s of steps) {
			if (!map[s.memberId]) map[s.memberId] = [];
			map[s.memberId].push(s);
		}
		return map;
	}, [members, steps]);

	if (!isOpen) return null;

	return (
		<aside className="swarm-canvas-panel" role="region" aria-label="多智能体协同泳道看板">
			{/* Header */}
			<div className="swarm-header">
				<div className="swarm-header-title">
					<Users size={16} className="text-purple-400" />
					<span>多智能体协同泳道</span>
					<span className="swarm-badge-count">{members.length} 协同节点</span>
				</div>

				<div className="swarm-view-switch">
					<button
						type="button"
						className={`swarm-view-tab ${activeTab === "lanes" ? "active" : ""}`}
						onClick={() => setActiveTab("lanes")}
					>
						并行泳道
					</button>
					<button
						type="button"
						className={`swarm-view-tab ${activeTab === "pipeline" ? "active" : ""}`}
						onClick={() => setActiveTab("pipeline")}
					>
						流程拓扑
					</button>
				</div>

				<div className="swarm-header-actions">
					<button
						type="button"
						className="swarm-close-btn"
						title="关闭协同泳道"
						aria-label="关闭"
						onClick={onClose}
					>
						<X size={15} />
					</button>
				</div>
			</div>

			{/* Pipeline View */}
			{activeTab === "pipeline" && (
				<div className="swarm-pipeline-container">
					<div className="swarm-pipeline-track">
						{steps.length === 0 ? (
							<div className="swarm-empty-state">
								<Sparkles size={24} className="text-gray-400" />
								<p>暂无协同步骤记录，输入任务即可激活多智能体流水线</p>
							</div>
						) : (
							steps.map((step, idx) => {
								const roleMeta = SWARM_ROLE_META[step.role] || SWARM_ROLE_META.custom;
								return (
									<div key={step.id} className="swarm-pipeline-step-wrapper">
										<div className={`swarm-pipeline-node status-${step.status}`}>
											<div className="swarm-node-badge" style={{ backgroundColor: roleMeta.bg, color: roleMeta.color }}>
												<span>{roleMeta.icon}</span>
												<span>{roleMeta.label}</span>
											</div>
											<div className="swarm-node-title">{step.title}</div>
											{step.description && <div className="swarm-node-desc">{step.description}</div>}
											<div className="swarm-node-footer">
												<span className={`swarm-status-pill ${step.status}`}>
													{step.status === "completed" && <Check size={11} />}
													{step.status === "running" && <RefreshCw size={11} className="animate-spin" />}
													{step.status === "failed" && <X size={11} />}
													{step.status === "pending" && <Clock3 size={11} />}
													{step.status}
												</span>
											</div>
										</div>
										{idx < steps.length - 1 && (
											<div className="swarm-pipeline-arrow">
												<ChevronRight size={16} />
											</div>
										)}
									</div>
								);
							})
						)}
					</div>
				</div>
			)}

			{/* Swimlanes View */}
			{activeTab === "lanes" && (
				<div className="swarm-swimlanes-grid">
					{members.map((member) => {
						const meta = SWARM_ROLE_META[member.role] || SWARM_ROLE_META.custom;
						const memberSteps = stepsByMember[member.id] || [];
						const isSelected = selectedMemberId === member.id;

						return (
							<div
								key={member.id}
								className={`swarm-lane-column ${isSelected ? "selected" : ""}`}
								onClick={() => setSelectedMemberId(member.id)}
							>
								{/* Lane Header */}
								<div className="swarm-lane-header" style={{ borderTopColor: meta.color }}>
									<div className="swarm-lane-identity">
										<span className="swarm-lane-avatar">{meta.icon}</span>
										<div className="swarm-lane-info">
											<div className="swarm-lane-name">{member.name}</div>
											<div className="swarm-lane-role" style={{ color: meta.color }}>
												{meta.label}
											</div>
										</div>
									</div>

									<div className="swarm-lane-status">
										<span className={`swarm-pulse-dot ${member.status}`} />
										<span className="text-[11px] font-mono text-gray-400">
											{member.status === "running" ? "执行中" : member.status === "idle" ? "待命" : member.status}
										</span>
									</div>

									{/* Action to dispatch task */}
									{onAssignTask && (
										<button
											type="button"
											className="swarm-dispatch-btn"
											title={`向 ${member.name} 指派任务`}
											onClick={(e) => {
												e.stopPropagation();
												onAssignTask(member);
											}}
										>
											<Plus size={12} />
											<span>指派任务</span>
										</button>
									)}
								</div>

								{/* Lane Body / Steps */}
								<div className="swarm-lane-body">
									{memberSteps.length === 0 ? (
										<div className="swarm-lane-empty">
											<span className="text-[11px] text-gray-500">尚无指派步骤</span>
										</div>
									) : (
										memberSteps.map((step) => (
											<div key={step.id} className={`swarm-task-card status-${step.status}`}>
												<div className="swarm-task-header">
													<span className="swarm-task-title">{step.title}</span>
													<span className={`swarm-task-status-icon ${step.status}`}>
														{step.status === "completed" && <Check size={12} />}
														{step.status === "running" && <RefreshCw size={12} className="animate-spin" />}
														{step.status === "failed" && <X size={12} />}
													</span>
												</div>

												{step.description && (
													<p className="swarm-task-desc">{step.description}</p>
												)}

												{step.toolCalls && step.toolCalls.length > 0 && (
													<div className="swarm-task-tools">
														{step.toolCalls.map((tc, tidx) => (
															<span key={`${tc.name}-${tidx}`} className="swarm-tool-tag">
																<Wrench size={10} />
																{tc.name}
															</span>
														))}
													</div>
												)}
											</div>
										))
									)}
								</div>
							</div>
						);
					})}
				</div>
			)}
		</aside>
	);
}
