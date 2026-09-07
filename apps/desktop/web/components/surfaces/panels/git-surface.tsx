import { useEffect, useState } from "react";
import { desktopApi as api } from "../../../api";
import type { GitBranch, GitFileChange, GitStatusResult } from "../../../types";
import { MiniDiffView } from "../../diff-viewer.tsx";
import {
	AlertCircle,
	ArrowDown,
	ArrowLeft,
	ArrowUp,
	Check,
	ChevronDown,
	ChevronRight,
	Copy,
	GitBranch as GitBranchIcon,
	Minus,
	Plus,
	RefreshCw,
	RotateCcw,
	Send,
	Sparkles,
	Trash2,
	UploadCloud,
} from "../../icons.tsx";

export interface GitSurfaceProps {
	gitStatus?: GitStatusResult | null;
	loading?: boolean;
	onRefresh: () => void;
	cwd?: string;
	onClose?: () => void;
}

export function GitSurface({
	gitStatus,
	loading = false,
	onRefresh,
	cwd,
	onClose,
}: GitSurfaceProps) {
	const [selectedFile, setSelectedFile] = useState<GitFileChange | null>(null);
	const [diffText, setDiffText] = useState<string>("");
	const [loadingDiff, setLoadingDiff] = useState(false);
	const [commitMessage, setCommitMessage] = useState("");
	const [committing, setCommitting] = useState(false);
	const [syncing, setSyncing] = useState<"pull" | "push" | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const [branches, setBranches] = useState<GitBranch[]>([]);
	const [showBranchMenu, setShowBranchMenu] = useState(false);
	const [newBranchName, setNewBranchName] = useState("");
	const [showNewBranchInput, setShowNewBranchInput] = useState(false);

	const isRepo = gitStatus?.isRepo ?? false;
	const files = gitStatus?.files || [];
	const conflictedFiles = files.filter((f) => f.status === "conflicted");
	const stagedFiles = files.filter((f) => f.staged && f.status !== "conflicted");
	const unstagedFiles = files.filter((f) => !f.staged && f.status !== "untracked" && f.status !== "conflicted");
	const untrackedFiles = files.filter((f) => f.status === "untracked");
	const [resolvingConflict, setResolvingConflict] = useState<string | null>(null);

	const handleResolveConflict = async (filePath: string, strategy: "ours" | "theirs") => {
		setResolvingConflict(filePath);
		setActionError(null);
		try {
			const res = await api.gitResolveConflict({ cwd, path: filePath, strategy });
			if (!res.ok) {
				setActionError(res.error || "解决冲突失败");
			} else {
				onRefresh();
			}
		} catch (err: any) {
			setActionError(err?.message || String(err));
		} finally {
			setResolvingConflict(null);
		}
	};

	// Auto-select first modified file if none selected
	useEffect(() => {
		if (!selectedFile && files.length > 0) {
			setSelectedFile(files[0]!);
		} else if (selectedFile && !files.some((f) => f.path === selectedFile.path && f.staged === selectedFile.staged)) {
			setSelectedFile(files[0] || null);
		}
	}, [files, selectedFile]);

	// Fetch diff when selected file changes
	useEffect(() => {
		if (!selectedFile) {
			setDiffText("");
			return;
		}
		let cancelled = false;
		setLoadingDiff(true);
		void api
			.getGitDiff({ cwd, path: selectedFile.path, staged: selectedFile.staged })
			.then((res: { diff: string }) => {
				if (!cancelled) {
					setDiffText(res.diff || "");
					setLoadingDiff(false);
				}
			})
			.catch((err: any) => {
				if (!cancelled) {
					setDiffText(`// 获取差异失败: ${err?.message || String(err)}`);
					setLoadingDiff(false);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [selectedFile, cwd]);

	// Fetch branches
	const loadBranches = async () => {
		try {
			const res = await api.getGitBranches(cwd);
			if (res && res.branches) {
				setBranches(res.branches);
			}
		} catch {
			// ignore
		}
	};

	useEffect(() => {
		if (isRepo) {
			void loadBranches();
		}
	}, [isRepo, cwd]);

	const handleStage = async (path?: string, all?: boolean) => {
		setActionError(null);
		try {
			const res = await api.gitStage({ cwd, paths: path ? [path] : undefined, all });
			if (!res.ok) setActionError(res.error || "暂存失败");
			onRefresh();
		} catch (e: any) {
			setActionError(e.message || "暂存失败");
		}
	};

	const handleUnstage = async (path?: string, all?: boolean) => {
		setActionError(null);
		try {
			const res = await api.gitUnstage({ cwd, paths: path ? [path] : undefined, all });
			if (!res.ok) setActionError(res.error || "取消暂存失败");
			onRefresh();
		} catch (e: any) {
			setActionError(e.message || "取消暂存失败");
		}
	};

	const handleDiscard = async (path: string) => {
		if (!window.confirm(`确定要放弃对 ${path} 的所有修改吗？该操作不可撤回。`)) return;
		setActionError(null);
		try {
			const res = await api.gitDiscard({ cwd, paths: [path] });
			if (!res.ok) setActionError(res.error || "放弃修改失败");
			onRefresh();
		} catch (e: any) {
			setActionError(e.message || "放弃修改失败");
		}
	};

	const handleCommit = async () => {
		if (!commitMessage.trim()) {
			setActionError("请输入提交信息");
			return;
		}
		setActionError(null);
		setCommitting(true);
		try {
			const stageAll = stagedFiles.length === 0 && files.length > 0;
			const res = await api.gitCommit({
				cwd,
				message: commitMessage.trim(),
				stageAll,
			});
			if (res.ok) {
				setCommitMessage("");
				onRefresh();
			} else {
				setActionError(res.error || "提交失败");
			}
		} catch (e: any) {
			setActionError(e.message || "提交失败");
		} finally {
			setCommitting(false);
		}
	};

	const handleSync = async (action: "pull" | "push") => {
		setActionError(null);
		setSyncing(action);
		try {
			const res = await api.gitSync({ cwd, action });
			if (!res.ok) {
				setActionError(res.error || `${action} 失败`);
			} else {
				onRefresh();
			}
		} catch (e: any) {
			setActionError(e.message || `${action} 失败`);
		} finally {
			setSyncing(null);
		}
	};

	const handleCheckout = async (branch: string, create = false) => {
		setActionError(null);
		try {
			const res = await api.gitCheckout({ cwd, branch, create });
			if (!res.ok) {
				setActionError(res.error || "切换分支失败");
			} else {
				setShowBranchMenu(false);
				setShowNewBranchInput(false);
				setNewBranchName("");
				onRefresh();
				void loadBranches();
			}
		} catch (e: any) {
			setActionError(e.message || "切换分支失败");
		}
	};

	const handleInitRepo = async () => {
		setActionError(null);
		try {
			const res = await api.gitInit(cwd);
			if (res.ok) {
				onRefresh();
			} else {
				setActionError(res.error || "初始化 Git 仓库失败");
			}
		} catch (e: any) {
			setActionError(e.message || "初始化 Git 仓库失败");
		}
	};

	if (!isRepo) {
		return (
			<section className="git-surface" aria-label="版本管理">
				<header className="git-surface-header">
					<div className="git-header-left">
						{onClose && (
							<button
								type="button"
								className="git-back-btn"
								title="返回对话"
								aria-label="返回对话"
								onClick={onClose}
							>
								<ArrowLeft size={14} />
								<span>返回</span>
							</button>
						)}
						<GitBranchIcon size={18} className="header-git-icon" />
						<strong style={{ fontSize: 13 }}>版本管理</strong>
					</div>
				</header>
				<div className="git-empty-viewport">
					<div className="git-empty-card glass-card">
						<div className="git-empty-icon-wrapper">
							<GitBranchIcon size={36} className="empty-git-icon" />
						</div>
						<h3>当前目录不是 Git 仓库</h3>
						<p>该工作区目录尚未初始化版本控制系统。初始化后即可使用分支、提交与差异对比功能。</p>
						{actionError && <div className="git-error-banner">{actionError}</div>}
						<button type="button" className="btn-primary-action" onClick={handleInitRepo}>
							<Plus size={15} />
							<span>初始化 Git 仓库 (git init)</span>
						</button>
					</div>
				</div>
			</section>
		);
	}

	return (
		<section className="git-surface" aria-label="版本管理中心">
			{/* Top Bar */}
			<header className="git-surface-header">
				<div className="git-header-left">
					{onClose && (
						<button
							type="button"
							className="git-back-btn"
							title="返回对话"
							aria-label="返回对话"
							onClick={onClose}
						>
							<ArrowLeft size={14} />
							<span>返回</span>
						</button>
					)}
					<GitBranchIcon size={18} className="header-git-icon" />
					<div className="git-branch-selector-wrap">
						<button
							type="button"
							className="git-branch-button"
							onClick={() => setShowBranchMenu((prev) => !prev)}
							title="点击切换或新建分支"
						>
							<span className="branch-current-name">{gitStatus?.branch || "main"}</span>
							<ChevronDown size={12} />
						</button>
						{showBranchMenu && (
							<div className="git-branch-dropdown">
								<div className="branch-dropdown-header">
									<span>本地分支</span>
									<button
										type="button"
										className="branch-new-btn"
										onClick={() => setShowNewBranchInput((prev) => !prev)}
									>
										+ 新建分支
									</button>
								</div>
								{showNewBranchInput && (
									<div className="branch-new-row">
										<input
											type="text"
											placeholder="分支名称…"
											value={newBranchName}
											onChange={(e) => setNewBranchName(e.target.value)}
											onKeyDown={(e) => {
												if (e.key === "Enter" && newBranchName.trim()) {
													void handleCheckout(newBranchName.trim(), true);
												}
											}}
										/>
										<button
											type="button"
											disabled={!newBranchName.trim()}
											onClick={() => void handleCheckout(newBranchName.trim(), true)}
										>
											创建
										</button>
									</div>
								)}
								<div className="branch-list">
									{branches.map((b) => (
										<button
											type="button"
											key={b.name}
											className={`branch-item ${b.current ? "current" : ""}`}
											onClick={() => void handleCheckout(b.name, false)}
										>
											<GitBranchIcon size={12} />
											<span>{b.name}</span>
											{b.current && <Check size={12} className="check-icon" />}
										</button>
									))}
								</div>
							</div>
						)}
					</div>
					<span className="git-status-upstream" title={gitStatus?.upstream ? `跟踪：${gitStatus.upstream}` : "未关联远程分支"}>
						{gitStatus?.upstream || "本地分支"}
					</span>
				</div>

				<div className="git-header-right">
					{/* Ahead/Behind Sync Buttons */}
					<button
						type="button"
						className={`git-sync-btn ${syncing === "pull" ? "loading" : ""}`}
						title="从远程拉取 (git pull --rebase)"
						disabled={syncing !== null}
						onClick={() => void handleSync("pull")}
					>
						<ArrowDown size={13} />
						<span>拉取</span>
						{(gitStatus?.behind || 0) > 0 && <span className="sync-num">{gitStatus!.behind}</span>}
					</button>
					<button
						type="button"
						className={`git-sync-btn ${syncing === "push" ? "loading" : ""}`}
						title="推送到远程 (git push)"
						disabled={syncing !== null}
						onClick={() => void handleSync("push")}
					>
						<ArrowUp size={13} />
						<span>推送</span>
						{(gitStatus?.ahead || 0) > 0 && <span className="sync-num">{gitStatus!.ahead}</span>}
					</button>
					<button
						type="button"
						className={`git-refresh-icon-btn ${loading ? "spinning" : ""}`}
						title="刷新 Git 状态"
						onClick={onRefresh}
					>
						<RefreshCw size={14} />
					</button>
				</div>
			</header>

			{actionError && (
				<div className="git-error-strip">
					<AlertCircle size={14} />
					<span>{actionError}</span>
					<button type="button" onClick={() => setActionError(null)}>
						×
					</button>
				</div>
			)}

			{/* Main Content: Left Column (Commit & File Trees) + Right Column (Diff View) */}
			<div className="git-main-layout">
				{/* Left Sidebar: Commit Box & Change Lists */}
				<div className="git-files-panel">
					{/* Commit Input Area */}
					<div className="git-commit-box">
						<textarea
							rows={3}
							placeholder="输入提交信息 (Cmd+Enter 提交)…"
							value={commitMessage}
							onChange={(e) => setCommitMessage(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
									e.preventDefault();
									void handleCommit();
								}
							}}
						/>
						<div className="commit-box-actions">
							<span className="commit-tip">
								{stagedFiles.length > 0
									? `已暂存 ${stagedFiles.length} 个文件`
									: files.length > 0
										? "将一键全量暂存并提交"
										: "无更改"}
							</span>
							<button
								type="button"
								className="git-commit-btn"
								disabled={committing || files.length === 0 || !commitMessage.trim()}
								onClick={handleCommit}
							>
								{committing ? <RefreshCw size={13} className="spinning" /> : <Send size={13} />}
								<span>提交 (Commit)</span>
							</button>
						</div>
					</div>

					{/* File Lists */}
					<div className="git-change-groups">
						{/* Group: Conflicted Files (Highest Priority) */}
						{conflictedFiles.length > 0 && (
							<div className="git-change-section git-conflicts-section">
								<div className="section-header conflict-header">
									<div className="section-title">
										<AlertCircle size={13} className="conflict-icon" />
										<span>冲突待解决</span>
										<span className="count-pill conflict-pill">{conflictedFiles.length}</span>
									</div>
								</div>
								<div className="file-items-list">
									{conflictedFiles.map((file) => (
										<div
											key={`conflicted-${file.path}`}
											className={`git-file-row conflict-row ${selectedFile?.path === file.path ? "selected" : ""}`}
											onClick={() => setSelectedFile(file)}
										>
											<span className="file-status-badge status-conflicted">!</span>
											<span className="file-name" title={file.path}>
												{file.path.split("/").pop()}
											</span>
											<span className="file-dir">
												{file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : ""}
											</span>
											<div className="conflict-quick-actions" onClick={(e) => e.stopPropagation()}>
												<button
													type="button"
													className="conflict-btn ours"
													title="采用当前分支更改 (Accept Ours)"
													disabled={resolvingConflict === file.path}
													onClick={() => void handleResolveConflict(file.path, "ours")}
												>
													当前
												</button>
												<button
													type="button"
													className="conflict-btn theirs"
													title="采用传入分支更改 (Accept Theirs)"
													disabled={resolvingConflict === file.path}
													onClick={() => void handleResolveConflict(file.path, "theirs")}
												>
													传入
												</button>
											</div>
										</div>
									))}
								</div>
							</div>
						)}

						{/* Group: Staged */}
						{stagedFiles.length > 0 && (
							<div className="git-change-section">
								<div className="section-header">
									<div className="section-title">
										<span>暂存的更改</span>
										<span className="count-pill">{stagedFiles.length}</span>
									</div>
									<button
										type="button"
										className="section-action-btn"
										title="取消全部暂存"
										onClick={() => void handleUnstage(undefined, true)}
									>
										<Minus size={13} />
									</button>
								</div>
								<div className="file-items-list">
									{stagedFiles.map((file) => (
										<div
											key={`staged-${file.path}`}
											className={`git-file-row ${selectedFile?.path === file.path && selectedFile?.staged ? "selected" : ""}`}
											onClick={() => setSelectedFile(file)}
										>
											<span className={`file-status-badge status-${file.status}`}>
												{file.status === "added" ? "A" : file.status === "deleted" ? "D" : "M"}
											</span>
											<span className="file-name" title={file.path}>
												{file.path.split("/").pop()}
											</span>
											<span className="file-dir">{file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : ""}</span>
											<button
												type="button"
												className="row-hover-btn"
												title="取消暂存"
												onClick={(e) => {
													e.stopPropagation();
													void handleUnstage(file.path);
												}}
											>
												<Minus size={12} />
											</button>
										</div>
									))}
								</div>
							</div>
						)}

						{/* Group: Unstaged Changes */}
						<div className="git-change-section">
							<div className="section-header">
								<div className="section-title">
									<span>更改</span>
									<span className="count-pill">{unstagedFiles.length}</span>
								</div>
								{unstagedFiles.length > 0 && (
									<button
										type="button"
										className="section-action-btn"
										title="暂存所有更改"
										onClick={() => void handleStage(undefined, true)}
									>
										<Plus size={13} />
									</button>
								)}
							</div>
							<div className="file-items-list">
								{unstagedFiles.length === 0 ? (
									<div className="empty-files-hint">无未暂存的修改</div>
								) : (
									unstagedFiles.map((file) => (
										<div
											key={`unstaged-${file.path}`}
											className={`git-file-row ${selectedFile?.path === file.path && !selectedFile?.staged ? "selected" : ""}`}
											onClick={() => setSelectedFile(file)}
										>
											<span className={`file-status-badge status-${file.status}`}>
												{file.status === "deleted" ? "D" : "M"}
											</span>
											<span className="file-name" title={file.path}>
												{file.path.split("/").pop()}
											</span>
											<span className="file-dir">{file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : ""}</span>
											<div className="row-hover-actions">
												<button
													type="button"
													className="row-hover-btn"
													title="放弃修改"
													onClick={(e) => {
														e.stopPropagation();
														void handleDiscard(file.path);
													}}
												>
													<RotateCcw size={12} />
												</button>
												<button
													type="button"
													className="row-hover-btn"
													title="暂存更改"
													onClick={(e) => {
														e.stopPropagation();
														void handleStage(file.path);
													}}
												>
													<Plus size={12} />
												</button>
											</div>
										</div>
									))
								)}
							</div>
						</div>

						{/* Group: Untracked Files */}
						{untrackedFiles.length > 0 && (
							<div className="git-change-section">
								<div className="section-header">
									<div className="section-title">
										<span>未跟踪的文件</span>
										<span className="count-pill">{untrackedFiles.length}</span>
									</div>
									<button
										type="button"
										className="section-action-btn"
										title="暂存所有新文件"
										onClick={() => void handleStage(undefined, true)}
									>
										<Plus size={13} />
									</button>
								</div>
								<div className="file-items-list">
									{untrackedFiles.map((file) => (
										<div
											key={`untracked-${file.path}`}
											className={`git-file-row ${selectedFile?.path === file.path ? "selected" : ""}`}
											onClick={() => setSelectedFile(file)}
										>
											<span className="file-status-badge status-untracked">U</span>
											<span className="file-name" title={file.path}>
												{file.path.split("/").pop()}
											</span>
											<span className="file-dir">{file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : ""}</span>
											<button
												type="button"
												className="row-hover-btn"
												title="暂存此文件"
												onClick={(e) => {
													e.stopPropagation();
													void handleStage(file.path);
												}}
											>
												<Plus size={12} />
											</button>
										</div>
									))}
								</div>
							</div>
						)}
					</div>
				</div>

				{/* Right Panel: Integrated Diff Viewer */}
				<div className="git-diff-panel">
					{selectedFile ? (
						<>
							{selectedFile.status === "conflicted" && (
								<div className="git-conflict-banner">
									<div className="conflict-banner-info">
										<AlertCircle size={16} className="conflict-icon" />
										<div>
											<strong>该文件包含代码合并冲突</strong>
											<p>可直接在下方快速采用某一方更改，或在编辑器中手动处理。</p>
										</div>
									</div>
									<div className="conflict-banner-actions">
										<button
											type="button"
											className="button small"
											disabled={resolvingConflict === selectedFile.path}
											onClick={() => void handleResolveConflict(selectedFile.path, "ours")}
											title="保留当前分支版本 (git checkout --ours)"
										>
											{resolvingConflict === selectedFile.path ? "处理中…" : "采用当前更改 (Ours)"}
										</button>
										<button
											type="button"
											className="button small primary"
											disabled={resolvingConflict === selectedFile.path}
											onClick={() => void handleResolveConflict(selectedFile.path, "theirs")}
											title="保留传入分支版本 (git checkout --theirs)"
										>
											{resolvingConflict === selectedFile.path ? "处理中…" : "采用传入更改 (Theirs)"}
										</button>
									</div>
								</div>
							)}
							{loadingDiff ? (
								<div className="diff-loading-box">
									<RefreshCw size={18} className="spinning" />
									<span>正在加载文件差异…</span>
								</div>
							) : diffText.trim() ? (
								<MiniDiffView diffText={diffText} filename={selectedFile.path} />
							) : (
								<div className="diff-empty-box">
									<Check size={24} />
									<p>文件已加入追踪或无文本内容差异</p>
								</div>
							)}
						</>
					) : (
						<div className="diff-empty-box">
							<GitBranchIcon size={32} />
							<p>在左侧选择一个文件查看详细差异对比</p>
						</div>
					)}
				</div>
			</div>
		</section>
	);
}
