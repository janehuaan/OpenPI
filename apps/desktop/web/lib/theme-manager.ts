/**
 * OpenPI Desktop Theme Manager
 * Supports System / Dark / Light modes and 8 curated high-craft theme flavors.
 */

import { useEffect, useState } from "react";
import { desktopApi } from "../api";

export type ThemeMode = "system" | "dark" | "light";

export type ThemeFlavor =
	| "dark-warm"
	| "dark-default"
	| "dark-oled"
	| "dark-tokyo"
	| "dark-cyberpunk"
	| "light-warm"
	| "light-default"
	| "light-nord";

export interface ThemePreset {
	id: ThemeFlavor;
	name: string;
	desc: string;
	tag: string;
	mode: "dark" | "light";
	swatches: {
		bg: string;
		elevated: string;
		accent: string;
		text: string;
	};
}

export const THEME_PRESETS: ThemePreset[] = [
	// ── Dark Themes ──
	{
		id: "dark-warm",
		name: "暖墨暗夜 (Claude Espresso)",
		desc: "温润深烘暖墨底色，陶土暖橘点缀，夜间极度护眼",
		tag: "Claude 同款 · 纸本暗调",
		mode: "dark",
		swatches: {
			bg: "#181715",
			elevated: "#24221f",
			accent: "#cc785c",
			text: "#ebe6dc",
		},
	},
	{
		id: "dark-default",
		name: "微光钛灰 (Linear Titanium)",
		desc: "深邃微冷石墨底色，发丝内光与克制靛紫，工业级精工美学",
		tag: "微光精工 · Linear",
		mode: "dark",
		swatches: {
			bg: "#0d0e12",
			elevated: "#161820",
			accent: "#5e6ad2",
			text: "#f0f2f7",
		},
	},
	{
		id: "dark-oled",
		name: "黑曜极简 (Geist Obsidian)",
		desc: "Vercel 级纯黑灰阶分层，无彩色干扰，极致克制",
		tag: "0 GPU · 极客无界",
		mode: "dark",
		swatches: {
			bg: "#000000",
			elevated: "#121214",
			accent: "#f4f4f5",
			text: "#f4f4f5",
		},
	},
	{
		id: "dark-tokyo",
		name: "沉静蓝紫 (Tokyo Night)",
		desc: "沉静蓝紫与深海夜色，低饱和夜间漫游",
		tag: "0 GPU · 蓝紫夜色",
		mode: "dark",
		swatches: {
			bg: "#16161e",
			elevated: "#1f2335",
			accent: "#7aa2f7",
			text: "#c0caf5",
		},
	},
	{
		id: "dark-cyberpunk",
		name: "机能未来 (Cyberpunk)",
		desc: "暗夜高能霓虹对撞，硬核科幻机能美学",
		tag: "0 GPU · 赛博机能",
		mode: "dark",
		swatches: {
			bg: "#08090f",
			elevated: "#131622",
			accent: "#00f0ff",
			text: "#eaedf6",
		},
	},

	// ── Light Themes ──
	{
		id: "light-warm",
		name: "暖沙纸本 (Claude Warm)",
		desc: "温润护眼米白纸本，无眩光如纸墨相依",
		tag: "Claude 同款 · 护眼纸本",
		mode: "light",
		swatches: {
			bg: "#f5ede0",
			elevated: "#f4ecdf",
			accent: "#c2652b",
			text: "#2c2523",
		},
	},
	{
		id: "light-default",
		name: "工作室极简 (Studio Minimal)",
		desc: "北欧冷白画廊质感，纯净高透，纯粹无杂色",
		tag: "纯净工坊 · Minimal",
		mode: "light",
		swatches: {
			bg: "#f8fafc",
			elevated: "#ffffff",
			accent: "#0f172a",
			text: "#0f172a",
		},
	},
	{
		id: "light-nord",
		name: "极光冰蓝 (Nord Frost)",
		desc: "极地冰蓝清透纯色，清爽通透流畅办公",
		tag: "0 GPU · 极光冷白",
		mode: "light",
		swatches: {
			bg: "#eaf1f8",
			elevated: "#e2ebf4",
			accent: "#0284c7",
			text: "#1e293b",
		},
	},
];

