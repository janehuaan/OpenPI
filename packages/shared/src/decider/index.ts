export * from "./types.ts";
export * from "./sentinel.ts";
export * from "./router.ts";
export * from "./semantic-router.ts";
export * from "./verifier.ts";
export * from "./laya-onnx.ts";

import { FastSentinel } from "./sentinel.ts";
import { FastModeRouter } from "./router.ts";
import { SemanticRouter } from "./semantic-router.ts";
import { StepVerifier } from "./verifier.ts";
import { LayaONNXEngine } from "./laya-onnx.ts";

/**
 * Unified OpenPI Decision Engine.
 * Combines zero-latency fast path (<0.2ms) with pluggable ONNX neural decision capabilities.
 */
export class OpenPIDecider {
	private static neuralEngine: LayaONNXEngine | null = null;
	private static verifierInstance = new StepVerifier();

	/**
	 * Get or initialize neural ONNX engine if available.
	 */
	static getNeuralEngine(): LayaONNXEngine {
		if (!this.neuralEngine) {
			this.neuralEngine = new LayaONNXEngine();
		}
		return this.neuralEngine;
	}

	/**
	 * Head: Determine whether the prompt is Chat or Code mode (Sync fast path).
	 */
	static decideMode(prompt: string, context?: import("./types.ts").RoutingContext) {
		return FastModeRouter.route(prompt, context);
	}

	/**
	 * Check whether Neural Semantic Router model files are present.
	 */
	static isSemanticAvailable(): boolean {
		return SemanticRouter.isAvailable();
	}

	/**
	 * Head: Determine whether the prompt is Chat or Code mode using Neural Semantic Router (~10ms).
	 */
	static async decideModeAsync(prompt: string, context?: import("./types.ts").RoutingContext) {
		return SemanticRouter.routeAsync(prompt, context);
	}

	/**
	 * Sentinel: Intercept high-risk / destructive commands and actions.
	 */
	static checkSafety(toolName: string, input: Record<string, unknown>) {
		return FastSentinel.checkToolCall(toolName, input);
	}

	/**
	 * Tail: Verify tool execution output and generate steering hints.
	 */
	static verifyStep(toolName: string, isError: boolean, outputText: string) {
		return this.verifierInstance.verify(toolName, isError, outputText);
	}
}
