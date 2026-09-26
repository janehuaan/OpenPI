import { type FC, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { desktopApi } from "../../../api";
import { Check, Copy, ExternalLink, FileText, X } from "../../icons";
import type { FilePreviewRequest } from "../../../lib/file-links";

export interface FilePreviewDialogProps {
	request: FilePreviewRequest | null;
	workspace?: string;
	onClose: () => void;
}

export const FilePreviewDialog: FC<FilePreviewDialogProps> = ({ request, workspace = "", onClose }) => {
	const [loading, setLoading] = useState(false);
	const [fileText, setFileText] = useState<string>("");
	const [error, setError] = useState<string | null>(null);
	const [resolvedPath, setResolvedPath] = useState<string>("");
	const [copiedPath, setCopiedPath] = useState(false);
	const [copiedCode, setCopiedCode] = useState(false);
	const [openingEditor, setOpeningEditor] = useState(false);
	const [editorNotice, setEditorNotice] = useState<string | null>(null);

	const codeContainerRef = useRef<HTMLDivElement>(null);
	const targetLineRef = useRef<HTMLDivElement>(null);

	const isOpen = Boolean(request);
	const rawPath = request?.path ?? "";
	const lineStart = request?.lineStart;
	const lineEnd = request?.lineEnd;

	// Close on Escape
	useEffect(() => {
		if (!isOpen) return;
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				onClose();
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [isOpen, onClose]);

	// Load file content
	useEffect(() => {
		if (!isOpen || !rawPath) {
			setFileText("");
			setError(null);
			setResolvedPath("");
			return;
		}

		let cancelled = false;
		setLoading(true);
		setError(null);

		desktopApi
			.readWorkspaceFile(workspace, rawPath)
			.then((res: any) => {
				if (cancelled) return;
				const text =
					typeof res?.text === "string"
						? res.text
						: typeof res?.content === "string"
							? res.content
							: null;

				if (text !== null && res?.exists !== false) {
					setFileText(text);
					setResolvedPath(res?.path || rawPath);
				} else if (res && res.exists === false) {
					setError(`未找到文件：${res.path || rawPath}`);
					setResolvedPath(res.path || rawPath);
				} else {
					setFileText(text ?? "");
					setResolvedPath(res?.path || rawPath);
				}
			})
			.catch((err) => {
				if (cancelled) return;
				setError(err?.message || "读取文件失败");
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});

		return () => {
			cancelled = true;
		};
	}, [isOpen, rawPath, workspace]);

	const lines = useMemo(() => {
		return fileText ? fileText.split(/\r?\n/) : [];
	}, [fileText]);

	// Scroll to target line
	useLayoutEffect(() => {
		if (!loading && targetLineRef.current) {
			targetLineRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
		}
	}, [loading, lines, lineStart]);

	const filename = useMemo(() => {
		const p = (resolvedPath || rawPath).replace(/[\\/]+$/, "");
		return p.split(/[\\/]/).filter(Boolean).at(-1) ?? p;
	}, [resolvedPath, rawPath]);

	const fileExt = useMemo(() => {
		const match = /\.([a-zA-Z0-9]+)$/.exec(filename);
		return match ? match[1].toUpperCase() : "TXT";
	}, [filename]);

	const handleCopyPath = () => {
		const p = resolvedPath || rawPath;
		void navigator.clipboard.writeText(p).then(() => {
			setCopiedPath(true);
			setTimeout(() => setCopiedPath(false), 1600);
		});
	};

	const handleCopyCode = () => {
		void navigator.clipboard.writeText(fileText).then(() => {
			setCopiedCode(true);
			setTimeout(() => setCopiedCode(false), 1600);
		});
	};

	const handleOpenInEditor = async () => {
		const p = resolvedPath || rawPath;
		setOpeningEditor(true);
		setEditorNotice(null);
		try {
			const res = await desktopApi.openFileInEditor(p, workspace);
			if (!res?.success) {
				setEditorNotice(res?.error || "打开失败");
				setTimeout(() => setEditorNotice(null), 3000);
			} else {
				setEditorNotice("已在系统编辑器中打开");
				setTimeout(() => setEditorNotice(null), 2000);
			}
		} catch (err: any) {
			setEditorNotice(err?.message || "打开失败");
			setTimeout(() => setEditorNotice(null), 3000);
		} finally {
			setOpeningEditor(false);
		}
	};

	if (!isOpen) return null;

	return (
		<div
			className="dialog-backdrop file-preview-backdrop"
			style={{ zIndex: 9999 }}
			onClick={(e) => {
				if (e.target === e.currentTarget) onClose();
			}}
		>
			<div className="dialog file-preview-dialog">
				{/* Header */}
				<div className="file-preview-header">
					<div className="file-preview-title-wrap">
						<div className="file-preview-icon-wrap">
							<FileText size={18} />
						</div>
						<div className="file-preview-meta">
							<div className="file-preview-name-row">
								<span className="file-preview-filename">{filename}</span>
								<span className="file-preview-badge">{fileExt}</span>
								{lineStart !== undefined && (
									<span className="file-preview-line-badge">
										行 {lineStart}
										{lineEnd !== undefined ? ` - ${lineEnd}` : ""}
									</span>
								)}
							</div>
							<span className="file-preview-filepath" title={resolvedPath || rawPath}>
								{resolvedPath || rawPath}
							</span>
						</div>
					</div>

					<div className="file-preview-actions">
						<button
							type="button"
							className="file-preview-btn"
							onClick={handleCopyPath}
							title="复制文件路径"
						>
							{copiedPath ? <Check size={13} /> : <Copy size={13} />}
							<span>{copiedPath ? "已复制路径" : "复制路径"}</span>
						</button>

						<button
							type="button"
							className="file-preview-btn"
							onClick={handleCopyCode}
							title="复制代码全文"
							disabled={!fileText}
						>
							{copiedCode ? <Check size={13} /> : <Copy size={13} />}
							<span>{copiedCode ? "已复制代码" : "复制代码"}</span>
						</button>

						<button
							type="button"
							className="file-preview-btn primary"
							onClick={handleOpenInEditor}
							title="在默认编辑器/IDE中打开"
							disabled={openingEditor}
						>
							<ExternalLink size={13} />
							<span>{editorNotice || (openingEditor ? "正在打开…" : "在编辑器打开")}</span>
						</button>

						<button
							type="button"
							className="icon-button quiet file-preview-close"
							onClick={onClose}
							title="关闭预览 (Esc)"
							aria-label="关闭预览"
						>
							<X size={16} />
						</button>
					</div>
				</div>

				{/* Body */}
				<div className="file-preview-body" ref={codeContainerRef}>
					{loading ? (
						<div className="file-preview-loading">
							<div className="file-preview-spinner" />
							<span>正在读取文件内容…</span>
						</div>
					) : error ? (
						<div className="file-preview-error">
							<p>{error}</p>
							<small>路径：{resolvedPath || rawPath}</small>
						</div>
					) : lines.length === 0 ? (
						<div className="file-preview-empty">
							<span>空文件</span>
						</div>
					) : (
						<div className="file-preview-code-view">
							{lines.map((lineContent, idx) => {
								const lineNum = idx + 1;
								const isTarget =
									lineStart !== undefined &&
									(lineEnd !== undefined
										? lineNum >= lineStart && lineNum <= lineEnd
										: lineNum === lineStart);
								const isFirstTarget = lineNum === lineStart;

								return (
									<div
										key={lineNum}
										ref={isFirstTarget ? targetLineRef : undefined}
										className={`file-preview-code-line ${isTarget ? "target-line" : ""}`}
									>
										<span className="file-preview-line-num" aria-hidden="true">
											{lineNum}
										</span>
										<pre className="file-preview-line-content">
											<code>{lineContent || " "}</code>
										</pre>
									</div>
								);
							})}
						</div>
					)}
				</div>

				{/* Footer */}
				<div className="file-preview-footer">
					<div className="file-preview-footer-stats">
						<span>共 {lines.length} 行代码</span>
						<span>·</span>
						<span>{(new Blob([fileText]).size / 1024).toFixed(1)} KB</span>
						<span>·</span>
						<span>UTF-8</span>
					</div>
					<div className="file-preview-footer-tip">
						<span>按 <kbd>Esc</kbd> 退出预览</span>
					</div>
				</div>
			</div>
		</div>
	);
};
