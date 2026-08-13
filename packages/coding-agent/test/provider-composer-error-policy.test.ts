import { describe, expect, it } from "vitest";
import {
	classifyProviderError,
	computeProviderRetryDelayMs,
	type ProviderErrorCategory,
	shouldRetryProviderError,
} from "../src/core/provider-composer.ts";

// ---------------------------------------------------------------------------
// classifyProviderError
// ---------------------------------------------------------------------------

describe("classifyProviderError", () => {
	// ---- null / undefined / non-error ----

	it("returns undefined for null", () => {
		expect(classifyProviderError(null)).toBeUndefined();
	});

	it("returns undefined for undefined", () => {
		expect(classifyProviderError(undefined)).toBeUndefined();
	});

	it("returns undefined for a plain string", () => {
		expect(classifyProviderError("something went wrong")).toBeUndefined();
	});

	it("returns undefined for a plain number", () => {
		expect(classifyProviderError(500)).toBeUndefined();
	});

	// ---- Error instance fallback ----

	it('returns "unknown" for a generic Error', () => {
		expect(classifyProviderError(new Error("random failure"))).toBe("unknown");
	});

	it('returns "unknown" for an Error with no recognizable signal', () => {
		expect(classifyProviderError(new Error("oops"))).toBe("unknown");
	});

	// ---- Known Node error codes ----

	it("classifies ECONNREFUSED as network_error", () => {
		const err = new Error("connect failed") as Error & { code: string };
		err.code = "ECONNREFUSED";
		expect(classifyProviderError(err)).toBe("network_error");
	});

	it("classifies ECONNRESET as network_error", () => {
		const err = new Error("reset") as Error & { code: string };
		err.code = "ECONNRESET";
		expect(classifyProviderError(err)).toBe("network_error");
	});

	it("classifies ENOTFOUND as network_error", () => {
		const err = new Error("host not found") as Error & { code: string };
		err.code = "ENOTFOUND";
		expect(classifyProviderError(err)).toBe("network_error");
	});

	it("classifies ETIMEDOUT as timeout", () => {
		const err = new Error("timed out") as Error & { code: string };
		err.code = "ETIMEDOUT";
		expect(classifyProviderError(err)).toBe("timeout");
	});

	it("classifies ESOCKETTIMEDOUT as timeout", () => {
		const err = new Error("socket timeout") as Error & { code: string };
		err.code = "ESOCKETTIMEDOUT";
		expect(classifyProviderError(err)).toBe("timeout");
	});

	it("classifies ECONNREFUSED via code property as network_error", () => {
		const err = new Error("connect failed") as Error & { code: string };
		err.code = "ECONNREFUSED";
		expect(classifyProviderError(err)).toBe("network_error");
	});

	it("classifies EHOSTUNREACH as network_error", () => {
		const err = new Error("no route") as Error & { code: string };
		err.code = "EHOSTUNREACH";
		expect(classifyProviderError(err)).toBe("network_error");
	});

	it("classifies ENETUNREACH as network_error", () => {
		const err = new Error("network unreachable") as Error & { code: string };
		err.code = "ENETUNREACH";
		expect(classifyProviderError(err)).toBe("network_error");
	});

	// ---- HTTP status codes (status / statusCode / numeric code) ----

	it("classifies status 429 as rate_limit", () => {
		const err = new Error("too many requests") as Error & { status: number };
		err.status = 429;
		expect(classifyProviderError(err)).toBe("rate_limit");
	});

	it("classifies statusCode 429 as rate_limit", () => {
		const err = new Error("rate limited") as Error & { statusCode: number };
		err.statusCode = 429;
		expect(classifyProviderError(err)).toBe("rate_limit");
	});

	it("classifies numeric code 429 as rate_limit when code is a number", () => {
		const err = new Error("throttled") as Error & { code: number };
		err.code = 429;
		expect(classifyProviderError(err)).toBe("rate_limit");
	});

	it("classifies status 500 as server_error", () => {
		const err = new Error("boom") as Error & { status: number };
		err.status = 500;
		expect(classifyProviderError(err)).toBe("server_error");
	});

	it("classifies status 502 as server_error", () => {
		const err = new Error("bad gateway") as Error & { status: number };
		err.status = 502;
		expect(classifyProviderError(err)).toBe("server_error");
	});

	it("classifies status 503 as server_error", () => {
		const err = new Error("unavailable") as Error & { status: number };
		err.status = 503;
		expect(classifyProviderError(err)).toBe("server_error");
	});

	it("classifies status 504 as server_error", () => {
		const err = new Error("gateway timeout") as Error & { status: number };
		err.status = 504;
		expect(classifyProviderError(err)).toBe("server_error");
	});

	it("classifies status 401 as auth_error", () => {
		const err = new Error("nope") as Error & { status: number };
		err.status = 401;
		expect(classifyProviderError(err)).toBe("auth_error");
	});

	it("classifies status 403 as auth_error", () => {
		const err = new Error("forbidden") as Error & { status: number };
		err.status = 403;
		expect(classifyProviderError(err)).toBe("auth_error");
	});

	it("classifies status 400 as server_error", () => {
		const err = new Error("bad request") as Error & { status: number };
		err.status = 400;
		expect(classifyProviderError(err)).toBe("server_error");
	});

	// string code that is NOT in the code map falls through to message/status checks

	it("ignores unrecognised string code and falls through to message", () => {
		const err = new Error("rate limited") as Error & { code: string };
		err.code = "UNKNOWN_CODE";
		expect(classifyProviderError(err)).toBe("rate_limit");
	});

	// ---- Message text heuristics ----

	it('classifies "Rate limit exceeded" as rate_limit via message', () => {
		expect(classifyProviderError(new Error("Rate limit exceeded"))).toBe("rate_limit");
	});

	it('classifies "Too Many Requests" as rate_limit via message', () => {
		expect(classifyProviderError(new Error("Too Many Requests"))).toBe("rate_limit");
	});

	it('classifies "quota exceeded" as rate_limit via message', () => {
		expect(classifyProviderError(new Error("quota exceeded"))).toBe("rate_limit");
	});

	it('classifies "Request timed out" as timeout via message', () => {
		expect(classifyProviderError(new Error("Request timed out"))).toBe("timeout");
	});

	it('classifies "deadline exceeded" as timeout via message', () => {
		expect(classifyProviderError(new Error("deadline exceeded"))).toBe("timeout");
	});

	it('classifies "Unauthorized" as auth_error via message', () => {
		expect(classifyProviderError(new Error("Unauthorized"))).toBe("auth_error");
	});

	it('classifies "Authentication failed" as auth_error via message', () => {
		expect(classifyProviderError(new Error("Authentication failed"))).toBe("auth_error");
	});

	it('classifies "invalid api key" as auth_error via message', () => {
		expect(classifyProviderError(new Error("invalid api key"))).toBe("auth_error");
	});

	it('classifies "connection refused" as network_error via message', () => {
		expect(classifyProviderError(new Error("connection refused"))).toBe("network_error");
	});

	it('classifies "fetch failed" as network_error via message', () => {
		expect(classifyProviderError(new Error("fetch failed"))).toBe("network_error");
	});

	it('classifies "socket hang up" as network_error via message', () => {
		expect(classifyProviderError(new Error("socket hang up"))).toBe("network_error");
	});

	it('classifies "websocket closed" as network_error via message', () => {
		expect(classifyProviderError(new Error("websocket closed"))).toBe("network_error");
	});

	it('classifies "Internal server error" as server_error via message', () => {
		expect(classifyProviderError(new Error("Internal server error"))).toBe("server_error");
	});

	it('classifies "service unavailable" as server_error via message', () => {
		expect(classifyProviderError(new Error("service unavailable"))).toBe("server_error");
	});

	it('classifies "bad gateway" as server_error via message', () => {
		expect(classifyProviderError(new Error("bad gateway"))).toBe("server_error");
	});

	// ---- code (string) beats message for error codes ----

	it("string error code ECONNREFUSED wins over status message", () => {
		const err = new Error("status 500") as Error & { code: string };
		err.code = "ECONNREFUSED";
		expect(classifyProviderError(err)).toBe("network_error");
	});

	// ---- Case insensitivity ----

	it("is case-insensitive for message heuristics", () => {
		expect(classifyProviderError(new Error("RATE LIMIT"))).toBe("rate_limit");
		expect(classifyProviderError(new Error("Connection REFUSED"))).toBe("network_error");
	});
});

