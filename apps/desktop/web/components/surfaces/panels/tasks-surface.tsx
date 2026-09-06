import {
	Check,
	ChevronRight,
	CircleStop,
	Clock3,
	Folder,
	History,
	ListTodo,
	Menu,
	Pause,
	Play,
	Plus,
	RefreshCw,
	Search,
	TerminalSquare,
	Trash2,
	X,
} from "../../icons.tsx";
import type { TaskFilter } from "../../../lib/app-types";
import { formatDate, scheduleLabel, shortWorkspacePath, statusLabel } from "../../../lib/helpers";
import type { TaskDefinition, TaskRun } from "../../../types";
import { TaskDagFlow } from "./task-dag-flow.tsx";

export function TasksSurface({
	tasks,
	taskCount,
	selectedTask,
	taskRuns,
	selectedRun,
	filter,
	query,
	log,
	busy,
	onFilterChange,
	onQueryChange,
	onSelectTask,
	onSelectRun,
	onNew,
	onOpenSidebar,
	onRun,
	onPause,
	onDelete,
	onCancel,
	onLoadLog,
}: {
	tasks: TaskDefinition[];
	taskCount: number;
	selectedTask?: TaskDefinition;
	taskRuns: TaskRun[];
	selectedRun?: TaskRun;
	filter: TaskFilter;
	query: string;
	log?: string;
	busy?: string;
	onFilterChange(filter: TaskFilter): void;
	onQueryChange(value: string): void;
	onSelectTask(taskId: string): void;
	onSelectRun(runId: string): void;
	onNew(): void;
	onOpenSidebar(): void;
	onRun(taskId: string): Promise<unknown>;
	onPause(taskId: string, paused: boolean): Promise<unknown>;
	onDelete(taskId: string): Promise<unknown>;
	onCancel(runId: string): Promise<unknown>;
	onLoadLog(run: TaskRun, stream: "stdout" | "stderr"): Promise<void>;
}) {
	return (
		<section className="tasks-surface">
			<header className="surface-header task-page-header">
				<button
					className="icon-button quiet mobile-only"
					title="Open conversations"
					aria-label="Open conversations"
					onClick={onOpenSidebar}
				>
					<Menu size={18} />
				</button>
				<div className="surface-heading">
					<strong>定时任务</strong>
					<span>{taskCount === 0 ? "还没有自动化" : `${taskCount} 个任务`}</span>
				</div>
				<button type="button" className="button primary" onClick={onNew}>
					<Plus size={16} />
					新建任务
				</button>
			</header>
			<div className="tasks-workspace">
				<aside className="task-browser">
					<div className="search-box">
						<Search size={15} />
						<input value={query ?? ""} onChange={(event) => onQueryChange(event.target.value)} placeholder="搜索任务" />
					</div>
					<div className="segmented">
						{(
							[
								["all", "全部"],
								["active", "启用"],
								["paused", "暂停"],
							] as const
						).map(([value, label]) => (
							<button
								type="button"
								key={value}
								className={filter === value ? "active" : ""}
								onClick={() => onFilterChange(value)}
							>
								{label}
							</button>
						))}
					</div>
					<div className="task-list">
						{tasks.map((task) => (
							<button
								type="button"
								key={task.id}
								className={`task-row ${selectedTask?.id === task.id ? "selected" : ""}`}
								onClick={() => onSelectTask(task.id)}
							>
								<span className={`task-status ${task.status}`} />
								<span>
									<strong>{task.title}</strong>
									<small>{task.nextRunAt ? formatDate(task.nextRunAt) : "已暂停"}</small>
								</span>
								<ChevronRight size={15} />
							</button>
						))}
						{tasks.length === 0 && (
							<div className="product-empty compact">
								<Clock3 size={22} />
								<strong>没有任务</strong>
								<span>用定时任务做日报、巡检、提醒。点右上角「新建任务」。</span>
							</div>
						)}
					</div>
				</aside>

				<div className="task-detail">
					{selectedTask ? (
						<>
							<div className="task-detail-header">
								<div>
									<span className="eyebrow">自动化</span>
									<h1>{selectedTask.title}</h1>
									<p>{selectedTask.prompt}</p>
								</div>
								<div className="detail-actions">
									<button
										type="button"
										className="button primary"
										disabled={Boolean(busy)}
										onClick={() => void onRun(selectedTask.id)}
									>
										<Play size={15} />
										立即运行
									</button>
									<button
										type="button"
										className="icon-button"
										title={selectedTask.status === "active" ? "暂停" : "恢复"}
										aria-label={selectedTask.status === "active" ? "暂停" : "恢复"}
										onClick={() => void onPause(selectedTask.id, selectedTask.status === "active")}
									>
										{selectedTask.status === "active" ? <Pause size={17} /> : <Play size={17} />}
									</button>
									<button
										type="button"
										className="icon-button danger"
										title="删除"
										aria-label="删除"
										onClick={() => {
											if (window.confirm(`删除「${selectedTask.title}」？`)) void onDelete(selectedTask.id);
										}}
									>
										<Trash2 size={17} />
									</button>
								</div>
							</div>
							<div className="metadata-strip">
								<div>
									<span>状态</span>
									<strong className={`text-status ${selectedTask.status}`}>
										{statusLabel(selectedTask.status)}
									</strong>
								</div>
								<div>
									<span>计划</span>
									<strong>{scheduleLabel(selectedTask)}</strong>
								</div>
								<div>
									<span>下次运行</span>
									<strong>{formatDate(selectedTask.nextRunAt)}</strong>
								</div>
								<div>
									<span>工作区</span>
									<strong className="path">
										<Folder size={14} />
										{selectedTask.cwd ? shortWorkspacePath(selectedTask.cwd) : "默认"}
									</strong>
								</div>
							</div>
							<TaskDagFlow task={selectedTask} run={selectedRun || taskRuns[0]} />
							<div className="task-run-grid">
								<section className="runs-panel">
									<div className="section-title">
										<div>
											<h2>运行历史</h2>
											<span>{taskRuns.length} 次</span>
										</div>
										<History size={17} />
									</div>
									<div className="run-list">
										{taskRuns.map((run) => (
											<button
												type="button"
												key={run.id}
												className={`run-row ${selectedRun?.id === run.id ? "selected" : ""}`}
												onClick={() => onSelectRun(run.id)}
											>
												<span className={`run-icon ${run.status}`}>
													{run.status === "succeeded" ? (
														<Check size={14} />
													) : run.status === "running" ? (
														<RefreshCw size={14} className="spin" />
													) : (
														<X size={14} />
													)}
												</span>
												<span>
													<strong>{statusLabel(run.status)}</strong>
													<small>
														{formatDate(run.startedAt ?? run.createdAt)} ·{" "}
														{run.trigger === "manual" ? "手动" : "定时"}
													</small>
												</span>
												<code>{run.id.slice(0, 8)}</code>
											</button>
										))}
										{taskRuns.length === 0 && (
											<div className="panel-empty">
												<TerminalSquare size={25} />
												<strong>还没有运行过</strong>
												<span>点「立即运行」试一次</span>
											</div>
										)}
									</div>
								</section>
								<section className="output-panel">
									<div className="section-title">
										<div>
											<h2>输出</h2>
											<span>{selectedRun?.id ?? "选一次运行"}</span>
										</div>
										{selectedRun?.status === "running" && (
											<button
												type="button"
												className="button danger"
												onClick={() => void onCancel(selectedRun.id)}
											>
												<CircleStop size={15} />
												取消
											</button>
										)}
									</div>
									{selectedRun ? (
										<>
											<div className="output-summary">
												<span className={`run-chip ${selectedRun.status}`}>
													{statusLabel(selectedRun.status)}
												</span>
												<span>退出码 {selectedRun.exitCode ?? "—"}</span>
												<span>{formatDate(selectedRun.finishedAt)}</span>
											</div>
											<div className="log-tabs">
												<button onClick={() => void onLoadLog(selectedRun, "stdout")}>stdout</button>
												<button onClick={() => void onLoadLog(selectedRun, "stderr")}>stderr</button>
											</div>
											<pre>{log ?? selectedRun.result ?? selectedRun.error ?? "暂无输出。"}</pre>
										</>
									) : (
										<div className="panel-empty">
											<TerminalSquare size={25} />
											<strong>选一次运行</strong>
										</div>
									)}
								</section>
							</div>
						</>
					) : (
						<div className="task-empty product-empty large">
							<ListTodo size={32} />
							<strong>还没选任务</strong>
							<span>从左侧选一个，或新建一个会自动跑的助手任务。</span>
							<button type="button" className="button primary" onClick={onNew}>
								<Plus size={16} />
								新建任务
							</button>
						</div>
					)}
				</div>
			</div>
		</section>
	);
}
