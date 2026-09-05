import { useMemo } from "react";
import { ChevronRight, Sparkles } from "./icons.tsx";
import type { ConversationMessage, TodoState } from "../types";
import { contentText, visibleMessageText } from "../lib/helpers";

export function extractRecapAndSuggestions(
	text: string,
	todos: Array<{ content: string; status: string }> = [],
): { recap: string; suggestions: string[] } {
	const paragraphs = text
		.split(/\n\s*\n/)
		.map((p) => p.trim())
		.filter(Boolean);
	let recap = "";

	// 1. Look for conclusion paragraph or summary sentence
	for (const p of paragraphs) {
		const clean = p.replace(/^[#*-\s]+/, "").trim();
		if (/^[#一二三四五六七八九十\d]+[、.：:\s]/.test(clean)) continue;
		if (clean.length > 10) {
			recap = clean.split("\n")[0]!.trim();
			break;
		}
	}
	if (!recap && paragraphs.length > 0) {
		recap = paragraphs[0]!.replace(/^[#*-\s]+/, "").split("\n")[0]!.trim();
	}

	// Clean markdown formatting
	recap = recap.replace(/[*_`]/g, "").trim();

	// 2. Extract next-step suggestions
	const suggestions: string[] = [];

	// A. From pending/in_progress todos
	const nextTodo = todos.find((t) => t.status === "pending" || t.status === "in_progress");
	if (nextTodo) {
		suggestions.push(`继续待办：${nextTodo.content}`);
	}

	// B. From assistant text section (e.g. 下一步建议, 后续步骤, 1. ..., 2. ...)
	const lines = text.split("\n");
	let inNextStepSection = false;
	for (const line of lines) {
		const trimmed = line.trim();
		const isHeading = /(^#+\s*.*(下一步|建议|后续)|^(?:[一二三四五六\d]+)[、.：:]\s*(下一步|建议|后续)|^(?:下一步|后续|建议)[：:])/i.test(trimmed);
		if (isHeading) {
			inNextStepSection = true;
			continue;
		}
		if (inNextStepSection) {
			const bulletMatch = trimmed.match(/^[-*•\d.]+\s*(.+)$/);
			if (bulletMatch) {
				const item = bulletMatch[1]!.replace(/[*_`]/g, "").trim();
				if (item.length >= 2 && item.length <= 35 && !suggestions.includes(item)) {
					suggestions.push(item);
				}
			} else if (trimmed === "" || trimmed.startsWith("#")) {
				inNextStepSection = false;
			}
		}
	}

	// C. Contextual smart fallbacks
	if (suggestions.length < 2) {
		if (text.includes("测试") || text.includes("test")) {
			if (!suggestions.includes("运行单元测试验证")) suggestions.push("运行单元测试验证");
		}
		if (text.includes("git") || text.includes("commit") || text.includes("代码")) {
			if (!suggestions.includes("提交本次代码更改")) suggestions.push("提交本次代码更改");
		}
		if (text.includes("build") || text.includes("打包") || text.includes("runtime")) {
			if (!suggestions.includes("重新构建并测试安装包")) suggestions.push("重新构建并测试安装包");
		}
		if (suggestions.length === 0) {
			suggestions.push("继续下一步工作");
		}
	}

	return { recap, suggestions: suggestions.slice(0, 4) };
}

export function ClaudeCodeRecapCard({
	message,
	todoState,
	onApplySuggestion,
	onSendSuggestion,
}: {
	message: ConversationMessage;
	todoState?: TodoState;
	onApplySuggestion(text: string): void;
	onSendSuggestion(text: string): void;
}) {
	const rawText = visibleMessageText(contentText(message.content));
	if (!rawText || rawText.length < 15) return null;

	const { recap, suggestions } = useMemo(
		() => extractRecapAndSuggestions(rawText, todoState?.todos ?? []),
		[rawText, todoState],
	);

	if (!recap && suggestions.length === 0) return null;

	return (
		<div className="claude-recap-card" role="region" aria-label="执行摘要与下一步建议">
			{recap && (
				<div className="claude-recap-header">
					<span className="claude-recap-badge">※ recap:</span>
					<span className="claude-recap-text">{recap}</span>
				</div>
			)}
			{suggestions.length > 0 && (
				<div className="claude-recap-suggestions">
					<span className="claude-recap-label">下一步建议：</span>
					<div className="claude-recap-chips">
						{suggestions.map((s, idx) => (
							<button
								type="button"
								key={`${idx}-${s}`}
								className="claude-recap-chip"
								title={`点击填入（双击直接发送）：“${s}”`}
								onClick={() => onApplySuggestion(s)}
								onDoubleClick={() => onSendSuggestion(s)}
							>
								<Sparkles size={11} />
								<span>{s}</span>
								<ChevronRight size={11} className="chip-arrow" />
							</button>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
