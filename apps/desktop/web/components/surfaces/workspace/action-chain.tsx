import { useEffect, useMemo, useRef, useState } from "react";
import { MiniDiffView } from "../../diff-viewer";
import { Bot, ChevronDown, FileText, Search, Terminal, Wrench } from "../../icons.tsx";
import { isDiffContent } from "../../../lib/diff";
import {
	computeTrajectorySummary,
	formatDuration,
	getRunningToolOutput,
	type ActionChainItem,
} from "../../../lib/helpers";
import type { RunningTool } from "../../../types";

function getRunningToolDetail(tool: RunningTool): string | undefined {
	if (!tool.args || typeof tool.args !== "object") return undefined;
	const args = tool.args as Record<string, unknown>;
	if (typeof args.command === "string") return args.command;
	if (typeof args.cmd === "string") return args.cmd;
	if (typeof args.path === "string") return args.path;
	if (typeof args.file === "string") return args.file;
	if (typeof args.pattern === "string") return args.pattern;
	if (typeof args.query === "string") return args.query;
	if (typeof args.prompt === "string") return args.prompt;
	return undefined;
}

export function AgentActionChain({
	actions,
	runningTools = [],
	defaultOpen,
	isWorking = false,
}: {
	actions: ActionChainItem[];
	runningTools?: RunningTool[];
	defaultOpen?: boolean;
	isWorking?: boolean;
}) {
	const hasError = actions.some((a) => a.isError);
	const [isOpen, setIsOpen] = useState(defaultOpen ?? isWorking);
	const wasWorkingRef = useRef(isWorking);
	const [expandedOutputs, setExpandedOutputs] = useState<Record<string, boolean>>({});

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
									<span className="trajectory-target" title={item.target || item.summary || item.name}>
										{item.target || item.summary || item.name}
									</span>
									{item.durationMs !== undefined && (
										<span className="trajectory-duration">· {formatDuration(item.durationMs)}</span>
									)}
									{isCurrentlyRunning ? (
										<span className="trajectory-badge running">running</span>
									) : item.badge ? (
										<span className={`trajectory-badge ${item.isError ? "error" : ""}`}>
											{item.badge}
										</span>
									) : null}
								</div>
								{isOutputOpen && effectiveOutput && (
									!isCurrentlyRunning && isDiffContent(effectiveOutput) ? (
										<MiniDiffView
											diffText={effectiveOutput}
											filename={item.target}
										/>
									) : (
										<pre
											ref={isCurrentlyRunning ? liveOutputRef : undefined}
											className={`trajectory-output ${isCurrentlyRunning ? "live-output" : ""}`}
										>
											{effectiveOutput}
										</pre>
									)
								)}
							</div>
						);
					})}

					{unmatchedRunningTools.map((tool, toolIdx) => {
						const detail = getRunningToolDetail(tool);
						const liveOutput = getRunningToolOutput(tool);
						const isBash = tool.toolName === "bash" || tool.toolName === "terminal";
						const IconComp = isBash
							? Terminal
							: tool.toolName === "grep" || tool.toolName === "find"
							? Search
							: FileText;

						return (
							<div className="trajectory-item" key={`${tool.toolCallId || "rt"}-${toolIdx}`}>
								<div className="trajectory-item-line">
									<span className="trajectory-verb">Running</span>
									<IconComp size={12} className="trajectory-icon" />
									<span className="trajectory-target" title={detail || tool.toolName}>
										{detail || tool.toolName}
									</span>
									<span className="trajectory-badge running">running</span>
								</div>
								{liveOutput && (
									<pre ref={liveOutputRef} className="trajectory-output live-output">
										{liveOutput}
									</pre>
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
