import { useCallback, useEffect, useMemo, useState } from "react";
import { desktopApi } from "../api.ts";
import type { TaskRun } from "../types.ts";
import type {
	ActionCardRecord,
	PersonalGoalRecord,
	PersonalMemoryRecord,
} from "./app-types.ts";

/**
 * 一条「最近活动」条目 —— 个人层事件流的统一形状。
 * Now / Activity / 常驻形象卡共用同一条实现，避免同一事实出现多个版本。
 */
export interface AgentActivityItem {
	id: string;
	time: string;
	label: string;
	detail?: string;
	kind: "card" | "run" | "goal";
}

export interface AgentOSState {
	loading: boolean;
	goals: PersonalGoalRecord[];
	memories: PersonalMemoryRecord[];
	actionCards: ActionCardRecord[];
	/** 待用户处理的建议卡片（status === "open"）。 */
	openCards: ActionCardRecord[];
	/** 「行动卡片 + 任务运行」合并出的真实活动流（时间倒序）。 */
	activity: AgentActivityItem[];
	reload: () => Promise<void>;
	executeCard: (card: ActionCardRecord) => Promise<{ success: boolean; message: string }>;
	dismissCard: (card: ActionCardRecord) => Promise<boolean>;
}

export function formatClock(iso?: string | null): string {
	if (!iso) return "";
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "";
	return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * 把「主动行动卡片 + 任务运行」两类真实事件合并成一条按时间倒序的活动流。
 * 这是 Activity / Now / 常驻形象卡共用的唯一实现（单一真源）。
 */
export function buildAgentActivity(
	actionCards: ActionCardRecord[] = [],
	taskRuns: TaskRun[] = [],
	limit = 6,
): AgentActivityItem[] {
	const raw: Array<{ ts: number; item: AgentActivityItem }> = [];
	for (const card of actionCards) {
		raw.push({
			ts: new Date(card.createdAt).getTime() || 0,
			item: {
				id: `card-${card.id}`,
				time: formatClock(card.createdAt),
				label: card.title,
				detail: card.summary,
				kind: "card",
			},
		});
	}
	for (const run of taskRuns) {
		const when = run.finishedAt || run.startedAt || run.createdAt;
		raw.push({
			ts: new Date(when).getTime() || 0,
			item: {
				id: `run-${run.id}`,
				time: formatClock(when),
				label: `任务运行 · ${run.status}`,
				detail: run.result || run.error || undefined,
				kind: "run",
			},
		});
	}
	raw.sort((a, b) => b.ts - a.ts);
	return raw.slice(0, limit).map((row) => row.item);
}

/**
 * 行动卡片要交给统一网关执行时用的上下文。
 * `payload` 是后端存的 JSON 字符串（例如 git_uncommitted 卡片会带 cwd/changedFiles）。
 */
export function actionCardPrompt(card: ActionCardRecord): string {
	try {
		const parsed = typeof card.payload === "string" ? JSON.parse(card.payload) : card.payload;
		const prompt = (parsed as { prompt?: unknown } | null)?.prompt;
		if (typeof prompt === "string" && prompt.trim()) return prompt.trim();
	} catch {
		// payload 不是 JSON 时静默回落到 summary
	}
	return card.summary || card.title;
}

/**
 * 行动卡片所属的仓库 / 目录名（`payload.cwd` 的 basename）。
 *
 * 后端对每种 action_type 会按 **cwd** 各留一张卡片（同一目录原地更新、不刷屏），
 * 所以「macosvir 的 9 个文件」和「openpi-next 的 1 个文件」本来就是两张不同的卡。
 * 但卡片标题完全一样，副标题里带上目录名，用户才不会把它们当成重复卡片。
 */
export function actionCardRepo(card: ActionCardRecord): string {
	try {
		const parsed = typeof card.payload === "string" ? JSON.parse(card.payload) : card.payload;
		const cwd = (parsed as { cwd?: unknown } | null)?.cwd;
		if (typeof cwd === "string" && cwd.trim()) {
			const parts = cwd.split(/[/\\]/).filter(Boolean);
			return parts.at(-1) ?? cwd;
		}
	} catch {
		// payload 不是 JSON 时静默忽略
	}
	return "";
}

/**
 * 一条「因果链」记录（Observed → Understood → Decision → Action → Result → Learned）。
 *
 * 只填**系统真的记录过**的字段：行动卡片只有 title/summary/actionType/status，
 * 任务运行只有 status/trigger/pid/result/error。没有任何一步是编的 ——
 * 系统没沉淀的那一步就留空，由 UI 显示「未记录」，而不是拿演示文案糊上去。
 */
export interface CausalChainEntry {
	id: string;
	time: string;
	observed: string;
	understood: string;
	decision: string;
	action: string;
	result: string;
	/** 系统目前不按事件沉淀学习结论，所以恒为空；保留字段是为了 UI 能如实标注。 */
	learned?: string;
	source: "card" | "run";
	/** 等待用户裁决的建议（open 卡片）。 */
	pending?: boolean;
}

function clockOf(iso?: string | null): number {
	if (!iso) return 0;
	const t = new Date(iso).getTime();
	return Number.isNaN(t) ? 0 : t;
}

function cardDecision(card: ActionCardRecord): string {
	if (card.status === "acted") return "已通过统一网关执行该建议";
	if (card.status === "dismissed") return "用户已忽略，归档不再提醒";
	return "等待用户裁决（尚未执行）";
}

function cardAction(card: ActionCardRecord): string {
	if (card.status === "acted") return `执行动作：${card.actionType}`;
	if (card.status === "dismissed") return "未执行任何动作";
	return `建议动作：${card.actionType}（未执行）`;
}

function cardResult(card: ActionCardRecord): string {
	if (card.status === "acted") return "已提交执行（网关回执未单独回写到卡片）";
	if (card.status === "dismissed") return "已忽略，无执行结果";
	return "尚无结果";
}

/**
 * 把「行动卡片 + 任务运行」两类真实事件整理成因果链（时间倒序）。
 * Activity 的因果时间线用它，替代此前写死的演示数据。
 */
export function buildCausalChain(
	actionCards: ActionCardRecord[] = [],
	taskRuns: TaskRun[] = [],
	limit = 20,
): CausalChainEntry[] {
	const rows: Array<{ ts: number; item: CausalChainEntry }> = [];

	for (const card of actionCards) {
		rows.push({
			ts: clockOf(card.createdAt),
			item: {
				id: `card-${card.id}`,
				time: formatClock(card.createdAt),
				observed: card.title,
				understood: card.summary || "（后端未附说明）",
				decision: cardDecision(card),
				action: cardAction(card),
				result: cardResult(card),
				source: "card",
				pending: card.status === "open",
			},
		});
	}

	for (const run of taskRuns) {
		const when = run.finishedAt || run.startedAt || run.createdAt;
		rows.push({
			ts: clockOf(when),
			item: {
				id: `run-${run.id}`,
				time: formatClock(when),
				observed: `任务运行 · ${run.status}`,
				understood: `任务 ${run.taskId}，触发方式：${run.trigger === "scheduled" ? "计划调度" : "用户手动"}`,
				decision: run.trigger === "scheduled" ? "按既定计划放行执行" : "响应用户手动触发",
				action: run.pid ? `启动子进程 PID ${run.pid}` : "启动执行进程（未记录 PID）",
				result: run.error ? `失败：${run.error}` : run.result || `状态：${run.status}`,
				source: "run",
			},
		});
	}

	rows.sort((a, b) => b.ts - a.ts);
	return rows.slice(0, limit).map((row) => row.item);
}

/**
 * Layer 3 · OS State Tree —— 个人智能层的单一真源。
 *
 * 订阅 `openpi:proactive` 事件，合并 active 目标 / 高置信记忆 / 行动卡片，
 * 输出一棵供 Now、Activity、常驻形象卡共同消费的状态树。
 * 注意：`list_personal_*` 返回的是 `{ goals }` / `{ memories }` / `{ cards }` 包装对象，
 * 不是裸数组（历史上有三处按裸数组解析，导致数据永远为空）。
 */
export function useAgentOS(options: { taskRuns?: TaskRun[]; enabled?: boolean } = {}): AgentOSState {
	const { taskRuns = [], enabled = true } = options;
	const [loading, setLoading] = useState(true);
	const [goals, setGoals] = useState<PersonalGoalRecord[]>([]);
	const [memories, setMemories] = useState<PersonalMemoryRecord[]>([]);
	const [actionCards, setActionCards] = useState<ActionCardRecord[]>([]);

	const reload = useCallback(async () => {
		if (!enabled) return;
		const [goalsRes, memoriesRes, cardsRes] = await Promise.allSettled([
			desktopApi.listPersonalGoals("active"),
			desktopApi.listPersonalMemories(undefined, 0.7, 20),
			desktopApi.listActionCards(undefined, 20),
		]);
		if (goalsRes.status === "fulfilled" && Array.isArray(goalsRes.value?.goals)) {
			setGoals(goalsRes.value.goals);
		}
		if (memoriesRes.status === "fulfilled" && Array.isArray(memoriesRes.value?.memories)) {
			setMemories(memoriesRes.value.memories);
		}
		if (cardsRes.status === "fulfilled" && Array.isArray(cardsRes.value?.cards)) {
			setActionCards(cardsRes.value.cards);
		}
	}, [enabled]);

	useEffect(() => {
		if (!enabled) return;
		let cancelled = false;
		void reload().finally(() => {
			if (!cancelled) setLoading(false);
		});
		const handler = () => void reload();
		window.addEventListener("openpi:proactive", handler);
		return () => {
			cancelled = true;
			window.removeEventListener("openpi:proactive", handler);
		};
	}, [enabled, reload]);

	const executeCard = useCallback(
		async (card: ActionCardRecord): Promise<{ success: boolean; message: string }> => {
			try {
				const res = await desktopApi.executeThroughGateway(
					actionCardPrompt(card),
					`proactive:${card.actionType}`,
				);
				// 执行成功后归档卡片：否则同一条建议会一直挂在主屏上反复催。
				if (res?.success) {
					await desktopApi.dismissActionCard(card.id).catch(() => {});
				}
				await reload();
				return { success: Boolean(res?.success), message: res?.message ?? "" };
			} catch (error) {
				return { success: false, message: error instanceof Error ? error.message : String(error) };
			}
		},
		[reload],
	);

	const dismissCard = useCallback(
		async (card: ActionCardRecord): Promise<boolean> => {
			try {
				await desktopApi.dismissActionCard(card.id);
			} catch {
				return false;
			}
			await reload();
			return true;
		},
		[reload],
	);

	const openCards = useMemo(() => actionCards.filter((card) => card.status === "open"), [actionCards]);
	const activity = useMemo(() => buildAgentActivity(actionCards, taskRuns, 6), [actionCards, taskRuns]);

	return {
		loading,
		goals,
		memories,
		actionCards,
		openCards,
		activity,
		reload,
		executeCard,
		dismissCard,
	};
}
