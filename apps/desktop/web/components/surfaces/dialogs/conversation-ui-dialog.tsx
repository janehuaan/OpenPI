import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { ChevronRight, X } from "../../icons.tsx";
import type { BlockingConversationUiRequest } from "../../../lib/app-types";
import type { ConversationUiResponse } from "../../../types";

export function ConversationUiDialog({
	request,
	busy,
	onRespond,
}: {
	request: BlockingConversationUiRequest;
	busy: boolean;
	onRespond(response: ConversationUiResponse): Promise<void>;
}) {
	const [value, setValue] = useState(request.method === "editor" ? (request.prefill ?? "") : "");
	const [activeOption, setActiveOption] = useState(0);
	const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
	const confirmRef = useRef<HTMLButtonElement | null>(null);
	const cancel = (): void => {
		const response: ConversationUiResponse =
			request.method === "confirm" ? { id: request.id, confirmed: false } : { id: request.id, cancelled: true };
		void onRespond(response);
	};

	// Keep focus inside the form so Escape and the select shortcuts reach onKeyDown.
	useEffect(() => {
		if (request.method === "select") {
			optionRefs.current[activeOption]?.focus();
		} else if (request.method === "confirm") {
			confirmRef.current?.focus();
		}
	}, [request.method, activeOption]);

	const handleKeyDown = (event: KeyboardEvent<HTMLFormElement>): void => {
		if (busy) return;
		if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			cancel();
			return;
		}
		if (request.method !== "select") return;
		const count = request.options.length;
		if (count === 0) return;
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			const delta = event.key === "ArrowDown" ? 1 : -1;
			setActiveOption((current) => (current + delta + count) % count);
			return;
		}
		if (/^[1-9]$/.test(event.key)) {
			const index = Number(event.key) - 1;
			if (index < count) {
				event.preventDefault();
				void onRespond({ id: request.id, value: request.options[index] });
			}
		}
	};

	return (
		<div className="dialog-backdrop">
			<form
				className="dialog agent-dialog"
				onKeyDown={handleKeyDown}
				onSubmit={(event) => {
					event.preventDefault();
					if (request.method === "confirm") {
						void onRespond({ id: request.id, confirmed: true });
					} else if (request.method === "input" || request.method === "editor") {
						void onRespond({ id: request.id, value });
					}
				}}
			>
				<div className="dialog-header">
					<div>
						<span className="eyebrow">助手请求</span>
						<h2>{request.title}</h2>
					</div>
					<button
						type="button"
						className="icon-button quiet"
						title="取消"
						aria-label="取消"
						disabled={busy}
						onClick={cancel}
					>
						<X size={17} />
					</button>
				</div>
				{request.method === "select" && (
					<div className="ui-request-options">
						{request.options.map((option, index) => (
							<button
								type="button"
								key={`${index}-${option}`}
								ref={(element) => {
									optionRefs.current[index] = element;
								}}
								disabled={busy}
								onFocus={() => setActiveOption(index)}
								onClick={() => void onRespond({ id: request.id, value: option })}
							>
								<span>{option}</span>
								<ChevronRight size={16} />
							</button>
						))}
					</div>
				)}
				{request.method === "confirm" && <p className="ui-request-message">{request.message}</p>}
				{request.method === "input" && (
					<label>
						回复
						<input
							autoFocus
							value={value ?? ""}
							placeholder={request.placeholder}
							onChange={(event) => setValue(event.target.value)}
						/>
					</label>
				)}
				{request.method === "editor" && (
					<label>
						内容
						<textarea autoFocus value={value ?? ""} onChange={(event) => setValue(event.target.value)} rows={9} />
					</label>
				)}
				<div className="dialog-actions">
					<button type="button" className="button" disabled={busy} onClick={cancel}>
						取消
					</button>
					{request.method === "confirm" && (
						<button ref={confirmRef} className="button primary" disabled={busy}>
							确认
						</button>
					)}
					{(request.method === "input" || request.method === "editor") && (
						<button className="button primary" disabled={busy}>
							提交
						</button>
					)}
				</div>
			</form>
		</div>
	);
}
