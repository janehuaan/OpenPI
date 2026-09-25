import type { ModeRoutingResult, RoutingContext } from "./types.ts";

/**
 * Explicit conversational constraints that override coding signals.
 * E.g. "先别动代码，跟我聊聊方案" -> Chat.
 */
const CHAT_CONSTRAINTS =
	/(别动代码|不要改代码|先别改|先别动工程|只讨论|聊聊思路|谈谈方案|先出方案|先理理|说下想法|不要动现有代码|纯探讨)/i;

/**
 * Standard technical keywords.
 */
const CODE_PATTERNS = [
	/\b(refactor|debug|fix|implement|function|class|component|interface|type|api|endpoint|test|unit\s*test|compile|build|npm|pnpm|cargo|pip|git|commit|pull|merge|branch|rebase)\b/i,
	/(重构|写一个|实现|改bug|修复|编写|报错|代码|函数|组件|接口|单测|构建|编译|依赖|安装|部署|提交|分支)/i,
	/[{}[\];=><+\-*/]{3,}/, // Code-like symbol density
	/```[a-z0-9_-]*\n[\s\S]*?\n```/i, // Markdown code blocks
];

/**
 * Colloquial engineering expressions and slang in daily dev work.
 */
const COLLOQUIAL_CODE_PATTERNS = [
	// Running / execution idioms: "跑不起来", "跑一下试试", "运行下"
	/(跑不起来|跑一下|跑试试|试试看|运行一下|跑下|跑通|启不来|打不开)/i,
	// References to previous turns: "按刚才说的改", "按上面的改", "照这样改"
	/(按刚才说的|按上面的|照这样改|按这个思路|按设计图|按要求改)/i,
	// Refactoring / tuning verbs: "优化一下", "修一下", "改改", "整一下", "调一下"
	/(优化一下|调一下|修一下|改改|改一下|弄一下|整一下|理一下代码)/i,
	// UI/UX issues: "这个页面好丑", "排版乱了", "样式崩了", "点不动"
	/(这个页面|界面|布局|排版|样式|好丑|太慢|卡顿|交互|点不动|没反应)/i,
	// Feature additions: "加个弹窗", "做个下拉框", "写个登录页", "补个接口"
	/(加个|做个|弄个|搞个|补个|写个).*(弹窗|按钮|页面|功能|接口|样式|组件|卡片|列表|表单|路由|输入框|下拉|弹框|模态框)/i,
	// Bug symptoms: "逻辑不对", "翻车了", "闪退", "挂了", "崩了"
	/(逻辑不对|不对劲|卡住了|挂了|崩了|翻车了|闪退|报错了|内存泄露)/i,
	// Stack traces / line numbers
	/line \d+|at \S+:\d+:\d+|\bTypeError|\bReferenceError|\bSyntaxError|\bException\b/i,
	// File extensions
	/\.(ts|tsx|js|jsx|py|rs|go|c|cpp|h|java|swift|json|ya?ml|html|css|vue|svelte)\b/i,
];

/**
 * Continuation triggers: "继续", "接着来", "下一项"
 */
const CONTINUATION_PATTERNS =
	/^(继续|接着来|下一[步个项]|继续写|继续改|往下做|go on|continue|proceed)[\s!！。~]*$/i;

/**
 * Pure greetings & chitchat
 */
const CHAT_PATTERNS = [
	/^(你好|您好|hi|hello|hey|早上好|晚上好|在吗|在不在)[\s!！?？~.]*$/i,
	/^(谢谢|多谢|thanks|thank you|ok|好的|收到|了解|明白)[\s!！?？~.]*$/i,
	/(解释一下|是什么|为什么|怎么理解|区别是什么|对比|聊聊|讲个笑话|写首诗|翻译|介绍一下|今天天气|新闻|历史)/i,
	/\b(explain|what is|why is|difference between|compare|tell me about|translate|summarize this text)\b/i,
];

