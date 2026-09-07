import {
	ArrowLeft,
	BrainCircuit,
	ChevronRight,
	FileJson,
	Menu,
	RefreshCw,
	TerminalSquare,
} from "../../icons.tsx";
import { formatUptime, parseCommand, prettyJson, shortWorkspacePath } from "../../../lib/helpers";

export { parseCommand, formatUptime };

export function IntelligenceSurface({
	workspace,
	runs,
	commands,
	selectedRunId,
	detail,
	busy,
	onOpenSidebar,
	onClose,
	onRefresh,
	onSelectRun,
}: {
	workspace?: string;
	runs: string[];
	commands: string[];
	selectedRunId?: string;
	detail: string;
	busy?: string;
	onOpenSidebar(): void;
	onClose?(): void;
	onRefresh(): void;
	onSelectRun(runId: string): void;
}) {
	const parsedCommands = commands.map(parseCommand);
	const refreshing = busy === "intelligence-refresh";
	const workspaceLabel = workspace ? shortWorkspacePath(workspace) : "未选择工作区";
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
						title="对话列表"
						aria-label="对话列表"
						onClick={onOpenSidebar}
					>
						<Menu size={18} />
					</button>
				)}
				<div className="surface-heading">
					<strong>智能规划</strong>
					<span>复杂任务的计划与执行记录 · {workspaceLabel}</span>
				</div>
				<div className="surface-actions">
					{runs.length > 0 && <span className="memory-count-pill">{runs.length} 次规划</span>}
					<button
						className="icon-button quiet"
						title="刷新"
						aria-label="刷新"
						disabled={refreshing}
						onClick={onRefresh}
					>
						<RefreshCw size={17} className={refreshing ? "spin" : undefined} />
					</button>
				</div>
			</header>
			<div className="operations-scroll">
				<div className="operations-content intelligence-content product-page">
					{runs.length === 0 ? (
						<div className="product-empty large">
							<BrainCircuit size={32} />
							<strong>还没有规划记录</strong>
							<span>
								在对话里让助手做多步骤任务时，会在这里留下计划清单。也可以在聊天输入 <code>/intel</code>{" "}
								相关命令（若已启用）。
							</span>
							{parsedCommands.length > 0 && (
								<div className="command-grid empty-commands">
									{parsedCommands.slice(0, 6).map((command) => (
										<div className="command-row" key={`${command.name}-${command.description}`}>
											<code>{command.name}</code>
											<span>{command.description}</span>
										</div>
									))}
								</div>
							)}
						</div>
					) : (
						<>
							<div className="intelligence-workspace">
								<div className="operation-panel intelligence-runs">
									<div className="operation-panel-title">
										<div>
											<h2>规划历史</h2>
											<span>点一条查看详情</span>
										</div>
										<FileJson size={16} />
									</div>
									<div className="run-browser-list">
										{[...runs].reverse().map((runId) => (
											<button
												className={`intelligence-run-row ${selectedRunId === runId ? "selected" : ""}`}
												type="button"
												key={runId}
												onClick={() => onSelectRun(runId)}
											>
												<span className="run-document">
													<FileJson size={15} />
												</span>
												<span>
													<strong>{runId}</strong>
													<small>计划详情</small>
												</span>
												<ChevronRight size={15} />
											</button>
										))}
									</div>
								</div>
								<div className="operation-panel intelligence-detail">
									<div className="operation-panel-title">
										<div>
											<h2>{selectedRunId ?? "详情"}</h2>
											<span>{selectedRunId ? "结构化执行计划" : "从左侧选一条"}</span>
										</div>
										{busy === "intelligence-detail" ? (
											<RefreshCw size={16} className="spin" />
										) : (
											<TerminalSquare size={16} />
										)}
									</div>
									<pre>{prettyJson(detail)}</pre>
								</div>
							</div>
							{parsedCommands.length > 0 && (
								<div className="operation-panel command-panel">
									<div className="operation-panel-title">
										<div>
											<h2>对话命令</h2>
											<span>当前会话可用的斜杠命令</span>
										</div>
										<TerminalSquare size={16} />
									</div>
									<div className="command-grid">
										{parsedCommands.map((command) => (
											<div className="command-row" key={`${command.name}-${command.description}`}>
												<code>{command.name}</code>
												<span>{command.description}</span>
											</div>
										))}
									</div>
								</div>
							)}
						</>
					)}
				</div>
			</div>
		</section>
	);
}
