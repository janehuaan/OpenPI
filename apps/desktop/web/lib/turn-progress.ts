export type TurnProgressStage = "submitted" | "starting" | "thinking" | "responding" | "tool" | "settled" | "error";

export interface TurnProgress {
	instanceId: string;
	stage: TurnProgressStage;
	label: string;
	startedAt: number;
	step?: number;
	maxSteps?: number;
	model?: string;
	toolName?: string;
	toolCount?: number;
	lastToolName?: string;
}

export type TurnProgressEvent = {
	instanceId: string;
	type?: string;
	assistantMessageEvent?: { type?: string };
	toolName?: unknown;
	toolCallId?: unknown;
	step?: number;
	maxSteps?: number;
	model?: string;
	error?: unknown;
};

const TOOL_LABELS: Record<string, string> = {
	read: "读取文件",
	grep: "搜索内容",
	find: "查找文件",
	glob: "匹配文件",
	search: "搜索",
	bash: "运行命令",
	edit: "编辑文件",
	write: "写入文件",
	apply_patch: "应用补丁",
	subagent: "调度子代理",
	subagent_status: "检查子代理状态",
	subagent_stop: "终止子代理",
	subagent_risk: "评估子代理风险",
	browser: "浏览器操作",
	web_search: "网络搜索",
	web_fetch: "获取网页",
	task: "任务规划",
	mcp: "调用 MCP",
	mcp_script: "执行 MCP 脚本",
};

export function toolLabel(toolName: string): string {
	const normalized = toolName.toLowerCase().replace(/[-\s]/g, "_");
	return TOOL_LABELS[normalized] ?? `使用 ${toolName}`;
}

export function initialTurnProgress(instanceId: string, now = Date.now()): TurnProgress {
	return { instanceId, stage: "submitted", label: "已提交，正在连接代理…", startedAt: now, toolCount: 0 };
}

export function submittedTurnProgress(instanceId: string, now = Date.now()): TurnProgress {
	return initialTurnProgress(instanceId, now);
}

export function reduceTurnProgress(
	current: TurnProgress | undefined,
	event: TurnProgressEvent,
	now = Date.now(),
): TurnProgress | undefined {
	const instanceId = event.instanceId;
	if (!current || current.instanceId !== instanceId) return current;
	const type = event.type;
	if (type === "agent_start") return { ...current, stage: "starting", label: "代理已启动，准备处理中…" };
	if (type === "turn_start") {
		const step = typeof event.step === "number" ? event.step : current.step;
		const maxSteps = typeof event.maxSteps === "number" ? event.maxSteps : current.maxSteps;
		const model = typeof event.model === "string" ? event.model : current.model;
		const isInitial = !step || step <= 1;
		return {
			...current,
			stage: "thinking",
			label: isInitial ? "正在思考…" : `第 ${step} 步思考与规划中…`,
			step,
			maxSteps,
			model,
			toolCount: isInitial ? 0 : current.toolCount,
		};
	}
	if (type === "message_start") {
		const hasExecutedTools = (current.toolCount ?? 0) > 0;
		return {
			...current,
			stage: "thinking",
			label: hasExecutedTools ? "已完成工具调用，正在分析结果并规划下一步…" : (current.label === "代理已启动，准备处理中…" ? "正在思考…" : (current.label || "正在思考…")),
		};
	}
	if (type === "tool_execution_start" || type === "tool_execution_update") {
		const name = typeof event.toolName === "string" ? event.toolName : undefined;
		const isSubagent = name === "subagent";
		return {
			...current,
			stage: "tool",
			label: isSubagent ? "🤖 正在执行独立子任务…" : name ? toolLabel(name) : "正在执行工具…",
			toolName: name,
			lastToolName: name ?? current.lastToolName,
		};
	}
	if (type === "tool_execution_end") {
		const count = (current.toolCount ?? 0) + 1;
		const lastLabel = current.toolName ? toolLabel(current.toolName) : current.lastToolName ? toolLabel(current.lastToolName) : undefined;
		return {
			...current,
			stage: "thinking",
			label: lastLabel ? `已完成${lastLabel}，分析结果中…` : "继续处理中…",
			toolName: undefined,
			toolCount: count,
		};
	}
	if (type === "message_update") {
		const messageType = event.assistantMessageEvent?.type;
		if (
			messageType === "thinking_delta" ||
			messageType === "thinking_start" ||
			messageType === "reasoning_delta" ||
			messageType === "reasoning_start"
		) {
			const hasExecutedTools = (current.toolCount ?? 0) > 0;
			return {
				...current,
				stage: "thinking",
				label: hasExecutedTools ? "结合执行结果深入思考中…" : "正在思考…",
			};
		}
		if (messageType === "text_delta") return { ...current, stage: "responding", label: "正在组织回复…" };
		if (messageType === "toolcall_delta") return { ...current, stage: "tool", label: "正在准备下一步操作…" };
	}
	if (type === "agent_settled") return undefined;
	if (type === "stream_error" || type === "stream_closed" || type === "abort" || type === "send_error")
		return undefined;
	return { ...current, startedAt: current.startedAt || now };
}

export function turnProgressFromEvent(
	current: TurnProgress | undefined,
	event: TurnProgressEvent,
	now = Date.now(),
): TurnProgress | undefined {
	return reduceTurnProgress(current, event, now);
}

/**
 * The short English activity verb for a turn. Both the main window's progress row
 * and the island render this, so the two surfaces always name the same activity
 * the same way — the Chinese `label` above is diagnostic copy, not display copy.
 */
export function turnVerb(progress: TurnProgress | undefined, seconds: number): string {
	if (!progress) return "Reasoning";
	if (progress.stage === "tool") {
		const tool = (progress.toolName || "").toLowerCase();
		if (tool.includes("bash") || tool.includes("terminal") || tool.includes("exec")) return "Executing";
		if (tool.includes("read") || tool.includes("find") || tool.includes("grep") || tool.includes("search"))
			return "Investigating";
		if (tool.includes("edit") || tool.includes("write") || tool.includes("patch")) return "Refactoring";
		if (tool.includes("subagent")) return "Orchestrating";
		if (tool.includes("mcp")) return "Interfacing";
		return "Operating";
	}
	if (progress.stage === "responding") return "Formulating";
	if (seconds >= 12) return "Illuminating";
	if (seconds >= 6) return "Synthesizing";
	if (seconds >= 3) return "Analyzing";
	return "Reasoning";
}