export class FastModeRouter {
	/**
	 * Decide whether user prompt should be routed to 'chat' or 'code' mode.
	 * Takes optional context (workspace status, previous mode, active file).
	 * Executes in < 0.2ms.
	 */
	static route(prompt: string, context?: RoutingContext): ModeRoutingResult {
		if (!prompt || typeof prompt !== "string") {
			return {
				mode: "chat",
				confidence: 0.9,
				requiresWorkspace: false,
				reason: "Empty prompt defaults to chat",
			};
		}

		const text = prompt.trim();

		// 1. Explicit conversational negative constraints override everything
		// e.g. "先别动代码，跟我聊聊方案"
		if (CHAT_CONSTRAINTS.test(text)) {
			return {
				mode: "chat",
				confidence: 0.98,
				requiresWorkspace: false,
				reason: "Explicitly constrained to discuss/plan without modifying code",
			};
		}

		// 2. Pure greetings & chit-chat
		for (const pat of CHAT_PATTERNS) {
			if (pat.test(text)) {
				const hasCode =
					CODE_PATTERNS.some((cp) => cp.test(text)) ||
					COLLOQUIAL_CODE_PATTERNS.some((cp) => cp.test(text));
				if (!hasCode) {
					return {
						mode: "chat",
						confidence: 0.95,
						requiresWorkspace: false,
						reason: "Matched pure conversational greeting or informational query",
					};
				}
			}
		}

		// 3. Continuation prompts ("继续", "接着来")
		if (CONTINUATION_PATTERNS.test(text)) {
			if (context?.previousMode === "code" || context?.hasWorkspace) {
				return {
					mode: "code",
					confidence: 0.9,
					requiresWorkspace: true,
					reason: "Continuation in active coding context",
				};
			}
			return {
				mode: "chat",
				confidence: 0.85,
				requiresWorkspace: false,
				reason: "Continuation in conversational context",
			};
		}

		// 4. Colloquial engineering expressions ("跑不起来", "按刚才说的改", "加个弹窗", "这个页面好丑")
		for (const pat of COLLOQUIAL_CODE_PATTERNS) {
			if (pat.test(text)) {
				return {
					mode: "code",
					confidence: 0.92,
					requiresWorkspace: true,
					reason: `Detected colloquial engineering imperative: ${pat.source.slice(0, 30)}`,
				};
			}
		}

		// 5. Standard coding patterns
		let codeScore = 0;
		for (const pat of CODE_PATTERNS) {
			if (pat.test(text)) {
				codeScore += 1;
			}
		}

		if (codeScore >= 1) {
			return {
				mode: "code",
				confidence: Math.min(0.75 + codeScore * 0.1, 0.99),
				requiresWorkspace: true,
				reason: `Detected technical keywords (score=${codeScore})`,
			};
		}

		// 6. Contextual inspection: If user is inside a workspace and issues an imperative like "看看这个"
		if (context?.hasWorkspace && /(看看|看下|查查|帮看|查一下|瞧瞧)/i.test(text)) {
			return {
				mode: "code",
				confidence: 0.85,
				requiresWorkspace: true,
				reason: "Project inspection in active workspace",
			};
		}

		// 7. Short non-technical question without project context -> chat
		if (text.length < 50 && !text.includes("/") && !text.includes(".") && !context?.hasWorkspace) {
			return {
				mode: "chat",
				confidence: 0.8,
				requiresWorkspace: false,
				reason: "Short non-technical inquiry without workspace",
			};
		}

		// 8. If in an active project workspace and prompt is ambiguous, lean towards code
		if (context?.hasWorkspace && text.length > 5) {
			return {
				mode: "code",
				confidence: 0.65,
				requiresWorkspace: true,
				reason: "Contextual fallback: user has an active code workspace",
			};
		}

		// Default fallback
		return {
			mode: "chat",
			confidence: 0.65,
			requiresWorkspace: false,
			reason: "Default fallback to lightweight chat",
		};
	}
}
