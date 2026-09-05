/**
 * channels.ts coverage.
 *
 * The allowlist is a security boundary: a channel missing from it is silently
 * unreachable, and one present without a handler rejects at call time.
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

	it("uses valid channel names without the prefix baked in", () => {
		for (const channel of INVOKE_CHANNELS) {
			expect(channel).toMatch(/^[a-z][a-z0-9_]*$/);
			expect(channel.startsWith(CHANNEL_PREFIX)).toBe(false);
		}
		for (const channel of EVENT_CHANNELS) {
			expect(channel).toMatch(/^[a-z][a-z0-9_-]*$/);
			expect(channel.startsWith(CHANNEL_PREFIX)).toBe(false);
		}
	});
});

describe("name builders", () => {
	it("prefixes invoke channels", () => {
		expect(invokeChannelName("get_snapshot")).toBe("openpi:get_snapshot");
	});

	it("prefixes event channels", () => {
		expect(eventChannelName("conversation-event")).toBe("openpi:conversation-event");
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
			"get_snapshot",
			"create_conversation",
			"get_conversation",
			"send_message",
			"abort_conversation",
			"rename_conversation",
			"delete_conversation",
			"watch_conversation_stream",
			"stop_conversation_stream",
		]) {
			expect(INVOKE_CHANNELS).toContain(channel);
		}
	});

	it("covers app-level, task and media operations", () => {
		for (const channel of [
			"get_available_models",
			"get_model_catalog",
			"get_workspace_summary",
			"list_memory_index",
			"create_task",
			"generate_image",
			"create_video",
			"save_media",
		]) {
			expect(INVOKE_CHANNELS).toContain(channel);
		}
	});

	it("has a main-process handler for every allowlisted channel", () => {
		const source = readFileSync(new URL("../electron/handlers.ts", import.meta.url), "utf8");
		const missing = INVOKE_CHANNELS.filter((channel) => !new RegExp(`\\b${channel}:`).test(source));
		expect(missing).toEqual([]);
	});
});
