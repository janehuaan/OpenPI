import { useEffect, useState } from "react";
import type { ProviderStatus } from "@openpi/shared";
import { api } from "../lib/api.ts";

/**
 * Provider configuration.
 *
 * A fresh install imports the user's pi CLI credentials once, on the daemon's
 * first run. When that finds nothing, every model call fails with 401 and there
 * has to be a way out from inside the app — this is it.
 *
 * Editing keys is deliberately not here: they live in the isolated agent dir's
 * models.json, and a UI that writes that file races the sessions reading it.
 * `pi auth` is the supported path, and re-import covers the common case.
 */
export function ProvidersView({ active }: { active: boolean }) {
	const [providers, setProviders] = useState<ProviderStatus[]>([]);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [notice, setNotice] = useState<string>();
	const [error, setError] = useState<string>();

	useEffect(() => {
		if (!active) return;
		void refresh();
	}, [active]);

	const refresh = async () => {
		try {
			const { providers: next } = await api.authStatus();
			setProviders(next);
			setError(undefined);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setLoading(false);
		}
	};

	const reimport = async () => {
		setBusy(true);
		setNotice(undefined);
		try {
			const result = await api.importCredentials();
			setNotice(
				result.imported.length > 0
					? `Imported ${result.imported.join(", ")} — ${result.providers.length} provider(s) available.`
					: "Nothing to import from ~/.pi/agent.",
			);
			await refresh();
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setBusy(false);
		}
	};

	const configured = providers.filter((provider) => provider.configured);

	return (
		<section className="providers">
			<header className="tasks-head">
				<h1>Providers</h1>
				<button type="button" onClick={() => void reimport()} disabled={busy}>
					{busy ? "Importing…" : "Re-import from ~/.pi"}
				</button>
			</header>

			{error ? <p className="error banner">{error}</p> : null}
			{notice ? <p className="hint banner">{notice}</p> : null}

			{loading ? (
				<p className="empty">Loading…</p>
			) : providers.length === 0 ? (
				<div className="empty-state">
					<p>No providers configured, so model calls will fail with 401.</p>
					<p className="hint">
						Either import an existing pi CLI setup with the button above, or run{" "}
						<code>pi auth</code> against openpi's agent directory:
					</p>
					<pre>
						PI_CODING_AGENT_DIR=~/.openpi/agent npx pi auth
					</pre>
				</div>
			) : (
				<>
					<p className="hint">
						{configured.length} of {providers.length} have a key. Keys live in{" "}
						<code>~/.openpi/agent/models.json</code> and are never shown here.
					</p>
					<ul className="provider-list">
						{providers.map((provider) => (
							<li key={provider.provider}>
								<span className={`dot ${provider.configured ? "on" : "off"}`} aria-hidden="true" />
								<span className="provider-name">{provider.provider}</span>
								<span className="provider-meta">
									{provider.modelCount} model{provider.modelCount === 1 ? "" : "s"}
									{provider.baseUrl ? ` · ${provider.baseUrl}` : ""}
								</span>
								<span className={provider.configured ? "badge ok" : "badge"}>
									{provider.configured ? "key set" : "no key"}
								</span>
							</li>
						))}
					</ul>
				</>
			)}
		</section>
	);
}
