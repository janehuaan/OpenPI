/**
 * Electron main process.
 *
 * Window lifecycle, window-state persistence, and handler registration. Anything
 * that is not an Electron concern lives in the daemon.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, globalShortcut, ipcMain, nativeTheme, screen, session, shell } from "electron";
import { disconnect } from "./daemon.ts";
import { registerHandlers } from "./handlers.ts";
import { cleanupGlobalShortcuts, setupGlobalShortcuts, toggleHudWindow } from "./hud.ts";
import { captureScreenNative } from "./system-ops.ts";
import { destroySystemTray, setupSystemTray } from "./tray.ts";

// Prevent fatal unhandled EPIPE crashes if terminal or parent process closes stdio pipes
process.stdout?.on?.("error", (err: any) => {
	if (err?.code === "EPIPE") return;
});
process.stderr?.on?.("error", (err: any) => {
	if (err?.code === "EPIPE") return;
});

process.on("uncaughtException", (error: any) => {
	if (error?.code === "EPIPE" || (typeof error?.message === "string" && error.message.includes("EPIPE"))) {
		return;
	}
	try {
		console.error("[main] uncaughtException:", error);
	} catch {}
});

function safeWriteStderr(message: string): void {
	try {
		if (process.stderr && !process.stderr.destroyed && process.stderr.writable) {
			process.stderr.write(message, () => {});
		}
	} catch {
		// Suppress EPIPE or stream closed error
	}
}

const here = dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged && process.env.OPENPI_DESKTOP_PROD !== "1";
const DEV_URL = "http://127.0.0.1:5179";

let mainWindow: BrowserWindow | undefined;

interface WindowState {
	width: number;
	height: number;
	x?: number;
	y?: number;
}

const DEFAULT_STATE: WindowState = { width: 1400, height: 900 };
const MIN_WIDTH = 900;
const MIN_HEIGHT = 600;

const backgroundColor = () => (nativeTheme.shouldUseDarkColors ? "#0b0d11" : "#eceff4");

function statePath(): string {
	const dir = join(app.getPath("userData"), "window-state");
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	return join(dir, "state.json");
}

function loadState(): WindowState | undefined {
	try {
		const file = statePath();
		if (!existsSync(file)) return undefined;
		const parsed = JSON.parse(readFileSync(file, "utf8")) as WindowState;
		if (typeof parsed.width !== "number" || typeof parsed.height !== "number") return undefined;
		if (parsed.width < MIN_WIDTH || parsed.height < MIN_HEIGHT) return undefined;
		return parsed;
	} catch {
		return undefined;
	}
}

function saveState(window: BrowserWindow): void {
	try {
		const bounds = window.getBounds();
		writeFileSync(statePath(), JSON.stringify(bounds), "utf8");
	} catch {
		// Losing window position is not worth surfacing.
	}
}

/**
 * Clamp saved bounds into a display that currently exists.
 *
 * A window restored onto a disconnected monitor is invisible with no way to get
 * it back, so the saved position is always re-checked against live displays.
 */
function fitToDisplay(state: WindowState): Required<WindowState> {
	const hasPosition = typeof state.x === "number" && typeof state.y === "number";
	const display = hasPosition
		? screen.getDisplayMatching({ x: state.x!, y: state.y!, width: state.width, height: state.height })
		: screen.getPrimaryDisplay();
	const area = display.workArea;
	const width = Math.min(Math.max(state.width, MIN_WIDTH), area.width);
	const height = Math.min(Math.max(state.height, MIN_HEIGHT), area.height);
	const wantedX = hasPosition ? state.x! : area.x + Math.round((area.width - width) / 2);
	const wantedY = hasPosition ? state.y! : area.y + Math.round((area.height - height) / 2);
	return {
		width,
		height,
		x: Math.min(Math.max(wantedX, area.x), area.x + area.width - width),
		y: Math.min(Math.max(wantedY, area.y), area.y + area.height - height),
	};
}

function resolveIcon(): string | undefined {
	const candidates = [
		join(here, "../build/icon.icns"),
		join(here, "../build/icon.png"),
		join(process.resourcesPath ?? "", "icon.icns"),
	];
	return candidates.find((candidate) => candidate && existsSync(candidate));
}

