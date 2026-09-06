import { useMemo } from "react";
import { ChevronRight, Sparkles, Terminal } from "./icons.tsx";
import type { ConversationMessage, TodoState } from "../types";
import { contentText, visibleMessageText } from "../lib/helpers";
import {
	extractRecapAndSuggestions,
	isCommandLike,
	type SuggestionContext,
} from "../lib/recap";

export type { SuggestionContext };
export { extractRecapAndSuggestions };

export function ClaudeCodeRecapCard({
	message,
	lastUserPrompt,
	todoState,
	onApplySuggestion,
	onSendSuggestion,
}: {
	message: ConversationMessage;
	lastUserPrompt?: string;
	todoState?: TodoState;
	onApplySuggestion(text: string): void;
	onSendSuggestion(text: string): void;
}) {
	const rawText = visibleMessageText(contentText(message.content));
	if (!rawText || rawText.length < 10) return null;

	const { recap, suggestions } = useMemo(
		() =>
			extractRecapAndSuggestions(rawText, {
				lastUserPrompt,
				todos: todoState?.todos ?? [],
				toolCalls: message.toolCalls ?? [],
				isError: Boolean(message.isError || message.errorMessage),
			}),
		[rawText, lastUserPrompt, todoState, message.toolCalls, message.isError, message.errorMessage],
	);

	if (!recap && suggestions.length === 0) return null;

	return (
		<div className={`claude-recap-card ${!recap ? "suggestions-only" : ""}`} role="region" aria-label="执行摘要与下一步建议">
			{recap && (
				<div className="claude-recap-header">
					<Sparkles size={12} className="claude-recap-icon" />
					<span className="claude-recap-badge">Recap</span>
					<span className="claude-recap-text">{recap}</span>
				</div>
			)}
			{suggestions.length > 0 && (
				<div className="claude-recap-suggestions">
					<span className="claude-recap-label">
						<Sparkles size={11} className="claude-recap-label-icon" /> 下一步建议：
					</span>
					<div className="claude-recap-chips">
						{suggestions.map((s, idx) => {
							const isCmd = isCommandLike(s);
							return (
								<button
									type="button"
									key={`${idx}-${s}`}
									className="claude-recap-chip"
									title={`点击直接发送（按住 Option/Shift 填入输入框）：“${s}”`}
									onClick={(e) => {
										if (e.altKey || e.shiftKey) {
											onApplySuggestion(s);
										} else {
											onSendSuggestion(s);
										}
									}}
								>
									{idx === 0 ? (
										<kbd className="chip-tab-kbd">Tab</kbd>
									) : isCmd ? (
										<Terminal size={11} />
									) : (
										<Sparkles size={11} />
									)}
									<span>{s}</span>
									<ChevronRight size={11} className="chip-arrow" />
								</button>
							);
						})}
					</div>
				</div>
			)}
		</div>
	);
}
