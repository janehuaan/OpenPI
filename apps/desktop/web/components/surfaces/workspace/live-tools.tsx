import { useEffect, useRef, useState } from "react";
import { AlertCircle, Check, Copy, FileText, Info, Search, Terminal, Wrench } from "../../icons.tsx";
import type { RunningTool } from "../../../types";
import {
	analyzeCommandExecutionState,
	getRunningToolDetail,
	getRunningToolOutput,
} from "../../../lib/helpers";

/** Live tool-execution card shown at the tail of the message thread. */
export function ChatLiveTools({ tools }: { tools: RunningTool[] }) {
	const [now, setNow] = useState(() => Date.now());
	const [copiedKey, setCopiedKey] = useState<string | null>(null);
	const [expandedCommands, setExpandedCommands] = useState<Record<string, boolean>>({});
	const outputRefs = useRef<Record<string, HTMLPreElement | null>>({});

	useEffect(() => {
		const timer = window.setInterval(() => setNow(Date.now()), 1_000);
		return () => window.clearInterval(timer);
	}, []);

	const copyText = async (key: string, text: string) => {
		try {
			await navigator.clipboard.writeText(text);
			setCopiedKey(key);
			setTimeout(() => {
				setCopiedKey((prev) => (prev === key ? null : prev));
			}, 1500);
		} catch {
			// fallback
		}
	};

	const toggleCommandExpand = (key: string) => {
		setExpandedCommands((prev) => ({ ...prev, [key]: !prev[key] }));
	};

	return (
		<div className="tool-live-list">
			{tools.map((tool, toolIndex) => {
				const key = `${tool.toolCallId || "tool"}-${toolIndex}`;
				const seconds = Math.max(0, Math.floor((now - tool.startedAt) / 1_000));
				const detail = getRunningToolDetail(tool);
				const output = getRunningToolOutput(tool);
				const diagnostic = analyzeCommandExecutionState(
					tool.toolName,
					detail.command || detail.summary,
					seconds,
					output,
				);

				const isBash = detail.isCommand;
				const IconComp = isBash
					? Terminal
					: tool.toolName === "read" || tool.toolName === "edit" || tool.toolName === "write"
					? FileText
					: tool.toolName === "grep" || tool.toolName === "find"
					? Search
					: Wrench;

				const commandText = detail.command || (detail.isCommand ? detail.summary : undefined);
				const isMultiline = commandText ? commandText.includes("\n") || commandText.length > 120 : false;
				const isExpanded = Boolean(expandedCommands[key]);
				const lineCount = output ? output.split("\n").length : 0;

				return (
					<div className="tool-live" key={key}>
						{/* Header row */}
						<div className="tool-live-header">
							<IconComp size={14} className="tool-live-icon" />
							<span className="tool-live-name">{tool.toolName}</span>

							{detail.cwd && (
								<span className="tool-live-tag" title={`工作目录: ${detail.cwd}`}>
									{detail.cwd}
								</span>
							)}

							<span className="tool-live-status">
								运行中 · {seconds}s
							</span>
						</div>

						{/* Full Command / Arguments Visibility */}
						{commandText ? (
							<div className="tool-live-cmd-container">
								<div className="tool-live-cmd-header">
									<span>执行命令</span>
									<div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
										{isMultiline && (
											<button
												type="button"
												className="tool-live-copy-btn"
												onClick={() => toggleCommandExpand(key)}
											>
												{isExpanded ? "收起" : "展开全部"}
											</button>
										)}
										<button
											type="button"
											className="tool-live-copy-btn"
											onClick={() => copyText(`cmd-${key}`, commandText)}
											title="复制完整指令"
										>
											{copiedKey === `cmd-${key}` ? (
												<>
													<Check size={10} />
													<span>已复制</span>
												</>
											) : (
												<>
													<Copy size={10} />
													<span>复制命令</span>
												</>
											)}
										</button>
									</div>
								</div>
								<pre
									className="tool-live-cmd-code"
									style={{
										maxHeight: isExpanded ? "400px" : "120px",
									}}
								>
									{commandText}
								</pre>
							</div>
						) : detail.filePath ? (
							<div className="tool-live-cmd-container">
								<div className="tool-live-cmd-header">
									<span>目标文件</span>
									<span className="tool-live-tag">{detail.filePath}</span>
								</div>
							</div>
						) : detail.query ? (
							<div className="tool-live-cmd-container">
								<div className="tool-live-cmd-header">
									<span>检索条件</span>
									<span className="tool-live-tag">{detail.query}</span>
								</div>
							</div>
						) : null}

						{/* Intelligent "Why It Takes So Long" Diagnostic Clue */}
						<div className={`tool-live-diagnostic ${diagnostic.warningLevel}`}>
							{diagnostic.warningLevel === "critical" ? (
								<AlertCircle size={14} />
							) : diagnostic.warningLevel === "warning" ? (
								<AlertCircle size={14} />
							) : (
								<Info size={14} />
							)}
							<div className="diagnostic-content">
								<div className="diagnostic-title">
									{diagnostic.title}
								</div>
								<div className="diagnostic-detail">
									{diagnostic.detail}
								</div>
								{diagnostic.suggestion && (
									<div className="diagnostic-suggestion">
										{diagnostic.suggestion}
									</div>
								)}
							</div>
						</div>

						{/* Streaming Output preview */}
						{output && (
							<>
								<div className="tool-live-output-bar">
									<span>实时输出 (共 {lineCount} 行)</span>
									<button
										type="button"
										className="tool-live-copy-btn"
										onClick={() => copyText(`out-${key}`, output)}
										title="复制当前控制台全部输出"
									>
										{copiedKey === `out-${key}` ? (
											<>
												<Check size={10} />
												<span>已复制输出</span>
											</>
										) : (
											<>
												<Copy size={10} />
												<span>复制输出</span>
											</>
										)}
									</button>
								</div>
								<pre
									ref={(el) => {
										outputRefs.current[key] = el;
										if (el) {
											el.scrollTop = el.scrollHeight;
										}
									}}
									className="tool-live-output"
								>
									{output}
								</pre>
							</>
						)}
					</div>
				);
			})}
		</div>
	);
}
