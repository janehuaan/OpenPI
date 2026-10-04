import { useEffect, useMemo, useRef, useState } from "react";
import { MiniDiffView } from "../../diff-viewer";
import {
	AlertCircle,
	Bot,
	Check,
	ChevronDown,
	Copy,
	FileText,
	Search,
	Square,
	Terminal,
	Wrench,
} from "../../icons.tsx";
import { isDiffContent } from "../../../lib/diff";
import {
	analyzeCommandExecutionState,
	computeTrajectorySummary,
	formatDuration,
	getRunningToolDetail,
	getRunningToolOutput,
	type ActionChainItem,
} from "../../../lib/helpers";
import type { RunningTool } from "../../../types";

export function AgentActionChain({
	actions,
	runningTools = [],
	defaultOpen,
	isWorking = false,
	workspaceCwd,
}: {
	actions: ActionChainItem[];
	runningTools?: RunningTool[];
	defaultOpen?: boolean;
	isWorking?: boolean;
	workspaceCwd?: string;
}) {
	const hasError = actions.some((a) => a.isError);
	const [isOpen, setIsOpen] = useState(defaultOpen ?? isWorking);
	const wasWorkingRef = useRef(isWorking);
	const [expandedOutputs, setExpandedOutputs] = useState<Record<string, boolean>>({});
	const [copiedKey, setCopiedKey] = useState<string | null>(null);
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		if (!isWorking && runningTools.length === 0) return;
		const timer = window.setInterval(() => setNow(Date.now()), 1_000);
		return () => window.clearInterval(timer);
	}, [isWorking, runningTools.length]);

	useEffect(() => {
		if (isWorking && !wasWorkingRef.current) {
			setIsOpen(true);
		} else if (!isWorking && wasWorkingRef.current) {
			setIsOpen(false);
		}
		wasWorkingRef.current = isWorking;
	}, [isWorking]);

	const toggleOutput = (id: string) => {
		setExpandedOutputs((prev) => ({ ...prev, [id]: !prev[id] }));
	};

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

	const activeTool = runningTools[0];
	const summaryText = useMemo(() => {
		return computeTrajectorySummary(actions, isWorking, activeTool?.toolName);
	}, [actions, isWorking, activeTool?.toolName]);

	const liveOutputRef = useRef<HTMLPreElement | null>(null);
	const liveOutputText = activeTool ? getRunningToolOutput(activeTool) : undefined;
	useEffect(() => {
		if (liveOutputRef.current) {
			liveOutputRef.current.scrollTop = liveOutputRef.current.scrollHeight;
		}
	}, [liveOutputText]);

	const unmatchedRunningTools = useMemo(() => {
		return runningTools.filter(
			(rt) => !actions.some((a) => a.id === rt.toolCallId || (a.name === rt.toolName && !a.output)),
		);
	}, [runningTools, actions]);

	return (
		<div className={`agent-action-chain ${hasError ? "has-error" : ""}`}>
			<button
				type="button"
				className="trajectory-header-btn"
				onClick={() => setIsOpen((prev) => !prev)}
				aria-expanded={isOpen}
			>
				<span>{summaryText}</span>
				{hasError && <span className="trajectory-badge error">error</span>}
				<ChevronDown
					size={12}
					className="trajectory-chevron"
					style={{
						transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
					}}
				/>
			</button>
			{isOpen && (
				<div className="trajectory-list">
					{actions.map((item, idx) => {
						const key = `${item.id || "act"}-${idx}`;
						const matchedTool = runningTools.find(
							(t) => t.toolCallId === item.id || (t.toolName === item.name && !item.output),
						);
						const isCurrentlyRunning = Boolean(matchedTool && isWorking);
						const liveOutput = matchedTool ? getRunningToolOutput(matchedTool) : undefined;
						const effectiveOutput = liveOutput || item.output;
						const isOutputOpen = isCurrentlyRunning || Boolean(expandedOutputs[key]);

						const seconds = matchedTool
							? Math.max(0, Math.floor((now - matchedTool.startedAt) / 1_000))
							: item.startedAt
							? Math.max(0, Math.floor((now - item.startedAt) / 1_000))
							: undefined;

						const toolDetail = matchedTool ? getRunningToolDetail(matchedTool) : undefined;
						const commandText = toolDetail?.command || item.target;

						const diagnostic = isCurrentlyRunning
							? analyzeCommandExecutionState(
									matchedTool?.toolName || item.name,
									commandText || "",
									seconds ?? 0,
									effectiveOutput,
							  )
							: undefined;

						const IconComp =
							item.actionType === "bash" || item.iconName === "terminal"
								? Terminal
								: item.actionType === "search" || item.iconName === "search"
								? Search
								: item.actionType === "read" ||
								  item.actionType === "edit" ||
								  item.actionType === "write" ||
								  item.iconName === "file"
								? FileText
								: item.iconName === "bot"
								? Bot
								: Wrench;

						return (
							<div className="trajectory-item" key={key}>
								<div
									className="trajectory-item-line"
									onClick={() => effectiveOutput && toggleOutput(key)}
									style={{ cursor: effectiveOutput ? "pointer" : "default" }}
								>
									<span className="trajectory-verb">{item.verb || "Called"}</span>
									<IconComp size={12} className="trajectory-icon" />
									<span className="trajectory-target" title={commandText || item.summary || item.name}>
										{commandText || item.summary || item.name}
									</span>
									{isCurrentlyRunning ? (
										<span className="trajectory-duration text-sky-500 font-mono">
											· {seconds !== undefined ? `${seconds}s` : "运行中"}
										</span>
									) : item.durationMs !== undefined ? (
										<span className="trajectory-duration">· {formatDuration(item.durationMs)}</span>
									) : null}

									{isCurrentlyRunning ? (
										<span className="trajectory-badge running">running</span>
									) : item.badge ? (
										<span className={`trajectory-badge ${item.isError ? "error" : ""}`}>
											{item.badge}
										</span>
									) : null}

								</div>

								{/* Running command diagnostics & explanation */}
								{isCurrentlyRunning && diagnostic && (
									<div className={`tool-live-diagnostic ${diagnostic.warningLevel}`}>
										<AlertCircle size={13} />
										<div className="diagnostic-content">
											<div className="diagnostic-title">{diagnostic.title}</div>
											<div className="diagnostic-detail">{diagnostic.detail}</div>
											{diagnostic.suggestion && (
												<div className="diagnostic-suggestion">{diagnostic.suggestion}</div>
											)}
										</div>
									</div>
								)}

								{isOutputOpen && effectiveOutput && (
									!isCurrentlyRunning && isDiffContent(effectiveOutput) ? (
										<MiniDiffView
											diffText={effectiveOutput}
											filename={item.target}
											workspaceCwd={workspaceCwd}
										/>
									) : (
										<div>
											{isCurrentlyRunning && (
												<div className="tool-live-output-bar px-1">
													<span>实时输出流</span>
													<button
														type="button"
														className="tool-live-copy-btn"
														onClick={() => copyText(`out-${key}`, effectiveOutput)}
														title="复制输出"
													>
														{copiedKey === `out-${key}` ? (
															<>
																<Check size={9} className="text-emerald-500" />
																<span>已复制</span>
															</>
														) : (
															<>
																<Copy size={9} />
																<span>复制输出</span>
															</>
														)}
													</button>
												</div>
											)}
											<pre
												ref={isCurrentlyRunning ? liveOutputRef : undefined}
												className={`trajectory-output ${isCurrentlyRunning ? "live-output" : ""}`}
											>
												{effectiveOutput}
											</pre>
										</div>
									)
								)}
							</div>
						);
					})}

					{unmatchedRunningTools.map((tool, toolIdx) => {
						const key = `${tool.toolCallId || "rt"}-${toolIdx}`;
						const detail = getRunningToolDetail(tool);
						const liveOutput = getRunningToolOutput(tool);
						const seconds = Math.max(0, Math.floor((now - tool.startedAt) / 1_000));
						const isBash = detail.isCommand;
						const IconComp = isBash
							? Terminal
							: tool.toolName === "grep" || tool.toolName === "find"
							? Search
							: FileText;

						const diagnostic = analyzeCommandExecutionState(
							tool.toolName,
							detail.command || detail.summary,
							seconds,
							liveOutput,
						);

						return (
							<div className="trajectory-item" key={key}>
								<div className="trajectory-item-line">
									<span className="trajectory-verb">Running</span>
									<IconComp size={12} className="trajectory-icon" />
									<span className="trajectory-target" title={detail.command || detail.summary}>
										{detail.command || detail.summary}
									</span>
									<span className="trajectory-duration text-sky-500 font-mono">
										· {seconds}s
									</span>
									<span className="trajectory-badge running">running</span>

								</div>

								{/* Running command diagnostic — only when there is something actionable */}
								{diagnostic && (
									<div className={`tool-live-diagnostic ${diagnostic.warningLevel}`}>
										<AlertCircle size={13} />
										<div className="diagnostic-content">
											<div className="diagnostic-title">{diagnostic.title}</div>
											<div className="diagnostic-detail">{diagnostic.detail}</div>
											{diagnostic.suggestion && (
												<div className="diagnostic-suggestion">{diagnostic.suggestion}</div>
											)}
										</div>
									</div>
								)}

								{liveOutput && (
									<div>
										<div className="tool-live-output-bar px-1">
											<span>实时输出流</span>
											<button
												type="button"
												className="tool-live-copy-btn"
												onClick={() => copyText(`out-${key}`, liveOutput)}
												title="复制输出"
											>
												{copiedKey === `out-${key}` ? (
													<>
														<Check size={9} className="text-emerald-500" />
														<span>已复制</span>
													</>
												) : (
													<>
														<Copy size={9} />
														<span>复制输出</span>
													</>
												)}
											</button>
										</div>
										<pre ref={liveOutputRef} className="trajectory-output live-output">
											{liveOutput}
										</pre>
									</div>
								)}
							</div>
						);
					})}

					{isWorking && actions.length === 0 && runningTools.length === 0 && (
						<div className="trajectory-working">
							<span className="trajectory-pulse" />
							<span>Working...</span>
						</div>
					)}
				</div>
			)}
		</div>
	);
}
