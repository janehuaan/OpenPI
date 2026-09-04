/**
 * ui-request.ts coverage.
 *
 * Getting this wrong is a hang, not a cosmetic bug: an extension's `ctx.ui`
 * prompt blocks its agent turn until a reply arrives, so a request we fail to
 * classify never gets answered. The event shapes here are the ones the Phase 0
 * spike observed on the real stream.
 */

import { describe, expect, it } from "vitest";
import { parseUiRequest, stripAnsi, uiResponseCommand } from "../lib/ui-request.ts";

const ESC = String.fromCharCode(27);

describe("blocking prompts", () => {
	it("parses a select with string options", () => {
		const parsed = parseUiRequest({
			type: "extension_ui_request",
			id: "ui-1",
			method: "select",
			message: "Pick a branch",
			options: ["main", "develop"],
		});
		expect(parsed.kind).toBe("request");
		if (parsed.kind !== "request") return;
		expect(parsed.request.id).toBe("ui-1");
		expect(parsed.request.options).toEqual(["main", "develop"]);
	});

	it("normalizes options given as label/value records", () => {
		const parsed = parseUiRequest({
			type: "extension_ui_request",
			id: "ui-2",
			method: "select",
			options: [{ label: "Main", value: "main" }, { value: "develop" }, { nothing: true }],
		});
		if (parsed.kind !== "request") throw new Error("expected a request");
		expect(parsed.request.options).toEqual(["Main", "develop"]);
	});

	it("parses a confirm whose question is in title, as the real stream sends it", () => {
		// Observed shape: {method:"confirm", title:"Proceed with the risky thing?"}
		const parsed = parseUiRequest({
			type: "extension_ui_request",
			id: "ui-3",
			method: "confirm",
			title: "Proceed with the risky thing?",
		});
		if (parsed.kind !== "request") throw new Error("expected a request");
		expect(parsed.request.method).toBe("confirm");
		expect(parsed.request.message).toBe("Proceed with the risky thing?");
	});

	it("prefers title as the question and keeps message as the detail line", () => {
		const parsed = parseUiRequest({
			type: "extension_ui_request",
			id: "ui-3b",
			method: "confirm",
			title: "Clear session?",
			message: "All messages will be lost.",
		});
		if (parsed.kind !== "request") throw new Error("expected a request");
		expect(parsed.request.message).toBe("Clear session?");
		expect(parsed.request.detail).toBe("All messages will be lost.");
	});

	it("parses an input, carrying its default", () => {
		const parsed = parseUiRequest({
			type: "extension_ui_request",
			id: "ui-4",
			method: "input",
			prompt: "Commit message",
			defaultValue: "wip",
		});
		if (parsed.kind !== "request") throw new Error("expected a request");
		expect(parsed.request.message).toBe("Commit message");
		expect(parsed.request.defaultValue).toBe("wip");
	});

	it("falls back to message, prompt or text when there is no title", () => {
		for (const field of ["message", "prompt", "text"]) {
			const parsed = parseUiRequest({
				type: "extension_ui_request",
				id: "ui-5",
				method: "input",
				[field]: `from ${field}`,
			});
			if (parsed.kind !== "request") throw new Error("expected a request");
			expect(parsed.request.message).toBe(`from ${field}`);
		}
	});

	it("carries an input's placeholder and an editor's prefill", () => {
		const input = parseUiRequest({
			type: "extension_ui_request",
			id: "ui-5b",
			method: "input",
			title: "Enter a value",
			placeholder: "type something...",
		});
		if (input.kind !== "request") throw new Error("expected a request");
		expect(input.request.placeholder).toBe("type something...");

		const editor = parseUiRequest({
			type: "extension_ui_request",
			id: "ui-5c",
			method: "editor",
			title: "Edit",
			prefill: "Line 1\nLine 2",
		});
		if (editor.kind !== "request") throw new Error("expected a request");
		expect(editor.request.defaultValue).toBe("Line 1\nLine 2");
	});

	it("ignores a blocking method with no id, which cannot be answered", () => {
		expect(parseUiRequest({ type: "extension_ui_request", method: "confirm" }).kind).toBe("ignored");
	});
});

describe("status updates", () => {
	it("parses setStatus into a keyed status", () => {
		const parsed = parseUiRequest({
			type: "extension_ui_request",
			id: "ui-6",
			method: "setStatus",
			statusKey: "openpi-usage",
			statusText: "5h 0%",
		});
		expect(parsed.kind).toBe("status");
		if (parsed.kind !== "status") return;
		expect(parsed.status).toEqual({ key: "openpi-usage", text: "5h 0%" });
	});

	it("treats setStatus with no text as a clear", () => {
		const parsed = parseUiRequest({
			type: "extension_ui_request",
			id: "ui-7",
			method: "setStatus",
			statusKey: "plan-mode",
		});
		if (parsed.kind !== "status") throw new Error("expected a status");
		expect(parsed.status.text).toBeUndefined();
	});

	it("parses setWidget by its widget key", () => {
		const parsed = parseUiRequest({
			type: "extension_ui_request",
			id: "ui-8",
			method: "setWidget",
			widgetKey: "plan-mode-plan",
		});
		if (parsed.kind !== "status") throw new Error("expected a status");
		expect(parsed.status.key).toBe("plan-mode-plan");
	});
});

describe("ignored events", () => {
	it("ignores events that are not UI requests", () => {
		expect(parseUiRequest({ type: "agent_start" }).kind).toBe("ignored");
		expect(parseUiRequest({ type: "message_end", message: {} }).kind).toBe("ignored");
	});

	it("ignores notify, which upstream documents as fire-and-forget", () => {
		// Replying to it would be harmless but pointless; showing a blocking dialog
		// for it would wrongly imply the turn is waiting.
		expect(parseUiRequest({ type: "extension_ui_request", id: "ui-n", method: "notify", message: "done" }).kind).toBe(
			"ignored",
		);
	});

	it("ignores an unknown method rather than rendering a dialog it cannot fill", () => {
		// Upstream adds methods between releases; a wrong dialog is worse than none.
		expect(parseUiRequest({ type: "extension_ui_request", id: "ui-9", method: "someFutureThing" }).kind).toBe(
			"ignored",
		);
	});
});

describe("uiResponseCommand", () => {
	it("echoes the request id so the subprocess can correlate it", () => {
		const command = uiResponseCommand({ id: "ui-1", method: "input" }, { value: "answer" });
		expect(command.type).toBe("extension_ui_response");
		expect(command.id).toBe("ui-1");
		expect(command.value).toBe("answer");
	});

	it("carries a confirm outcome", () => {
		expect(uiResponseCommand({ id: "ui-2", method: "confirm" }, { confirmed: true }).confirmed).toBe(true);
		expect(uiResponseCommand({ id: "ui-3", method: "confirm" }, { confirmed: false }).confirmed).toBe(false);
	});

	it("carries a cancel, which still has to be sent", () => {
		// Closing the dialog without replying would leave the turn blocked forever.
		expect(uiResponseCommand({ id: "ui-4", method: "select" }, { cancelled: true }).cancelled).toBe(true);
	});
});

describe("stripAnsi", () => {
	it("removes color codes including the escape byte", () => {
		// Matching only "[33m" leaves a bare ESC behind, which renders as a glyph.
		expect(stripAnsi(`usage ${ESC}[33m100%${ESC}[0m done`)).toBe("usage 100% done");
	});

	it("leaves text without escapes untouched", () => {
		expect(stripAnsi("plain text with [brackets]")).toBe("plain text with [brackets]");
	});

	it("handles an empty string", () => {
		expect(stripAnsi("")).toBe("");
	});
});
