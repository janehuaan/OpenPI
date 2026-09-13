import { useEffect, useRef, useState } from "react";
import { desktopApi } from "../../../api";
import {
	Activity,
	ArrowUp,
	Check,
	ChevronRight,
	Cpu,
	FileCode,
	GitBranch,
	Layers,
	Mic,
	Monitor,
	Play,
	RefreshCw,
	Search,
	Sliders,
	Terminal,
	Trash,
	X,
	Zap,
} from "../../icons";
import { joinSpeechText } from "../../../lib/speech-recognition";
import type { SymbolKind } from "@openpi/shared";

type HudMode = "ask" | "symbols" | "actions";

interface SymbolResultItem {
	name: string;
	kind: SymbolKind;
	filePath: string;
	line: number;
	signature?: string;
}

export interface QuickActionItem {
	id: string;
	title: string;
	desc: string;
	icon: any;
	execute: () => Promise<void>;
}

export type HudParsedCommand =
	| { type: "kill_port"; port: number }
	| { type: "capture_screen" }
	| { type: "git_status" }
	| { type: "handoff"; text: string };

export function parseHudCommand(input: string): HudParsedCommand {
	const trimmed = input.trim();
	if (/^释放\s*(\d+)/.test(trimmed) || /kill\s*(\d+)/i.test(trimmed)) {
		const match = /(\d+)/.exec(trimmed);
		if (match) {
			return { type: "kill_port", port: parseInt(match[1], 10) };
		}
	}
	if (trimmed === "截屏" || trimmed === "看屏幕" || trimmed.includes("看下屏幕") || trimmed === "截图") {
		return { type: "capture_screen" };
	}
	if (trimmed === "git" || trimmed === "git status" || trimmed === "git 状态") {
		return { type: "git_status" };
	}
	return { type: "handoff", text: trimmed };
}

export function isCliCommand(text: string): boolean {
	const t = text.trim();
	if (t.startsWith("$ ") || t.startsWith("> ")) return true;
	return /^(npm|pnpm|yarn|cargo|git|python|python3|node|docker|lsof|curl|cat|ls|pwd|find|ps|kill|df|top)\b/.test(t);
}

export function extractCliCommand(text: string): string {
	const t = text.trim();
	if (t.startsWith("$ ") || t.startsWith("> ")) return t.slice(2).trim();
	return t;
}

export function navigateIndex(currentIndex: number, totalCount: number, direction: "up" | "down"): number {
	if (totalCount <= 0) return 0;
	if (direction === "down") {
		return (currentIndex + 1) % totalCount;
	}
	return (currentIndex - 1 + totalCount) % totalCount;
}

