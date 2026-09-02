/**
 * Phase 0 spike extension.
 *
 * Proves, against the real @earendil-works/pi-coding-agent@0.84.4 package:
 *   1. a script extension is discovered and loaded from settings.json
 *   2. registerTool exposes a custom tool to RPC callers
 *   3. pi.on("context") can inject messages into the provider payload
 *   4. pi.appendEntry + upstream get_entries RPC round-trip works
 *   5. ctx.ui.setStatus reaches an RPC client as extension_ui_request
 *
 * Correct shape: default-export a factory `(pi: ExtensionAPI) => void`.
 * `ctx` is the second argument of each handler, not an init parameter.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function spikeExtension(pi: ExtensionAPI) {
	// 1. Tool registration
	pi.registerTool({
		name: "openpi_ping",
		label: "openpi ping",
		description: "Ping the openpi extension to prove it is loaded",
		parameters: {
			type: "object",
			properties: {},
			additionalProperties: false,
		},
		execute: async () => ({
			output: "pong from openpi-next extension",
		}),
	});

	// 2. Context injection - proves the memory-injection channel
	pi.on("context", async (event) => {
		return {
			messages: [
				...event.messages,
				{
					role: "user" as const,
					content: "[openpi-next] injected-context-marker",
				},
			],
		};
	});

	// 3. Custom session entry - proves the extension -> desktop data channel
	pi.on("session_start", async (_event, ctx) => {
		pi.appendEntry("openpi:checkpoint", {
			text: "checkpoint written at session start",
			cwd: ctx.cwd,
			writtenAt: new Date().toISOString(),
		});
		ctx.ui.setStatus("openpi-spike", "openpi-next loaded");
	});

	// 4. Tool observation - proves the event-ledger channel
	pi.on("tool_call", async (event, ctx) => {
		ctx.ui.setStatus("openpi-spike", `tool: ${event.toolName}`);
	});
}
