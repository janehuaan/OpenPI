/**
 * Test totalTokens field across all providers.
 *
 * totalTokens represents the total number of tokens processed by the LLM,
 * including input (with cache) and output (with thinking). This is the
 * base for calculating context size for the next request.
 *
 * - OpenAI Completions: Uses native total_tokens field
 * - OpenAI Responses: Uses native total_tokens field
 * - Google: Uses native totalTokenCount field
 * - Anthropic: Computed as input + output + cacheRead + cacheWrite
 * - Other OpenAI-compatible providers: Uses native total_tokens field
 */

import { describe, expect, it } from "vitest";
import { complete, getModel } from "../src/compat.ts";
import type { Api, Context, Model, StreamOptions, Usage } from "../src/types.ts";

type StreamOptionsWithExtras = StreamOptions & Record<string, unknown>;

import { hasAzureOpenAICredentials, resolveAzureDeploymentName } from "./azure-utils.ts";
import { resolveApiKey } from "./oauth.ts";

// Resolve OAuth tokens at module level (async, runs before tests)
const oauthTokens = await Promise.all([
	resolveApiKey("anthropic"),
	resolveApiKey("github-copilot"),
	resolveApiKey("openai-codex"),
]);
const [_anthropicOAuthToken, _githubCopilotToken, openaiCodexToken] = oauthTokens;

// Generate a long system prompt to trigger caching (>2k bytes for most providers)
const LONG_SYSTEM_PROMPT = `You are a helpful assistant. Be concise in your responses.

Here is some additional context that makes this system prompt long enough to trigger caching:

${Array(50)
	.fill(
		"Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.",
	)
	.join("\n\n")}

Remember: Always be helpful and concise.`;

async function testTotalTokensWithCache<TApi extends Api>(
	llm: Model<TApi>,
	options: StreamOptionsWithExtras = {},
): Promise<{ first: Usage; second: Usage }> {
	// First request - no cache
	const context1: Context = {
		systemPrompt: LONG_SYSTEM_PROMPT,
		messages: [
			{
				role: "user",
				content: "What is 2 + 2? Reply with just the number.",
				timestamp: Date.now(),
			},
		],
	};

	const response1 = await complete(llm, context1, options);
	expect(response1.stopReason).toBe("stop");

	// Second request - should trigger cache read (same system prompt, add conversation)
	const context2: Context = {
		systemPrompt: LONG_SYSTEM_PROMPT,
		messages: [
			...context1.messages,
			response1, // Include previous assistant response
			{
				role: "user",
				content: "What is 3 + 3? Reply with just the number.",
				timestamp: Date.now(),
			},
		],
	};

	const response2 = await complete(llm, context2, options);
	expect(response2.stopReason).toBe("stop");

	return { first: response1.usage, second: response2.usage };
}

function logUsage(label: string, usage: Usage) {
	const computed = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
	console.log(`  ${label}:`);
	console.log(
		`    input: ${usage.input}, output: ${usage.output}, cacheRead: ${usage.cacheRead}, cacheWrite: ${usage.cacheWrite}`,
	);
	console.log(`    totalTokens: ${usage.totalTokens}, computed: ${computed}`);
}

function assertTotalTokensEqualsComponents(usage: Usage) {
	const computed = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
	expect(usage.totalTokens).toBe(computed);
}

