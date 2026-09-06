import { useState, type ReactNode } from "react";
import {
	Bot,
	BrainCircuit,
	Check,
	ChevronRight,
	CircleStop,
	Copy,
	FileText,
	Search,
	Terminal,
	Wrench,
} from "../../icons.tsx";
import {
	contentImages,
	contentText,
	formatTime,
	isRecord,
	messageBlockCounts,
	messageReasoning,
	toolCallIconName,
	toolCalls,
	toolCallSummary,
	type ToolCallBlock,
} from "../../../lib/helpers";
import { MarkdownText } from "../../../lib/markdown";
import type { ConversationMessage } from "../../../types";
import { MessageImages } from "./message-images";

function BlockRenderer({
	content,
	hideAssistantTools,
}: {
	content: unknown;
	hideAssistantTools?: boolean;
}): React.ReactNode {
	if (!Array.isArray(content)) return null;
	const parts: React.ReactNode[] = [];
	for (const block of content) {
		if (!isRecord(block)) continue;
		const type = typeof block.type === "string" ? block.type : "";
		if (type === "text" || type === "output_text") {
			parts.push(
				<div className="message-text" key={parts.length}>
					<MarkdownText text={String((block as { text: string }).text)} />
				</div>,
			);
		} else if (type === "thinking") {
			parts.push(
				<div className="activity-inline activity-thinking" key={parts.length}>
					<BrainCircuit size={12} />
					<span>思考 · 持续了几秒</span>
				</div>,
			);
		} else if (type === "toolCall" || type === "tool_use") {
			if (hideAssistantTools) continue;
			const tc = block as unknown as ToolCallBlock;
			const iconName = toolCallIconName(tc);
			const summary = toolCallSummary(tc);
			const IconComp =
				iconName === "terminal"
					? Terminal
					: iconName === "search"
						? Search
						: iconName === "file"
							? FileText
							: iconName === "bot"
								? Bot
								: Wrench;
			parts.push(
				<div className={`activity-inline activity-${iconName}`} key={`${tc.id || "tc"}-${parts.length}`}>
					<IconComp size={12} />
					<span className="activity-summary">{summary}</span>
				</div>,
			);
		} else if (type === "image") {
			const img = block as { data: string; mimeType: string };
			parts.push(
				<MessageImages images={[{ type: "image", data: img.data, mimeType: img.mimeType }]} key={parts.length} />,
			);
		}
	}
	return <>{parts}</>;
}

