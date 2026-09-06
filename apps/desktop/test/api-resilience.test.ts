import { describe, expect, it, vi, beforeEach } from "vitest";

describe("Web API Resilience & Daemon Status", () => {
	let mockInvoke: ReturnType<typeof vi.fn>;
	let mockOnDaemonStatus: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		mockInvoke = vi.fn();
		mockOnDaemonStatus = vi.fn().mockReturnValue(() => {});

		(globalThis as any).window = {
			openpi: {
				isNative: true,
				invoke: mockInvoke,
				onConversationEvent: vi.fn().mockReturnValue(() => {}),
				onRefreshData: vi.fn().mockReturnValue(() => {}),
				onSpeechEvent: vi.fn().mockReturnValue(() => {}),
				onDaemonRestartDeferred: vi.fn().mockReturnValue(() => {}),
				onDaemonStatus: mockOnDaemonStatus,
			},
		};
	});

	it("registers daemon status listener via desktopApi", async () => {
		const { desktopApi } = await import("../web/api.ts");
		const handler = vi.fn();
		const unsub = desktopApi.onDaemonStatus(handler);

		expect(mockOnDaemonStatus).toHaveBeenCalledWith(handler);
		expect(typeof unsub).toBe("function");
	});

	it("invokes notify_task_completed via desktopApi", async () => {
		mockInvoke.mockResolvedValueOnce(true);
		const { desktopApi } = await import("../web/api.ts");

		const result = await desktopApi.notifyTaskCompleted({
			message: "Agent turn done",
			durationMs: 6500,
		});

		expect(mockInvoke).toHaveBeenCalledWith("notify_task_completed", {
			message: "Agent turn done",
			durationMs: 6500,
		});
		expect(result).toBe(true);
	});

	it("smoothly retries transient daemon disconnect errors in call()", async () => {
		let callCount = 0;
		mockInvoke.mockImplementation(async () => {
			callCount++;
			if (callCount === 1) {
				throw new Error("daemon connection closed");
			}
			return { daemonRunning: true, instances: [] };
		});

		const { desktopApi } = await import("../web/api.ts");
		const snapshot = await desktopApi.getSnapshot();

		expect(snapshot).toEqual({ daemonRunning: true, instances: [] });
		expect(callCount).toBe(2);
	});

	it("does not auto-retry non-retryable channels like send_message", async () => {
		let callCount = 0;
		mockInvoke.mockImplementation(async () => {
			callCount++;
			throw new Error("daemon connection closed");
		});

		const { desktopApi } = await import("../web/api.ts");
		await expect(desktopApi.sendMessage("inst-1", "hello", [])).rejects.toThrow("daemon connection closed");
		expect(callCount).toBe(1);
	});
});
