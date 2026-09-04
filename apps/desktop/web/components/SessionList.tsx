import type { SessionInfo } from "@openpi/shared";
import { basename } from "../lib/paths.ts";

interface Props<TView extends string> {
	sessions: SessionInfo[];
	selectedId?: string;
	onSelect: (sessionId: string) => void;
	onStop: (sessionId: string) => void;
	onDelete: (sessionId: string) => void;
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
	onNew,
	views,
	view,
	onView,
}: Props<TView>) {
	return (
		<aside className="sidebar">
			<header className="sidebar-head">
				<span className="brand">OpenPI</span>
				<button type="button" className="primary" onClick={onNew}>
					New
				</button>
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
							<span className="session-actions">
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
