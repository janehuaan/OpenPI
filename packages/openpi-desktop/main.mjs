import { app, BrowserWindow, ipcMain, shell } from "electron";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { registerBridge } from "./bridge.mjs";
import { ensureDaemon } from "./orch.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged && process.env.OPENPI_DESKTOP_PROD !== "1";

let mainWindow;

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
	const icon = resolveAppIcon();
	mainWindow = new BrowserWindow({
		width: 1400,
		height: 900,
		minWidth: 1100,
		minHeight: 700,
		title: "OpenPI",
		backgroundColor: "#f7f7f5",
		...(icon ? { icon } : {}),
		webPreferences: {
			preload: join(__dirname, "preload.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
	});
	if (process.platform === "darwin" && icon && app.dock) {
		app.dock.setIcon(icon);
	}

	mainWindow.webContents.setWindowOpenHandler(({ url }) => {
		void shell.openExternal(url);
		return { action: "deny" };
	});

	mainWindow.webContents.on("did-fail-load", (_event, code, desc, url) => {
		console.error("did-fail-load", code, desc, url);
	});
	mainWindow.webContents.on("render-process-gone", (_event, details) => {
		console.error("render-process-gone", details);
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
	// Best-effort daemon start (UI still works if it fails; setup screen can fix)
	void ensureDaemon().catch((error) => {
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
