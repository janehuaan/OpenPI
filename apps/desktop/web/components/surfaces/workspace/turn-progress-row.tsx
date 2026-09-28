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
	const isThinking = progress.stage === "thinking";
	const isLongThinking = isThinking && seconds >= 15;

	return (
		<div className={`turn-progress ${isLongThinking ? "long-thinking" : ""}`} role="status" aria-live="polite">
			{isThinking ? (
				<BrainCircuit size={14} className="turn-progress-icon text-sky-400 mr-1.5" />
			) : (
				<span className="turn-progress-dots" aria-hidden="true">
					<span />
					<span />
					<span />
				</span>
			)}
			<span className="turn-progress-label">
				{isLongThinking ? "正在进行深度逻辑推演思考…" : progress.label}
			</span>
			{seconds > 0 && <span className="turn-progress-elapsed">{seconds} 秒</span>}
			{isLongThinking && seconds >= 35 && (
				<span className="text-[11px] text-amber-400/80 ml-2" title="当前模型正在深入推演边缘场景，如需极速响应可在设置中调低思考档位">
					(复杂推演中，保持连接活跃)
				</span>
			)}
		</div>
	);
}
