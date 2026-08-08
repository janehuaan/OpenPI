import { app, BrowserWindow, ipcMain, nativeTheme, screen, shell } from "electron";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { registerBridge } from "./bridge.mjs";
import { ensureDaemon } from "./orch.mjs";
import { registerSpeechBridge, stopSpeechRecognitionHelper } from "./speech.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged && process.env.OPENPI_DESKTOP_PROD !== "1";

let mainWindow;
let daemonReady = false;

// ── Window state persistence ──────────────────────────────────────────────

const DEFAULT_OPTS = { width: 1400, height: 900, x: undefined, y: undefined };
const windowBackgroundColor = () => (nativeTheme.shouldUseDarkColors ? "#090b0e" : "#e9edf3");

function windowStatePath() {
	const base = app.getPath("userData");
	const dir = join(base, "window-state");
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	return join(dir, "state.json");
}

function loadWindowState() {
	try {
		const path = windowStatePath();
		if (existsSync(path)) {
			const data = JSON.parse(readFileSync(path, "utf8"));
			if (typeof data.width === "number" && typeof data.height === "number" && data.width >= 900 && data.height >= 600) {
				return { width: data.width, height: data.height, x: data.x ?? undefined, y: data.y ?? undefined };
			}
		}
	} catch { /* ignore */ }
	return null;
}

function fitWindowStateToDisplay(state) {
	const hasPosition = typeof state.x === "number" && typeof state.y === "number";
	const display = hasPosition
		? screen.getDisplayMatching({ x: state.x, y: state.y, width: state.width, height: state.height })
		: screen.getPrimaryDisplay();
	const workArea = display.workArea;
	const width = Math.min(Math.max(state.width, 900), workArea.width);
	const height = Math.min(Math.max(state.height, 600), workArea.height);
	const preferredX = hasPosition ? state.x : workArea.x + Math.round((workArea.width - width) / 2);
	const preferredY = hasPosition ? state.y : workArea.y + Math.round((workArea.height - height) / 2);
	return {
		width,
		height,
		x: Math.min(Math.max(preferredX, workArea.x), workArea.x + workArea.width - width),
		y: Math.min(Math.max(preferredY, workArea.y), workArea.y + workArea.height - height),
	};
}

function saveWindowState(win) {
	try {
		const bounds = win.getBounds();
		const path = windowStatePath();
		writeFileSync(path, JSON.stringify({ width: bounds.width, height: bounds.height, x: bounds.x, y: bounds.y }));
	} catch { /* ignore */ }
}

// ── Icon resolution ───────────────────────────────────────────────────────

function resolveAppIcon() {
	const candidates = [
		join(__dirname, "../build/icon.icns"),
		join(__dirname, "../build/icon.png"),
		join(process.resourcesPath ?? "", "icon.icns"),
		join(process.resourcesPath ?? "", "icon.png"),
	];
	for (const candidate of candidates) {
		if (candidate && existsSync(candidate)) return candidate;
	}
	return undefined;
}

function createWindow() {
	const saved = loadWindowState();
	const icon = resolveAppIcon();
	const opts = {
		...fitWindowStateToDisplay(saved ?? DEFAULT_OPTS),
		minWidth: 900,
		minHeight: 600,
		title: "OpenPI",
		backgroundColor: windowBackgroundColor(),
		...(icon ? { icon } : {}),
		webPreferences: {
			preload: join(__dirname, "preload.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
	};
	mainWindow = new BrowserWindow(opts);

	// Persist window state on resize/move/close
	mainWindow.on("resize", () => saveWindowState(mainWindow));
	mainWindow.on("move", () => saveWindowState(mainWindow));
	mainWindow.on("close", () => saveWindowState(mainWindow));
	mainWindow.on("closed", () => stopSpeechRecognitionHelper());
	// Do not app.dock.setIcon() on packaged macOS — it bypasses the system
	// continuous-corner mask and makes the Dock icon look square. Bundle icon.icns
	// (CFBundleIconFile) is applied correctly by LaunchServices.
	if (process.platform === "darwin" && icon && app.dock && !app.isPackaged) {
		try {
			app.dock.setIcon(icon);
		} catch (error) {
			console.warn("Unable to set development Dock icon:", error instanceof Error ? error.message : error);
		}
	}

	mainWindow.webContents.setWindowOpenHandler(({ url }) => {
		void shell.openExternal(url);
		return { action: "deny" };
	});

	mainWindow.webContents.on("did-fail-load", (_event, code, desc, url) => {
		console.error("did-fail-load", code, desc, url);
	});
	mainWindow.webContents.once("did-finish-load", () => {
		if (daemonReady && !mainWindow.isDestroyed()) mainWindow.webContents.send("openpi:refresh-data");
	});
	mainWindow.webContents.on("render-process-gone", (_event, details) => {
		console.error("render-process-gone", details);
	});
	mainWindow.webContents.on("before-input-event", (event, input) => {
		if (
			input.type === "keyDown" &&
			input.code === "KeyR" &&
			(input.meta || input.control) &&
			!input.alt &&
			!input.isAutoRepeat
		) {
			event.preventDefault();
			mainWindow.webContents.send("openpi:refresh-data");
		}
	});

	if (isDev) {
		void mainWindow.loadURL("http://127.0.0.1:5179").catch((error) => {
			console.error("loadURL failed", error);
		});
		mainWindow.webContents.openDevTools({ mode: "detach" });
	} else {
		const index = join(__dirname, "../dist/index.html");
		if (!existsSync(index)) {
			console.error("Missing dist/index.html — run: npm run build --workspace @earendil-works/openpi-desktop");
		}
		void mainWindow.loadFile(index).catch((error) => {
			console.error("loadFile failed", error);
		});
	}
}

app.whenReady().then(() => {
	registerBridge(ipcMain, () => mainWindow);
	registerSpeechBridge(ipcMain, () => mainWindow);
	nativeTheme.on("updated", () => {
		if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setBackgroundColor(windowBackgroundColor());
	});
	// Best-effort daemon start (UI still works if it fails; setup screen can fix)
	void ensureDaemon()
		.then(() => {
			daemonReady = true;
			if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("openpi:refresh-data");
		})
		.catch((error) => {
			console.warn("Daemon auto-start:", error instanceof Error ? error.message : error);
		});
	createWindow();
	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});
