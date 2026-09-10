/**
 * Context Budget Tracker & Proactive Micro-Compaction
 *
 * Continuously tracks conversation token consumption relative to the model's
 * physical context window. Emits warning alerts at 80% usage and activates
 * non-destructive micro-compaction at 85% to prevent '400 Context Length Exceeded'
 * errors from ever reaching the user.
 */

export interface ContextBudgetOptions {
	/** Warning threshold ratio. Default: 0.80 (80%) */
	warningThreshold?: number;
	/** Critical threshold ratio to trigger micro-compaction. Default: 0.85 (85%) */
	criticalThreshold?: number;
	/** Fallback context window if model doesn't specify. Default: 128_000 */
	defaultContextWindow?: number;
}

export interface ContextBudgetAssessment {
	estimatedTokens: number;
	contextWindow: number;
	ratio: number;
	warning: boolean;
	compacted: boolean;
	messages: any[];
	foldedTurns?: number;
}

/**
 * Fast, accurate token estimator for heterogeneous multi-turn message arrays.
 */
export function estimateMessageTokens(messages: any[]): number {
	let asciiChars = 0;
	let nonAsciiChars = 0;
	let imageCount = 0;

	const countText = (str: string) => {
		const nonAscii = (str.match(/[^\x00-\x7F]/g) || []).length;
		nonAsciiChars += nonAscii;
		asciiChars += str.length - nonAscii;
	};

	for (const msg of messages) {
		if (!msg) continue;
		asciiChars += 16; // Message header & role overhead

		if (typeof msg.content === "string") {
			countText(msg.content);
		} else if (Array.isArray(msg.content)) {
			for (const part of msg.content) {
				if (!part) continue;
				if (part.type === "text" && typeof part.text === "string") {
					countText(part.text);
				} else if (part.type === "image") {
					imageCount += 1;
				} else if (part.type === "toolCall") {
					asciiChars += (part.name?.length ?? 0) + 10;
					try {
						countText(JSON.stringify(part.arguments ?? {}));
					} catch {
						asciiChars += 50;
					}
				}
			}
		}
	}

	// ASCII (English/code): ~3.8 characters per token
	// Non-ASCII (CJK/emojis): ~1.5 tokens per character (BPE subwords)
	const textTokens = Math.ceil(asciiChars / 3.8 + nonAsciiChars * 1.5);
	// Vision models typically assign 800 - 1600 tokens per image tile
	const imageTokens = imageCount * 1200;

	return textTokens + imageTokens;
}

/**
 * Assesses token budget and applies proactive micro-compaction if exceeding threshold.
 */
export function assessAndBudgetMessages(
	messages: any[],
	modelContextWindow?: number,
	options?: ContextBudgetOptions,
): ContextBudgetAssessment {
	const contextWindow =
		typeof modelContextWindow === "number" && modelContextWindow > 0
			? modelContextWindow
			: (options?.defaultContextWindow ?? 128_000);

	const warningRatio = options?.warningThreshold ?? 0.80;
	const criticalRatio = options?.criticalThreshold ?? 0.85;

	const initialTokens = estimateMessageTokens(messages);
	const initialRatio = initialTokens / contextWindow;

	// If within safe limits, return as is
	if (initialRatio < criticalRatio || messages.length <= 4) {
		return {
			estimatedTokens: initialTokens,
			contextWindow,
			ratio: Number(initialRatio.toFixed(3)),
			warning: initialRatio >= warningRatio,
			compacted: false,
			messages,
		};
	}

	// Micro-Compaction: Compress earlier turns into a compact historical digest
	// Preserve the last 3 turns + anchor turn completely intact
	const recentCount = 4;
	const head = messages.slice(0, Math.max(0, messages.length - recentCount));
	const tail = messages.slice(Math.max(0, messages.length - recentCount));

	// Extract key topics and tool summaries from older head turns
	const extractedKeyPoints: string[] = [];
	let userGoal = "";

	for (const m of head) {
		if (m.role === "user") {
			const text = typeof m.content === "string" ? m.content : m.content?.[0]?.text ?? "";
			if (!userGoal && text) {
				userGoal = text.slice(0, 150);
			}
		} else if (m.role === "assistant" && Array.isArray(m.content)) {
			for (const part of m.content) {
				if (part.type === "toolCall") {
					extractedKeyPoints.push(`Called tool '${part.name}'`);
				}
			}
		}
	}

	const summaryBlock = {
		role: "assistant",
		content: [
			{
				type: "text",
				text: `> ⚡ **[OpenPI 自适应微压缩 (Micro-Compaction)]**\n> 历史 ${head.length} 轮对话已折叠微缩，核心目标：${userGoal || "进行中任务"}。\n> 工具调用记录：${extractedKeyPoints.slice(0, 10).join("; ") || "已执行代码检索与编辑"}。\n> 前序状态已归档，保持最新上下文专注执行。`,
			},
		],
	};

	const budgetedMessages = [summaryBlock, ...tail];
	const compactedTokens = estimateMessageTokens(budgetedMessages);
	const compactedRatio = compactedTokens / contextWindow;

	return {
		estimatedTokens: compactedTokens,
		contextWindow,
		ratio: Number(compactedRatio.toFixed(3)),
		warning: compactedRatio >= warningRatio,
		compacted: true,
		messages: budgetedMessages,
		foldedTurns: head.length,
	};
}