export const THEME_MODE_STORAGE_KEY = "openpi-theme";
export const THEME_FLAVOR_STORAGE_KEY = "openpi-theme-flavor";
export const THEME_CHANGED_EVENT = "openpi:theme-changed";

export interface ThemeConfig {
	mode: ThemeMode;
	flavor: ThemeFlavor;
}

/**
 * Resolves the effective mode ('dark' or 'light') based on the current mode and OS preference.
 */
export function resolveEffectiveMode(mode: ThemeMode): "dark" | "light" {
	if (mode === "dark") return "dark";
	if (mode === "light") return "light";
	if (typeof window !== "undefined" && window.matchMedia) {
		return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
	}
	return "dark";
}

/**
 * Gets default flavor for a given mode.
 */
export function defaultFlavorForMode(mode: "dark" | "light"): ThemeFlavor {
	return mode === "dark" ? "dark-default" : "light-default";
}

/**
 * Reads current theme configuration from storage or defaults.
 */
export function getStoredThemeConfig(): ThemeConfig {
	if (typeof window === "undefined") {
		return { mode: "dark", flavor: "dark-default" };
	}

	let mode: ThemeMode = "dark";
	const rawMode = window.localStorage.getItem(THEME_MODE_STORAGE_KEY);
	if (rawMode === "system" || rawMode === "dark" || rawMode === "light") {
		mode = rawMode;
	}

	const effectiveMode = resolveEffectiveMode(mode);
	let flavor: ThemeFlavor = defaultFlavorForMode(effectiveMode);
	const rawFlavor = window.localStorage.getItem(THEME_FLAVOR_STORAGE_KEY) as ThemeFlavor | null;

	if (rawFlavor && THEME_PRESETS.some((p) => p.id === rawFlavor)) {
		const preset = THEME_PRESETS.find((p) => p.id === rawFlavor);
		// If the stored flavor matches the effective mode (or user explicitly picked it), use it
		if (preset && (mode === "system" ? preset.mode === effectiveMode : true)) {
			flavor = rawFlavor;
		}
	}

	return { mode, flavor };
}

/**
 * Applies the theme attributes to the HTML document element and syncs with Electron.
 */
export function applyTheme(config: ThemeConfig): void {
	if (typeof document === "undefined") return;

	const effectiveMode = resolveEffectiveMode(config.mode);
	const html = document.documentElement;

	// Validate flavor matches effective mode
	let flavor = config.flavor;
	const preset = THEME_PRESETS.find((p) => p.id === flavor);
	if (!preset || preset.mode !== effectiveMode) {
		flavor = defaultFlavorForMode(effectiveMode);
	}

	// 1. Set DOM attributes
	html.setAttribute("data-theme", effectiveMode);
	html.setAttribute("data-theme-flavor", flavor);
	if (effectiveMode === "dark") {
		html.classList.add("dark");
		html.classList.remove("light");
	} else {
		html.classList.add("light");
		html.classList.remove("dark");
	}

	// 2. Persist to localStorage
	try {
		window.localStorage.setItem(THEME_MODE_STORAGE_KEY, config.mode);
		window.localStorage.setItem(THEME_FLAVOR_STORAGE_KEY, flavor);
	} catch {}

	// 3. Inform Electron native theme if available
	try {
		if (desktopApi?.setNativeTheme) {
			desktopApi.setNativeTheme(config.mode).catch(() => {});
		}
	} catch {}

	// 4. Dispatch DOM event
	try {
		window.dispatchEvent(
			new CustomEvent(THEME_CHANGED_EVENT, {
				detail: { mode: config.mode, effectiveMode, flavor },
			}),
		);
	} catch {}
}

/**
 * Sets new theme configuration, applies it, and persists it to backend settings.
 */
