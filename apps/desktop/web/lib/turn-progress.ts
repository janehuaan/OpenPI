export type TurnProgressStage = "submitted" | "starting" | "thinking" | "responding" | "tool" | "reviewing" | "settled" | "error";

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
	/** 最近一次收到任何事件的时间：用来显示「最近活动 Xs 前」，区分「在推进」和「卡住」。 */
	lastEventAt?: number;
	/** 引擎侧护栏（工具预算 / 重复操作）给出的一句话。 */
	guardMessage?: string;
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
	reviewer?: unknown;
	status?: unknown;
	attempt?: unknown;
	mode?: unknown;
	/** `turn_guard` 事件：本轮工具调用次数 / 预算 / 提示语。 */
	toolCalls?: unknown;
	budget?: unknown;
	level?: unknown;
	message?: unknown;
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
	const next = reduceTurnProgressInner(current, event, now);
	// 任何一条事件都算「有动静」。UI 用它显示「最近活动 Xs 前」，
	// 这样用户能一眼分辨「在稳步推进」和「真的卡住了」。
	if (!next || next === current) return next;
	return { ...next, lastEventAt: now };
}

function reduceTurnProgressInner(
	current: TurnProgress | undefined,
	event: TurnProgressEvent,
	now = Date.now(),
): TurnProgress | undefined {
	const instanceId = event.instanceId;
	if (!current || current.instanceId !== instanceId) return current;
	const type = event.type;
	if (type === "turn_guard") {
		const message = typeof event.message === "string" ? event.message : undefined;
		const toolCalls = typeof event.toolCalls === "number" ? event.toolCalls : current.toolCount;
		return {
			...current,
			toolCount: toolCalls ?? current.toolCount,
			guardMessage: message ?? current.guardMessage,
		};
	}
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
	if (type === "review_start") {
		const reviewer = typeof event.reviewer === "string" ? event.reviewer : "第三方独立模型";
		const attempt = typeof event.attempt === "number" ? ` (第 ${event.attempt} 轮)` : "";
		const isAsync = event.mode === "async";
		return {
			...current,
			stage: "reviewing",
			label: isAsync
				? `🧐 ${reviewer} 正在后台质检… (不阻塞交互)`
				: `🧐 ${reviewer} 正在对方案与修改进行双盲质检${attempt}…`,
		};
	}
	if (type === "review_result") {
		const status = event.status;
		const reviewer = typeof event.reviewer === "string" ? event.reviewer : "评审模型";
		const isAsync = event.mode === "async";
		if (status === "rejected") {
			return {
				...current,
				stage: "reviewing",
				label: isAsync
					? `⚠️ ${reviewer} 质检提示已记录至对话`
					: `⚠️ ${reviewer} 质检驳回，主模型正在重新修正缺陷…`,
			};
		}
		if (status === "approved") {
			return {
				...current,
				stage: "responding",
				label: isAsync
					? `✅ ${reviewer} 质检通过`
					: `✅ ${reviewer} 质检通过，正在完成本轮交付…`,
			};
		}
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
	if (progress.stage === "reviewing") return "Reviewing";
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
