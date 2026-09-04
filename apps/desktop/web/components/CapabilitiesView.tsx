import { useEffect, useState } from "react";
import type { Capabilities } from "@openpi/shared";
import { api } from "../lib/api.ts";

/**
 * Extensions, skills, prompts and packages loaded by every session.
 *
 * `settings.json` in the isolated agent dir is the source of truth — the same
 * file `pi install` writes. The old desktop read this through four custom pi RPC
 * commands (`get_capabilities`, `reload_resources`, `install_package`,
 * `remove_package`) that existed only because the fork patched them into
 * upstream; 0.84.4 has none of them.
 *
 * Changes apply to new sessions. A running session has already loaded its
 * extensions, and reloading them under a live agent turn is not something
 * upstream exposes.
 */
export function CapabilitiesView({ active }: { active: boolean }) {
	const [capabilities, setCapabilities] = useState<Capabilities>();
	const [source, setSource] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string>();
	const [notice, setNotice] = useState<string>();

	useEffect(() => {
		if (!active) return;
		void refresh();
	}, [active]);

	const refresh = async () => {
		try {
			setCapabilities(await api.capabilities());
			setError(undefined);
		} catch (caught) {
			setError(describe(caught));
		}
	};

	const run = async (action: () => Promise<Capabilities>, done: string) => {
		setBusy(true);
		setError(undefined);
		setNotice(undefined);
		try {
			setCapabilities(await action());
			setNotice(`${done} — applies to new sessions.`);
			setSource("");
		} catch (caught) {
			setError(describe(caught));
		} finally {
			setBusy(false);
		}
	};

	const addLocal = async () => {
		const picked = await api.selectWorkspace().catch(() => ({ cwd: undefined }));
		if (picked.cwd) await run(() => api.addExtension(picked.cwd!), `Added ${picked.cwd}`);
	};

	const entries = capabilities?.entries ?? [];

	return (
		<section className="providers">
			<header className="tasks-head">
				<h1>Capabilities</h1>
				<button type="button" onClick={() => void addLocal()} disabled={busy}>
					Add local extension…
				</button>
			</header>

			{error ? <p className="error banner">{error}</p> : null}
			{notice ? <p className="hint banner">{notice}</p> : null}

			<div className="row install-row">
				<input
					value={source}
					onChange={(event) => setSource(event.target.value)}
					placeholder="npm package, git URL, or path"
					spellCheck={false}
				/>
				<button
					type="button"
					onClick={() => void run(() => api.installPackage(source.trim()), `Installed ${source.trim()}`)}
					disabled={busy || !source.trim()}
				>
					{busy ? "Working…" : "Install"}
				</button>
			</div>

			{capabilities ? (
				<p className="hint">
					Loaded from <code>{capabilities.agentDir}/settings.json</code>
				</p>
			) : null}

			{entries.length === 0 ? (
				<p className="empty">Nothing configured. openpi's own extensions ship inside the app and load automatically.</p>
			) : (
				<ul className="provider-list">
					{entries.map((entry) => (
						<li key={`${entry.kind}:${entry.source}`}>
							<span className={`dot ${entry.present ? "on" : "off"}`} aria-hidden="true" />
							<span className="provider-name">{entry.kind}</span>
							<span className="provider-meta" title={entry.resolved ?? entry.source}>
								{entry.source}
							</span>
							{entry.present ? null : <span className="badge">missing</span>}
							<button
								type="button"
								disabled={busy}
								onClick={() =>
									void run(
										() =>
											entry.kind === "package"
												? api.removePackage(entry.source)
												: api.removeExtension(entry.source),
										`Removed ${entry.source}`,
									)
								}
							>
								Remove
							</button>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
