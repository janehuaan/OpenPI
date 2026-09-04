/**
 * App shell: three panes and a status bar.
 *
 * Composition only. Session state lives in `useSessions`, stream reduction in
 * `lib/turn.ts`, and each pane is presentational — the old App.tsx held ~60
 * useState calls and 1,880 lines, with the surfaces in one 7,180-line file.
 */

import { useEffect, useState } from "react";
import type { SessionMode } from "@openpi/shared";
import { Chat } from "./components/Chat.tsx";
import { ContextPanel } from "./components/ContextPanel.tsx";
import { NewSessionDialog } from "./components/NewSessionDialog.tsx";
import { SessionList } from "./components/SessionList.tsx";
import { StatusBar } from "./components/StatusBar.tsx";
import { api, isNative } from "./lib/api.ts";
import { useSessions } from "./hooks/useSessions.ts";

export function App() {
	const sessions = useSessions();
	const [dialogOpen, setDialogOpen] = useState(false);
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
		<div className="app">
			<SessionList
				sessions={sessions.sessions}
				selectedId={sessions.selectedId}
				onSelect={(id) => void sessions.select(id)}
				onStop={(id) => void sessions.stop(id)}
				onDelete={(id) => void sessions.remove(id)}
				onNew={() => setDialogOpen(true)}
			/>

			<main className="main">
				{sessions.error ? <p className="error banner">{sessions.error}</p> : null}
				<Chat
					turn={sessions.turn}
					sending={sessions.sending}
					onSend={(message) => void sessions.send(message)}
					onAbort={() => void sessions.abort()}
					disabled={!sessions.selectedId}
				/>
			</main>

			<ContextPanel cwd={selected?.cwd} />

			<StatusBar restartDeferred={restartDeferred} onRestart={() => void restart()} />

			<NewSessionDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onCreate={(input) => void create(input)} />
		</div>
	);
}
