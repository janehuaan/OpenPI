import { useEffect, useRef, useState } from "react";
import { type Attachment, formatBytes, messageWithAttachments, readAttachment } from "../lib/attachments.ts";
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
	const [attachments, setAttachments] = useState<Attachment[]>([]);
	const [dropping, setDropping] = useState(false);
	const [attachError, setAttachError] = useState<string>();
	const endRef = useRef<HTMLDivElement>(null);
	const fileRef = useRef<HTMLInputElement>(null);

	// Follow the tail as text streams in.
	useEffect(() => {
		endRef.current?.scrollIntoView({ block: "end" });
	}, [turn.messages, turn.runningTools]);

	const submit = () => {
		const text = draft.trim();
		if ((!text && attachments.length === 0) || disabled) return;
		setDraft("");
		setAttachments([]);
		setAttachError(undefined);
		onSend(messageWithAttachments(text, attachments));
	};

	const attach = async (files: FileList | null) => {
		if (!files || files.length === 0) return;
		setAttachError(undefined);
		for (const file of Array.from(files)) {
			try {
				const attachment = await readAttachment(file);
				setAttachments((current) => [...current.filter((entry) => entry.name !== attachment.name), attachment]);
			} catch (error) {
				setAttachError(error instanceof Error ? error.message : String(error));
			}
		}
	};

	return (
		<section
			className={dropping ? "chat dropping" : "chat"}
			onDragOver={(event) => {
				if (disabled) return;
				event.preventDefault();
				setDropping(true);
			}}
			onDragLeave={() => setDropping(false)}
			onDrop={(event) => {
				event.preventDefault();
				setDropping(false);
				if (!disabled) void attach(event.dataTransfer.files);
			}}
		>
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
				{attachments.length > 0 ? (
					<div className="attachments">
						{attachments.map((attachment) => (
							<span key={attachment.name} className="attachment">
								{attachment.name}
								<span className="attachment-size">
									{formatBytes(attachment.bytes)}
									{attachment.truncated ? " · truncated" : ""}
								</span>
								<button
									type="button"
									onClick={() => setAttachments((current) => current.filter((entry) => entry !== attachment))}
									aria-label={`Remove ${attachment.name}`}
								>
									×
								</button>
							</span>
						))}
					</div>
				) : null}
				{attachError ? <p className="error">{attachError}</p> : null}
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
					placeholder={
						disabled ? "Select a session first" : "Message…  (Shift+Enter for a newline, or drop a file)"
					}
					rows={3}
					disabled={disabled}
				/>
				<div className="composer-actions">
					<input
						ref={fileRef}
						type="file"
						multiple
						hidden
						onChange={(event) => {
							void attach(event.target.files);
							event.target.value = "";
						}}
					/>
					<button type="button" onClick={() => fileRef.current?.click()} disabled={disabled} title="Attach a file">
						Attach
					</button>
					{turn.active ? (
						<button type="button" onClick={onAbort}>
							Stop
						</button>
					) : null}
					<button
						type="button"
						className="primary"
						onClick={submit}
						disabled={disabled || sending || (!draft.trim() && attachments.length === 0)}
					>
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
