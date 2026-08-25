import { afterEach, describe, expect, it, vi } from "vitest";
import { openaiCodexOAuth } from "../src/auth/oauth/openai-codex.ts";
import * as extensionOAuthCompatibility from "../src/oauth.ts";

function _jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe.sequential("OAuthAuth adapters", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("keeps the extension OAuth barrel free of built-in flow implementations", () => {
		expect(extensionOAuthCompatibility).not.toHaveProperty("loginOpenAICodex");
		expect(extensionOAuthCompatibility).not.toHaveProperty("openaiCodexOAuth");
	});

	it("openai-codex toAuth derives the api key from the access token", async () => {
		const auth = await openaiCodexOAuth.toAuth({ type: "oauth", access: "token", refresh: "r", expires: 0 });
		expect(auth).toEqual({ apiKey: "token" });
	});
});
