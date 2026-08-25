export type TurnProgressStage = "submitted" | "starting" | "thinking" | "responding" | "tool" | "settled" | "error";

export interface TurnProgress {
	instanceId: string;
	stage: TurnProgressStage;
	label: string;
	startedAt: number;
	toolName?: string;
}

export type TurnProgressEvent = {
	instanceId: string;
	type?: string;
	assistantMessageEvent?: { type?: string };
	toolName?: unknown;
	toolCallId?: unknown;
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
};

export function toolLabel(toolName: string): string {
	const normalized = toolName.toLowerCase().replace(/[-\s]/g, "_");
	return TOOL_LABELS[normalized] ?? `使用 ${toolName}`;
}

export function initialTurnProgress(instanceId: string, now = Date.now()): TurnProgress {
	return { instanceId, stage: "submitted", label: "已提交，正在连接代理…", startedAt: now };
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
	if (type === "turn_start") return { ...current, stage: "thinking", label: "正在思考…" };
	if (type === "tool_execution_start" || type === "tool_execution_update") {
		const name = typeof event.toolName === "string" ? event.toolName : undefined;
		return { ...current, stage: "tool", label: name ? toolLabel(name) : "正在执行工具…", toolName: name };
	}
	if (type === "tool_execution_end")
		return { ...current, stage: "thinking", label: "继续处理中…", toolName: undefined };
	if (type === "message_update" || type === "message_start") {
		const messageType = event.assistantMessageEvent?.type;
		if (messageType === "thinking_delta") return { ...current, stage: "thinking", label: "正在思考…" };
		if (messageType === "text_delta") return { ...current, stage: "responding", label: "正在组织回复…" };
		if (messageType === "toolcall_delta") return { ...current, stage: "tool", label: "正在准备工具调用…" };
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
