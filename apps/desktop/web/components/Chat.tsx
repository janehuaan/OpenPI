import { useEffect, useRef, useState } from "react";
import type { ChatMessage, TurnState } from "../lib/turn.ts";
import { Markdown } from "./Markdown.tsx";

interface Props {
	turn: TurnState;
	sending: boolean;
	onSend: (message: string) => void;
	onAbort: () => void;
	disabled?: boolean;
}

export function Chat({ turn, sending, onSend, onAbort, disabled }: Props) {
	const [draft, setDraft] = useState("");
	const endRef = useRef<HTMLDivElement>(null);

	// Follow the tail as text streams in.
	useEffect(() => {
		endRef.current?.scrollIntoView({ block: "end" });
	}, [turn.messages, turn.runningTools]);

	const submit = () => {
		const text = draft.trim();
		if (!text || disabled) return;
		setDraft("");
		onSend(text);
	};

	return (
		<section className="chat">
			<div className="transcript">
				{turn.messages.length === 0 ? (
					<p className="empty">Send a message to start.</p>
				) : (
					turn.messages.map((message) => <Message key={message.id} message={message} />)
				)}

				{turn.runningTools.length > 0 ? (
					<div className="tools-running">
						{turn.runningTools.map((tool) => (
							<span key={tool.id} className="tool-chip">
								{tool.name}…
							</span>
						))}
					</div>
				) : null}

				{turn.error ? <p className="error">{turn.error}</p> : null}
				<div ref={endRef} />
			</div>

			<footer className="composer">
				<textarea
					value={draft}
					onChange={(event) => setDraft(event.target.value)}
					onKeyDown={(event) => {
						// Enter sends, Shift+Enter inserts a newline.
						if (event.key === "Enter" && !event.shiftKey) {
							event.preventDefault();
							submit();
						}
					}}
					placeholder={disabled ? "Select a session first" : "Message…  (Shift+Enter for a newline)"}
					rows={3}
					disabled={disabled}
				/>
				<div className="composer-actions">
					{turn.active ? (
						<button type="button" onClick={onAbort}>
							Stop
						</button>
					) : null}
					<button type="button" className="primary" onClick={submit} disabled={disabled || sending || !draft.trim()}>
						{sending ? "Sending…" : "Send"}
					</button>
				</div>
			</footer>
		</section>
	);
}

function Message({ message }: { message: ChatMessage }) {
	return (
		<article className={`message ${message.role}`}>
			<header>{message.role === "user" ? "You" : "OpenPI"}</header>
			{/* The user's own text stays literal; assistant output gets markdown, built
			    as React elements so it never passes through innerHTML. */}
			{message.role === "assistant" ? (
				<Markdown text={message.text} />
			) : (
				<div className="body">{message.text}</div>
			)}
			{message.tools.length > 0 ? (
				<div className="tools">
					{message.tools.map((tool) => (
						<span key={tool.id} className="tool-chip done">
							{tool.name}
						</span>
					))}
				</div>
			) : null}
			{message.error ? <p className="error">{message.error}</p> : null}
			{message.streaming ? <span className="cursor" aria-hidden="true" /> : null}
		</article>
	);
}
