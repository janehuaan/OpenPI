/**
 * Automated Dynamic Model Capability Prober
 *
 * Actively probes models via live API calls to test:
 * 1. Modality capabilities: Image/Vision support vs Text-only.
 * 2. Reasoning capability: reasoning_content, reasoning_tokens, and <think> tokens.
 * 3. Max tokens output ceiling: dynamic probe capturing gateway-enforced limits.
 * 4. Context window bounds: dynamic error boundary detection + registry resolution.
 * 5. Latency and health status.
 */

import { queryDynamicRegistry } from "./model-specs-registry.ts";

export interface ModelProbeResult {
	modelId: string;
	ok: boolean;
	latencyMs: number;
	contextWindow: number;
	maxTokens: number;
	reasoning: boolean;
	input: string[]; // ["text"] or ["text", "image"]
	error?: string;
	probedAt: number;
	details?: {
		visionSupport: boolean;
		detectedMaxTokens?: number;
		detectedContext?: number;
		reasoningTokensDetected?: boolean;
	};
}

export interface ProbeOptions {
	baseUrl: string;
	apiKey?: string;
	modelId: string;
	defaultContext?: number;
	timeoutMs?: number;
}

// 1x1 transparent PNG data URL for vision probing
const PROBE_PIXEL_IMAGE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/**
 * Actively probe a single model against its provider endpoint.
 */
export async function probeSingleModel(options: ProbeOptions): Promise<ModelProbeResult> {
	const { baseUrl, apiKey, modelId, defaultContext = 1000000, timeoutMs = 15000 } = options;
	const cleanBaseUrl = baseUrl.trim().replace(/\/+$/, "");
	const endpoint = cleanBaseUrl.endsWith("/v1")
		? `${cleanBaseUrl}/chat/completions`
		: `${cleanBaseUrl}/v1/chat/completions`;

	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	if (apiKey && apiKey.trim()) {
		headers.Authorization = `Bearer ${apiKey.trim()}`;
	}

	const registrySpec = queryDynamicRegistry(modelId);
	let detectedMaxTokens: number | undefined;
	let detectedContext: number | undefined;
	let reasoningTokensDetected = false;
	let visionSupport = false;
	let latencyMs = 0;
	let lastError = "";
	let isOk = false;

	// ── 1. Probe Max Tokens & Reasoning Boundary ──
	const startTime = Date.now();
	try {
		const res = await fetch(endpoint, {
			method: "POST",
			headers,
			signal: AbortSignal.timeout(timeoutMs),
			body: JSON.stringify({
				model: modelId,
				messages: [{ role: "user", content: "1" }],
				max_tokens: 500000,
			}),
		});
		latencyMs = Date.now() - startTime;

		const json = (await res.json().catch(() => ({}))) as any;
		const rawText = JSON.stringify(json);

		if (res.ok && json.choices && json.choices.length > 0) {
			isOk = true;
			// Check reasoning in completion response
			const choice = json.choices[0];
			if (choice?.message?.reasoning_content) {
				reasoningTokensDetected = true;
			}
			if (typeof json?.usage?.completion_tokens_details?.reasoning_tokens === "number" && json.usage.completion_tokens_details.reasoning_tokens > 0) {
				reasoningTokensDetected = true;
			}
			const content = choice?.message?.content || "";
			if (content.includes("<think>") || content.includes("</think>")) {
				reasoningTokensDetected = true;
			}
		} else {
			// Parse gateway error messages for limits
			// E.g.: "max_tokens should be less or equal to 131072", "should be <= 65536", "maximum context length is 1048576 tokens"
			const limitMatch =
				rawText.match(/less or equal to\s*(\d+)/i) ||
				rawText.match(/max_tokens.*?(?:<=?|less than or equal to)\s*(\d+)/i) ||
				rawText.match(/max_tokens\s*\((\d+)\)\s*exceeds\s*(?:maximum allowed of\s*)?(\d+)/i) ||
				rawText.match(/exceeds the limit of\s*(\d+)/i);

			if (limitMatch) {
				const num = Number(limitMatch[1] || limitMatch[2]);
				if (!isNaN(num) && num > 0) {
					detectedMaxTokens = num;
					isOk = true; // Gateway reached and responded with exact spec
				}
			}

			const ctxMatch =
				rawText.match(/maximum(?:\s*context)?\s*length is\s*(\d+)/i) ||
				rawText.match(/context length\s*(?:is|of)\s*(\d+)/i);
			if (ctxMatch) {
				const cNum = Number(ctxMatch[1]);
				if (!isNaN(cNum) && cNum > 0) {
					detectedContext = cNum;
					isOk = true;
				}
			}

			if (json?.error) {
				lastError = typeof json.error === "string" ? json.error : json.error?.message || rawText;
			} else if (json?.message) {
				lastError = json.message;
			}
		}
	} catch (err: any) {
		latencyMs = Date.now() - startTime;
		lastError = err?.message || String(err);
	}

	// ── 2. Probe Vision Capability ──
	try {
		const vRes = await fetch(endpoint, {
			method: "POST",
			headers,
			signal: AbortSignal.timeout(timeoutMs),
			body: JSON.stringify({
				model: modelId,
				messages: [
					{
						role: "user",
						content: [
							{ type: "text", text: "1" },
							{ type: "image_url", image_url: { url: PROBE_PIXEL_IMAGE } },
						],
					},
				],
				max_tokens: 1,
			}),
		});

		const vJson = (await vRes.json().catch(() => ({}))) as any;
		const vText = JSON.stringify(vJson);

		if (vRes.ok && vJson.choices && vJson.choices.length > 0) {
			visionSupport = true;
			isOk = true;
		} else {
			// Explicit capability rejection
			const notSupported =
				vText.includes("MODEL_CAPABILITY_NOT_SUPPORTED") ||
				vText.includes("不支持该能力：vision") ||
				vText.includes("does not support image") ||
				vText.includes("not support vision") ||
				vText.includes("invalid image");

			if (notSupported) {
				visionSupport = false;
				isOk = true;
			} else if (registrySpec?.input?.includes("image")) {
				visionSupport = true;
			}
		}
	} catch {
		// Vision probe timeout or error, fallback to registry
		visionSupport = registrySpec?.input?.includes("image") ?? false;
	}

	// ── 3. Resolve Final Specs Dynamically ──
	const contextWindow =
		detectedContext ??
		registrySpec?.contextWindow ??
		defaultContext;

	const maxTokens =
		detectedMaxTokens ??
		registrySpec?.maxTokens ??
		Math.min(contextWindow, 65536);

	const reasoning =
		reasoningTokensDetected ||
		Boolean(registrySpec?.reasoning) ||
		modelId.toLowerCase().includes("reason") ||
		modelId.toLowerCase().includes("think") ||
		modelId.toLowerCase().includes("r1") ||
		modelId.toLowerCase().includes("o1") ||
		modelId.toLowerCase().includes("o3");

	return {
		modelId,
		ok: isOk,
		latencyMs,
		contextWindow,
		maxTokens,
		reasoning,
		input: visionSupport ? ["text", "image"] : ["text"],
		error: !isOk && lastError ? lastError : undefined,
		probedAt: Date.now(),
		details: {
			visionSupport,
			detectedMaxTokens,
			detectedContext,
			reasoningTokensDetected,
		},
	};
}

