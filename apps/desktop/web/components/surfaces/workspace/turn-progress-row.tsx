import { useEffect, useState } from "react";
import type { TurnProgress } from "../../../lib/turn-progress";
import { BrainCircuit } from "../../icons";

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

export function TurnProgressRow({ progress, isWorking }: TurnProgressRowProps) {
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		if (!progress && !isWorking) return;
		setNow(Date.now());
		const timer = window.setInterval(() => setNow(Date.now()), 1_000);
		return () => window.clearInterval(timer);
	}, [progress, isWorking]);

	if (!progress && !isWorking) return null;

	const startedAt = progress?.startedAt || now;
	const seconds = Math.max(0, Math.floor((now - startedAt) / 1_000));
	const isThinking = !progress || progress.stage === "thinking" || progress.stage === "starting" || progress.stage === "submitted";
	const isLongThinking = isThinking && seconds >= 15;

	// Authentic, context-aware status label from turn-progress
	let displayLabel = progress?.label;
	if (!displayLabel || displayLabel === "代理已启动，准备处理中…") {
		displayLabel = "正在思考…";
	}
	if (isThinking) {
		if (seconds >= 20) {
			displayLabel = "云端模型正在深度推演与计算…";
		} else if (seconds >= 10 && displayLabel === "正在思考…") {
			displayLabel = "已连接云端，正在规划下一步…";
		}
	}

	return (
		<div className={`turn-progress ${isLongThinking ? "long-thinking" : ""}`} role="status" aria-live="polite">
			{isThinking ? (
				<BrainCircuit size={13} className="turn-progress-icon text-sky-400 animate-pulse" />
			) : (
				<span className="turn-progress-dot" aria-hidden="true" />
			)}

			<span className="turn-progress-label">{displayLabel}</span>

			{progress?.step && progress.step > 1 && (
				<span className="turn-progress-step-tag">
					第 {progress.step} 步
				</span>
			)}

			{seconds > 0 && <span className="turn-progress-elapsed">{formatElapsed(seconds)}</span>}

			{isLongThinking && seconds >= 30 && (
				<span className="turn-progress-hint" title="云端正在推演复杂逻辑，网络连接活跃">
					(云端推演中，保持连接)
				</span>
			)}
		</div>
	);
}
