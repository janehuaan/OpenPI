import { useEffect, useMemo, useState } from "react";
import { Check, Copy, Pencil, RotateCcw, X } from "./icons.tsx";
import { parseDiffHunks, type DiffHunk, type HunkStatus } from "../lib/diff";
import { desktopApi } from "../api";

export function MiniDiffView({
	diffText,
	filename,
	workspaceCwd,
	onApplied,
}: {
	diffText: string;
	filename?: string;
	workspaceCwd?: string;
	onApplied?: () => void;
}) {
	const [copied, setCopied] = useState(false);
	const [applying, setApplying] = useState(false);
	const [applyStatus, setApplyStatus] = useState<string | null>(null);
	const [editingHunkId, setEditingHunkId] = useState<string | null>(null);
	const [editingDraft, setEditingDraft] = useState<string>("");

	const parsed = useMemo(() => parseDiffHunks(diffText), [diffText]);
	const [hunks, setHunks] = useState<DiffHunk[]>(() => parsed.hunks);

	useEffect(() => {
		setHunks(parsed.hunks);
	}, [parsed]);

	const acceptedCount = hunks.filter((h) => h.status === "accepted").length;
	const rejectedCount = hunks.filter((h) => h.status === "rejected").length;

	const handleCopy = () => {
		void navigator.clipboard.writeText(diffText).then(() => {
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		});
	};

	const setAllStatus = (status: HunkStatus) => {
		setHunks((prev) => prev.map((h) => ({ ...h, status })));
	};

	const setHunkStatus = (hunkId: string, status: HunkStatus) => {
		setHunks((prev) =>
			prev.map((h) => (h.id === hunkId ? { ...h, status } : h)),
		);
	};

	const startEditHunk = (hunk: DiffHunk) => {
		setEditingHunkId(hunk.id);
		const currentText = hunk.editedLines
			? hunk.editedLines.join("\n")
			: hunk.lines
					.filter((l) => l.type === "add" || l.type === "ctx")
					.map((l) => l.content)
					.join("\n");
		setEditingDraft(currentText);
	};

	const saveEditHunk = (hunkId: string) => {
		const lines = editingDraft.split("\n");
		setHunks((prev) =>
			prev.map((h) =>
				h.id === hunkId ? { ...h, editedLines: lines, status: "accepted" } : h,
			),
		);
		setEditingHunkId(null);
	};

	const cancelEditHunk = () => {
		setEditingHunkId(null);
		setEditingDraft("");
	};

	const handleApply = async () => {
		if (!filename) return;
		setApplying(true);
		setApplyStatus(null);
		try {
			// If all are pending, treat as accepting all
			const effectiveHunks = hunks.map((h) =>
				h.status === "pending" ? { ...h, status: "accepted" as const } : h,
			);
			const res = await desktopApi.applyDiffHunks({
				filename,
				cwd: workspaceCwd,
				hunks: effectiveHunks,
			});
			if (res?.success) {
				setApplyStatus(`已采纳 ${res.appliedCount} 处变更`);
				if (onApplied) onApplied();
				setTimeout(() => setApplyStatus(null), 3500);
			} else {
				setApplyStatus(`应用失败: ${res?.error || "未知错误"}`);
			}
		} catch (err: any) {
			setApplyStatus(`应用失败: ${err?.message || String(err)}`);
		} finally {
			setApplying(false);
		}
	};

	return (
		<div className="mini-diff-viewer" role="region" aria-label="交互式代码变更对比">
			<div className="mini-diff-header">
				<div className="mini-diff-info">
					{filename && <span className="mini-diff-filename" title={filename}>{filename}</span>}
					<span className="mini-diff-stats">
						{parsed.totalAdds > 0 && <span className="stat-add">+{parsed.totalAdds}</span>}
						{parsed.totalDels > 0 && <span className="stat-del">-{parsed.totalDels}</span>}
					</span>
					{hunks.length > 1 && (
						<span className="mini-diff-hunk-summary">
							({hunks.length} 块 · {acceptedCount} 已采纳{rejectedCount > 0 ? ` · ${rejectedCount} 已忽略` : ""})
						</span>
					)}
				</div>

				<div className="mini-diff-actions">
					{hunks.length > 1 && (
						<>
							<button
								type="button"
								className="diff-action-btn"
								onClick={() => setAllStatus("accepted")}
								title="一键采纳所有变更块"
							>
								全部采纳
							</button>
							<button
								type="button"
								className="diff-action-btn"
								onClick={() => setAllStatus("rejected")}
								title="一键忽略所有变更块"
							>
								全部忽略
							</button>
							<button
								type="button"
								className="diff-action-btn"
								onClick={() => setAllStatus("pending")}
								title="重置块级选择状态"
							>
								<RotateCcw size={10} />
							</button>
						</>
					)}

					{filename && (
						<button
							type="button"
							className={`diff-apply-btn ${applyStatus ? "has-status" : ""}`}
							onClick={handleApply}
							disabled={applying}
							title="将已选变更块保存写入文件"
						>
							{applying ? "写入中…" : applyStatus ?? "应用至文件"}
						</button>
					)}

					<button
						type="button"
						className="mini-diff-copy-btn"
						onClick={handleCopy}
						title="复制完整 Diff 内容"
					>
						{copied ? (
							<>
								<Check size={11} className="copy-ok" />
								<span>已复制</span>
							</>
						) : (
							<>
								<Copy size={11} />
								<span>复制</span>
							</>
						)}
					</button>
				</div>
			</div>

			<div className="mini-diff-body">
				{/* Top-level headers */}
				{parsed.headers.map((header, idx) => (
					<div className="diff-row diff-row-header" key={`hdr-${idx}`}>
						<span className="diff-col-num" />
						<span className="diff-col-num" />
						<span className="diff-col-sign"> </span>
						<span className="diff-col-code">{header}</span>
					</div>
				))}

				{/* Hunks */}
				{hunks.map((hunk) => {
					const isEditing = editingHunkId === hunk.id;

					return (
						<div
							key={hunk.id}
							className={`diff-hunk-container status-${hunk.status}`}
						>
							<div className="diff-hunk-header-bar">
								<span className="diff-hunk-title">{hunk.header}</span>
								<div className="diff-hunk-tools">
									{hunk.status === "accepted" && (
										<span className="diff-hunk-badge accepted">✓ 已采纳</span>
									)}
									{hunk.status === "rejected" && (
										<span className="diff-hunk-badge rejected">✗ 已忽略</span>
									)}
									{hunk.status === "pending" && (
										<span className="diff-hunk-badge pending">待定</span>
									)}

									<button
										type="button"
										className={`hunk-tool-btn accept ${hunk.status === "accepted" ? "active" : ""}`}
										onClick={() => setHunkStatus(hunk.id, "accepted")}
										title="采纳该代码块"
									>
										<Check size={10} />
										<span>采纳</span>
									</button>
									<button
										type="button"
										className={`hunk-tool-btn reject ${hunk.status === "rejected" ? "active" : ""}`}
										onClick={() => setHunkStatus(hunk.id, "rejected")}
										title="忽略该代码块"
									>
										<X size={10} />
										<span>忽略</span>
									</button>
									<button
										type="button"
										className={`hunk-tool-btn edit ${isEditing ? "active" : ""}`}
										onClick={() => (isEditing ? cancelEditHunk() : startEditHunk(hunk))}
										title="在当前块内微调代码"
									>
										<Pencil size={10} />
										<span>{isEditing ? "取消" : "微调"}</span>
									</button>
								</div>
							</div>

							{isEditing ? (
								<div className="diff-hunk-edit-panel">
									<div className="diff-hunk-edit-desc">
										微调替换代码（保存后将作为该块的新实现）：
									</div>
									<textarea
										className="diff-hunk-textarea"
										value={editingDraft}
										onChange={(e) => setEditingDraft(e.target.value)}
										rows={Math.min(12, Math.max(3, editingDraft.split("\n").length + 1))}
									/>
									<div className="diff-hunk-edit-actions">
										<button
											type="button"
											className="hunk-save-btn"
											onClick={() => saveEditHunk(hunk.id)}
										>
											保存并采纳
										</button>
										<button
											type="button"
											className="hunk-cancel-btn"
											onClick={cancelEditHunk}
										>
											取消
										</button>
									</div>
								</div>
							) : (
								<div className="diff-hunk-lines">
									{hunk.lines.map((line, idx) => {
										if (line.type === "hunk") return null;
										return (
											<div
												className={`diff-row diff-row-${line.type} ${hunk.status === "rejected" ? "dimmed" : ""}`}
												key={`line-${idx}`}
											>
												<span className="diff-col-num">{line.oldLineNo ?? ""}</span>
												<span className="diff-col-num">{line.newLineNo ?? ""}</span>
												<span className="diff-col-sign">
													{line.type === "add" ? "+" : line.type === "del" ? "-" : " "}
												</span>
												<span className="diff-col-code">{line.content}</span>
											</div>
										);
									})}
									{hunk.editedLines && (
										<div className="diff-hunk-edited-preview">
											<div className="edited-tag">✏️ 已微调内容:</div>
											<pre className="edited-content">
												{hunk.editedLines.join("\n")}
											</pre>
										</div>
									)}
								</div>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
}

