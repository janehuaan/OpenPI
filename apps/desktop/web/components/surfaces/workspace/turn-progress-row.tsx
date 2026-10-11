import { useEffect, useState } from "react";
import { turnVerb, type TurnProgress } from "../../../lib/turn-progress";

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

	// Shared with the island so both surfaces name the activity identically.
	const verb = turnVerb(progress, seconds);

	if (!progress && !isWorking) return null;

	const elapsedStr = formatElapsed(seconds);
	const tokenStr = formatTokens(tokens);
	// 「最近活动」是分辨「在推进」与「卡住」的唯一硬信号：它只由真实事件推进。
	const lastEventAt = progress?.lastEventAt;
	const idleSeconds = lastEventAt ? Math.max(0, Math.floor((now - lastEventAt) / 1_000)) : undefined;
	const idleStr =
		idleSeconds === undefined ? "" : idleSeconds < 3 ? "刚刚有响应" : `${formatElapsed(idleSeconds)} 无响应`;
	const toolCount = progress?.toolCount ?? 0;

	return (
		<div className="agent-runtime-hud" role="status" aria-live="polite">
			<div className="agent-runtime-main-bar">
				<div className={`agent-runtime-badge ${progress?.stage === "reviewing" ? "is-reviewing" : ""}`}>
					<span className="agent-runtime-badge-icon">{progress?.stage === "reviewing" ? "🧐" : "⌘"}</span>
					<span className="agent-runtime-badge-verb">{verb}...</span>
				</div>

				<div className="agent-runtime-meta-stream">
					<span className="agent-runtime-time">{elapsedStr}</span>

					{toolCount > 0 && (
						<>
							<span className="agent-runtime-bullet">•</span>
							<span className="agent-runtime-tools" title="本轮已执行的工具调用次数">
								第 {toolCount} 次工具调用
							</span>
						</>
					)}

					{idleStr && (
						<>
							<span className="agent-runtime-bullet">•</span>
							<span
								className="agent-runtime-idle"
								style={idleSeconds !== undefined && idleSeconds >= 60 ? { color: "#d97706", fontWeight: 500 } : undefined}
								title="距最近一次真实事件（模型输出或工具结果）的时间"
							>
								{idleStr}
							</span>
						</>
					)}

					{progress?.stage === "reviewing" && progress.label && (
						<>
							<span className="agent-runtime-bullet">•</span>
							<span style={{ color: "#a855f7", fontWeight: 500 }}>{progress.label}</span>
						</>
					)}

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

			{progress?.guardMessage && (
				<div className="agent-runtime-guard" role="note">
					<span className="agent-runtime-guard-icon">🛡️</span>
					<span>{progress.guardMessage}</span>
				</div>
			)}
		</div>
	);
}
