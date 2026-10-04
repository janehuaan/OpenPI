import { useEffect, useState, useMemo } from "react";
import type { TurnProgress } from "../../../lib/turn-progress";

export interface TurnProgressRowProps {
	progress?: TurnProgress;
	onAbort?: () => void;
	isWorking?: boolean;
	tokens?: number;
}

function formatElapsed(seconds: number): string {
	if (seconds < 60) return `${seconds}s`;
	const m = Math.floor(seconds / 60);
	const s = seconds % 60;
	return `${m}m ${s}s`;
}

function formatTokens(count?: number): string {
	if (!count || count <= 0) return "";
	if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
	if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
	return String(count);
}

export function TurnProgressRow({ progress, isWorking, tokens }: TurnProgressRowProps) {
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		if (!progress && !isWorking) return;
		setNow(Date.now());
		const timer = window.setInterval(() => setNow(Date.now()), 1_000);
		return () => window.clearInterval(timer);
	}, [progress, isWorking]);

	const startedAt = progress?.startedAt || now;
	const seconds = Math.max(0, Math.floor((now - startedAt) / 1_000));

	// Contextual dynamic English verbs (Claude Code & elite developer agent runtime HUD)
	const verb = useMemo(() => {
		if (!progress) return "Reasoning";
		const stage = progress.stage;
		if (stage === "tool") {
			const t = (progress.toolName || "").toLowerCase();
			if (t.includes("bash") || t.includes("terminal") || t.includes("exec")) return "Executing";
			if (t.includes("read") || t.includes("find") || t.includes("grep") || t.includes("search")) return "Investigating";
			if (t.includes("edit") || t.includes("write") || t.includes("patch")) return "Refactoring";
			if (t.includes("subagent")) return "Orchestrating";
			if (t.includes("mcp")) return "Interfacing";
			return "Operating";
		}
		if (stage === "responding") return "Formulating";
		if (seconds >= 12) return "Illuminating";
		if (seconds >= 6) return "Synthesizing";
		if (seconds >= 3) return "Analyzing";
		return "Reasoning";
	}, [progress, seconds]);

	if (!progress && !isWorking) return null;

	const elapsedStr = formatElapsed(seconds);
	const tokenStr = formatTokens(tokens);

	return (
		<div className="agent-runtime-hud" role="status" aria-live="polite">
			<div className="agent-runtime-main-bar">
				<div className="agent-runtime-badge">
					<span className="agent-runtime-badge-icon">⌘</span>
					<span className="agent-runtime-badge-verb">{verb}...</span>
				</div>

				<div className="agent-runtime-meta-stream">
					<span className="agent-runtime-time">{elapsedStr}</span>

					{tokenStr && (
						<>
							<span className="agent-runtime-bullet">•</span>
							<span className="agent-runtime-tokens" title={`当前上下文消耗约 ${tokens?.toLocaleString()} tokens`}>
								↓ {tokenStr}
							</span>
						</>
					)}
				</div>
			</div>
		</div>
	);
}
