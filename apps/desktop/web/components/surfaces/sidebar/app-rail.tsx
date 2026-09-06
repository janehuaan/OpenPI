import {
	Blocks,
	BookOpen,
	BrainCircuit,
	GitBranch,
	ListTodo,
	MessageSquare,
	Server,
} from "../../icons.tsx";
import type { TaskDefinition, TaskRun } from "../../../types";

export type MoreView = "tasks" | "capabilities" | "memory" | "intelligence" | "daemon" | "git";

export const MORE_ITEMS: Array<{ id: MoreView; label: string; hint: string; icon: typeof BookOpen }> = [
	{ id: "git", label: "版本管理", hint: "Git 仓库与变更管理", icon: GitBranch },
	{ id: "memory", label: "记忆", hint: "跨对话记住的偏好", icon: BookOpen },
	{ id: "tasks", label: "定时任务", hint: "后台自动化", icon: ListTodo },
	{ id: "capabilities", label: "能力与扩展", hint: "技能 / MCP / 工具", icon: Blocks },
	{ id: "intelligence", label: "智能规划", hint: "多步计划记录", icon: BrainCircuit },
	{ id: "daemon", label: "运行时", hint: "本地服务状态", icon: Server },
];

export function AppRail({
	activeView,
	tasks,
	runs,
	daemonRunning,
	gitChangedCount,
	onNavigate,
}: {
	activeView: MoreView | "chat";
	tasks: TaskDefinition[];
	runs: TaskRun[];
	daemonRunning: boolean;
	gitChangedCount?: number;
	onNavigate(view: MoreView | "chat"): void;
}) {
	const activeRuns = runs.filter((run) => run.status === "running" || run.status === "queued").length;
	return (
		<aside className="app-rail" aria-label="主导航">
			<button
				type="button"
				className="brand-mark"
				data-label="OpenPI"
				title="OpenPI"
				onClick={() => onNavigate("chat")}
			>
				π
			</button>
			<nav className="rail-navigation" aria-label="页面">
				<button
					type="button"
					className={`rail-button ${activeView === "chat" ? "active" : ""}`}
					data-label="对话"
					title="对话"
					onClick={() => onNavigate("chat")}
				>
					<MessageSquare size={18} />
				</button>
				{MORE_ITEMS.map((item) => {
					const Icon = item.icon;
					const count = item.id === "tasks" ? activeRuns || tasks.length : item.id === "git" ? (gitChangedCount || 0) : 0;
					return (
						<button
							type="button"
							className={`rail-button ${activeView === item.id ? "active" : ""} ${item.id === "daemon" && daemonRunning ? "online" : ""}`}
							data-label={item.label}
							title={item.label}
							key={item.id}
							onClick={() => onNavigate(item.id)}
						>
							<Icon size={18} />
							{count > 0 && <span className="rail-count">{count > 9 ? "9+" : count}</span>}
							{item.id === "daemon" && <span className="rail-status" />}
						</button>
					);
				})}
			</nav>
		</aside>
	);
}
