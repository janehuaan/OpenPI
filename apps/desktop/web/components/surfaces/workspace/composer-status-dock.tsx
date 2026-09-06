import type { GitStatusResult } from "../../../types";
import { fmtCost, fmtTokens } from "../../../lib/helpers";
import {
	AlertCircle,
	ArrowDown,
	ArrowUp,
	Check,
	Cpu,
	GitBranch,
	RefreshCw,
	Sparkles,
} from "../../icons.tsx";

export interface TokenStatsData {
	inputTokens?: number;
	outputTokens?: number;
	totalTokens?: number;
	contextTokens?: number;
	contextWindow?: number;
	contextPercent?: number;
	cacheRead?: number;
	cacheWrite?: number;
	cacheHitPercent?: number;
	cost?: number;
	isWorking?: boolean;
}

export interface ComposerStatusDockProps {
	gitStatus?: GitStatusResult | null;
	loading?: boolean;
	onRefreshGit?: () => void;
	onOpenGit?: () => void;
	tokenStats?: TokenStatsData;
	onOpenContextPanel?: () => void;
	/**
	 * Extensible slot for developing new custom data widgets below the input box.
	 */
	extraDataSlot?: React.ReactNode;
	className?: string;
}

export function ComposerStatusDock({
	gitStatus,
	loading = false,
	onRefreshGit,
	onOpenGit,
	tokenStats,
	onOpenContextPanel,
	extraDataSlot,
	className = "",
}: ComposerStatusDockProps) {
	const isRepo = gitStatus?.isRepo ?? false;
	const branch = gitStatus?.branch || "main";
	const files = gitStatus?.files || [];

	const stagedCount = files.filter((f) => f.staged).length;
	const unstagedCount = files.filter((f) => !f.staged && f.status !== "untracked").length;
	const untrackedCount = files.filter((f) => f.status === "untracked").length;
	const totalChanges = files.length;

	const ahead = gitStatus?.ahead || 0;
	const behind = gitStatus?.behind || 0;

	const totalTokens = tokenStats?.totalTokens ?? 0;
	const inputTokens = tokenStats?.inputTokens ?? 0;
	const outputTokens = tokenStats?.outputTokens ?? 0;
	const contextTokens = tokenStats?.contextTokens ?? 0;
	const contextWindow = tokenStats?.contextWindow ?? 0;
	const contextPercent = tokenStats?.contextPercent;
	const cacheHitPercent = tokenStats?.cacheHitPercent;
	const cost = tokenStats?.cost ?? 0;
	const isWorking = tokenStats?.isWorking ?? false;

	return (
		<div className={`composer-status-dock ${className}`} role="region" aria-label="工作区状态底栏">
			{/* Left: Git Version Status */}
			<div className="dock-left-zone">
				{isRepo ? (
					<div className="dock-git-group">
						{/* Branch Selector / Display */}
						<button
							type="button"
							className="dock-badge dock-badge-branch"
							title={`当前 Git 分支：${branch} (点击打开版本管理)`}
							onClick={onOpenGit}
						>
							<GitBranch size={13} className="dock-icon-branch" />
							<span className="dock-branch-name">{branch}</span>
						</button>

						{/* Changes Indicator */}
						<button
							type="button"
							className={`dock-badge dock-badge-changes ${totalChanges > 0 ? "has-changes" : "is-clean"}`}
							title={
								totalChanges > 0
									? `共 ${totalChanges} 个文件变动 (暂存: ${stagedCount}, 未暂存: ${unstagedCount}, 未跟踪: ${untrackedCount}) - 点击查看差异与提交`
									: "工作区整洁，无未提交更改"
							}
							onClick={onOpenGit}
						>
							{totalChanges > 0 ? (
								<>
									<span className="dock-changes-dot" />
									<span className="dock-changes-count">{totalChanges} 个变动</span>
									<span className="dock-changes-breakdown">
										{stagedCount > 0 && <span className="stat-staged">+{stagedCount}</span>}
										{unstagedCount > 0 && <span className="stat-modified">~{unstagedCount}</span>}
										{untrackedCount > 0 && <span className="stat-untracked">?{untrackedCount}</span>}
									</span>
								</>
							) : (
								<>
									<Check size={12} className="dock-icon-clean" />
									<span className="dock-clean-label">工作区干净</span>
								</>
							)}
						</button>

						{/* Ahead / Behind Sync Indicator */}
						{(ahead > 0 || behind > 0) && (
							<button
								type="button"
								className="dock-badge dock-badge-sync"
								title={`与远程同步：待推送 ${ahead} 个提交，待拉取 ${behind} 个提交`}
								onClick={onOpenGit}
							>
								{ahead > 0 && (
									<span className="sync-ahead" title={`待推送 ${ahead}`}>
										<ArrowUp size={11} />
										{ahead}
									</span>
								)}
								{behind > 0 && (
									<span className="sync-behind" title={`待拉取 ${behind}`}>
										<ArrowDown size={11} />
										{behind}
									</span>
								)}
							</button>
						)}

						{/* Quick Refresh */}
						{onRefreshGit && (
							<button
								type="button"
								className={`dock-btn-refresh ${loading ? "spinning" : ""}`}
								title="刷新 Git 状态"
								onClick={(e) => {
									e.stopPropagation();
									onRefreshGit();
								}}
							>
								<RefreshCw size={11} />
							</button>
						)}
					</div>
				) : (
					<div className="dock-git-group non-repo">
						<button
							type="button"
							className="dock-badge dock-badge-nonrepo"
							title="当前目录未初始化 Git 仓库，点击打开版本管理"
							onClick={onOpenGit}
						>
							<AlertCircle size={12} />
							<span>未检测到 Git 仓库</span>
						</button>
					</div>
				)}
			</div>

			{/* Right: Real-time Token Statistics & Extensible Data Slot */}
			<div className="dock-right-zone">
				{extraDataSlot ? (
					<div className="dock-custom-slot">{extraDataSlot}</div>
				) : (
					<button
						type="button"
						className={`dock-badge dock-badge-tokens ${isWorking ? "is-working" : ""}`}
						title={`会话 Token：${fmtTokens(totalTokens)} tok (输入: ${fmtTokens(inputTokens)}, 回复: ${fmtTokens(outputTokens)}) · 上下文占用: ${contextPercent !== undefined ? (contextPercent * 100).toFixed(1) + "%" : "--"} · 点击展开/收起右侧上下文用量面板`}
						onClick={onOpenContextPanel}
					>
						<Cpu size={12} className="dock-icon-tokens" />
						<span className="dock-tokens-total">
							{isWorking && <span className="dock-stream-dot" />}
							{fmtTokens(totalTokens)} tok
						</span>
						{contextPercent !== undefined && contextWindow > 0 && (
							<span
								className={`dock-tokens-ctx ${
									contextPercent > 0.85 ? "danger" : contextPercent > 0.65 ? "warn" : ""
								}`}
								title={`当前上下文占用 ${(contextPercent * 100).toFixed(1)}%`}
							>
								{(contextPercent * 100).toFixed(0)}%
							</span>
						)}
						{cost > 0 && (
							<span className="dock-tokens-cost" title={`会话费用 ${fmtCost(cost)}`}>
								{fmtCost(cost)}
							</span>
						)}
					</button>
				)}
			</div>
		</div>
	);
}
