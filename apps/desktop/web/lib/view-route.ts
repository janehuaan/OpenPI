import type { View } from "./app-types.ts";

const VIEW_VALUES = new Set<string>(["chat", "tasks", "capabilities", "settings", "memory", "intelligence", "daemon", "git"]);

export const VIEW_STORAGE_KEY = "openpi-active-view";

export function isView(value: string | null | undefined): value is View {
	return typeof value === "string" && VIEW_VALUES.has(value);
}

export function normalizeView(view: string | null | undefined): View {
	if (view === "settings") return "capabilities";
	if (isView(view)) return view as View;
	return "chat";
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
