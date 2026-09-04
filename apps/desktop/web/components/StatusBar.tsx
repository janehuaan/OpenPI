import { useEffect, useState } from "react";
import type { HealthInfo, ProviderStatus } from "@openpi/shared";
import { api } from "../lib/api.ts";

interface Props {
	/** Set when the daemon deferred a restart because a session was live. */
	restartDeferred: boolean;
	onRestart: () => void;
}

export function StatusBar({ restartDeferred, onRestart }: Props) {
	const [health, setHealth] = useState<HealthInfo>();
	const [providers, setProviders] = useState<ProviderStatus[]>([]);
	const [error, setError] = useState<string>();

	useEffect(() => {
		let cancelled = false;
		const poll = async () => {
			try {
				const [healthResult, authResult] = await Promise.all([api.health(), api.authStatus()]);
				if (cancelled) return;
				setHealth(healthResult);
				setProviders(authResult.providers);
				setError(undefined);
			} catch (caught) {
				if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
			}
		};
		void poll();
		// Slow poll: this is a status line, and health is cheap but not free.
		const timer = setInterval(poll, 10_000);
		return () => {
			cancelled = true;
			clearInterval(timer);
		};
	}, []);

	const configured = providers.filter((provider) => provider.configured).length;

	return (
		<footer className="status-bar">
			{error ? (
				<span className="status error">daemon unreachable — {error}</span>
			) : health ? (
				<>
					<span className="status">
						<span className="dot on" aria-hidden="true" /> daemon {health.version} · pid {health.pid}
					</span>
					<span className="status">
						{health.runningCount}/{health.sessionCount} running
					</span>
					<span className="status">
						{configured > 0 ? `${configured} provider${configured === 1 ? "" : "s"}` : "no providers"}
					</span>
				</>
			) : (
				<span className="status">connecting…</span>
			)}

			{restartDeferred ? (
				<span className="status warn">
					Backend rebuilt — restart deferred while a session is live.
					<button type="button" onClick={onRestart}>
						Restart now
					</button>
				</span>
			) : null}
		</footer>
	);
}
