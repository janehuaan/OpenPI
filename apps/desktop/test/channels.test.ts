/**
 * channels.ts coverage.
 *
 * The allowlist is a security boundary: a channel missing from it is silently
 * unreachable, and one present without a handler rejects at call time. The old
 * fork kept two copies of this list with a "keep in sync" comment, and they had
 * already drifted - two channels existed only in the preload. These tests make
 * the single list the thing that is checked.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	CHANNEL_PREFIX,
	EVENT_CHANNELS,
	eventChannelName,
	INVOKE_CHANNELS,
	invokeChannelName,
} from "../electron/channels.ts";

describe("channel lists", () => {
	it("has no duplicate invoke channels", () => {
		expect(new Set(INVOKE_CHANNELS).size).toBe(INVOKE_CHANNELS.length);
	});

	it("has no duplicate event channels", () => {
		expect(new Set(EVENT_CHANNELS).size).toBe(EVENT_CHANNELS.length);
	});

	it("keeps invoke and event names disjoint", () => {
		const events = new Set<string>(EVENT_CHANNELS);
		expect(INVOKE_CHANNELS.filter((channel) => events.has(channel))).toEqual([]);
	});

	it("uses snake_case names without the prefix baked in", () => {
		for (const channel of [...INVOKE_CHANNELS, ...EVENT_CHANNELS]) {
			expect(channel).toMatch(/^[a-z][a-z0-9_]*$/);
			expect(channel.startsWith(CHANNEL_PREFIX)).toBe(false);
		}
	});
});

describe("name builders", () => {
	it("prefixes invoke channels", () => {
		expect(invokeChannelName("daemon_health")).toBe("openpi:daemon_health");
	});

	it("prefixes event channels", () => {
		expect(eventChannelName("session_event")).toBe("openpi:session_event");
	});

	it("prefixes every channel exactly once", () => {
		for (const channel of INVOKE_CHANNELS) {
			const name = invokeChannelName(channel);
			expect(name.startsWith(CHANNEL_PREFIX)).toBe(true);
			expect(name.slice(CHANNEL_PREFIX.length).includes(":")).toBe(false);
		}
	});
});

describe("coverage of what the app needs", () => {
	it("covers the session lifecycle", () => {
		for (const channel of [
			"list_sessions",
			"create_session",
			"stop_session",
			"delete_session",
			"subscribe_session",
			"unsubscribe_session",
			"session_rpc",
		]) {
			expect(INVOKE_CHANNELS).toContain(channel);
		}
	});

	it("covers the app-level operations the old fork used custom RPC commands for", () => {
		// get_model_catalog, get_provider_auth_status and friends were 8 of the 12
		// commands that required patching upstream; they are plain app ops now.
		for (const channel of ["auth_status", "list_models", "workspace_summary", "list_memory"]) {
			expect(INVOKE_CHANNELS).toContain(channel);
		}
	});

	it("exposes only Electron capabilities that have no other home", () => {
		// Anything that could run in the daemon should not be an IPC channel: that
		// is how the old bridge.mjs reached 1,326 lines.
		const native = INVOKE_CHANNELS.filter((channel) =>
			["select_workspace", "open_external", "show_item_in_folder"].includes(channel),
		);
		expect(native).toHaveLength(3);
	});

	it("has a main-process handler for every allowlisted channel", () => {
		// A channel in the allowlist with no handler rejects only when the UI calls
		// it, which is exactly the drift the old two-list setup produced.
		const source = readFileSync(new URL("../electron/handlers.ts", import.meta.url), "utf8");
		const missing = INVOKE_CHANNELS.filter((channel) => !new RegExp(`\\b${channel}:`).test(source));
		expect(missing).toEqual([]);
	});
});