export function FloatingHud({
	onOpenMainWithPrompt,
	onClose,
}: {
	onOpenMainWithPrompt?: (prompt: string, images?: string[]) => void;
	onClose?: () => void;
}) {
	const [mode, setMode] = useState<HudMode>("ask");
	const [query, setQuery] = useState("");
	const [status, setStatus] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [resultText, setResultText] = useState<string | null>(null);
	const [capturedImage, setCapturedImage] = useState<string | null>(null);
	const [selectedIndex, setSelectedIndex] = useState(0);

	// Symbols search state
	const [symbolResults, setSymbolResults] = useState<SymbolResultItem[]>([]);
	const [symbolStats, setSymbolStats] = useState<{ totalIndexed: number; filesIndexed: number } | null>(null);

	// Inline AI session & streaming state
	const [inlineSessionId, setInlineSessionId] = useState<string | null>(null);
	const activeSessionIdRef = useRef<string | null>(null);
	const sessionUnsubRef = useRef<(() => void) | null>(null);
	const resultEndRef = useRef<HTMLDivElement>(null);

	// Voice recognition state
	const [isListening, setIsListening] = useState(false);
	const recognitionRef = useRef<any>(null);

	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		inputRef.current?.focus();
	}, []);

	// Symbol search effect with debounce
	useEffect(() => {
		if (mode !== "symbols") return;
		let active = true;
		const timer = setTimeout(async () => {
			setLoading(true);
			try {
				const res = await desktopApi.searchCodeSymbols({ query, limit: 15 });
				if (active && res?.symbols) {
					setSymbolResults(res.symbols);
					setSymbolStats({
						totalIndexed: res.totalIndexed ?? 0,
						filesIndexed: res.filesIndexed ?? 0,
					});
					setSelectedIndex(0);
				}
			} catch (e: any) {
				console.error("[HUD] Symbol search failed:", e);
			} finally {
				if (active) setLoading(false);
			}
		}, 150);

		return () => {
			active = false;
			clearTimeout(timer);
		};
	}, [query, mode]);

	useEffect(() => {
		if (resultText) {
			resultEndRef.current?.scrollIntoView({ behavior: "smooth" });
		}
	}, [resultText]);

	useEffect(() => {
		return () => {
			if (sessionUnsubRef.current) {
				sessionUnsubRef.current();
				sessionUnsubRef.current = null;
			}
		};
	}, []);

	const handleClose = () => {
		if (sessionUnsubRef.current) {
			sessionUnsubRef.current();
			sessionUnsubRef.current = null;
		}
		if (recognitionRef.current) {
			try {
				recognitionRef.current.stop();
			} catch {}
		}
		if (onClose) onClose();
		else void desktopApi.toggleHud();
	};

	const handleToggleVoice = () => {
		if (isListening) {
			if (recognitionRef.current) {
				try {
					recognitionRef.current.stop();
				} catch {}
			}
			setIsListening(false);
			return;
		}

		if (typeof window === "undefined") return;
		const SpeechRecognition =
			(window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
		if (!SpeechRecognition) {
			setStatus("当前环境不支持系统语音识别，请直接键盘输入。");
			return;
		}

		try {
			const recognition = new SpeechRecognition();
			recognition.lang = "zh-CN";
			recognition.continuous = false;
			recognition.interimResults = true;

			recognition.onstart = () => {
				setIsListening(true);
				setStatus("正在倾听语音指令...");
			};

			recognition.onresult = (event: any) => {
				let transcript = "";
				for (let i = 0; i < event.results.length; i++) {
					transcript += event.results[i][0].transcript;
				}
				setQuery((prev) => joinSpeechText(prev, transcript));
			};

			recognition.onerror = (event: any) => {
				setStatus(`语音识别异常: ${event.error || "未知错误"}`);
				setIsListening(false);
			};

			recognition.onend = () => {
				setIsListening(false);
				setStatus(null);
			};

			recognitionRef.current = recognition;
			recognition.start();
		} catch (err: any) {
			setStatus(`启动语音异常: ${err.message}`);
			setIsListening(false);
		}
	};

	const handleCaptureScreenAndAsk = async () => {
		setLoading(true);
		setStatus("正在截取屏幕...");
		try {
			const res = await desktopApi.captureScreen({ target: "fullscreen" });
			setCapturedImage(res.path);
			setStatus(`已捕获屏幕: ${res.path}`);
			setResultText("已捕获全屏图像，可直接敲击 Enter 在主窗口中向 Agent 提问。");
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

	const handleGitQuickStatus = async () => {
		setLoading(true);
		setStatus("正在检查工作区 Git 状态...");
		try {
			const res = await desktopApi.getGitStatus();
			if (!res.isRepo) {
				setResultText("当前工作区不是有效的 Git 仓库。");
			} else {
				const modified = res.files?.filter((f) => f.status !== "untracked").length ?? 0;
				const untracked = res.files?.filter((f) => f.status === "untracked").length ?? 0;
				setResultText(
					`Git 分支: ${res.branch || "main"}\n• 已修改: ${modified} 文件\n• 未跟踪: ${untracked} 文件\n• 领先: ${res.ahead ?? 0} | 落后: ${res.behind ?? 0}`,
				);
			}
		} catch (err: any) {
			setResultText(`Git 状态检查失败: ${err.message}`);
		} finally {
			setLoading(false);
			setStatus(null);
		}
	};

	const quickActions: QuickActionItem[] = [
		{
			id: "screen",
			title: "截取屏幕提问",
			desc: "捕获当前全屏幕图像并准备向 Agent 分析",
			icon: Monitor,
			execute: handleCaptureScreenAndAsk,
		},
		{
			id: "git",
			title: "检查 Git 状态",
			desc: "查看当前分支修改、待提交及落后情况",
			icon: GitBranch,
			execute: handleGitQuickStatus,
		},
		{
			id: "kill3000",
			title: "释放 :3000 端口",
			desc: "终止占用前端 DevServer 3000 端口的进程",
			icon: Zap,
			execute: () => handleKillCommonPort(3000),
		},
		{
			id: "kill5173",
			title: "释放 :5173 端口",
			desc: "终止占用 Vite DevServer 5173 端口的进程",
			icon: Zap,
			execute: () => handleKillCommonPort(5173),
		},
		{
			id: "kill8080",
			title: "释放 :8080 端口",
			desc: "终止占用服务 8080 端口的僵尸进程",
			icon: Trash,
			execute: () => handleKillCommonPort(8080),
		},
		{
			id: "clip",
			title: "读取系统剪贴板",
			desc: "快速检查当前系统剪切板纯文本",
			icon: Sliders,
			execute: handleClipboardAction,
		},
	];

	const handleExecuteTerminalCommand = async (cmd: string) => {
		setLoading(true);
		setStatus(`正在执行本地终端命令: ${cmd} ...`);
		const startTime = Date.now();
		try {
			const res = await desktopApi.runTerminalCommand({ command: cmd });
			const duration = Date.now() - startTime;
			const out = res.stdout ? res.stdout.trimEnd() : "";
			const err = res.stderr ? res.stderr.trimEnd() : "";
			let fullOutput = `$ ${cmd}\n[退出码: ${res.exitCode} | 耗时: ${duration}ms]\n`;
			if (out) fullOutput += `\n${out}`;
			if (err) fullOutput += `\n\n[stderr]:\n${err}`;
			if (!out && !err && res.exitCode === 0) {
				fullOutput += "\n✅ 命令执行完成 (无标准输出)";
			}
			setResultText(fullOutput);
		} catch (err: any) {
			setResultText(`$ ${cmd}\n❌ 执行失败: ${err.message || String(err)}`);
		} finally {
			setLoading(false);
			setStatus(null);
		}
	};

	const handleInlineAiStream = async (promptText: string) => {
		setLoading(true);
		setStatus("正在建立独立会话并驱动 OpenPI 思考...");
		setResultText("🤖 OpenPI 思考中...\n");
		if (sessionUnsubRef.current) {
			sessionUnsubRef.current();
			sessionUnsubRef.current = null;
		}

		try {
			const conv = await desktopApi.createConversation({
				label: `HUD: ${promptText.slice(0, 20)}`,
				mode: "work",
			});
			setInlineSessionId(conv.id);
			activeSessionIdRef.current = conv.id;

			await desktopApi.watchConversation(conv.id);

			let accumulatedText = "";
			const unsub = desktopApi.onConversationEvent((payload) => {
				if (payload.instanceId !== conv.id || !payload.event) return;
				const ev = payload.event as Record<string, any>;
				const evType = ev.type;

				if (evType === "message_update") {
					const am = ev.assistantMessageEvent;
					if (am?.type === "text_delta" && typeof am.delta === "string") {
						accumulatedText += am.delta;
						setResultText(accumulatedText);
					}
				} else if (evType === "tool_execution_start" || evType === "tool_call") {
					const toolName = ev.toolName || ev.name || "tool";
					accumulatedText += `\n> ⚙️ [Agent 调用工具: ${toolName}]...\n`;
					setResultText(accumulatedText);
				} else if (evType === "agent_settled" || evType === "agent_end" || evType === "stream_closed") {
					setLoading(false);
					setStatus(null);
				}
			});
			sessionUnsubRef.current = unsub;

			await desktopApi.sendMessage(conv.id, promptText, []);
		} catch (err: any) {
			setResultText((prev) => `${prev ? `${prev}\n` : ""}❌ 对话异常: ${err.message || String(err)}`);
			setLoading(false);
			setStatus(null);
		}
	};

	const handleSubmit = async (e?: React.FormEvent, isForceMain = false) => {
		e?.preventDefault();
		const trimmed = query.trim();

		// If in symbols mode, selecting a symbol:
		if (mode === "symbols") {
			const selected = symbolResults[selectedIndex];
			if (selected) {
				const prompt = `[关于代码符号: ${selected.name} (${selected.filePath}:${selected.line})] `;
				if (onOpenMainWithPrompt) {
					onOpenMainWithPrompt(prompt);
					void desktopApi.focusMainWindow();
					handleClose();
				} else {
					await desktopApi.manageClipboard({ action: "write", text: `${selected.filePath}:${selected.line}` });
					setResultText(`已复制符号路径至剪贴板: ${selected.filePath}:${selected.line}`);
				}
				return;
			}
		}

		// If in actions mode, execute selected action:
		if (mode === "actions") {
			const action = quickActions[selectedIndex];
			if (action) {
				await action.execute();
				return;
			}
		}

		if (!trimmed && !capturedImage) return;

		// Force main window via Cmd+Enter:
		if (isForceMain) {
			if (onOpenMainWithPrompt) {
				onOpenMainWithPrompt(trimmed, capturedImage ? [capturedImage] : undefined);
				void desktopApi.focusMainWindow();
				handleClose();
			} else {
				void desktopApi.focusMainWindow();
			}
			return;
		}

		// Local heuristic shortcuts in ask mode:
		const parsed = parseHudCommand(trimmed);
		if (parsed.type === "kill_port") {
			await handleKillCommonPort(parsed.port);
			return;
		}
		if (parsed.type === "capture_screen") {
			await handleCaptureScreenAndAsk();
			return;
		}
		if (parsed.type === "git_status") {
			await handleGitQuickStatus();
			return;
		}

		// Terminal Command Execution:
		if (isCliCommand(trimmed)) {
			const cmd = extractCliCommand(trimmed);
			await handleExecuteTerminalCommand(cmd);
			return;
		}

		// Inline AI Stream in HUD:
		await handleInlineAiStream(trimmed);
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Escape") {
			e.stopPropagation();
			handleClose();
			return;
		}

		if (mode === "symbols" && symbolResults.length > 0) {
			if (e.key === "ArrowDown") {
				e.preventDefault();
				setSelectedIndex((prev) => navigateIndex(prev, symbolResults.length, "down"));
				return;
			}
			if (e.key === "ArrowUp") {
				e.preventDefault();
				setSelectedIndex((prev) => navigateIndex(prev, symbolResults.length, "up"));
				return;
			}
		}

		if (mode === "actions" && quickActions.length > 0) {
			if (e.key === "ArrowDown") {
				e.preventDefault();
				setSelectedIndex((prev) => navigateIndex(prev, quickActions.length, "down"));
				return;
			}
			if (e.key === "ArrowUp") {
				e.preventDefault();
				setSelectedIndex((prev) => navigateIndex(prev, quickActions.length, "up"));
				return;
			}
		}

		if (e.key === "Enter") {
			if (e.metaKey || e.ctrlKey) {
				e.preventDefault();
				void handleSubmit(undefined, true);
				return;
			}
		}
	};

	return (
		<div className="floating-hud-overlay" onClick={handleClose}>
			<div className="floating-hud-card" onClick={(e) => e.stopPropagation()}>
				{/* Top Search Bar */}
				<form onSubmit={handleSubmit} className="hud-input-row">
					<div className="hud-brand-pill">
						<Zap size={16} className="text-blue-500" />
					</div>

					<input
						ref={inputRef}
						type="text"
						className="hud-main-input"
						placeholder={
							mode === "ask"
								? "向 OpenPI 提问或输入指令 (如: 修改登录逻辑、看屏幕、释放8080端口)..."
								: mode === "symbols"
									? "搜索全工程函数、类、接口代码符号 (输入即搜)..."
									: "选择系统快捷急救动作..."
						}
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						onKeyDown={handleKeyDown}
					/>

					{/* Voice Button */}
					<button
						type="button"
						className={`hud-voice-btn ${isListening ? "listening" : ""}`}
						onClick={handleToggleVoice}
						title={isListening ? "正在录音，点击停止" : "语音听写输入"}
					>
						<Mic size={15} />
					</button>

					{query && (
						<button type="submit" className="hud-submit-btn" disabled={loading} title="执行 (Enter)">
							<ArrowUp size={16} />
						</button>
					)}

					<button type="button" className="hud-close-btn" onClick={handleClose} title="关闭 (Esc)">
						<X size={15} />
					</button>
				</form>

				{/* Mode Switcher Tabs */}
				<div className="hud-tabs-row">
					<button
						type="button"
						className={`hud-tab-btn ${mode === "ask" ? "active" : ""}`}
						onClick={() => {
							setMode("ask");
							inputRef.current?.focus();
						}}
					>
						💬 指令对话
					</button>
					<button
						type="button"
						className={`hud-tab-btn ${mode === "symbols" ? "active" : ""}`}
						onClick={() => {
							setMode("symbols");
							inputRef.current?.focus();
						}}
					>
						🔍 代码符号
						{symbolStats && <span className="hud-tab-badge">{symbolStats.totalIndexed}</span>}
					</button>
					<button
						type="button"
						className={`hud-tab-btn ${mode === "actions" ? "active" : ""}`}
						onClick={() => {
							setMode("actions");
							inputRef.current?.focus();
						}}
					>
						⚡ 快捷急救
					</button>
				</div>

				{/* Content Area */}
				<div className="hud-body-area">
					{/* Symbols Mode List */}
					{mode === "symbols" && (
						<div className="hud-symbols-list">
							{loading && symbolResults.length === 0 ? (
								<div className="hud-loading-state">
									<RefreshCw size={16} className="animate-spin text-blue-500" />
									<span>检索符号中...</span>
								</div>
							) : symbolResults.length === 0 ? (
								<div className="hud-empty-state">
									<Search size={20} className="text-gray-400 mb-1" />
									<span>{query ? `未找到包含 "${query}" 的代码符号` : "输入符号名称进行全局秒搜"}</span>
								</div>
							) : (
								symbolResults.map((sym, idx) => {
									const isSelected = selectedIndex === idx;
									return (
										<div
											key={`${sym.filePath}-${sym.line}-${sym.name}-${idx}`}
											className={`hud-symbol-row ${isSelected ? "selected" : ""}`}
											onClick={() => {
												setSelectedIndex(idx);
												void handleSubmit();
											}}
										>
											<span className={`hud-kind-pill kind-${sym.kind}`}>{sym.kind}</span>
											<span className="hud-sym-name">{sym.name}</span>
											<span className="hud-sym-path">
												{sym.filePath}:{sym.line}
											</span>
											<ChevronRight size={13} className="hud-row-arrow" />
										</div>
									);
								})
							)}
						</div>
					)}

					{/* Actions Mode List */}
					{mode === "actions" && (
						<div className="hud-actions-list">
							{quickActions.map((act, idx) => {
								const isSelected = selectedIndex === idx;
								const Icon = act.icon;
								return (
									<div
										key={act.id}
										className={`hud-action-row ${isSelected ? "selected" : ""}`}
										onClick={() => {
											setSelectedIndex(idx);
											void act.execute();
										}}
									>
										<div className="hud-action-icon-wrap">
											<Icon size={15} />
										</div>
										<div className="hud-action-texts">
											<div className="hud-action-title">{act.title}</div>
											<div className="hud-action-desc">{act.desc}</div>
										</div>
										<ChevronRight size={13} className="hud-row-arrow" />
									</div>
								);
							})}
						</div>
					)}

					{/* Ask Mode / Status & Result View */}
					{mode === "ask" && (
						<div className="hud-ask-container">
							{status && <div className="hud-status-banner">{status}</div>}

							{resultText ? (
								<div className="hud-result-box">
									<pre className="hud-result-pre">{resultText}</pre>
									<div ref={resultEndRef} />
									{inlineSessionId && (
										<div className="hud-handoff-row" style={{ marginTop: 10 }}>
											<button
												type="button"
												className="hud-handoff-btn"
												onClick={async () => {
													if (onOpenMainWithPrompt) {
														onOpenMainWithPrompt(query.trim() || "继续此对话");
													}
													await desktopApi.focusMainWindow();
													handleClose();
												}}
											>
												在主窗口深入此会话 ➔
											</button>
										</div>
									)}
								</div>
							) : (
								<div className="hud-ask-presets">
									<div className="hud-preset-hint">常用快捷操作</div>
									<div className="hud-pills-row">
										<button type="button" className="hud-pill" onClick={() => void handleCaptureScreenAndAsk()}>
											<Monitor size={12} />
											📷 截屏提问
										</button>
										<button type="button" className="hud-pill" onClick={() => void handleGitQuickStatus()}>
											<GitBranch size={12} />
											🌿 Git 检查
										</button>
										<button type="button" className="hud-pill" onClick={() => void handleKillCommonPort(3000)}>
											<Zap size={12} />
											⚡ 释放 3000
										</button>
										<button type="button" className="hud-pill" onClick={() => void handleKillCommonPort(5173)}>
											<Zap size={12} />
											⚡ 释放 5173
										</button>
										<button type="button" className="hud-pill" onClick={() => void handleClipboardAction()}>
											<Sliders size={12} />
											📋 剪贴板
										</button>
									</div>
								</div>
							)}

							{capturedImage && onOpenMainWithPrompt && (
								<div className="hud-handoff-row">
									<button
										type="button"
										className="hud-handoff-btn"
										onClick={async () => {
											onOpenMainWithPrompt("请分析当前屏幕截屏中的内容：", [capturedImage]);
											await desktopApi.focusMainWindow();
											handleClose();
										}}
									>
										在主窗口中以此图提问 Agent ➔
									</button>
								</div>
							)}
						</div>
					)}
				</div>

				{/* Footer Info */}
				<div className="hud-footer">
					<div className="hud-footer-hints">
						<span><code>↵</code> 选定/发送</span>
						<span><code>⌘↵</code> 主窗口打开</span>
						<span><code>↑↓</code> 浏览列表</span>
						<span><code>Esc</code> 隐藏</span>
					</div>
					<div className="hud-footer-hotkey">
						<span>全局快捷键 <code>⌥Space</code></span>
					</div>
				</div>
			</div>
		</div>
	);
}