export function MessageItem({
	message,
	hideAssistantTools = false,
	onRemember,
}: {
	message: ConversationMessage;
	/** When true, skip in-message tool chips (toolResult rows already cover them). */
	hideAssistantTools?: boolean;
	onRemember?(text: string): void;
}) {
	const text = contentText(message.content);
	const images = contentImages(message.content);
	const calls = hideAssistantTools ? [] : toolCalls(message);
	const blockCounts = message.role !== "user" ? messageBlockCounts(message.content) : undefined;
	// Live tool-call status arrives via tool_execution_* stream events.
	const liveTools = (message.toolCalls ?? []).filter((tc) => tc.status === "running");
	// Reasoning/thinking blocks extracted from content (collapsible display).
	const reasoning = Array.isArray(message.content)
		? message.content
				.filter(
					(block): block is { type: "thinking"; thinking: string } =>
						isRecord(block) && block.type === "thinking" && typeof block.thinking === "string",
				)
				.map((block) => block.thinking)
				.join("\n\n")
		: "";
	// toolResult must use the same avatar+stack grid as assistant messages,
	// otherwise summary rows are wider and misaligned with assistant text.
	if (message.role === "toolResult") {
		return (
			<article className="message tool-result">
				<div className="message-avatar tool-avatar">
					<Wrench size={14} />
				</div>
				<div className="message-stack">
					<div className="message-body">
						{calls.map((call, index) => (
							<details className={`tool-trace ${message.isError ? "error" : ""}`} key={`${call.name}-${index}`}>
								<summary>
									<span>
										<Wrench size={14} />
										{call.name}
									</span>
									<span className="tool-trace-status">
										{message.isError ? (
											<>
												<CircleStop size={13} className="trace-icon error" />
												失败
											</>
										) : (
											<>
												<Check size={13} className="trace-icon ok" />
												完成
											</>
										)}
										<ChevronRight size={14} />
									</span>
								</summary>
								{call.detail && <pre>{call.detail}</pre>}
								{images.length > 0 && <MessageImages images={images} />}
							</details>
						))}
					</div>
				</div>
			</article>
		);
	}
	const isUser = message.role === "user";
	// Empty assistant shells after tools are shown as toolResult rows — skip,
	// but keep the message alive while a live tool call is streaming into it.
	if (
		!isUser &&
		!text &&
		images.length === 0 &&
		!message.errorMessage &&
		calls.length === 0 &&
		!reasoning &&
		liveTools.length === 0
	) {
		return null;
	}

	// Build a compact trace badge like "2个工具 · 1段思考"
	let traceBadge: string | undefined;
	if (!isUser && blockCounts) {
		const parts: string[] = [];
		if (blockCounts.tools > 0) parts.push(`${blockCounts.tools}个工具`);
		if (blockCounts.thinking > 0) parts.push(`${blockCounts.thinking}段思考`);
		if (parts.length > 0) traceBadge = parts.join(" · ");
	}

	return (
		<article className={`message ${isUser ? "user" : "assistant"}`}>
			{!isUser && (
				<div className="message-avatar">
					<Bot size={14} />
				</div>
			)}
			<div className="message-stack">
				{!isUser && (
					<div className="message-meta">
						<strong>OpenPI</strong>
						{traceBadge && <span className="message-trace-badge">{traceBadge}</span>}
						{message.recalledMemories && message.recalledMemories.length > 0 && (
							<span
								className="message-memory-badge"
								title={`本轮命中 ${message.recalledMemories.length} 条记忆：\n${message.recalledMemories
									.map((m) => `• [${m.type}] ${m.key}: ${m.value}`)
									.join("\n")}`}
							>
								<BrainCircuit size={12} />
								命中 {message.recalledMemories.length} 条记忆
							</span>
						)}
						<span>{formatTime(message.timestamp)}</span>
						{text && <MessageCopyButton text={text} />}
						{text && onRemember && (
							<button
								type="button"
								className="icon-button quiet message-remember-button"
								title="存为长期记忆"
								aria-label="存为长期记忆"
								onClick={() => onRemember(text)}
							>
								<BrainCircuit size={13} />
							</button>
						)}
					</div>
				)}
				{isUser && (
					<div className="user-message-meta">
						<span>{formatTime(message.timestamp)}</span>
						{text && <MessageCopyButton text={text} />}
						{text && onRemember && (
							<button
								type="button"
								className="icon-button quiet message-remember-button"
								title="存为长期记忆"
								aria-label="存为长期记忆"
								onClick={() => onRemember(text)}
							>
								<BrainCircuit size={13} />
							</button>
						)}
					</div>
				)}
				<div className="message-body">
					{liveTools.length > 0 && (
						<div className="tool-live-list">
							{liveTools.map((tc, tcIndex) => (
								<div className="tool-live" key={`${tc.id || "live"}-${tcIndex}`}>
									<div className="tool-live-header">
										<Wrench size={13} className="tool-live-icon" />
										<span className="tool-live-name">{tc.name}</span>
										<span className="tool-live-status">运行中</span>
									</div>
									{tc.result && <pre className="tool-live-output">{tc.result.slice(-800)}</pre>}
								</div>
							))}
						</div>
					)}
					{reasoning && (
						<details className="message-reasoning">
							<summary>思考过程</summary>
							<pre>{reasoning}</pre>
						</details>
					)}
					{images.length > 0 && <MessageImages images={images} />}
					{text && <div className="message-text">{isUser ? text : <MarkdownText text={text} />}</div>}
					{message.errorMessage && <div className="message-error">{message.errorMessage}</div>}
					{calls.map((call, index) => (
						<details className={`tool-trace ${message.isError ? "error" : ""}`} key={`${call.name}-${index}`}>
							<summary>
								<span>
									<Wrench size={14} />
									{call.name}
								</span>
								<span className="tool-trace-status">
									{message.isError ? (
										<>
											<CircleStop size={13} className="trace-icon error" />
											失败
										</>
									) : (
										<>
											<Check size={13} className="trace-icon ok" />
											完成
										</>
									)}
									<ChevronRight size={14} />
								</span>
							</summary>
							{call.detail && <pre>{call.detail}</pre>}
						</details>
					))}
				</div>
			</div>
		</article>
	);
}

function MessageCopyButton({ text }: { text: string }) {
	const [copied, setCopied] = useState(false);
	const handleCopy = () => {
		void navigator.clipboard.writeText(text).then(() => {
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		});
	};
	return (
		<button
			type="button"
			className={`message-meta-copy-btn ${copied ? "copied" : ""}`}
			title={copied ? "已复制" : "复制消息"}
			aria-label={copied ? "已复制" : "复制消息"}
			onClick={handleCopy}
		>
			{copied ? <Check size={11} /> : <Copy size={11} />}
			<span>{copied ? "已复制" : "复制"}</span>
		</button>
	);
}

