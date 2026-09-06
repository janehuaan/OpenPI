import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockClientInstance, mockDaemonLive } = vi.hoisted(() => {
	const mockClientInstance = {
		connect: vi.fn().mockResolvedValue(undefined),
		request: vi.fn().mockResolvedValue({ ok: true }),
		onEvent: vi.fn(),
		onClose: vi.fn(),
		close: vi.fn(),
		isConnected: vi.fn().mockReturnValue(true),
	};
	const mockDaemonLive = vi.fn().mockResolvedValue(true);
	return { mockClientInstance, mockDaemonLive };
});

vi.mock("@openpi/daemon", () => {
	return {
		DaemonClient: vi.fn().mockImplementation(() => mockClientInstance),
		isDaemonLive: mockDaemonLive,
	};
});

vi.mock("electron", () => {
	return {
		app: { isPackaged: false },
	};
});

import {
	disconnect,
	ensureDaemon,
	getDaemonStatus,
	onDaemonStatusChange,
	requestDaemon,
	scheduleReconnect,
	type DaemonStatus,
} from "../electron/daemon.ts";

describe("Daemon Resilience & Reconnection", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		disconnect();
	});

	it("tracks status and notifies listeners on connection", async () => {
		const statuses: DaemonStatus[] = [];
		const unsub = onDaemonStatusChange((s) => statuses.push(s));

		expect(statuses).toContain("disconnected");

		await ensureDaemon();
		expect(getDaemonStatus()).toBe("connected");
		expect(statuses).toContain("connected");

		unsub();
	});

	it("transitions to reconnecting when socket closes unexpectedly", async () => {
		let closeHandler: (() => void) | undefined;
		mockClientInstance.onClose.mockImplementation((handler: () => void) => {
			closeHandler = handler;
			return () => {};
		});

		await ensureDaemon();
		expect(getDaemonStatus()).toBe("connected");
		expect(closeHandler).toBeDefined();

		// Simulate unexpected socket close
		mockClientInstance.isConnected.mockReturnValue(false);
		closeHandler!();

		expect(getDaemonStatus()).toBe("reconnecting");
	});

	it("retries requestDaemon with exponential backoff when connection drops", async () => {
		let attempts = 0;
		mockClientInstance.request.mockImplementation(async () => {
			attempts++;
			if (attempts === 1) {
				throw new Error("daemon connection closed");
			}
			return { success: true };
		});

		const res = await requestDaemon({ type: "health" } as any, 2);
		expect(res).toEqual({ success: true });
		expect(attempts).toBe(2);
	});

	it("cleans up state and stays disconnected on intentional disconnect", async () => {
		await ensureDaemon();
		expect(getDaemonStatus()).toBe("connected");

		disconnect();
		expect(getDaemonStatus()).toBe("disconnected");
		expect(mockClientInstance.close).toHaveBeenCalled();
	});
});
