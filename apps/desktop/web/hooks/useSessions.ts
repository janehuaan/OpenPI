/**
 * Session list and chat state.
 *
 * One hook owns the daemon conversation: the session list, the selected
 * session's transcript, and the event subscription. The old App.tsx held ~60
 * useState calls in one component; keeping the reducer in `turn.ts` and the
 * wiring here means the views stay presentational.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionInfo, SessionMode } from "@openpi/shared";
import { api } from "../lib/api.ts";
import { emptyTurnState, reduceTurn, type TurnState } from "../lib/turn.ts";
import { parseUiRequest, stripAnsi, type UiRequest, uiResponseCommand } from "../lib/ui-request.ts";

export interface SessionsState {
	sessions: SessionInfo[];
	selectedId?: string;
	turn: TurnState;
	loading: boolean;
	error?: string;
	sending: boolean;
	/** Extension prompts awaiting an answer; the agent turn is blocked on the first. */
	uiRequests: UiRequest[];
	/** Latest status text per extension key, e.g. a usage meter. */
	extensionStatus: Record<string, string>;
}

export function useSessions() {
	const [state, setState] = useState<SessionsState>({
		sessions: [],
		turn: emptyTurnState(),
		loading: true,
		sending: false,
		uiRequests: [],
		extensionStatus: {},
	});
	// The event handler must see the current selection without being torn down
	// and re-subscribed on every change.
	const selectedRef = useRef<string | undefined>(undefined);

	const refresh = useCallback(async () => {
		try {
			const { sessions } = await api.listSessions();
			setState((current) => ({ ...current, sessions, loading: false, error: undefined }));
		} catch (error) {
			setState((current) => ({ ...current, loading: false, error: describe(error) }));
		}
	}, []);

	useEffect(() => {
		void refresh();
		const stopEvents = api.onSessionEvent(({ sessionId, event }) => {
			// Events arrive for every subscribed session; only the visible one
			// updates the transcript.
			if (sessionId !== selectedRef.current) return;

			// An extension prompt blocks the agent turn until answered, so it is
			// surfaced as a dialog rather than folded into the transcript.
			const parsed = parseUiRequest(event);
			if (parsed.kind === "request") {
				setState((current) => ({ ...current, uiRequests: [...current.uiRequests, parsed.request] }));
				return;
			}
			if (parsed.kind === "status") {
				setState((current) => ({
					...current,
					extensionStatus: parsed.status.text
						? { ...current.extensionStatus, [parsed.status.key]: stripAnsi(parsed.status.text) }
						: omit(current.extensionStatus, parsed.status.key),
				}));
				return;
			}

			setState((current) => ({ ...current, turn: reduceTurn(current.turn, event) }));
		});
		const stopRefresh = api.onRefresh(() => void refresh());
		return () => {
			stopEvents();
			stopRefresh();
		};
	}, [refresh]);

	const select = useCallback(async (sessionId: string) => {
		selectedRef.current = sessionId;
		setState((current) => ({
			...current,
			selectedId: sessionId,
			turn: emptyTurnState(),
			uiRequests: [],
			extensionStatus: {},
			error: undefined,
		}));
		try {
			await api.subscribe(sessionId);
			// Replay history so a reopened session is not blank. get_messages is an
			// upstream RPC command; no custom command is needed for this.
			const history = await api.rpc<{ messages?: unknown[] }>(sessionId, { type: "get_messages" });
			const events = (history?.messages ?? []).map((message) => ({ type: "message_end", message }));
			setState((current) => ({
				...current,
				turn: events.reduce(reduceTurn, emptyTurnState()),
			}));
		} catch (error) {
			setState((current) => ({ ...current, error: describe(error) }));
		}
	}, []);

	const create = useCallback(
		async (input: { cwd: string; mode?: SessionMode; model?: string; name?: string }) => {
			try {
				const session = await api.createSession(input);
				await refresh();
				await select(session.sessionId);
				return session;
			} catch (error) {
				setState((current) => ({ ...current, error: describe(error) }));
				return undefined;
			}
		},
		[refresh, select],
	);

	const send = useCallback(async (message: string) => {
		const sessionId = selectedRef.current;
		if (!sessionId || !message.trim()) return;
		setState((current) => ({ ...current, sending: true, error: undefined }));
		try {
			// The prompt is acked as soon as preflight succeeds; the reply arrives as
			// events, so this resolving does not mean the turn is done.
			await api.rpc(sessionId, { type: "prompt", message });
		} catch (error) {
			setState((current) => ({ ...current, error: describe(error) }));
		} finally {
			setState((current) => ({ ...current, sending: false }));
		}
	}, []);

	const abort = useCallback(async () => {
		const sessionId = selectedRef.current;
		if (!sessionId) return;
		await api.rpc(sessionId, { type: "abort" }).catch(() => undefined);
	}, []);

	const stop = useCallback(
		async (sessionId: string) => {
			await api.stopSession(sessionId).catch(() => undefined);
			await refresh();
		},
		[refresh],
	);

	const rename = useCallback(
		async (sessionId: string, name: string) => {
			if (!name.trim()) return;
			await api.renameSession(sessionId, name.trim()).catch((error) => {
				setState((current) => ({ ...current, error: describe(error) }));
			});
			await refresh();
		},
		[refresh],
	);

	const remove = useCallback(
		async (sessionId: string) => {
			await api.deleteSession(sessionId).catch(() => undefined);
			if (selectedRef.current === sessionId) {
				selectedRef.current = undefined;
				setState((current) => ({ ...current, selectedId: undefined, turn: emptyTurnState() }));
			}
			await refresh();
		},
		[refresh],
	);

	/**
	 * Answer an extension prompt. Always sends a reply, including on cancel: the
	 * turn stays blocked until the subprocess hears something.
	 */
	const respondUi = useCallback(
		async (request: UiRequest, outcome: { value?: string; confirmed?: boolean; cancelled?: boolean }) => {
			const sessionId = selectedRef.current;
			setState((current) => ({
				...current,
				uiRequests: current.uiRequests.filter((pending) => pending.id !== request.id),
			}));
			if (!sessionId) return;
			await api.rpc(sessionId, uiResponseCommand(request, outcome)).catch(() => undefined);
		},
		[],
	);

	return { ...state, refresh, select, create, send, abort, stop, remove, rename, respondUi };
}

function omit(record: Record<string, string>, key: string): Record<string, string> {
	const { [key]: _removed, ...rest } = record;
	return rest;
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
