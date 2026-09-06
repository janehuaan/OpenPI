/**
 * Raycast/Spotlight-style floating HUD (Quick Command Palette) window manager.
 *
 * Provides:
 * - Frameless translucent floating HUD window
 * - Global shortcut registration (`Option+Space` / `CommandOrControl+Shift+Space`)
 * - Centered screen placement with auto-hide on blur option
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, globalShortcut, screen } from "electron";

const here = dirname(fileURLToPath(import.meta.url));
const isDev = typeof app?.isPackaged === "boolean" ? !app.isPackaged && process.env.OPENPI_DESKTOP_PROD !== "1" : process.env.NODE_ENV !== "production";
const DEV_URL = "http://127.0.0.1:5179#hud";

let hudWindow: BrowserWindow | undefined;

export function getHudWindow(): BrowserWindow | undefined {
	return hudWindow;
}

export function createHudWindow(getMainWindow?: () => BrowserWindow | undefined): BrowserWindow {
	if (hudWindow && !hudWindow.isDestroyed()) {
		return hudWindow;
	}

	const primaryDisplay = screen?.getPrimaryDisplay
		? screen.getPrimaryDisplay()
		: { workArea: { width: 1400, height: 900, x: 0, y: 0 } };
	const { width: screenWidth, height: screenHeight } = primaryDisplay.workArea;

	const HUD_WIDTH = 680;
	const HUD_HEIGHT = 440;
	const x = Math.round((screenWidth - HUD_WIDTH) / 2);
	// Place higher up like Spotlight/Raycast
	const y = Math.round(screenHeight * 0.2);

	const win = new BrowserWindow({
		width: HUD_WIDTH,
		height: HUD_HEIGHT,
		x,
		y,
		frame: false,
		transparent: true,
		alwaysOnTop: true,
		skipTaskbar: true,
		hasShadow: true,
		resizable: false,
		show: false,
		vibrancy: "under-window",
		visualEffectState: "active",
		webPreferences: {
			preload: join(here, "preload.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
	});

	hudWindow = win;

	win.on("blur", () => {
		// Auto-hide on blur if not dev mode
		if (!isDev) {
			win.hide();
		}
	});

	win.on("closed", () => {
		hudWindow = undefined;
	});

	if (isDev) {
		void win.loadURL(DEV_URL);
	} else {
		const index = join(here, "../dist/index.html");
		void win.loadFile(index, { hash: "hud" });
	}

	return win;
}

export function toggleHudWindow(getMainWindow?: () => BrowserWindow | undefined): boolean {
	if (!hudWindow || hudWindow.isDestroyed()) {
		createHudWindow(getMainWindow);
	}

	if (!hudWindow) return false;

	if (hudWindow.isVisible() && hudWindow.isFocused()) {
		hudWindow.hide();
		return false;
	}

	// Reposition on current active display
	try {
		const cursorPoint = screen.getCursorScreenPoint();
		const activeDisplay = screen.getDisplayNearestPoint(cursorPoint);
		const { x: areaX, y: areaY, width: areaWidth, height: areaHeight } = activeDisplay.workArea;

		const bounds = hudWindow.getBounds();
		const newX = areaX + Math.round((areaWidth - bounds.width) / 2);
		const newY = areaY + Math.round(areaHeight * 0.2);
		hudWindow.setPosition(newX, newY, false);
	} catch {}

	hudWindow.show();
	hudWindow.focus();
	return true;
}

export function setupGlobalShortcuts(getMainWindow?: () => BrowserWindow | undefined): void {
	// Register Option+Space for instant HUD toggle
	try {
		const registeredOpt = globalShortcut.register("Option+Space", () => {
			toggleHudWindow(getMainWindow);
		});
		if (!registeredOpt) {
			// Fallback shortcut if Option+Space is already claimed by another system app
			globalShortcut.register("CommandOrControl+Shift+Space", () => {
				toggleHudWindow(getMainWindow);
			});
		}
	} catch {
		try {
			globalShortcut.register("CommandOrControl+Shift+Space", () => {
				toggleHudWindow(getMainWindow);
			});
		} catch {}
	}
}

export function cleanupGlobalShortcuts(): void {
	try {
		globalShortcut.unregisterAll();
	} catch {}
}