describe("totalTokens field", () => {
	// =========================================================================
	// Anthropic
	// =========================================================================

	// =========================================================================
	// OpenAI
	// =========================================================================

	describe.skipIf(!process.env.OPENAI_API_KEY)("OpenAI Completions", () => {
		it(
			"gpt-4o-mini - should return totalTokens equal to sum of components",
			{ retry: 3, timeout: 60000 },
			async () => {
				const { compat: _compat, ...baseModel } = getModel("openai", "gpt-5.6-luna")!;
				void _compat;
				const llm: Model<"openai-completions"> = {
					...baseModel,
					api: "openai-completions",
				};

				console.log(`\nOpenAI Completions / ${llm.id}:`);
				const { first, second } = await testTotalTokensWithCache(llm);

				logUsage("First request", first);
				logUsage("Second request", second);

				assertTotalTokensEqualsComponents(first);
				assertTotalTokensEqualsComponents(second);
			},
		);
	});

	describe.skipIf(!process.env.OPENAI_API_KEY)("OpenAI Responses", () => {
		it(
			"claude-haiku-4.5 - should return totalTokens equal to sum of components",
			{ retry: 3, timeout: 60000 },
			async () => {
				const llm = getModel("openai", "gpt-5.6-luna");

				console.log(`\nOpenAI Responses / ${llm.id}:`);
				const { first, second } = await testTotalTokensWithCache(llm);

				logUsage("First request", first);
				logUsage("Second request", second);

				assertTotalTokensEqualsComponents(first);
				assertTotalTokensEqualsComponents(second);
			},
		);
	});

	describe.skipIf(!hasAzureOpenAICredentials())("Azure OpenAI Responses", () => {
		it(
			"gpt-4o-mini - should return totalTokens equal to sum of components",
			{ retry: 3, timeout: 60000 },
			async () => {
				const llm = getModel("azure-openai-responses", "gpt-5.6-luna");
				const azureDeploymentName = resolveAzureDeploymentName(llm.id);
				const azureOptions = azureDeploymentName ? { azureDeploymentName } : {};

				console.log(`\nAzure OpenAI Responses / ${llm.id}:`);
				const { first, second } = await testTotalTokensWithCache(llm, azureOptions);

				logUsage("First request", first);
				logUsage("Second request", second);

				assertTotalTokensEqualsComponents(first);
				assertTotalTokensEqualsComponents(second);
			},
		);
	});

	// =========================================================================
	// Google
	// =========================================================================

	// =========================================================================
	// xAI
	// =========================================================================

	describe.skipIf(!process.env.XAI_API_KEY)("xAI", () => {
		it(
			"grok-3-fast - should return totalTokens equal to sum of components",
			{ retry: 3, timeout: 60000 },
			async () => {
				const llm = getModel("xai", "grok-3-fast");

				console.log(`\nxAI / ${llm.id}:`);
				const { first, second } = await testTotalTokensWithCache(llm, { apiKey: process.env.XAI_API_KEY });

				logUsage("First request", first);
				logUsage("Second request", second);

				assertTotalTokensEqualsComponents(first);
				assertTotalTokensEqualsComponents(second);
			},
		);
	});

	// =========================================================================
	// Groq
	// =========================================================================

	// =========================================================================
	// Cerebras
	// =========================================================================

	// =========================================================================
	// Cloudflare Workers AI
	// =========================================================================

	// =========================================================================
	// Cloudflare AI Gateway
	// =========================================================================

	// =========================================================================
	// Hugging Face
	// =========================================================================

	// =========================================================================
	// Together AI
	// =========================================================================

	// =========================================================================
	// z.ai
	// =========================================================================

	// =========================================================================
	// Mistral
	// =========================================================================

	describe.skipIf(!process.env.MISTRAL_API_KEY)("Mistral", () => {
		it(
			"devstral-medium-latest - should return totalTokens equal to sum of components",
			{ retry: 3, timeout: 60000 },
			async () => {
				const llm = getModel("mistral", "mistral-medium-3.5");

				console.log(`\nMistral / ${llm.id}:`);
				const { first, second } = await testTotalTokensWithCache(llm, { apiKey: process.env.MISTRAL_API_KEY });

				logUsage("First request", first);
				logUsage("Second request", second);

				assertTotalTokensEqualsComponents(first);
				assertTotalTokensEqualsComponents(second);
			},
		);
	});

	// =========================================================================
	// MiniMax
	// =========================================================================

	// =========================================================================
	// Xiaomi MiMo
	// =========================================================================

	// =========================================================================
	// Xiaomi MiMo Token Plan CN
	// =========================================================================

	// =========================================================================
	// Xiaomi MiMo Token Plan AMS
	// =========================================================================

	// =========================================================================
	// Xiaomi MiMo Token Plan SGP
	// =========================================================================

	// =========================================================================
	// Kimi For Coding
	// =========================================================================

	// =========================================================================
	// Vercel AI Gateway
	// =========================================================================

	// =========================================================================
	// OpenRouter - Multiple backend providers
	// =========================================================================

	describe.skipIf(!process.env.OPENROUTER_API_KEY)("OpenRouter", () => {
		it(
			"anthropic/claude-sonnet-4 - should return totalTokens equal to sum of components",
			{ retry: 3, timeout: 60000 },
			async () => {
				const llm = getModel("openrouter", "auto");

				console.log(`\nOpenRouter / ${llm.id}:`);
				const { first, second } = await testTotalTokensWithCache(llm, { apiKey: process.env.OPENROUTER_API_KEY });

				logUsage("First request", first);
				logUsage("Second request", second);

				assertTotalTokensEqualsComponents(first);
				assertTotalTokensEqualsComponents(second);
			},
		);

		it(
			"deepseek/deepseek-chat - should return totalTokens equal to sum of components",
			{ retry: 3, timeout: 60000 },
			async () => {
				const llm = getModel("openrouter", "auto");

				console.log(`\nOpenRouter / ${llm.id}:`);
				const { first, second } = await testTotalTokensWithCache(llm, { apiKey: process.env.OPENROUTER_API_KEY });

				logUsage("First request", first);
				logUsage("Second request", second);

				assertTotalTokensEqualsComponents(first);
				assertTotalTokensEqualsComponents(second);
			},
		);

		it(
			"mistralai/mistral-small-3.2-24b-instruct - should return totalTokens equal to sum of components",
			{ retry: 3, timeout: 60000 },
			async () => {
				const llm = getModel("openrouter", "auto");

				console.log(`\nOpenRouter / ${llm.id}:`);
				const { first, second } = await testTotalTokensWithCache(llm, { apiKey: process.env.OPENROUTER_API_KEY });

				logUsage("First request", first);
				logUsage("Second request", second);

				assertTotalTokensEqualsComponents(first);
				assertTotalTokensEqualsComponents(second);
			},
		);

		it(
			"google/gemini-2.5-flash - should return totalTokens equal to sum of components",
			{ retry: 3, timeout: 60000 },
			async () => {
				const llm = getModel("openrouter", "auto");

				console.log(`\nOpenRouter / ${llm.id}:`);
				const { first, second } = await testTotalTokensWithCache(llm, { apiKey: process.env.OPENROUTER_API_KEY });

				logUsage("First request", first);
				logUsage("Second request", second);

				assertTotalTokensEqualsComponents(first);
				assertTotalTokensEqualsComponents(second);
			},
		);

		it(
			"deepseek/deepseek-chat - should return totalTokens equal to sum of components",
			{ retry: 3, timeout: 60000 },
			async () => {
				const llm = getModel("openrouter", "auto");

				console.log(`\nOpenRouter / ${llm.id}:`);
				const { first, second } = await testTotalTokensWithCache(llm, { apiKey: process.env.OPENROUTER_API_KEY });

				logUsage("First request", first);
				logUsage("Second request", second);

				assertTotalTokensEqualsComponents(first);
				assertTotalTokensEqualsComponents(second);
			},
		);
	});

	// =========================================================================
	// GitHub Copilot (OAuth)
	// =========================================================================

	// =========================================================================
	// =========================================================================

	// =========================================================================
	// =========================================================================

	// =========================================================================
	// OpenAI Codex (OAuth)
	// =========================================================================

	describe("OpenAI Codex (OAuth)", () => {
		it.skipIf(!openaiCodexToken)(
			"gpt-5.5 - should return totalTokens equal to sum of components",
			{ retry: 3, timeout: 60000 },
			async () => {
				const llm = getModel("openai-codex", "gpt-5.5");

				console.log(`\nOpenAI Codex / ${llm.id}:`);
				const { first, second } = await testTotalTokensWithCache(llm, { apiKey: openaiCodexToken });

				logUsage("First request", first);
				logUsage("Second request", second);

				assertTotalTokensEqualsComponents(first);
				assertTotalTokensEqualsComponents(second);
			},
		);
	});
});
