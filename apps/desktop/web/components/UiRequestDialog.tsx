import { useState } from "react";
import type { UiRequest } from "../lib/ui-request.ts";

interface Props {
	request: UiRequest;
	onRespond: (outcome: { value?: string; confirmed?: boolean; cancelled?: boolean }) => void;
}

/**
 * Answer an extension's `ctx.ui` prompt.
 *
 * The agent turn is blocked until this resolves, so cancelling still sends a
 * reply — closing without answering would hang the session.
 */
export function UiRequestDialog({ request, onRespond }: Props) {
	const [text, setText] = useState(request.defaultValue ?? "");

	const cancel = () => onRespond({ cancelled: true });

	return (
		<div className="dialog-backdrop" role="presentation">
			<div className="dialog" role="dialog" aria-label="Extension request">
				<h2>{request.message ?? "The agent needs input"}</h2>
				{request.detail ? <p>{request.detail}</p> : null}
				<p className="hint">from an extension · {request.method}</p>

				{request.method === "confirm" ? (
					<footer className="dialog-actions">
						<button type="button" onClick={() => onRespond({ confirmed: false })}>
							No
						</button>
						<button type="button" className="primary" onClick={() => onRespond({ confirmed: true })}>
							Yes
						</button>
					</footer>
				) : request.options && request.options.length > 0 ? (
					<div className="ui-options">
						{request.options.map((option) => (
							<button key={option} type="button" onClick={() => onRespond({ value: option })}>
								{option}
							</button>
						))}
						<button type="button" onClick={cancel}>
							Cancel
						</button>
					</div>
				) : (
					<>
						<input
							value={text}
							placeholder={request.placeholder}
							onChange={(event) => setText(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter") onRespond({ value: text });
								if (event.key === "Escape") cancel();
							}}
							// biome-ignore lint/a11y/noAutofocus: the turn is blocked on this input
							autoFocus
						/>
						<footer className="dialog-actions">
							<button type="button" onClick={cancel}>
								Cancel
							</button>
							<button type="button" className="primary" onClick={() => onRespond({ value: text })}>
								Send
							</button>
						</footer>
					</>
				)}
			</div>
		</div>
	);
}
