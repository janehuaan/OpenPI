import { useState } from "react";
import type { SessionInfo } from "@openpi/shared";
import { basename } from "../lib/paths.ts";

interface Props<TView extends string> {
	sessions: SessionInfo[];
	selectedId?: string;
	onSelect: (sessionId: string) => void;
	onStop: (sessionId: string) => void;
	onDelete: (sessionId: string) => void;
	onRename: (sessionId: string, name: string) => void;
	onProfile: () => void;
	onNew: () => void;
	views: Array<{ id: TView; label: string }>;
	view: TView;
	onView: (view: TView) => void;
}

export function SessionList<TView extends string>({
	sessions,
	selectedId,
	onSelect,
	onStop,
	onDelete,
	onRename,
	onNew,
	onProfile,
	views,
	view,
	onView,
}: Props<TView>) {
	const [renaming, setRenaming] = useState<string>();
	const [draft, setDraft] = useState("");

	const startRename = (session: SessionInfo) => {
		setRenaming(session.sessionId);
		setDraft(session.name ?? basename(session.cwd));
	};

	const commitRename = () => {
		if (renaming && draft.trim()) onRename(renaming, draft);
		setRenaming(undefined);
	};

	return (
		<aside className="sidebar">
			<header className="sidebar-head">
				<span className="brand">OpenPI</span>
				<span className="head-actions">
					<button type="button" onClick={onProfile} title="Profile">
						Profile
					</button>
					<button type="button" className="primary" onClick={onNew}>
						New
					</button>
				</span>
			</header>

			<nav className="view-tabs">
				{views.map((entry) => (
					<button
						key={entry.id}
						type="button"
						className={entry.id === view ? "tab on" : "tab"}
						onClick={() => onView(entry.id)}
					>
						{entry.label}
					</button>
				))}
			</nav>

			{sessions.length === 0 ? (
				<p className="empty">No sessions yet.</p>
			) : (
				<ul className="session-list">
					{sessions.map((session) => (
						<li key={session.sessionId} className={session.sessionId === selectedId ? "selected" : undefined}>
							{renaming === session.sessionId ? (
								<input
									className="rename-input"
									value={draft}
									onChange={(event) => setDraft(event.target.value)}
									onBlur={commitRename}
									onKeyDown={(event) => {
										if (event.key === "Enter") commitRename();
										if (event.key === "Escape") setRenaming(undefined);
									}}
									// biome-ignore lint/a11y/noAutofocus: the field replaces what was just clicked
									autoFocus
								/>
							) : (
							<button type="button" className="session" onClick={() => onSelect(session.sessionId)}>
								<span className="session-name">{session.name ?? basename(session.cwd)}</span>
								<span className="session-meta">
									<span className={`dot ${session.running ? "on" : "off"}`} aria-hidden="true" />
									{session.mode}
									{session.model ? ` · ${session.model}` : ""}
								</span>
								<span className="session-cwd" title={session.cwd}>
									{session.cwd}
								</span>
							</button>
							)}
							<span className="session-actions">
								<button type="button" onClick={() => startRename(session)} title="Rename">
									Rename
								</button>
								{session.running ? (
									<button type="button" onClick={() => onStop(session.sessionId)} title="Suspend">
										Suspend
									</button>
								) : null}
								<button type="button" onClick={() => onDelete(session.sessionId)} title="Delete">
									Delete
								</button>
							</span>
						</li>
					))}
				</ul>
			)}
		</aside>
	);
}
