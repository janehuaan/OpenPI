/**
 * Context Token Governance: Tool Output Semantic Pruner & Folding
 *
 * In long sessions, tool outputs from earlier turns (e.g. huge build logs, grep results,
 * directory listings, subagent reports) consume 40-70% of the context window.
 *
 * This pruner:
 * - Keeps an Active Window (recent 2 turns) 100% byte-exact.
 * - For older historical tool results, if the content exceeds charThreshold (default: 1,500 chars),
 *   it folds the middle lines while retaining head (first 15 lines) and tail (last 10 lines).
 */

export interface PrunerOptions {
	/** Number of recent user-assistant turns to keep untouched (default: 2) */
	activeWindowTurns?: number;
	/** Minimum character length to trigger folding (default: 1500) */
	charThreshold?: number;
	/** Number of lines to preserve at the start of historical output (default: 15) */
	headLines?: number;
	/** Number of lines to preserve at the end of historical output (default: 10) */
	tailLines?: number;
}

export interface PruneResult<T = any> {
	messages: T[];
	foldedCount: number;
	savedChars: number;
}

/**
 * Folds large text into head lines + folded marker + tail lines.
 */
export function foldLongOutput(
	text: string,
	toolName = "tool",
	headLines = 15,
	tailLines = 10,
): { folded: string; wasFolded: boolean; savedChars: number } {
	const lines = text.split("\n");
	if (lines.length <= headLines + tailLines + 5) {
		return { folded: text, wasFolded: false, savedChars: 0 };
	}

	const head = lines.slice(0, headLines).join("\n");
	const tail = lines.slice(-tailLines).join("\n");
	const omittedLines = lines.length - headLines - tailLines;
	const estimatedSavedTokens = Math.round((text.length - (head.length + tail.length)) / 4);

	const marker = `\n\n... [Folded ${omittedLines} lines of historical ${toolName} output (~${estimatedSavedTokens} tokens saved)] ...\n\n`;
	const folded = `${head}${marker}${tail}`;
	const savedChars = Math.max(0, text.length - folded.length);

	return {
		folded,
		wasFolded: true,
		savedChars,
	};
}

/**
 * Prunes historical tool outputs in a conversation message array.
 */
export function pruneHistoricalToolOutputs<T extends Record<string, any>>(
	messages: T[],
	options?: PrunerOptions,
): PruneResult<T> {
	if (!Array.isArray(messages) || messages.length === 0) {
		return { messages, foldedCount: 0, savedChars: 0 };
	}

	const activeWindowTurns = options?.activeWindowTurns ?? 2;
	const charThreshold = options?.charThreshold ?? 1500;
	const headLines = options?.headLines ?? 15;
	const tailLines = options?.tailLines ?? 10;

	// Identify cutoff index for active window turns
	// A turn starts when role === "user"
	let userTurnsSeen = 0;
	let cutoffIndex = 0;

	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role === "user") {
			userTurnsSeen++;
			if (userTurnsSeen >= activeWindowTurns) {
				cutoffIndex = i;
				break;
			}
		}
	}

	if (cutoffIndex <= 0) {
		// All messages are within the active window, no pruning needed
		return { messages, foldedCount: 0, savedChars: 0 };
	}

	let foldedCount = 0;
	let savedChars = 0;
	let modified = false;

	const pruned = messages.map((msg, idx) => {
		// Only prune historical messages before the active window cutoff
		if (idx >= cutoffIndex) {
			return msg;
		}

		const isToolMessage = msg.role === "toolResult" || msg.role === "tool";
		if (!isToolMessage || !Array.isArray(msg.content)) {
			return msg;
		}

		let msgChanged = false;
		const newContent = msg.content.map((part: any) => {
			if (part && typeof part === "object" && part.type === "text" && typeof part.text === "string") {
				if (part.text.length >= charThreshold) {
					const toolName = msg.toolName ?? "tool";
					const { folded, wasFolded, savedChars: saved } = foldLongOutput(part.text, toolName, headLines, tailLines);
					if (wasFolded) {
						foldedCount++;
						savedChars += saved;
						msgChanged = true;
						modified = true;
						return { ...part, text: folded };
					}
				}
			}
			return part;
		});

		return msgChanged ? { ...msg, content: newContent } : msg;
	});

	return {
		messages: modified ? pruned : messages,
		foldedCount,
		savedChars,
	};
}
