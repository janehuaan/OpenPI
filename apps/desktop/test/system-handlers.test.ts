import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => {
	let clipboardStore = "hello clipboard";
	return {
		app: {
			isPackaged: false,
			getPath: vi.fn().mockReturnValue("/tmp"),
		},
		Notification: vi.fn(),
		BrowserWindow: vi.fn(),
		ipcMain: {
			handle: vi.fn(),
		},
		dialog: {
			showOpenDialog: vi.fn(),
			showSaveDialog: vi.fn(),
		},
		shell: {
			openExternal: vi.fn(),
		},
		clipboard: {
			readText: vi.fn(() => clipboardStore),
			writeText: vi.fn((text: string) => {
				clipboardStore = text;
			}),
			readImage: vi.fn().mockReturnValue({ isEmpty: () => true }),
		},
		screen: {
			getPrimaryDisplay: vi.fn().mockReturnValue({
				workArea: { x: 0, y: 0, width: 1920, height: 1080 },
			}),
			getCursorScreenPoint: vi.fn().mockReturnValue({ x: 0, y: 0 }),
			getDisplayNearestPoint: vi.fn().mockReturnValue({
				workArea: { x: 0, y: 0, width: 1920, height: 1080 },
			}),
		},
		globalShortcut: {
			register: vi.fn().mockReturnValue(true),
			unregisterAll: vi.fn(),
		},
	};
});

import {
	getSystemTelemetry,
	listListeningPorts,
	readSystemClipboard,
	writeSystemClipboard,
} from "../electron/system-ops.ts";

describe("System Operations (system-ops)", () => {
	it("fetches system telemetry data", async () => {
		const telemetry = await getSystemTelemetry();
		expect(telemetry).toBeDefined();
		expect(telemetry.cpu.cores).toBeGreaterThan(0);
		expect(telemetry.memory.totalGb).toBeGreaterThan(0);
		expect(telemetry.memory.usedGb).toBeGreaterThanOrEqual(0);
		expect(telemetry.memory.usagePercent).toBeGreaterThanOrEqual(0);
	});

	it("manages system clipboard read and write", () => {
		writeSystemClipboard("OpenPI System Agent Test");
		const res = readSystemClipboard();
		expect(res.text).toBe("OpenPI System Agent Test");
		expect(res.hasImage).toBe(false);
	});

	it("lists listening ports without crashing", async () => {
		const ports = await listListeningPorts();
		expect(Array.isArray(ports)).toBe(true);
	});
});
