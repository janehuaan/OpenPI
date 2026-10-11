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
	suppressRecap = false,
	onApplySuggestion,
	onSendSuggestion,
}: {
	message: ConversationMessage;
	lastUserPrompt?: string;
	todoState?: TodoState;
	/** 正文已由结构化卡片（交付看板 / 结论简报）呈现时置 true：只留建议，不再复述正文。 */
	suppressRecap?: boolean;
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

	// 正文已结构化时不复述（避免与交付看板 / 结论简报重复）
	const showRecap = Boolean(recap) && !suppressRecap;
	if (!showRecap && suggestions.length === 0) return null;

	return (
		<div className={`claude-recap-card ${!showRecap ? "suggestions-only" : ""}`} role="region" aria-label="执行摘要与下一步建议">
			{showRecap && (
				<div className="claude-recap-header">
					<Sparkles size={12} className="claude-recap-icon" />
					<span className="claude-recap-badge">本轮复盘</span>
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
