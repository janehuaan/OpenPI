/**
 * App shell: a view switcher over three panes, plus the status bar.
 *
 * Composition only. Session state lives in `useSessions`, tasks in `useTasks`,
 * stream reduction in `lib/turn.ts`, and each pane is presentational — the old
 * App.tsx held ~60 `useState` calls in 1,880 lines, with every surface in one
 * 7,180-line file.
 */

import { useEffect, useState } from "react";
import type { SessionMode } from "@openpi/shared";
import { Chat } from "./components/Chat.tsx";
import { ContextPanel } from "./components/ContextPanel.tsx";
import { NewSessionDialog } from "./components/NewSessionDialog.tsx";
import { CapabilitiesView } from "./components/CapabilitiesView.tsx";
import { MediaView } from "./components/MediaView.tsx";
import { ProfileDialog } from "./components/ProfileDialog.tsx";
import { ProvidersView } from "./components/ProvidersView.tsx";
import { SessionList } from "./components/SessionList.tsx";
import { StatusBar } from "./components/StatusBar.tsx";
import { TasksView } from "./components/TasksView.tsx";
import { UiRequestDialog } from "./components/UiRequestDialog.tsx";
import { api, isNative } from "./lib/api.ts";
import { useSessions } from "./hooks/useSessions.ts";

type View = "chat" | "tasks" | "providers" | "capabilities" | "media";

const VIEWS: Array<{ id: View; label: string }> = [
	{ id: "chat", label: "Chat" },
	{ id: "tasks", label: "Tasks" },
	{ id: "providers", label: "Providers" },
	{ id: "capabilities", label: "Extensions" },
	{ id: "media", label: "Media" },
];

export function App() {
	const sessions = useSessions();
	const [view, setView] = useState<View>("chat");
	const [dialogOpen, setDialogOpen] = useState(false);
	const [profileOpen, setProfileOpen] = useState(false);
	const [restartDeferred, setRestartDeferred] = useState(false);

	useEffect(() => {
		if (!isNative) return;
		return api.onDaemonStatus((status) => {
			if (status.kind === "restart_deferred") setRestartDeferred(true);
		});
	}, []);

	if (!isNative) {
		return (
			<main className="fatal">
				<h1>OpenPI</h1>
				<p>This UI needs the Electron shell. Run `npm run dev -w @openpi/desktop`.</p>
			</main>
		);
	}

	const selected = sessions.sessions.find((session) => session.sessionId === sessions.selectedId);
	// Only the first prompt matters: the turn is blocked on it, so later ones
	// cannot have been produced yet.
	const pendingUi = sessions.uiRequests[0];

	const create = async (input: { cwd: string; mode: SessionMode; model?: string; name?: string }) => {
		setDialogOpen(false);
		await sessions.create(input);
	};

	const restart = async () => {
		setRestartDeferred(false);
		await api.restartDaemon().catch(() => undefined);
		await sessions.refresh();
	};

	return (
		<div className={view === "chat" ? "app" : "app single"}>
			<SessionList
				sessions={sessions.sessions}
				selectedId={sessions.selectedId}
				onSelect={(id) => {
					setView("chat");
					void sessions.select(id);
				}}
				onStop={(id) => void sessions.stop(id)}
				onDelete={(id) => void sessions.remove(id)}
				onRename={(id, name) => void sessions.rename(id, name)}
				onNew={() => setDialogOpen(true)}
				onProfile={() => setProfileOpen(true)}
				views={VIEWS}
				view={view}
				onView={setView}
			/>

			<main className="main">
				{sessions.error ? <p className="error banner">{sessions.error}</p> : null}

				{view === "chat" ? (
					<Chat
						turn={sessions.turn}
						sending={sessions.sending}
						onSend={(message) => void sessions.send(message)}
						onAbort={() => void sessions.abort()}
						disabled={!sessions.selectedId}
					/>
				) : view === "tasks" ? (
					<TasksView active={view === "tasks"} />
				) : view === "providers" ? (
					<ProvidersView active={view === "providers"} />
				) : view === "capabilities" ? (
					<CapabilitiesView active={view === "capabilities"} />
				) : (
					<MediaView active={view === "media"} />
				)}
			</main>

			{view === "chat" ? <ContextPanel cwd={selected?.cwd} /> : null}

			<StatusBar
				restartDeferred={restartDeferred}
				onRestart={() => void restart()}
				extensionStatus={sessions.extensionStatus}
			/>

			<NewSessionDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onCreate={(input) => void create(input)} />

			<ProfileDialog open={profileOpen} onClose={() => setProfileOpen(false)} />

			{pendingUi ? (
				<UiRequestDialog
					request={pendingUi}
					onRespond={(outcome) => void sessions.respondUi(pendingUi, outcome)}
				/>
			) : null}
		</div>
	);
}
