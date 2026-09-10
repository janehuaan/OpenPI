import type { TaskDefinition, TaskRun } from "../../../types";
import type { MoreView } from "./app-rail";

export function SidebarHeader({
	activeView: _activeView,
	tasks: _tasks,
	runs: _runs,
	daemonRunning: _daemonRunning,
	onNavigate,
}: {
	activeView: MoreView | "chat";
	tasks: TaskDefinition[];
	runs: TaskRun[];
	daemonRunning: boolean;
	onNavigate(view: MoreView | "chat"): void;
}) {
	return (
		<div className="sidebar-header">
			<button type="button" className="sidebar-brand" title="OpenPI" onClick={() => onNavigate("chat")}>
				<span className="sidebar-brand-mark">π</span>
				<span className="sidebar-brand-text">
					<strong>OpenPI</strong>
					<span>智能编程助理</span>
				</span>
			</button>
		</div>
	);
}
