import { describe, expect, it } from "vitest";
import { INVOKE_CHANNELS } from "../electron/channels";
import { desktopApi } from "../web/api";

describe("Agent Steering and Follow-up Queuing", () => {
	it("registers steer_conversation, follow_up_conversation, and clear_conversation_queue in INVOKE_CHANNELS", () => {
		expect(INVOKE_CHANNELS).toContain("steer_conversation");
		expect(INVOKE_CHANNELS).toContain("follow_up_conversation");
		expect(INVOKE_CHANNELS).toContain("clear_conversation_queue");
	});

	it("exposes steerConversation, followUpConversation, and clearConversationQueue on desktopApi", () => {
		expect(typeof desktopApi.steerConversation).toBe("function");
		expect(typeof desktopApi.followUpConversation).toBe("function");
		expect(typeof desktopApi.clearConversationQueue).toBe("function");
	});

	it("keeps steer and follow_up distinct from abort and prompt channels", () => {
		const steerIdx = INVOKE_CHANNELS.indexOf("steer_conversation");
		const followIdx = INVOKE_CHANNELS.indexOf("follow_up_conversation");
		const sendIdx = INVOKE_CHANNELS.indexOf("send_message");
		const abortIdx = INVOKE_CHANNELS.indexOf("abort_conversation");

		expect(steerIdx).toBeGreaterThan(-1);
		expect(followIdx).toBeGreaterThan(-1);
		expect(sendIdx).toBeGreaterThan(-1);
		expect(abortIdx).toBeGreaterThan(-1);
		expect(new Set([steerIdx, followIdx, sendIdx, abortIdx]).size).toBe(4);
	});
});
