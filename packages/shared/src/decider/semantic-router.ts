import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ModeRoutingResult, RoutingContext } from "./types.ts";
import { FastModeRouter } from "./router.ts";

/**
 * Anchor phrases representing the CODE intent cluster.
 */
const CODE_ANCHORS = [
	"编写或修改代码，实现新功能，添加组件、弹窗或界面",
	"排查错误与异常，修复Bug，调试代码，解决运行报错，怎么跑不起来",
	"代码重构与性能优化，调整样式排版与布局结构",
	"按刚才的方案继续修改工程代码，继续执行开发任务",
	"查看项目文件，分析代码逻辑，排查问题，执行构建与测试",
];

/**
 * Anchor phrases representing the CHAT intent cluster.
 */
const CHAT_ANCHORS = [
	"日常闲聊问答，打招呼问候，你好，谢谢",
	"百科知识问答，查一下概念原理，科学学术科普解释与背景探讨",
	"先不要动代码，只讨论构思和思路，纯方案探讨",
	"通用语言翻译与文本润色，写作辅助与资讯问答",
	"今天天气怎么样，讲个笑话，随意聊聊，查资料",
];

const CHAT_OVERRIDE_PATTERN =
	/(别动代码|不要改代码|先别改|先别动工程|只讨论|聊聊思路|谈谈方案|先出方案|先理理|说下想法|不要动现有代码|纯探讨)/i;

const CONTINUATION_PATTERN =
	/^(继续|接着|继续做|按你说的|往下走|接着弄|继续刚才|照这个做)/i;

export class SemanticRouter {
	private static extractor: any = null;
	private static isInitialized = false;
	private static initPromise: Promise<void> | null = null;
	private static codeAnchorVectors: Float32Array[] = [];
	private static chatAnchorVectors: Float32Array[] = [];

	static isAvailable(): boolean {
		const modelDir = join(homedir(), ".openpi", "models", "bge-small-zh-v1.5");
		return existsSync(join(modelDir, "onnx", "model_quantized.onnx"));
	}

	static async initialize(): Promise<void> {
		if (this.isInitialized) return;
		if (this.initPromise) return this.initPromise;

		this.initPromise = (async () => {
			if (!this.isAvailable()) {
				console.warn("[SemanticRouter] Local model assets not found in ~/.openpi/models/bge-small-zh-v1.5. Falling back to rules.");
				return;
			}

			const { pipeline, env } = await import("@xenova/transformers");
			env.allowRemoteModels = false;
			env.localModelPath = join(homedir(), ".openpi", "models");

			this.extractor = await pipeline("feature-extraction", "bge-small-zh-v1.5", {
				quantized: true,
			});

			// Precompute and cache anchor embeddings
			this.codeAnchorVectors = [];
			for (const anchor of CODE_ANCHORS) {
				const out = await this.extractor(anchor, { pooling: "mean", normalize: true });
				this.codeAnchorVectors.push(new Float32Array(out.data));
			}

			this.chatAnchorVectors = [];
			for (const anchor of CHAT_ANCHORS) {
				const out = await this.extractor(anchor, { pooling: "mean", normalize: true });
				this.chatAnchorVectors.push(new Float32Array(out.data));
			}

			this.isInitialized = true;
			console.log("[SemanticRouter] Neural anchor embeddings initialized successfully.");
		})();

		return this.initPromise;
	}

	private static cosineSimilarity(a: Float32Array, b: Float32Array): number {
		let dot = 0;
		for (let i = 0; i < a.length; i++) {
			dot += a[i] * b[i];
		}
		return dot;
	}

	/**
	 * Classify intent using Neural Semantic Embeddings in ~10ms.
	 */
	static async routeAsync(prompt: string, context?: RoutingContext): Promise<ModeRoutingResult> {
		if (!prompt || typeof prompt !== "string") {
			return { mode: "chat", confidence: 0.9, requiresWorkspace: false, reason: "Empty prompt" };
		}

		const text = prompt.trim();

		// 1. Explicit conversational constraint overrides neural scoring
		if (CHAT_OVERRIDE_PATTERN.test(text)) {
			return {
				mode: "chat",
				confidence: 0.98,
				requiresWorkspace: false,
				reason: "Explicit instruction to discuss/plan without modifying code",
			};
		}

		// 2. Continuation follows previous session mode
		if (context?.previousMode && CONTINUATION_PATTERN.test(text)) {
			return {
				mode: context.previousMode,
				confidence: 0.95,
				requiresWorkspace: context.previousMode === "code",
				reason: `Continuation follows previous ${context.previousMode} mode`,
			};
		}

		// 3. Initialize if needed
		if (!this.isInitialized && this.isAvailable()) {
			await this.initialize();
		}

		// Fallback to fast rule-based router if neural engine is unavailable
		if (!this.isInitialized || !this.extractor) {
			return FastModeRouter.route(prompt, context);
		}

		try {
			const t0 = performance.now();
			const output = await this.extractor(text, { pooling: "mean", normalize: true });
			const promptVec = new Float32Array(output.data);

			let maxCodeSim = -1;
			for (const anchorVec of this.codeAnchorVectors) {
				const sim = this.cosineSimilarity(promptVec, anchorVec);
				if (sim > maxCodeSim) maxCodeSim = sim;
			}

			let maxChatSim = -1;
			for (const anchorVec of this.chatAnchorVectors) {
				const sim = this.cosineSimilarity(promptVec, anchorVec);
				if (sim > maxChatSim) maxChatSim = sim;
			}

			const latency = Math.round(performance.now() - t0);
			const margin = maxCodeSim - maxChatSim;

			// Handle close margins with context state
			let mode: "chat" | "code" = maxCodeSim > maxChatSim ? "code" : "chat";
			if (Math.abs(margin) < 0.05) {
				if (context?.previousMode) {
					mode = context.previousMode;
				} else if (context?.hasWorkspace) {
					mode = "code";
				}
			}

			const conf = Math.min(0.5 + Math.abs(margin) * 2, 0.98);

			return {
				mode,
				confidence: Math.round(conf * 100) / 100,
				requiresWorkspace: mode === "code",
				reason: `Neural semantic match: Code=${maxCodeSim.toFixed(3)}, Chat=${maxChatSim.toFixed(3)} (${latency}ms)`,
			};
		} catch (err) {
			console.warn("[SemanticRouter] Neural inference failed, falling back to rules:", err);
			return FastModeRouter.route(prompt, context);
		}
	}

	/**
	 * Synchronous version falling back to FastModeRouter if model not awaited.
	 */
	static route(prompt: string, context?: RoutingContext): ModeRoutingResult {
		return FastModeRouter.route(prompt, context);
	}
}