function createWindow(): void {
	const icon = resolveIcon();
	const window = new BrowserWindow({
		...fitToDisplay(loadState() ?? DEFAULT_STATE),
		minWidth: MIN_WIDTH,
		minHeight: MIN_HEIGHT,
		title: "OpenPI",
		backgroundColor: backgroundColor(),
		...(icon ? { icon } : {}),
		webPreferences: {
			preload: join(here, "preload.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
	});
	mainWindow = window;

	const persist = () => saveState(window);
	window.on("resize", persist);
	window.on("move", persist);
	window.on("close", persist);
	window.on("closed", () => {
		mainWindow = undefined;
	});

	// External links open in the browser, never as a new Electron window.
	window.webContents.setWindowOpenHandler(({ url }) => {
		if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
		return { action: "deny" };
	});

	// Surface renderer failures in the terminal. A blank window with a silent main
	// process is otherwise indistinguishable from a load that simply never
	// happened - which is exactly how a bad asset path presents.
	window.webContents.on("did-fail-load", (_event, code, description, url) => {
		safeWriteStderr(`[renderer] load failed ${code} ${description} ${url}\n`);
		if (isDev && url.startsWith("http://")) {
			setTimeout(() => {
				if (!window.isDestroyed()) {
					void window.loadURL(DEV_URL);
				}
			}, 800);
		}
	});
	window.webContents.on("console-message", (_event, level, message, line, source) => {
		if (level >= 2) safeWriteStderr(`[renderer] ${message} (${source}:${line})\n`);
	});
	window.webContents.on("render-process-gone", (_event, details) => {
		safeWriteStderr(`[renderer] gone: ${details.reason}\n`);
	});

	if (isDev) {
		void window.loadURL(DEV_URL);
		window.webContents.openDevTools({ mode: "detach" });
	} else {
		const index = join(here, "../dist/index.html");
		if (!existsSync(index)) {
			safeWriteStderr(`[main] missing ${index} - run \`npm run build:web\`\n`);
		}
		void window.loadFile(index);
	}
}

app.whenReady().then(() => {
	// Automatically approve safe permissions (clipboard, notifications, fullscreen) and block others silently without popups
	session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
		const allowedPermissions = new Set([
			"clipboard-read",
			"clipboard-sanitized-write",
			"notifications",
			"fullscreen",
		]);
		callback(allowedPermissions.has(permission));
	});

	session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
		const allowedPermissions = new Set([
			"clipboard-read",
			"clipboard-sanitized-write",
			"notifications",
			"fullscreen",
		]);
		return allowedPermissions.has(permission);
	});

	registerHandlers(ipcMain, () => mainWindow);
	nativeTheme.on("updated", () => mainWindow?.setBackgroundColor(backgroundColor()));
	createWindow();

	setupGlobalShortcuts(() => mainWindow);
	try {
		globalShortcut.register("Option+Shift+S", async () => {
			const res = await captureScreenNative({ target: "interactive" }).catch(() => ({
				path: "",
				dataUrl: undefined,
				cancelled: true,
			}));
			if (!res.cancelled && res.dataUrl) {
				focusMainWindow();
				mainWindow?.webContents.send("openpi:composer-prefill", {
					text: "请帮我深度分析这张截图中的内容，并给出具体的解答或排障修复方案：",
					images: [res.dataUrl],
				});
			}
		});
	} catch {}
	setupSystemTray({
		onToggleHud: () => toggleHudWindow(() => mainWindow),
		onOpenMain: () => focusMainWindow(),
		onNewConversation: () => {
			focusMainWindow();
			mainWindow?.webContents.send("openpi:new-conversation");
		},
		onPrefillComposer: (draft) => {
			focusMainWindow();
			mainWindow?.webContents.send("openpi:composer-prefill", draft);
		},
		onOpenGit: () => {
			focusMainWindow();
			mainWindow?.webContents.send("openpi:navigate", "git");
		},
		onOpenMemory: () => {
			focusMainWindow();
			mainWindow?.webContents.send("openpi:navigate", "memory");
		},
		onOpenTasks: () => {
			focusMainWindow();
			mainWindow?.webContents.send("openpi:navigate", "tasks");
		},
		onOpenSettings: () => {
			focusMainWindow();
			mainWindow?.webContents.send("openpi:navigate", "capabilities");
		},
		onQuit: () => app.quit(),
	});

	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});

app.on("will-quit", () => {
	cleanupGlobalShortcuts();
	destroySystemTray();
});

app.on("window-all-closed", () => {
	// The daemon stays running on purpose: closing the window must not end an
	// in-flight agent turn, and reopening reattaches to the same sessions.
	disconnect();
	if (process.platform !== "darwin") app.quit();
});

export function focusMainWindow(): void {
	if (mainWindow && !mainWindow.isDestroyed()) {
		if (mainWindow.isMinimized()) mainWindow.restore();
		mainWindow.show();
		mainWindow.focus();
	}
}

export function getMainWindow(): BrowserWindow | undefined {
	return mainWindow;
}

