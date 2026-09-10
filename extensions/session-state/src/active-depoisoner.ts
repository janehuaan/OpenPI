/**
 * Active Stream De-poisoner & Error Extractor
 *
 * Solves the critical LLM Context Window thrashing problem:
 * 1. Active Log Flooding: If a tool emits 1000 lines of build output, test traces,
 *    or directory dumps, it immediately poisons the LLM context *in the current turn*.
 * 2. Error Signal-to-Noise Ratio: Massive terminal outputs hide 2 lines of real error
 *    under 50 screens of warnings and package download progress.
 *
 * This depoisoner runs directly on `tool_result` events before messages hit the model:
 * - Folds clean outputs exceeding threshold while retaining head and tail.
 * - Intelligently distills error stacks when failure occurs.
 */

export interface DepoisonerOptions {
	/** Maximum character threshold before folding clean outputs. Default: 2500 */
	maxCleanChars?: number;
	/** Maximum line threshold before folding clean outputs. Default: 60 */
	maxCleanLines?: number;
	/** Lines to keep from top of clean output. Default: 15 */
	headLines?: number;
	/** Lines to keep from bottom of clean output. Default: 15 */
	tailLines?: number;
	/** Maximum error lines to extract. Default: 25 */
	maxErrorLines?: number;
}

export interface DepoisonResult {
	text: string;
	depoisoned: boolean;
	originalChars: number;
	savedChars: number;
	reason?: "folded_large_output" | "extracted_error_signal";
}

const ERROR_SIGNATURES = [
	/error[:\s]/i,
	/syntaxerror[:\s]/i,
	/typeerror[:\s]/i,
	/referenceerror[:\s]/i,
	/fatal[:\s]/i,
	/panic[:\s]/i,
	/failed[:\s]/i,
	/exception[:\s]/i,
	/unhandledrejection/i,
	/cannot find module/i,
	/ts\d{4,5}:/i, // TypeScript compiler diagnostics e.g. TS2304
	/npm err!/i,
];

/**
 * Extracts essential error lines and their surrounding context.
 */
export function extractErrorSignal(text: string, maxLines = 25): string {
	const lines = text.split("\n");
	if (lines.length <= maxLines) return text;

	const matchedIndices = new Set<number>();

	lines.forEach((line, idx) => {
		const isMatch = ERROR_SIGNATURES.some((sig) => sig.test(line));
		if (isMatch) {
			// Keep previous line (context) and up to 3 next lines (stack frame)
			for (let offset = -1; offset <= 3; offset++) {
				const target = idx + offset;
				if (target >= 0 && target < lines.length) {
					matchedIndices.add(target);
				}
			}
		}
	});

	if (matchedIndices.size === 0) {
		// Fallback: If no explicit signature matched, keep the last N lines (where the crash normally appears)
		return lines.slice(-maxLines).join("\n");
	}

	const sortedIndices = Array.from(matchedIndices).sort((a, b) => a - b).slice(0, maxLines);
	const extracted: string[] = [];
	let lastIdx = -1;

	for (const idx of sortedIndices) {
		if (lastIdx !== -1 && idx > lastIdx + 1) {
			extracted.push("... [intermediate output omitted] ...");
		}
		extracted.push(lines[idx]);
		lastIdx = idx;
	}

	return extracted.join("\n");
}

/**
 * Actively de-poisons a tool result text string.
 */
export function depoisonToolOutput(
	text: string,
	toolName: string,
	isError: boolean,
	options?: DepoisonerOptions,
): DepoisonResult {
	const originalChars = text.length;
	const maxCleanChars = options?.maxCleanChars ?? 2500;
	const maxCleanLines = options?.maxCleanLines ?? 60;
	const headLines = options?.headLines ?? 15;
	const tailLines = options?.tailLines ?? 15;
	const maxErrorLines = options?.maxErrorLines ?? 25;

	// Case 1: Error output distillation
	if (isError) {
		const lines = text.split("\n");
		if (lines.length > maxErrorLines || originalChars > maxCleanChars) {
			const distilled = extractErrorSignal(text, maxErrorLines);
			const savedChars = Math.max(0, originalChars - distilled.length);
			const summary = `\n[Notice: Verbose error stream distilled to core failure signal (~${Math.round(savedChars / 4)} tokens saved)]\n`;
			return {
				text: `${distilled}${summary}`,
				depoisoned: true,
				originalChars,
				savedChars,
				reason: "extracted_error_signal",
			};
		}
		return { text, depoisoned: false, originalChars, savedChars: 0 };
	}

	// Case 2: Clean output overflow folding
	const lines = text.split("\n");
	if (lines.length > maxCleanLines || originalChars > maxCleanChars) {
		if (lines.length > headLines + tailLines + 5) {
			const head = lines.slice(0, headLines).join("\n");
			const tail = lines.slice(-tailLines).join("\n");
			const omitted = lines.length - headLines - tailLines;
			const estimatedTokens = Math.round((originalChars - (head.length + tail.length)) / 4);

			const marker = `\n\n... [Folded ${omitted} lines of high-volume ${toolName} output (~${estimatedTokens} tokens saved)] ...\n\n`;
			const folded = `${head}${marker}${tail}`;
			const savedChars = Math.max(0, originalChars - folded.length);

			return {
				text: folded,
				depoisoned: true,
				originalChars,
				savedChars,
				reason: "folded_large_output",
			};
		}
	}

	return { text, depoisoned: false, originalChars, savedChars: 0 };
}