export function setThemeConfig(patch: Partial<ThemeConfig>): ThemeConfig {
	const current = getStoredThemeConfig();

	let nextMode = patch.mode ?? current.mode;

	// If flavor is provided without mode, align mode with the flavor's preset
	if (patch.flavor && !patch.mode) {
		const targetPreset = THEME_PRESETS.find((p) => p.id === patch.flavor);
		if (targetPreset) {
			nextMode = targetPreset.mode;
		}
	}

	const effectiveMode = resolveEffectiveMode(nextMode);

	let nextFlavor = patch.flavor ?? current.flavor;
	const preset = THEME_PRESETS.find((p) => p.id === nextFlavor);
	if (!preset || preset.mode !== effectiveMode) {
		if (current.flavor === "light-warm" && effectiveMode === "dark") {
			nextFlavor = "dark-warm";
		} else if (current.flavor === "dark-warm" && effectiveMode === "light") {
			nextFlavor = "light-warm";
		} else {
			nextFlavor = defaultFlavorForMode(effectiveMode);
		}
	}

	const nextConfig: ThemeConfig = { mode: nextMode, flavor: nextFlavor };
	applyTheme(nextConfig);

	// Persist to backend settings
	try {
		if (desktopApi?.updateAppSettings) {
			desktopApi
				.updateAppSettings({
					theme: nextConfig.mode,
					themeFlavor: nextConfig.flavor,
				})
				.catch(() => {});
		}
	} catch {}

	return nextConfig;
}

/**
 * Toggles between Dark and Light mode.
 */
export function toggleThemeMode(): ThemeConfig {
	const current = getStoredThemeConfig();
	const effective = resolveEffectiveMode(current.mode);
	const nextMode: ThemeMode = effective === "dark" ? "light" : "dark";
	return setThemeConfig({ mode: nextMode });
}

let initialized = false;

if (typeof window !== "undefined") {
	(window as unknown as { __openpiTheme?: unknown }).__openpiTheme = {
		setThemeConfig,
		getStoredThemeConfig,
		toggleThemeMode,
		THEME_PRESETS,
	};
}

/**
 * Initializes the theme system: applies current theme and listens to OS appearance changes.
 */
export function initTheme(): void {
	if (initialized || typeof window === "undefined") return;
	initialized = true;

	const config = getStoredThemeConfig();
	applyTheme(config);

	// Listen to OS appearance changes if in system mode
	if (typeof window !== "undefined" && window.matchMedia) {
		const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
		const handler = () => {
			const current = getStoredThemeConfig();
			if (current.mode === "system") {
				applyTheme(current);
			}
		};

		if (mediaQuery.addEventListener) {
			mediaQuery.addEventListener("change", handler);
		} else {
			mediaQuery.addListener?.(handler);
		}
	}
}

/**
 * React hook for consuming and updating the theme.
 */
export function useTheme() {
	const [theme, setTheme] = useState<ThemeConfig>(getStoredThemeConfig);
	const [effectiveMode, setEffectiveMode] = useState<"dark" | "light">(() =>
		resolveEffectiveMode(getStoredThemeConfig().mode),
	);

	useEffect(() => {
		const handleThemeChanged = (event: Event) => {
			const custom = event as CustomEvent<{
				mode: ThemeMode;
				effectiveMode: "dark" | "light";
				flavor: ThemeFlavor;
			}>;
			if (custom.detail) {
				setTheme({ mode: custom.detail.mode, flavor: custom.detail.flavor });
				setEffectiveMode(custom.detail.effectiveMode);
			} else {
				const current = getStoredThemeConfig();
				setTheme(current);
				setEffectiveMode(resolveEffectiveMode(current.mode));
			}
		};

		window.addEventListener(THEME_CHANGED_EVENT, handleThemeChanged);
		return () => {
			window.removeEventListener(THEME_CHANGED_EVENT, handleThemeChanged);
		};
	}, []);

	const setMode = (mode: ThemeMode) => setThemeConfig({ mode });
	const setFlavor = (flavor: ThemeFlavor) => setThemeConfig({ flavor });
	const toggle = () => toggleThemeMode();

	return {
		mode: theme.mode,
		flavor: theme.flavor,
		effectiveMode,
		presets: THEME_PRESETS,
		setMode,
		setFlavor,
		setTheme: setThemeConfig,
		toggle,
	};
}
