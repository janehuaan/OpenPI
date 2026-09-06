import { useEffect, useRef } from "react";

export type KeybindingAction =
	| "new_conversation"
	| "toggle_sidebar"
	| "abort"
	| "open_settings"
	| "export_markdown"
	| "toggle_git";

export interface KeybindingHandlers {
	onNewConversation?: () => void;
	onToggleSidebar?: () => void;
	onAbort?: () => void;
	onOpenSettings?: () => void;
	onExportMarkdown?: () => void;
	onToggleGit?: () => void;
	isWorking?: boolean;
}

export interface KeyMatchOptions {
	isWorking?: boolean;
}

export function matchKeybinding(
	event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">,
	options?: KeyMatchOptions,
): KeybindingAction | null {
	const isModifier = event.metaKey || event.ctrlKey;
	const key = event.key.toLowerCase();

	if (isModifier && !event.altKey) {
		// Cmd/Ctrl + Shift + E
		if (event.shiftKey && key === "e") {
			return "export_markdown";
		}

		// Cmd/Ctrl + Shift + G
		if (event.shiftKey && key === "g") {
			return "toggle_git";
		}

		// Non-shift combinations
		if (!event.shiftKey) {
			if (key === "n") {
				return "new_conversation";
			}
			if (key === "b") {
				return "toggle_sidebar";
			}
			if (key === ",") {
				return "open_settings";
			}
			if (key === ".") {
				return options?.isWorking ? "abort" : null;
			}
		}
	}

	// Escape: only when isWorking is true
	if (event.key === "Escape" && options?.isWorking) {
		return "abort";
	}

	return null;
}

export function handleKeybinding(
	event: KeyboardEvent,
	handlers: KeybindingHandlers,
): boolean {
	const action = matchKeybinding(event, { isWorking: handlers.isWorking });
	if (!action) return false;

	switch (action) {
		case "new_conversation":
			if (handlers.onNewConversation) {
				event.preventDefault();
				handlers.onNewConversation();
				return true;
			}
			break;
		case "toggle_sidebar":
			if (handlers.onToggleSidebar) {
				event.preventDefault();
				handlers.onToggleSidebar();
				return true;
			}
			break;
		case "abort":
			if (handlers.onAbort) {
				// Safety check: If Escape was pressed, do not abort if an interactive overlay (modal, popover, menu, file-picker) is active
				if (event.key === "Escape") {
					if (event.defaultPrevented) return false;
					if (typeof document !== "undefined") {
						const hasOverlay = document.querySelector(
							"[data-radix-popper-content-wrapper], .dialog-overlay, [role='dialog'], [role='menu'], .reference-slash-menu, .reference-file-picker, .model-popover",
						);
						if (hasOverlay) return false;
					}
				}
				event.preventDefault();
				handlers.onAbort();
				return true;
			}
			break;
		case "open_settings":
			if (handlers.onOpenSettings) {
				event.preventDefault();
				handlers.onOpenSettings();
				return true;
			}
			break;
		case "export_markdown":
			if (handlers.onExportMarkdown) {
				event.preventDefault();
				handlers.onExportMarkdown();
				return true;
			}
			break;
		case "toggle_git":
			if (handlers.onToggleGit) {
				event.preventDefault();
				handlers.onToggleGit();
				return true;
			}
			break;
	}

	return false;
}

export function useGlobalKeybindings(handlers: KeybindingHandlers): void {
	const handlersRef = useRef(handlers);
	handlersRef.current = handlers;

	useEffect(() => {
		const listener = (event: KeyboardEvent) => {
			handleKeybinding(event, handlersRef.current);
		};

		window.addEventListener("keydown", listener);
		return () => {
			window.removeEventListener("keydown", listener);
		};
	}, []);
}
