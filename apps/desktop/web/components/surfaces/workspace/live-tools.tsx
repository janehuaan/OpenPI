import { useEffect, useState } from "react";
import { FileText, Search, Terminal, Wrench } from "../../icons.tsx";
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

/** Live tool-execution card shown at the tail of the message thread. */
export function ChatLiveTools({ tools }: { tools: RunningTool[] }) {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = window.setInterval(() => setNow(Date.now()), 1_000);
		return () => window.clearInterval(timer);
	}, []);
	return (
		<div className="tool-live-list">
			{tools.map((tool, toolIndex) => {
				const seconds = Math.max(0, Math.floor((now - tool.startedAt) / 1_000));
				const detail = getRunningToolDetail(tool);
				const output =
					tool.partialResult && typeof tool.partialResult === "object"
						? (tool.partialResult as { content?: Array<{ type?: string; text?: string }> }).content?.find(
								(c) => c?.type === "text",
							)?.text
						: undefined;
				const IconComp =
					tool.toolName === "bash"
						? Terminal
						: tool.toolName === "read" || tool.toolName === "edit" || tool.toolName === "write"
						? FileText
						: tool.toolName === "grep" || tool.toolName === "find"
						? Search
						: Wrench;
				return (
					<div className="tool-live" key={`${tool.toolCallId || "tool"}-${toolIndex}`}>
						<div className="tool-live-header">
							<IconComp size={13} className="tool-live-icon" />
							<span className="tool-live-name">{tool.toolName}</span>
							{detail && (
								<span
									className="tool-live-args"
									style={{
										fontFamily: "var(--font-mono, monospace)",
										fontSize: "11.5px",
										color: "var(--text-secondary)",
										overflow: "hidden",
										textOverflow: "ellipsis",
										whiteSpace: "nowrap",
										maxWidth: "360px",
									}}
									title={detail}
								>
									{detail}
								</span>
							)}
							<span className="tool-live-status">运行中{seconds > 0 ? ` · ${seconds}s` : ""}</span>
						</div>
						{output && <pre className="tool-live-output">{output.slice(-1200)}</pre>}
					</div>
				);
			})}
		</div>
	);
}
