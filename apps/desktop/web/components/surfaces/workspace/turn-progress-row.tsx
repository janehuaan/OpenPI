import { useEffect, useState } from "react";
import type { TurnProgress } from "../../../lib/turn-progress";
import { BrainCircuit } from "../../icons";

export function TurnProgressRow({ progress }: { progress?: TurnProgress }) {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!progress) return;
		setNow(Date.now());
		const timer = window.setInterval(() => setNow(Date.now()), 1_000);
		return () => window.clearInterval(timer);
	}, [progress]);
	if (!progress) return null;
	const seconds = Math.max(0, Math.floor((now - progress.startedAt) / 1_000));
	const isThinking = progress.stage === "thinking" || progress.stage === "starting" || progress.stage === "submitted";
	const isLongThinking = isThinking && seconds >= 10;

	// Contextual dynamic label based on elapsed seconds and stage
	let displayLabel = progress.label;
	if (isThinking) {
		if (seconds >= 12) {
			displayLabel = "云端模型正在深度推演与计算…";
		} else if (seconds >= 5) {
			displayLabel = "已连接云端，正在规划下一步…";
		} else if (displayLabel === "代理已启动，准备处理中…") {
			displayLabel = "已连接模型，正在思考…";
		}
	}

	return (
		<div className={`turn-progress ${isLongThinking ? "long-thinking" : ""}`} role="status" aria-live="polite">
			{isThinking ? (
				<BrainCircuit size={14} className="turn-progress-icon text-sky-400 mr-1.5 animate-pulse" />
			) : (
				<span className="turn-progress-dots" aria-hidden="true">
					<span />
					<span />
					<span />
				</span>
			)}
			<span className="turn-progress-label">
				{displayLabel}
			</span>
			{progress.step && progress.step > 1 && (
				<span className="text-[11px] px-1.5 py-0.5 rounded bg-sky-950/60 border border-sky-800/50 text-sky-300 font-mono ml-1.5">
					第 {progress.step} 步
				</span>
			)}
			{seconds > 0 && <span className="turn-progress-elapsed">{seconds} 秒</span>}
			{isLongThinking && (
				<span className="text-[11px] text-amber-400/80 ml-2" title="云端正在推演复杂逻辑，网络连接活跃">
					(云端推演中，保持连接)
				</span>
			)}
		</div>
	);
}
