import { describe, expect, it } from "vitest";
import { complete, getModel } from "../src/compat.ts";
import type { Api, Context, Model, StreamOptions } from "../src/types.ts";
import { hasAzureOpenAICredentials, resolveAzureDeploymentName } from "./azure-utils.ts";
import { resolveApiKey } from "./oauth.ts";

type StreamOptionsWithExtras = StreamOptions & Record<string, unknown>;

const oauthTokens = await Promise.all([resolveApiKey("github-copilot"), resolveApiKey("openai-codex")]);
const [_githubCopilotToken, openaiCodexToken] = oauthTokens;

async function expectResponseId<TApi extends Api>(model: Model<TApi>, options: StreamOptionsWithExtras = {}) {
	const context: Context = {
		systemPrompt: "You are a helpful assistant. Be concise.",
		messages: [{ role: "user", content: "Reply with exactly: response id test", timestamp: Date.now() }],
	};

	const response = await complete(model, context, options);

	expect(response.stopReason, response.errorMessage).not.toBe("error");
	expect(response.responseId).toBeTruthy();
	expect(typeof response.responseId).toBe("string");
}

describe("responseId E2E Tests", () => {
	describe.skipIf(!process.env.OPENAI_API_KEY)("OpenAI Completions Provider", () => {
		const { compat: _compat, ...baseModel } = getModel("openai", "gpt-5.6-luna");
		void _compat;
		const llm: Model<"openai-completions"> = {
			...baseModel,
			api: "openai-completions",
		};

		it("should expose responseId", { retry: 3, timeout: 30000 }, async () => {
			await expectResponseId(llm);
		});
	});

	describe.skipIf(!process.env.OPENAI_API_KEY)("OpenAI Responses Provider", () => {
		const llm = getModel("openai", "gpt-5.6-luna");

		it("should expose responseId", { retry: 3, timeout: 30000 }, async () => {
			await expectResponseId(llm);
		});
	});

	describe.skipIf(!hasAzureOpenAICredentials())("Azure OpenAI Responses Provider", () => {
		const llm = getModel("azure-openai-responses", "gpt-5.6-luna");
		const azureDeploymentName = resolveAzureDeploymentName(llm.id);
		const azureOptions = azureDeploymentName ? { azureDeploymentName } : {};

		it("should expose responseId", { retry: 3, timeout: 30000 }, async () => {
			await expectResponseId(llm, azureOptions);
		});
	});

	describe.skipIf(!process.env.MISTRAL_API_KEY)("Mistral Provider", () => {
		const llm = getModel("mistral", "mistral-medium-3.5");

		it("should expose responseId", { retry: 3, timeout: 30000 }, async () => {
			await expectResponseId(llm);
		});
	});

	describe("OpenAI Codex Provider", () => {
		it.skipIf(!openaiCodexToken)("should expose responseId", { retry: 3, timeout: 30000 }, async () => {
			const llm = getModel("openai-codex", "gpt-5.5");
			await expectResponseId(llm, { apiKey: openaiCodexToken });
		});
	});
});
