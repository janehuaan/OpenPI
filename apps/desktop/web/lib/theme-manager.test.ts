import { describe, expect, it, beforeEach, vi } from "vitest";
import {
	getStoredThemeConfig,
	setThemeConfig,
	toggleThemeMode,
	resolveEffectiveMode,
	defaultFlavorForMode,
	THEME_MODE_STORAGE_KEY,
	THEME_FLAVOR_STORAGE_KEY,
	THEME_PRESETS,
} from "./theme-manager";

describe("ThemeManager", () => {
	let store: Record<string, string> = {};
	let domAttrs: Record<string, string> = {};
	let classList = new Set<string>();

	beforeEach(() => {
		store = {};
		domAttrs = {};
		classList = new Set<string>();

		const mockLocalStorage = {
			getItem: vi.fn((key: string) => store[key] ?? null),
			setItem: vi.fn((key: string, val: string) => {
				store[key] = val;
			}),
			removeItem: vi.fn((key: string) => {
				delete store[key];
			}),
			clear: vi.fn(() => {
				store = {};
			}),
		};

		const mockElement = {
			setAttribute: vi.fn((name: string, value: string) => {
				domAttrs[name] = value;
			}),
			getAttribute: vi.fn((name: string) => domAttrs[name] ?? null),
			removeAttribute: vi.fn((name: string) => {
				delete domAttrs[name];
			}),
			classList: {
				add: vi.fn((cls: string) => classList.add(cls)),
				remove: vi.fn((cls: string) => classList.delete(cls)),
				contains: vi.fn((cls: string) => classList.has(cls)),
			},
		};

		vi.stubGlobal("localStorage", mockLocalStorage);
		vi.stubGlobal("window", {
			localStorage: mockLocalStorage,
			matchMedia: vi.fn(() => ({ matches: true, addEventListener: vi.fn() })),
			dispatchEvent: vi.fn(),
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		});
		vi.stubGlobal("document", {
			documentElement: mockElement,
		});
	});

	it("resolves dark and light modes directly", () => {
		expect(resolveEffectiveMode("dark")).toBe("dark");
		expect(resolveEffectiveMode("light")).toBe("light");
	});

	it("returns default flavors accurately", () => {
		expect(defaultFlavorForMode("dark")).toBe("dark-default");
		expect(defaultFlavorForMode("light")).toBe("light-default");
	});

	it("initializes with dark theme by default when storage is empty", () => {
		const config = getStoredThemeConfig();
		expect(config.mode).toBe("dark");
		expect(config.flavor).toBe("dark-default");
	});

	it("applies theme to DOM root and updates localStorage", () => {
		setThemeConfig({ mode: "dark", flavor: "dark-oled" });

		expect(domAttrs["data-theme"]).toBe("dark");
		expect(domAttrs["data-theme-flavor"]).toBe("dark-oled");
		expect(classList.has("dark")).toBe(true);
		expect(classList.has("light")).toBe(false);
		expect(store[THEME_MODE_STORAGE_KEY]).toBe("dark");
		expect(store[THEME_FLAVOR_STORAGE_KEY]).toBe("dark-oled");
	});

	it("switches to light mode with a light flavor", () => {
		setThemeConfig({ mode: "light", flavor: "light-warm" });

		expect(domAttrs["data-theme"]).toBe("light");
		expect(domAttrs["data-theme-flavor"]).toBe("light-warm");
		expect(classList.has("light")).toBe(true);
		expect(classList.has("dark")).toBe(false);
	});

	it("auto-corrects mismatched flavor when mode changes", () => {
		setThemeConfig({ mode: "dark", flavor: "dark-tokyo" });
		expect(domAttrs["data-theme-flavor"]).toBe("dark-tokyo");

		// Switch to light mode without specifying flavor -> should fallback to light-default
		setThemeConfig({ mode: "light" });
		expect(domAttrs["data-theme"]).toBe("light");
		expect(domAttrs["data-theme-flavor"]).toBe("light-default");
	});

	it("toggleThemeMode cleanly toggles between dark and light", () => {
		setThemeConfig({ mode: "dark" });
		toggleThemeMode();
		expect(domAttrs["data-theme"]).toBe("light");

		toggleThemeMode();
		expect(domAttrs["data-theme"]).toBe("dark");
	});

	it("defines all 7 presets with required properties", () => {
		expect(THEME_PRESETS.length).toBe(7);
		for (const preset of THEME_PRESETS) {
			expect(preset.id).toBeDefined();
			expect(preset.name).toBeDefined();
			expect(preset.swatches.bg).toMatch(/^#[0-9a-fA-F]{6}$/);
			expect(preset.swatches.accent).toMatch(/^#[0-9a-fA-F]{6}$/);
		}
	});
});
