import type { View } from "./app-types.ts";

const VIEW_VALUES = new Set<string>(["chat", "tasks", "capabilities", "memory", "security", "intelligence", "daemon"]);

export const VIEW_STORAGE_KEY = "openpi-active-view";

export function isView(value: string | null | undefined): value is View {
	return typeof value === "string" && VIEW_VALUES.has(value);
}

export function viewFromHash(hash: string): View | undefined {
	const match = /^#\/([^/?#]+)\/?$/.exec(hash);
	const view = match?.[1];
	return isView(view) ? view : undefined;
}

export function initialView(hash: string, persistedView: string | null): View {
	if (hash) return viewFromHash(hash) ?? "chat";
	return isView(persistedView) ? persistedView : "chat";
}

export function hashForView(view: View): string {
	return `#/${view}`;
}
