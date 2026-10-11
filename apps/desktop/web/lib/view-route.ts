import type { View } from "./app-types.ts";

const VIEW_VALUES = new Set<string>([
	"today",
	"chat",
	"tasks",
	"capabilities",
	"settings",
	"memory",
	"intelligence",
	"daemon",
	"git",
	"goals",
	"activity",
	"projects",
]);

export const VIEW_STORAGE_KEY = "openpi-active-view";

export function isView(value: string | null | undefined): value is View {
	return typeof value === "string" && VIEW_VALUES.has(value);
}

export function normalizeView(view: string | null | undefined): View {
	if (view === "settings") return "capabilities";
	if (isView(view)) return view as View;
	return "today";
}

export function viewFromHash(hash: string): View | undefined {
	const match = /^#\/([^/?#]+)\/?$/.exec(hash);
	const view = match?.[1];
	return isView(view) ? view : undefined;
}

export function initialView(hash: string, persistedView: string | null): View {
	// 冷启动第一屏必须是 Agent OS 主屏（today = Now）。
	// 所以 `chat` 既不能从 localStorage 恢复，也不能从 URL hash 恢复 ——
	// 它现在是一个「面板」，不是落地页（对话本身仍是一键可达）。
	if (hash) {
		const routed = viewFromHash(hash);
		if (routed && routed !== "chat") return routed;
		return "today";
	}
	if (persistedView && persistedView !== "chat" && isView(persistedView)) {
		return persistedView;
	}
	return "today";
}

export function hashForView(view: View): string {
	return `#/${view}`;
}