// ---------------------------------------------------------------------------
// shouldRetryProviderError
// ---------------------------------------------------------------------------

describe("shouldRetryProviderError", () => {
	// maxRetries === 0 short-circuits to false for every category

	it("returns false when maxRetries is 0 regardless of category", () => {
		for (const cat of [
			"rate_limit",
			"server_error",
			"network_error",
			"timeout",
			"auth_error",
			"unknown",
		] satisfies ProviderErrorCategory[]) {
			expect(shouldRetryProviderError(cat, 0, 0)).toBe(false);
		}
	});

	// auth_error is never retried

	it("never retries auth_error even with maxRetries > 0", () => {
		expect(shouldRetryProviderError("auth_error", 0, 3)).toBe(false);
		expect(shouldRetryProviderError("auth_error", 1, 3)).toBe(false);
		expect(shouldRetryProviderError("auth_error", 2, 3)).toBe(false);
	});

	// attempt >= maxRetries short-circuits

	it("returns false when attempt >= maxRetries", () => {
		expect(shouldRetryProviderError("rate_limit", 3, 3)).toBe(false);
		expect(shouldRetryProviderError("server_error", 2, 2)).toBe(false);
	});

	// rate_limit: retried up to 3 times (attempts 0, 1, 2)

	it("retries rate_limit within its 3-attempt budget", () => {
		expect(shouldRetryProviderError("rate_limit", 0, 3)).toBe(true);
		expect(shouldRetryProviderError("rate_limit", 1, 3)).toBe(true);
		expect(shouldRetryProviderError("rate_limit", 2, 3)).toBe(true);
		expect(shouldRetryProviderError("rate_limit", 3, 3)).toBe(false);
	});

	// server_error: retried up to 3 times

	it("retries server_error within its 3-attempt budget", () => {
		expect(shouldRetryProviderError("server_error", 0, 3)).toBe(true);
		expect(shouldRetryProviderError("server_error", 1, 3)).toBe(true);
		expect(shouldRetryProviderError("server_error", 2, 3)).toBe(true);
		expect(shouldRetryProviderError("server_error", 3, 3)).toBe(false);
	});

	// timeout: retried up to 2 times

	it("retries timeout within its 2-attempt budget", () => {
		expect(shouldRetryProviderError("timeout", 0, 3)).toBe(true);
		expect(shouldRetryProviderError("timeout", 1, 3)).toBe(true);
		expect(shouldRetryProviderError("timeout", 2, 3)).toBe(false);
	});

	// network_error: retried up to 2 times

	it("retries network_error within its 2-attempt budget", () => {
		expect(shouldRetryProviderError("network_error", 0, 3)).toBe(true);
		expect(shouldRetryProviderError("network_error", 1, 3)).toBe(true);
		expect(shouldRetryProviderError("network_error", 2, 3)).toBe(false);
	});

	// unknown: retried at most once (attempt === 0 only)

	it("retries unknown only on the first attempt", () => {
		expect(shouldRetryProviderError("unknown", 0, 5)).toBe(true);
		expect(shouldRetryProviderError("unknown", 1, 5)).toBe(false);
		expect(shouldRetryProviderError("unknown", 2, 5)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// computeProviderRetryDelayMs
// ---------------------------------------------------------------------------

describe("computeProviderRetryDelayMs", () => {
	it("returns 0 when baseDelayMs is 0", () => {
		expect(computeProviderRetryDelayMs("server_error", 0, 0)).toBe(0);
	});

	it("returns baseDelayMs * 2^attempt for non-rate-limit categories", () => {
		expect(computeProviderRetryDelayMs("server_error", 0, 2000)).toBe(2000);
		expect(computeProviderRetryDelayMs("server_error", 1, 2000)).toBe(4000);
		expect(computeProviderRetryDelayMs("server_error", 2, 2000)).toBe(8000);
	});

	it("returns the same exponential backoff for timeout and network_error", () => {
		expect(computeProviderRetryDelayMs("timeout", 1, 1000)).toBe(2000);
		expect(computeProviderRetryDelayMs("network_error", 1, 1000)).toBe(2000);
	});

	it("returns exponential backoff capped at 0 for negative baseDelayMs", () => {
		expect(computeProviderRetryDelayMs("server_error", 0, -100)).toBe(0);
	});

	it("returns a value >= baseDelayMs * 2^attempt for rate_limit (jitter >= 0)", () => {
		const base = 2000;
		const attempt = 1;
		const delay = computeProviderRetryDelayMs("rate_limit", attempt, base);
		expect(delay).toBeGreaterThanOrEqual(base * 2 ** attempt);
		expect(delay).toBeLessThan(base * 2 ** attempt + base / 2);
	});

	it("rate_limit jitter stays below baseDelayMs / 2", () => {
		// Run many times to statistically bound jitter
		const base = 2000;
		const attempt = 0;
		const minDelay = base * 2 ** attempt;
		const maxExpected = minDelay + base / 2;
		for (let i = 0; i < 200; i++) {
			const delay = computeProviderRetryDelayMs("rate_limit", attempt, base);
			expect(delay).toBeGreaterThanOrEqual(minDelay);
			expect(delay).toBeLessThan(maxExpected);
		}
	});

	it("auth_error still computes a delay value (caller decides not to retry)", () => {
		// The delay function is pure and does not embed policy — that's
		// shouldRetryProviderError's job.
		expect(computeProviderRetryDelayMs("auth_error", 0, 2000)).toBe(2000);
	});
});
