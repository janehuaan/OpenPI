import type { ConversationMessage, TodoState } from "../types";
import { contentText, visibleMessageText } from "./helpers";

export interface SuggestionContext {
	lastUserPrompt?: string;
	todos?: Array<{ content: string; status: string }>;
	toolCalls?: Array<{ name: string; status?: string; isError?: boolean }>;
	isError?: boolean;
}

function cleanMarkdown(str: string): string {
	return str
		.replace(/[*_`#]/g, "")
		.replace(/^[、.：:\s-]+/, "")
		.trim();
}

export function isCommandLike(str: string): boolean {
	return /^(?:npm|pnpm|yarn|npx|git|cargo|pytest|python|node|docker|make|bun|go)\b/.test(str.trim());
}

export function extractRecapAndSuggestions(
	text: string,
	context: SuggestionContext = {},
): { recap: string; suggestions: string[] } {
	const trimmed = text.trim();
	if (!trimmed) return { recap: "", suggestions: [] };

	const paragraphs = trimmed
		.split(/\n\s*\n/)
		.map((p) => p.trim())
		.filter(Boolean);
	const lastUserPrompt = context.lastUserPrompt?.trim() || "";

	// 1. Context & tone detection
	const isQuestioning =
		/(不太清楚|不太确定|请提供|能提供|告诉我更多|具体要做什么|具体是指|具体细节|需要您提供|请问需要|你想使用哪种|请确认)/i.test(
			trimmed,
		);

	// 2. Intelligent choice & branch extraction (options offered by the model)
	const choices: string[] = [];

	// A. Confirmation questions (e.g., "是否开始执行修复？", "需要我现在提交代码吗？")
	const hasConfirmQuestion =
		/(?:是否(?:开始|立即|确认|需要我|现在|进行)|要不要(?:开始|立即|现在|进行)|(?:确认|同意)(?:开始|执行|修改|提交|继续)吗)[^。\n]*[？?]/i.test(
			trimmed,
		);
	if (hasConfirmQuestion) {
		const specificVerbMatch = trimmed.match(/(重构|修改|提交|继续|优化|部署|运行|修复)/);
		const actionVerb = specificVerbMatch ? specificVerbMatch[1] : "执行";
		choices.push(`确认，开始${actionVerb}`);
		choices.push("先不执行，查看方案细节");
	}

	// B. Explicit option patterns ("方案一：...", "方案A: ...", "Option 1: ...")
	const optionPattern = /^(?:方案[一二三四1-4A-D]|Option\s*[1-4A-D]|[A-D][.、])\s*[：:]?\s*(.+)$/i;
	for (const line of trimmed.split("\n")) {
		const lineTrim = line.trim();
		const m = lineTrim.match(optionPattern);
		if (m && m[1]) {
			const cleaned = cleanMarkdown(m[1]);
			const coreOpt = cleaned.split(/[，。；;]/)[0]!.trim();
			const finalOpt = coreOpt.length >= 2 && coreOpt.length <= 28 ? coreOpt : cleaned.slice(0, 28);
			if (finalOpt && !choices.includes(finalOpt)) {
				choices.push(finalOpt);
			}
		}
	}

	// C. Numbered choices following an option prompt (e.g., "你可以选择以下几种方式：\n1. xxx\n2. yyy")
	const lines = trimmed.split("\n");
	let inChoiceBlock = false;
	for (let i = 0; i < lines.length; i++) {
		const l = lines[i]!.trim();
		if (
			/(?:请选择|你可以选择|提供以下几种|有两个方案|有以下几种|以下选项|偏好哪种|选择哪一个|可供选择|几种方案)[^。\n]*[：:？?]/i.test(
				l,
			)
		) {
			inChoiceBlock = true;
			continue;
		}
		if (inChoiceBlock) {
			const numMatch = l.match(/^[1-4][.、)]\s*(.+)$/);
			if (numMatch && numMatch[1]) {
				const item = cleanMarkdown(numMatch[1]).split(/[，。；;]/)[0]!.trim().slice(0, 28);
				if (item.length >= 2 && !choices.includes(item)) {
					choices.push(item);
				}
			} else if (l === "" || l.startsWith("#")) {
				inChoiceBlock = false;
			}
		}
	}

	// 3. Executable code block command extraction (e.g. ```bash\n npm test \n```)
	const commands: string[] = [];
	const codeBlockRegex = /```(?:bash|sh|shell|zsh|console)?\s*\n([^`]+?)\n```/g;
	let match: RegExpExecArray | null;
	while ((match = codeBlockRegex.exec(trimmed)) !== null) {
		const block = match[1]!.trim();
		const blockLines = block.split("\n").map((s) => s.trim()).filter(Boolean);
		if (blockLines.length === 1) {
			const cmd = blockLines[0]!;
			if (isCommandLike(cmd) && cmd.length <= 45 && !commands.includes(cmd)) {
				commands.push(cmd);
			}
		}
	}

	// 4. Explicit next-step bullet points in text
	const nextSteps: string[] = [];
	let inNextStepSection = false;
	for (const line of lines) {
		const lineTrim = line.trim();
		const isHeading =
			/(^#+\s*.*(?:下一步|后续|建议|接下来|Next Steps)|^(?:[一二三四五六\d]+)[、.：:]\s*(?:下一步|后续|建议|接下来)|^(?:下一步|后续|建议|你可以尝试|接下来)[：:])/i.test(
				lineTrim,
			);
		if (isHeading) {
			inNextStepSection = true;
			continue;
		}
		if (inNextStepSection) {
			const bulletMatch = lineTrim.match(/^[-*•\d.]+\s*(.+)$/);
			if (bulletMatch && bulletMatch[1]) {
				const item = cleanMarkdown(bulletMatch[1]);
				if (item.length >= 2 && item.length <= 32 && !nextSteps.includes(item)) {
					nextSteps.push(item);
				}
			} else if (lineTrim === "" || lineTrim.startsWith("#")) {
				inNextStepSection = false;
			}
		}
	}

	// 5. Tool execution awareness
	const toolSuggestions: string[] = [];
	const toolCalls = context.toolCalls ?? [];
	const hasToolError = context.isError || toolCalls.some((t) => t.status === "error");
	const hasEditOrWrite = toolCalls.some((t) => t.name === "edit" || t.name === "write");
	const hasCodeSearch = toolCalls.some((t) => t.name === "grep" || t.name === "find" || t.name === "code_search");

	if (hasToolError) {
		toolSuggestions.push("分析并修复工具执行报错");
	} else if (hasEditOrWrite) {
		toolSuggestions.push("查看 git diff 确认文件修改");
		if (trimmed.includes("测试") || trimmed.includes("test") || /spec|test/i.test(trimmed)) {
			toolSuggestions.push("运行测试用例验证改动");
		}
	} else if (hasCodeSearch) {
		toolSuggestions.push("继续分析相关模块的具体实现");
	}

	// 6. Assemble candidate suggestions with priority
	const suggestions: string[] = [];

	// Priority 1: Active session todos (always highest priority if present)
	const nextTodo = (context.todos || []).find((t) => t.status === "pending" || t.status === "in_progress");
	if (nextTodo) {
		suggestions.push(`继续待办：${nextTodo.content}`);
	}

	// Priority 2: Concrete choices model gave the user
	for (const choice of choices) {
		if (!suggestions.includes(choice)) suggestions.push(choice);
	}

	// Priority 3: Explicit next steps from text
	for (const step of nextSteps) {
		if (!suggestions.includes(step)) suggestions.push(step);
	}

	// Priority 4: Actionable shell commands from markdown code blocks
	for (const cmd of commands) {
		if (!suggestions.includes(cmd)) suggestions.push(cmd);
	}

	// Priority 5: Tool-aware suggestions
	for (const ts of toolSuggestions) {
		if (!suggestions.includes(ts)) suggestions.push(ts);
	}

	// Priority 6: Contextual fallbacks (Only if there is strong semantic intent, NEVER force generic junk)
	if (suggestions.length === 0) {
		if (isQuestioning) {
			suggestions.push("按推荐的最佳实践继续推进");
			suggestions.push("补充更详细的上下文信息");
		} else if (/(为什么|原理|机制|怎么实现|解释|介绍)/.test(lastUserPrompt)) {
			suggestions.push("深入讲解核心底层原理");
			suggestions.push("提供具体的工程使用示例");
		} else if (/(重构|优化|性能)/.test(trimmed) && /(重构|优化|性能)/.test(lastUserPrompt)) {
			suggestions.push("分析边界条件与性能影响");
		} else if (/(测试|验证)/.test(trimmed)) {
			suggestions.push("运行测试用例验证改动");
		} else if (/(?:github|repo|项目|开源|仓库|router)/i.test(lastUserPrompt) || /(?:github\.com|项目|开源)/i.test(trimmed)) {
			suggestions.push("对比各项目的优缺点与适用场景");
			suggestions.push("深入查看推荐项目的源码实现");
		}
	}

	// 7. Accurate Milestone Recap Extraction
	let recap = "";
	if (!isQuestioning && trimmed.length >= 20) {
		const nonNextStepParagraphs = paragraphs.filter((p) => {
			const firstLine = p.trim().split("\n")[0]!;
			return !/(?:下一步|后续|建议|Next Steps|Suggestions)/i.test(firstLine);
		});

		for (const p of nonNextStepParagraphs) {
			const linesInP = p.split("\n").map((l) => cleanMarkdown(l)).filter(Boolean);
			for (const line of linesInP) {
				if (/[？?]$/.test(line)) continue;
				if (/^(?:为了|如果|若|待|将要|计划|准备|建议|假设|首先|可以通过)/.test(line)) continue;
				if (
					/(已完成|完整实现|已实现|已成功|已修复|全部通过|优化完毕|已交付|重构完成|经过排查|总结如下|总结：|修复完毕)/.test(
						line,
					) &&
					line.length >= 8 &&
					line.length <= 140
				) {
					recap = line;
					break;
				}
			}
			if (recap) break;
		}
	}

	return {
		recap,
		suggestions: [...new Set(suggestions)].filter((s) => s !== "继续下一步工作").slice(0, 3),
	};
}

export function extractLatestSuggestions(
	messages: ConversationMessage[],
	todoState?: TodoState,
): string[] {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (m && m.role === "assistant") {
			const rawText = visibleMessageText(contentText(m.content));
			if (rawText && rawText.length >= 10) {
				const userPrompt = messages.slice(0, i).reverse().find((msg) => msg.role === "user");
				const res = extractRecapAndSuggestions(rawText, {
					lastUserPrompt: userPrompt ? visibleMessageText(contentText(userPrompt.content)) : "",
					todos: todoState?.todos ?? [],
					toolCalls: m.toolCalls ?? [],
					isError: Boolean(m.isError || m.errorMessage),
				});
				if (res.suggestions.length > 0) {
					return res.suggestions;
				}
			}
		}
	}
	return [];
}
