import { describe, expect, it, vi } from "vitest";
import registerSystemTools, {
	killProcess,
	parseDfOutput,
	parseLsofOutput,
	parsePmsetBattery,
} from "../src/system.ts";

describe("Telemetry Parsers", () => {
	it("parses macOS pmset battery charging output", () => {
		const sample = `Now drawing from 'AC Power'
 -InternalBattery-0 (id=1234567)	87%; charging; 0:45 remaining present: true`;
		const result = parsePmsetBattery(sample);
		expect(result.hasBattery).toBe(true);
		expect(result.percentage).toBe(87);
		expect(result.charging).toBe(true);
		expect(result.source).toBe("AC Power");
	});

	it("parses macOS pmset battery discharging output", () => {
		const sample = `Now drawing from 'Battery Power'
 -InternalBattery-0 (id=1234567)	52%; discharging; 3:12 remaining present: true`;
		const result = parsePmsetBattery(sample);
		expect(result.hasBattery).toBe(true);
		expect(result.percentage).toBe(52);
		expect(result.charging).toBe(false);
		expect(result.source).toBe("Battery Power");
	});

	it("handles desktop Mac or missing battery gracefully", () => {
		const sample = `Now drawing from 'AC Power'
 No battery`;
		const result = parsePmsetBattery(sample);
		expect(result.hasBattery).toBe(false);
	});

	it("parses df -k disk output", () => {
		const sample = `Filesystem    1024-blocks      Used Available Capacity iused      ifree %iused  Mounted on
/dev/disk3s1s1  482884968  11184768 152640200     7%  488584 1526402000    0%   /`;
		const result = parseDfOutput(sample);
		expect(result).toBeDefined();
		expect(result?.totalGb).toBeGreaterThan(400);
		expect(result?.usedGb).toBeGreaterThan(5);
		expect(result?.freeGb).toBeGreaterThan(100);
		expect(result?.usagePercent).toBe(2);
	});

	it("handles invalid df output gracefully", () => {
		expect(parseDfOutput("")).toBeUndefined();
		expect(parseDfOutput("header only")).toBeUndefined();
	});

	it("parses lsof listening ports output", () => {
		const sample = `COMMAND     PID   USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
node      24567 huaan   23u  IPv6 0x1234567890abcdef      0t0  TCP *:3000 (LISTEN)
vite      24580 huaan   19u  IPv4 0xabcdef1234567890      0t0  TCP 127.0.0.1:5173 (LISTEN)
Python    24601 huaan    4u  IPv4 0x9988776655443322      0t0  TCP *:8080 (LISTEN)`;
		const result = parseLsofOutput(sample);
		expect(result.length).toBe(3);
		expect(result[0]).toEqual({
			command: "node",
			pid: 24567,
			user: "huaan",
			node: "IPv6",
			port: 3000,
		});
		expect(result[1]).toEqual({
			command: "vite",
			pid: 24580,
			user: "huaan",
			node: "IPv4",
			port: 5173,
		});
		expect(result[2]).toEqual({
			command: "Python",
			pid: 24601,
			user: "huaan",
			node: "IPv4",
			port: 8080,
		});
	});

	it("handles empty lsof output", () => {
		const sample = "COMMAND     PID   USER   FD   TYPE   DEVICE SIZE/OFF NODE NAME\n";
		const result = parseLsofOutput(sample);
		expect(result).toEqual([]);
	});
});

describe("System Tools Extension Registration", () => {
	it("registers system_os, system_screen, and system_process tools", () => {
		const registeredTools: any[] = [];
		const mockPi: any = {
			registerTool: vi.fn((toolDef) => {
				registeredTools.push(toolDef);
			}),
		};

		registerSystemTools(mockPi);

		expect(mockPi.registerTool).toHaveBeenCalledTimes(3);
		const toolNames = registeredTools.map((t) => t.name);
		expect(toolNames).toContain("system_os");
		expect(toolNames).toContain("system_screen");
		expect(toolNames).toContain("system_process");
	});

	it("executes system_process get_telemetry via registered tool execute", async () => {
		const registeredTools: Map<string, any> = new Map();
		const mockPi: any = {
			registerTool: vi.fn((toolDef) => {
				registeredTools.set(toolDef.name, toolDef);
			}),
		};

		registerSystemTools(mockPi);

		const processTool = registeredTools.get("system_process");
		expect(processTool).toBeDefined();

		const res = await processTool.execute("test-call-1", { action: "get_telemetry" });
		expect(res.content[0].type).toBe("text");
		expect(res.content[0].text).toContain("硬件遥测");
		expect(res.details.telemetry.cpu.cores).toBeGreaterThan(0);
		expect(res.details.telemetry.memory.totalGb).toBeGreaterThan(0);
	});

	describe("killProcess PID Safety Firewall", () => {
		it("refuses to kill PID <= 1", async () => {
			await expect(killProcess(0)).rejects.toThrow("Invalid or protected PID");
			await expect(killProcess(1)).rejects.toThrow("Invalid or protected PID");
			await expect(killProcess(-10)).rejects.toThrow("Invalid or protected PID");
		});

		it("refuses to kill current agent process or parent process", async () => {
			await expect(killProcess(process.pid)).rejects.toThrow("Refusing to terminate current process or parent process");
			await expect(killProcess(process.ppid)).rejects.toThrow("Refusing to terminate current process or parent process");
		});
	});
});

