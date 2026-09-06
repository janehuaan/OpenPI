import { useEffect, useState } from "react";
import type { TurnProgress } from "../../../lib/turn-progress";

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
	return (
		<div className="turn-progress" role="status" aria-live="polite">
			<span className="turn-progress-dots" aria-hidden="true">
				<span />
				<span />
				<span />
			</span>
			<span className="turn-progress-label">{progress.label}</span>
			{seconds > 0 && <span className="turn-progress-elapsed">{seconds} 秒</span>}
		</div>
	);
}
