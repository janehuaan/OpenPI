import {
	ArrowLeft,
	Bot,
	CircleStop,
	Menu,
	Play,
	RefreshCw,
	Server,
	Square,
	Trash2,
} from "../../icons.tsx";
import { formatUptime, instanceTitle, shortWorkspacePath, statusLabel } from "../../../lib/helpers";
import type { DesktopSnapshot } from "../../../types";

export function DaemonSurface({
	snapshot,
	busy,
	onOpenSidebar,
	onClose,
	onStart,
	onStop,
	onRestart,
	onStopInstance,
	onPruneStopped,
}: {
	snapshot: DesktopSnapshot;
	busy?: string;
	onOpenSidebar(): void;
	onClose?(): void;
	onStart(): void;
	onStop(): void;
	onRestart(): void;
	onStopInstance(instanceId: string): void;
	onPruneStopped(): void;
}) {
	const activeTasks = snapshot.health?.tasksActive ?? snapshot.tasks.filter((task) => task.status === "active").length;
	const pausedTasks = snapshot.health?.tasksPaused ?? snapshot.tasks.filter((task) => task.status === "paused").length;
	const runningRuns = snapshot.health?.runsRunning ?? snapshot.runs.filter((run) => run.status === "running").length;
	const queuedRuns = snapshot.health?.runsQueued ?? snapshot.runs.filter((run) => run.status === "queued").length;
	const changingState =
		busy === "daemon-start" || busy === "daemon-stop" || busy === "daemon" || busy === "daemon-restart";
	const stats = snapshot.instanceStats;
	const healthMissing = snapshot.daemonRunning && !snapshot.health?.version && !snapshot.health?.uptimeMs;
	return (
		<section className="operations-surface">
			<header className="surface-header operation-page-header">
				{onClose ? (
					<button
						type="button"
						className="icon-button quiet"
						title="返回对话"
						aria-label="返回对话"
						onClick={onClose}
					>
						<ArrowLeft size={16} />
					</button>
				) : (
					<button
						className="icon-button quiet mobile-only"
						title="打开对话列表"
						aria-label="打开对话列表"
						onClick={onOpenSidebar}
					>
						<Menu size={18} />
					</button>
				)}
				<div className="surface-heading">
					<strong>运行时</strong>
					<span>后台服务是否在线，以及有多少助手进程</span>
				</div>
				<div className="surface-actions">
					<span className={`service-state header-state ${snapshot.daemonRunning ? "online" : "offline"}`}>
						<i />
						{snapshot.daemonRunning ? "在线" : "已停止"}
					</span>
				</div>
			</header>
			<div className="operations-scroll">
				<div className="operations-content product-page">
					<div className="daemon-status-band">
						<span className={`daemon-symbol ${snapshot.daemonRunning ? "online" : "offline"}`}>
							<Server size={20} />
						</span>
						<div>
							<span>本地服务</span>
							<strong>{snapshot.daemonRunning ? "可以正常对话与跑任务" : "服务已停止，对话会失败"}</strong>
							<small>{snapshot.health?.socketPath ?? "尚未连接本地 socket"}</small>
							{healthMissing && (
								<small className="health-hint">健康信息缺失：点「重启」加载当前 orchestrator 构建</small>
							)}
						</div>
						<div className="daemon-actions">
							{snapshot.daemonRunning ? (
								<>
									<button className="button" type="button" disabled={changingState} onClick={onRestart}>
										{busy === "daemon-restart" ? (
											<RefreshCw size={15} className="spin" />
										) : (
											<RefreshCw size={15} />
										)}
										重启
									</button>
									<button className="button danger" type="button" disabled={changingState} onClick={onStop}>
										{changingState && busy !== "daemon-restart" ? (
											<RefreshCw size={15} className="spin" />
										) : (
											<CircleStop size={15} />
										)}
										停止
									</button>
								</>
							) : (
								<button className="button primary" type="button" disabled={changingState} onClick={onStart}>
									{changingState ? <RefreshCw size={15} className="spin" /> : <Play size={15} />}
									启动服务
								</button>
							)}
						</div>
					</div>
					<div className="operations-metrics four">
						<div>
							<span>版本</span>
							<strong>{snapshot.health?.version ?? "—"}</strong>
						</div>
						<div>
							<span>运行时长</span>
							<strong>{snapshot.daemonRunning ? formatUptime(snapshot.health?.uptimeMs) : "已停止"}</strong>
						</div>
						<div>
							<span>定时任务</span>
							<strong>
								{activeTasks} 启用 <small>{pausedTasks} 暂停</small>
							</strong>
						</div>
						<div>
							<span>执行中</span>
							<strong>
								{runningRuns} 运行 <small>{queuedRuns} 排队</small>
							</strong>
						</div>
					</div>
					<div className="operation-panel">
						<div className="operation-panel-title">
							<h2>任务进度</h2>
						</div>
						<div className="task-progress-list">
							{(() => {
								// Task progress is shown via status segments, rendered inline below
								return <div className="task-progress-hint">查看状态栏中的"任务"segment 获取实时进度</div>;
							})()}
						</div>
					</div>
					<div className="operation-panel">
						<div className="operation-panel-title">
							<h2>事件日志</h2>
						</div>
						<div className="event-log">
							<div className="event-log-hint">工具调用和 compaction 事件将显示在这里</div>
						</div>
					</div>
					<div className="operation-panel daemon-instances">
						<div className="operation-panel-title">
							<div>
								<h2>助手进程</h2>
								<span>
									{stats
										? `${stats.active} 活跃 · ${stats.stopped} 已停 · 显示 ${stats.shown}`
										: `显示 ${snapshot.instances.length}`}
								</span>
							</div>
							{(stats?.stopped ?? 0) > 0 && (
								<button
									className="button"
									type="button"
									disabled={busy === "prune-stopped"}
									onClick={onPruneStopped}
								>
									{busy === "prune-stopped" ? <RefreshCw size={15} className="spin" /> : <Trash2 size={15} />}
									清理已停止
								</button>
							)}
						</div>
						<div className="operation-list">
							{snapshot.instances.length === 0 ? (
								<div className="operation-empty">
									<Server size={21} />
									<strong>还没有助手进程</strong>
									<span>新建或打开一个对话后，这里会出现对应进程。</span>
								</div>
							) : (
								snapshot.instances.map((instance) => (
									<div className="daemon-instance-row" key={instance.id}>
										<span className={`instance-symbol ${instance.status}`}>
											<Bot size={16} />
										</span>
										<div className="daemon-instance-body">
											<div className="daemon-instance-title">
												<strong>{instanceTitle(instance)}</strong>
												<span className={`instance-status ${instance.status}`}>
													{statusLabel(instance.status)}
												</span>
											</div>
											<div className="daemon-instance-meta" title={instance.cwd}>
												{shortWorkspacePath(instance.cwd)}
											</div>
											<code className="daemon-instance-id" title={instance.id}>
												{instance.id}
											</code>
										</div>
										{instance.status !== "stopped" && (
											<button
												className="icon-button quiet danger"
												type="button"
												title={`停止 ${instanceTitle(instance)}`}
												aria-label={`停止 ${instanceTitle(instance)}`}
												disabled={busy === "stop-instance"}
												onClick={() => onStopInstance(instance.id)}
											>
												<Square size={14} />
											</button>
										)}
									</div>
								))
							)}
						</div>
					</div>
				</div>
			</div>
		</section>
	);
}
