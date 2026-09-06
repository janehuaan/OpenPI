import { describe, expect, it, vi } from "vitest";
import { handleKeybinding, matchKeybinding, type KeybindingHandlers } from "./keybindings";

describe("keybindings", () => {
	describe("matchKeybinding", () => {
		it("matches Cmd/Ctrl + N for new_conversation", () => {
			// Mac: Meta + N
			expect(matchKeybinding({ key: "n", metaKey: true, ctrlKey: false, shiftKey: false, altKey: false })).toBe(
				"new_conversation",
			);
			expect(matchKeybinding({ key: "N", metaKey: true, ctrlKey: false, shiftKey: false, altKey: false })).toBe(
				"new_conversation",
			);
			// Windows/Linux: Ctrl + N
			expect(matchKeybinding({ key: "n", metaKey: false, ctrlKey: true, shiftKey: false, altKey: false })).toBe(
				"new_conversation",
			);
			// Shift + Cmd + N should NOT match new_conversation
			expect(matchKeybinding({ key: "n", metaKey: true, ctrlKey: false, shiftKey: true, altKey: false })).toBeNull();
			// Alt + Cmd + N should NOT match
			expect(matchKeybinding({ key: "n", metaKey: true, ctrlKey: false, shiftKey: false, altKey: true })).toBeNull();
		});

		it("matches Cmd/Ctrl + B for toggle_sidebar", () => {
			expect(matchKeybinding({ key: "b", metaKey: true, ctrlKey: false, shiftKey: false, altKey: false })).toBe(
				"toggle_sidebar",
			);
			expect(matchKeybinding({ key: "B", metaKey: false, ctrlKey: true, shiftKey: false, altKey: false })).toBe(
				"toggle_sidebar",
			);
			expect(matchKeybinding({ key: "b", metaKey: true, ctrlKey: false, shiftKey: true, altKey: false })).toBeNull();
		});

		it("matches Escape for abort only when isWorking is true", () => {
			// Not working: should NOT match
			expect(
				matchKeybinding(
					{ key: "Escape", metaKey: false, ctrlKey: false, shiftKey: false, altKey: false },
					{ isWorking: false },
				),
			).toBeNull();
			expect(
				matchKeybinding(
					{ key: "Escape", metaKey: false, ctrlKey: false, shiftKey: false, altKey: false },
					{ isWorking: undefined },
				),
			).toBeNull();

			// Working: should match abort
			expect(
				matchKeybinding(
					{ key: "Escape", metaKey: false, ctrlKey: false, shiftKey: false, altKey: false },
					{ isWorking: true },
				),
			).toBe("abort");
		});

		it("matches Cmd/Ctrl + , for open_settings", () => {
			expect(matchKeybinding({ key: ",", metaKey: true, ctrlKey: false, shiftKey: false, altKey: false })).toBe(
				"open_settings",
			);
			expect(matchKeybinding({ key: ",", metaKey: false, ctrlKey: true, shiftKey: false, altKey: false })).toBe(
				"open_settings",
			);
			expect(matchKeybinding({ key: ",", metaKey: true, ctrlKey: false, shiftKey: true, altKey: false })).toBeNull();
		});

		it("matches Cmd/Ctrl + Shift + E for export_markdown", () => {
			expect(matchKeybinding({ key: "e", metaKey: true, ctrlKey: false, shiftKey: true, altKey: false })).toBe(
				"export_markdown",
			);
			expect(matchKeybinding({ key: "E", metaKey: false, ctrlKey: true, shiftKey: true, altKey: false })).toBe(
				"export_markdown",
			);
			// Without shift, should NOT match
			expect(matchKeybinding({ key: "e", metaKey: true, ctrlKey: false, shiftKey: false, altKey: false })).toBeNull();
		});

		it("returns null for unrelated keys", () => {
			expect(matchKeybinding({ key: "k", metaKey: true, ctrlKey: false, shiftKey: false, altKey: false })).toBeNull();
			expect(matchKeybinding({ key: "Enter", metaKey: false, ctrlKey: false, shiftKey: false, altKey: false })).toBeNull();
		});
	});

	describe("handleKeybinding", () => {
		function createMockEvent(props: Partial<KeyboardEvent>): KeyboardEvent {
			return {
				key: "",
				metaKey: false,
				ctrlKey: false,
				shiftKey: false,
				altKey: false,
				preventDefault: vi.fn(),
				...props,
			} as unknown as KeyboardEvent;
		}

		it("calls onNewConversation and prevents default on Cmd+N", () => {
			const onNewConversation = vi.fn();
			const event = createMockEvent({ key: "n", metaKey: true });
			const handled = handleKeybinding(event, { onNewConversation });

			expect(handled).toBe(true);
			expect(event.preventDefault).toHaveBeenCalledTimes(1);
			expect(onNewConversation).toHaveBeenCalledTimes(1);
		});

		it("calls onToggleSidebar and prevents default on Cmd+B", () => {
			const onToggleSidebar = vi.fn();
			const event = createMockEvent({ key: "b", metaKey: true });
			const handled = handleKeybinding(event, { onToggleSidebar });

			expect(handled).toBe(true);
			expect(event.preventDefault).toHaveBeenCalledTimes(1);
			expect(onToggleSidebar).toHaveBeenCalledTimes(1);
		});

		it("calls onAbort and prevents default on Escape when isWorking", () => {
			const onAbort = vi.fn();
			const event = createMockEvent({ key: "Escape" });
			const handled = handleKeybinding(event, { onAbort, isWorking: true });

			expect(handled).toBe(true);
			expect(event.preventDefault).toHaveBeenCalledTimes(1);
			expect(onAbort).toHaveBeenCalledTimes(1);
		});

		it("does not call onAbort when isWorking is false", () => {
			const onAbort = vi.fn();
			const event = createMockEvent({ key: "Escape" });
			const handled = handleKeybinding(event, { onAbort, isWorking: false });

			expect(handled).toBe(false);
			expect(event.preventDefault).not.toHaveBeenCalled();
			expect(onAbort).not.toHaveBeenCalled();
		});

		it("calls onOpenSettings and prevents default on Cmd+,", () => {
			const onOpenSettings = vi.fn();
			const event = createMockEvent({ key: ",", metaKey: true });
			const handled = handleKeybinding(event, { onOpenSettings });

			expect(handled).toBe(true);
			expect(event.preventDefault).toHaveBeenCalledTimes(1);
			expect(onOpenSettings).toHaveBeenCalledTimes(1);
		});

		it("calls onExportMarkdown and prevents default on Cmd+Shift+E", () => {
			const onExportMarkdown = vi.fn();
			const event = createMockEvent({ key: "e", metaKey: true, shiftKey: true });
			const handled = handleKeybinding(event, { onExportMarkdown });

			expect(handled).toBe(true);
			expect(event.preventDefault).toHaveBeenCalledTimes(1);
			expect(onExportMarkdown).toHaveBeenCalledTimes(1);
		});

		it("does nothing when handler is missing", () => {
			const event = createMockEvent({ key: "n", metaKey: true });
			const handled = handleKeybinding(event, {});

			expect(handled).toBe(false);
			expect(event.preventDefault).not.toHaveBeenCalled();
		});
	});
});