/**
 * Concurrently probe a list of models with a pool worker to avoid overwhelming the gateway.
 */
export async function batchProbeModels(
	options: {
		baseUrl: string;
		apiKey?: string;
		models: string[];
		defaultContext?: number;
		concurrency?: number;
		onProgress?: (done: number, total: number, result: ModelProbeResult) => void;
	}
): Promise<ModelProbeResult[]> {
	const { baseUrl, apiKey, models, defaultContext = 1000000, concurrency = 4, onProgress } = options;
	const results: ModelProbeResult[] = [];
	let index = 0;
	let completed = 0;

	async function worker() {
		while (index < models.length) {
			const i = index++;
			const modelId = models[i];
			try {
				const res = await probeSingleModel({
					baseUrl,
					apiKey,
					modelId,
					defaultContext,
				});
				results[i] = res;
				completed++;
				onProgress?.(completed, models.length, res);
			} catch (err: any) {
				const fallbackSpec = queryDynamicRegistry(modelId);
				const fallback: ModelProbeResult = {
					modelId,
					ok: false,
					latencyMs: 0,
					contextWindow: fallbackSpec?.contextWindow ?? defaultContext,
					maxTokens: fallbackSpec?.maxTokens ?? 65536,
					reasoning: fallbackSpec?.reasoning ?? false,
					input: fallbackSpec?.input ?? ["text"],
					error: err?.message || String(err),
					probedAt: Date.now(),
				};
				results[i] = fallback;
				completed++;
				onProgress?.(completed, models.length, fallback);
			}
		}
	}

	const poolSize = Math.min(concurrency, models.length);
	const workers = Array.from({ length: poolSize }, () => worker());
	await Promise.all(workers);

	return results;
}
