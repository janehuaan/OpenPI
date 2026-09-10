import type { ConversationMessage } from "../types";

export type SwarmRole = "lead" | "coder" | "tester" | "auditor" | "researcher" | "custom";

export interface SwarmMember {
	id: string;
	name: string;
	role: SwarmRole;
	avatar?: string;
	status: "idle" | "running" | "completed" | "error" | "waiting";
	currentTask?: string;
	model?: string;
	completedTasksCount: number;
	totalDurationMs?: number;
}

export interface SwarmToolCall {
	name: string;
	args?: string;
	resultSummary?: string;
	durationMs?: number;
}

export interface SwarmTaskStep {
	id: string;
	memberId: string;
	role: SwarmRole;
	title: string;
	description?: string;
	status: "pending" | "running" | "completed" | "failed";
	startedAt?: number;
	finishedAt?: number;
	toolCalls?: SwarmToolCall[];
	outputSummary?: string;
}

export interface SwarmWorkflow {
	id: string;
	title: string;
	members: SwarmMember[];
	steps: SwarmTaskStep[];
	activeMemberId?: string;
}

export const SWARM_ROLE_META: Record<
	SwarmRole,
	{ label: string; icon: string; color: string; bg: string; borderColor: string; description: string }
> = {
	lead: {
		label: "总架构师",
		icon: "🧠",
		color: "#a855f7",
		bg: "rgba(168, 85, 247, 0.12)",
		borderColor: "rgba(168, 85, 247, 0.35)",
		description: "任务分解、架构把控与整体决策调度",
	},
	coder: {
		label: "核心编码员",
		icon: "💻",
		color: "#3b82f6",
		bg: "rgba(59, 130, 246, 0.12)",
		borderColor: "rgba(59, 130, 246, 0.35)",
		description: "功能代码实现、重构与文件修改",
	},
	tester: {
		label: "质量测试员",
		icon: "🧪",
		color: "#10b981",
		bg: "rgba(16, 185, 129, 0.12)",
		borderColor: "rgba(16, 185, 129, 0.35)",
		description: "执行单元测试、回归校验与运行断言",
	},
	auditor: {
		label: "安全审计员",
		icon: "🛡️",
		color: "#f59e0b",
		bg: "rgba(245, 158, 11, 0.12)",
		borderColor: "rgba(245, 158, 11, 0.35)",
		description: "门禁审查、风险阻断与合规检测",
	},
	researcher: {
		label: "代码检索员",
		icon: "🔍",
		color: "#06b6d4",
		bg: "rgba(6, 182, 212, 0.12)",
		borderColor: "rgba(6, 182, 212, 0.35)",
		description: "符号索引、上下文调研与依赖摸排",
	},
	custom: {
		label: "协同专家",
		icon: "🤖",
		color: "#ec4899",
		bg: "rgba(236, 72, 153, 0.12)",
		borderColor: "rgba(236, 72, 153, 0.35)",
		description: "定制领域专项任务智能体",
	},
};

/**
 * Parses conversation messages and tool calls into a structured multi-agent swarm workflow.
 */
export function extractSwarmFromMessages(
	messages: ConversationMessage[],
	currentModel?: string,
	isWorking?: boolean,
): SwarmWorkflow {
	const defaultMembers: SwarmMember[] = [
		{
			id: "agent-lead",
			name: "Lead Architect",
			role: "lead",
			avatar: "🧠",
			status: isWorking ? "running" : "idle",
			currentTask: isWorking ? "统筹分析与协调" : undefined,
			model: currentModel || "Default Model",
			completedTasksCount: 0,
		},
		{
			id: "agent-coder",
			name: "Core Coder",
			role: "coder",
			avatar: "💻",
			status: "idle",
			model: currentModel,
			completedTasksCount: 0,
		},
		{
			id: "agent-tester",
			name: "QA Tester",
			role: "tester",
			avatar: "🧪",
			status: "idle",
			model: currentModel,
			completedTasksCount: 0,
		},
		{
			id: "agent-auditor",
			name: "Security Auditor",
			role: "auditor",
			avatar: "🛡️",
			status: "idle",
			model: currentModel,
			completedTasksCount: 0,
		},
	];

	const steps: SwarmTaskStep[] = [];
	let stepCounter = 1;

	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i];
		if (!msg) continue;

		if (msg.role === "user") {
			const text = typeof msg.content === "string" ? msg.content : "";
			steps.push({
				id: `step-${stepCounter++}`,
				memberId: "agent-lead",
				role: "lead",
				title: "需求分解与架构规划",
				description: text.slice(0, 120),
				status: "completed",
			});
			continue;
		}

		if (msg.role === "assistant" && Array.isArray(msg.toolCalls) && msg.toolCalls.length > 0) {
			for (const call of msg.toolCalls) {
				const toolName = (call.name || "").toLowerCase();
				let assignedRole: SwarmRole = "lead";
				let assignedMemberId = "agent-lead";

				if (toolName.includes("test") || toolName.includes("assert") || toolName.includes("verify")) {
					assignedRole = "tester";
					assignedMemberId = "agent-tester";
				} else if (
					toolName.includes("edit") ||
					toolName.includes("write") ||
					toolName.includes("replace") ||
					toolName.includes("diff")
				) {
					assignedRole = "coder";
					assignedMemberId = "agent-coder";
				} else if (
					toolName.includes("guard") ||
					toolName.includes("risk") ||
					toolName.includes("audit") ||
					toolName.includes("rollback")
				) {
					assignedRole = "auditor";
					assignedMemberId = "agent-auditor";
				} else if (
					toolName.includes("search") ||
					toolName.includes("find") ||
					toolName.includes("grep") ||
					toolName.includes("symbol")
				) {
					assignedRole = "researcher";
					assignedMemberId = "agent-lead";
				}

				const member = defaultMembers.find((m) => m.id === assignedMemberId);
				if (member) {
					member.completedTasksCount++;
				}

				steps.push({
					id: `step-${stepCounter++}`,
					memberId: assignedMemberId,
					role: assignedRole,
					title: `执行工具: ${call.name}`,
					description: call.result || undefined,
					status: msg.isError ? "failed" : "completed",
					toolCalls: [
						{
							name: call.name,
							resultSummary: call.result,
						},
					],
				});
			}
		}
	}

	if (isWorking) {
		const lastStep = steps[steps.length - 1];
		if (lastStep) {
			lastStep.status = "running";
			const member = defaultMembers.find((m) => m.id === lastStep.memberId);
			if (member) {
				member.status = "running";
				member.currentTask = lastStep.title;
			}
		}
	}

	return {
		id: "swarm-active",
		title: "实时智能体协同泳道",
		members: defaultMembers,
		steps,
		activeMemberId: isWorking ? "agent-coder" : undefined,
	};
}
