import { useEffect, useRef, useState } from "react";
import { desktopApi } from "../../../api";
import {
	Activity,
	ArrowUp,
	Cpu,
	Monitor,
	Sliders,
	Trash,
	X,
	Zap,
} from "../../icons.tsx";

export function FloatingHud({
	onOpenMainWithPrompt,
	onClose,
}: {
	onOpenMainWithPrompt?: (prompt: string, images?: string[]) => void;
	onClose?: () => void;
}) {
	const [query, setQuery] = useState("");
	const [status, setStatus] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [resultText, setResultText] = useState<string | null>(null);
	const [capturedImage, setCapturedImage] = useState<string | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		inputRef.current?.focus();
	}, []);

	const handleClose = () => {
		if (onClose) onClose();
		else void desktopApi.toggleHud();
	};

	const handleCaptureScreenAndAsk = async () => {
		setLoading(true);
		setStatus("正在截取屏幕...");
		try {
			const res = await desktopApi.captureScreen({ target: "fullscreen" });
			setCapturedImage(res.path);
			setStatus(`已捕获屏幕: ${res.path}`);
			setResultText("已捕获全屏图像，可点击下方在主窗口中向 Agent 提问。");
		} catch (err: any) {
			setStatus(`截屏失败: ${err.message}`);
		} finally {
			setLoading(false);
		}
	};

	const handleKillCommonPort = async (port: number) => {
		setLoading(true);
		setStatus(`正在检查并释放端口 ${port}...`);
		try {
			const res = await desktopApi.killPort(port);
			if (res.killed.length > 0) {
				setResultText(`✅ 成功终止占用 :${port} 的进程 (PIDs: ${res.killed.join(", ")})`);
			} else {
				setResultText(`ℹ️ 端口 :${port} 当前未被占用。`);
			}
		} catch (err: any) {
			setResultText(`❌ 释放失败: ${err.message}`);
		} finally {
			setLoading(false);
			setStatus(null);
		}
	};

	const handleClipboardAction = async () => {
		setLoading(true);
		setStatus("正在读取剪贴板...");
		try {
			const clip = await desktopApi.manageClipboard({ action: "read" });
			if (!clip.text || !clip.text.trim()) {
				setResultText("剪贴板当前为空。");
			} else {
				setResultText(`剪贴板内容预览 (${clip.text.length} 字符):\n\n${clip.text.slice(0, 300)}...`);
			}
		} catch (err: any) {
			setResultText(`读取失败: ${err.message}`);
		} finally {
			setLoading(false);
			setStatus(null);
		}
	};

	const handleMusicToggle = async () => {
		try {
			await desktopApi.runAppleScript(
				'tell application "System Events" to if exists (application process "Music") then tell application "Music" to playpause',
			);
			setResultText("已发送音乐播放/暂停指令。");
		} catch (err: any) {
			setResultText(`音乐控制失败: ${err.message}`);
		}
	};

	const handleSubmit = async (e?: React.FormEvent) => {
		e?.preventDefault();
		const trimmed = query.trim();
		if (!trimmed) return;

		// Local heuristic shortcuts
		if (/^释放\s*(\d+)/.test(trimmed) || /kill\s*(\d+)/i.test(trimmed)) {
			const match = /(\d+)/.exec(trimmed);
			if (match) {
				await handleKillCommonPort(parseInt(match[1], 10));
				return;
			}
		}
		if (trimmed === "截屏" || trimmed === "看屏幕" || trimmed.includes("看下屏幕")) {
			await handleCaptureScreenAndAsk();
			return;
		}

		// Otherwise hand off to main chat session
		if (onOpenMainWithPrompt) {
			onOpenMainWithPrompt(trimmed, capturedImage ? [capturedImage] : undefined);
			handleClose();
		} else {
			setResultText(`已提交指令: "${trimmed}"。请打开主窗口查看 Agent 执行进度。`);
		}
	};

	return (
		<div className="floating-hud-overlay" onClick={handleClose}>
			<div className="floating-hud-card" onClick={(e) => e.stopPropagation()}>
				{/* Top Search Bar */}
				<form onSubmit={handleSubmit} className="hud-input-row">
					<Zap size={18} className="hud-logo-icon" />
					<input
						ref={inputRef}
						type="text"
						className="hud-main-input"
						placeholder="向 OpenPI 提问或输入快捷指令 (如: 看屏幕、释放8080端口、剪贴板)..."
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Escape") {
								e.stopPropagation();
								handleClose();
							}
						}}
					/>
					{query && (
						<button type="submit" className="hud-submit-btn" disabled={loading}>
							<ArrowUp size={16} />
						</button>
					)}
					<button type="button" className="hud-close-btn" onClick={handleClose} title="关闭 (Esc)">
						<X size={16} />
					</button>
				</form>

				{/* Quick Suggestion Pills */}
				<div className="hud-pills-row">
					<button
						type="button"
						className="hud-pill"
						onClick={() => void handleCaptureScreenAndAsk()}
					>
						<Monitor size={12} />
						📷 分析当前屏幕
					</button>
					<button
						type="button"
						className="hud-pill"
						onClick={() => void handleKillCommonPort(8080)}
					>
						<Trash size={12} />
						⚡ 释放 8080 端口
					</button>
					<button
						type="button"
						className="hud-pill"
						onClick={() => void handleClipboardAction()}
					>
						<Sliders size={12} />
						📋 检查剪贴板
					</button>
					<button
						type="button"
						className="hud-pill"
						onClick={() => void handleMusicToggle()}
					>
						🎵 音乐 播放/暂停
					</button>
				</div>

				{/* Status & Result Box */}
				{(status || resultText || loading) && (
					<div className="hud-result-box">
						{status && <div className="hud-status-text">{status}</div>}
						{resultText && <pre className="hud-result-pre">{resultText}</pre>}
						{capturedImage && onOpenMainWithPrompt && (
							<div className="hud-handoff-row">
								<button
									type="button"
									className="hud-handoff-btn"
									onClick={() => {
										onOpenMainWithPrompt("请分析当前屏幕截屏中的内容：", [capturedImage]);
										handleClose();
									}}
								>
									在主窗口中以此图提问 Agent ➔
								</button>
							</div>
						)}
					</div>
				)}

				{/* Footer Info */}
				<div className="hud-footer">
					<span>全局快捷键 <code>⌥Space</code></span>
					<span>按 <code>Esc</code> 隐藏</span>
				</div>
			</div>
		</div>
	);
}
