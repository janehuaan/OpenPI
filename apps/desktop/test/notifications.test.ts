import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => {
	const mockNotificationInstance = {
		show: vi.fn(),
		on: vi.fn(),
	};
	const MockNotification = vi.fn().mockImplementation((options) => {
		return Object.assign(mockNotificationInstance, options);
	});
	(MockNotification as any).isSupported = vi.fn().mockReturnValue(true);
	return { MockNotification, mockNotificationInstance };
});
const { MockNotification, mockNotificationInstance } = mocks;

vi.mock("electron", () => {
	return {
		app: {
			isPackaged: false,
			getPath: vi.fn().mockReturnValue("/tmp"),
		},
		Notification: mocks.MockNotification,
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
			readText: vi.fn().mockReturnValue(""),
			writeText: vi.fn(),
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

import { showTaskCompletedNotification } from "../electron/handlers.ts";

describe("Native Desktop Notifications", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("creates and displays an Electron Notification with title and body", () => {
		const mockWin = {
			isDestroyed: vi.fn().mockReturnValue(false),
			isMinimized: vi.fn().mockReturnValue(false),
			isFocused: vi.fn().mockReturnValue(false),
			show: vi.fn(),
			focus: vi.fn(),
			restore: vi.fn(),
		} as any;

		showTaskCompletedNotification("Task 1 completed", () => mockWin, "OpenPI");

		expect(MockNotification).toHaveBeenCalledWith({
			title: "OpenPI",
			body: "Task 1 completed",
		});
		expect(mockNotificationInstance.show).toHaveBeenCalled();
	});

	it("restores, shows and focuses the window when notification is clicked", () => {
		const mockWin = {
			isDestroyed: vi.fn().mockReturnValue(false),
			isMinimized: vi.fn().mockReturnValue(true),
			isFocused: vi.fn().mockReturnValue(false),
			show: vi.fn(),
			focus: vi.fn(),
			restore: vi.fn(),
		} as any;

		let clickHandler: (() => void) | undefined;
		mockNotificationInstance.on.mockImplementation((event: string, handler: () => void) => {
			if (event === "click") {
				clickHandler = handler;
			}
		});

		showTaskCompletedNotification("Task 2 completed", () => mockWin);

		expect(clickHandler).toBeDefined();
		clickHandler!();

		expect(mockWin.restore).toHaveBeenCalled();
		expect(mockWin.show).toHaveBeenCalled();
		expect(mockWin.focus).toHaveBeenCalled();
	});

	it("does not crash if window is destroyed or undefined when notification clicked", () => {
		let clickHandler: (() => void) | undefined;
		mockNotificationInstance.on.mockImplementation((event: string, handler: () => void) => {
			if (event === "click") clickHandler = handler;
		});

		showTaskCompletedNotification("Task 3 completed", () => undefined);
		expect(() => clickHandler?.()).not.toThrow();
	});
});
