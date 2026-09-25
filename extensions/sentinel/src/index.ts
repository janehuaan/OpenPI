import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { OpenPIDecider } from "@openpi/shared";
import { Type } from "typebox";

let totalBlockedCount = 0;
let totalVerifiedCount = 0;
const blockedLog: Array<{ timestamp: number; tool: string; reason: string }> = [];

export default function sentinelExtension(pi: ExtensionAPI): void {
	// ── 1. 首部判别 (Head: Intent & Mode Routing) ──────────────────────────
	pi.on("input", async (event) => {
		try {
			const routing = await OpenPIDecider.decideModeAsync(event.text);
			if (routing.mode === "chat") {
				console.log(`[OpenPI Sentinel] Neural route -> CHAT (${routing.reason}): "${event.text.slice(0, 30)}..."`);
			} else {
				console.log(`[OpenPI Sentinel] Neural route -> CODE (${routing.reason}): "${event.text.slice(0, 30)}..."`);
			}
		} catch (err) {
			console.warn("[OpenPI Sentinel] Routing inspection error:", err);
		}
	});

	// ── 2. 中置拦截 (Sentinel: Zero-Latency High-Risk Guardrail) ───────────
	pi.on("tool_call", async (event) => {
		try {
			const check = OpenPIDecider.checkSafety(event.toolName, event.input as Record<string, unknown>);
			if (check.isDangerous) {
				totalBlockedCount += 1;
				const entry = {
					timestamp: Date.now(),
					tool: event.toolName,
					reason: `${check.reason} (matched: ${check.matchedRule})`,
				};
				blockedLog.push(entry);
				if (blockedLog.length > 50) blockedLog.shift();

				console.warn(`[OpenPI Sentinel] 🛑 BLOCKED high-risk operation:`, entry);

				return {
					block: true,
					reason: `🛑 [OpenPI Sentinel 安全哨兵拦截] 该操作已被系统自动拦截。\n原因: ${check.reason}\n风险评分: ${(check.riskScore * 100).toFixed(0)}%\n命中规则: ${check.matchedRule}\n如果你确认需要执行，请改用非强制/安全模式，或向用户请求显式授权。`,
				};
			}
		} catch (err) {
			console.error("[OpenPI Sentinel] Error in safety check:", err);
		}
		return undefined;
	});

	// ── 3. 尾部纠偏 (Tail: Execution Verifier & Steering) ───────────────────
	pi.on("tool_result", async (event) => {
		try {
			totalVerifiedCount += 1;
			const text =
				event.content
					?.map((c) => (c.type === "text" ? c.text : ""))
					.join("\n") || "";

			const verifyRes = OpenPIDecider.verifyStep(event.toolName, event.isError, text);
			if (verifyRes.correctiveHint) {
				console.info(`[OpenPI Sentinel] Steering hint injected: ${verifyRes.correctiveHint}`);
				return {
					content: [
						...(event.content || []),
						{
							type: "text",
							text: `\n${verifyRes.correctiveHint}`,
						},
					],
				};
			}
		} catch (err) {
			console.warn("[OpenPI Sentinel] Verifier error:", err);
		}
		return undefined;
	});

	// ── 4. 辅助状态查看工具 (Inspection Tool) ──────────────────────────────
	pi.registerTool({
		name: "pi_sentinel_status",
		label: "OpenPI Sentinel Status",
		description: "Inspect OpenPI Sentinel safety statistics, blocked commands log, and decision engine status.",
		parameters: Type.Object({}),
		execute: async () => {
			const semanticAvailable = OpenPIDecider.isSemanticAvailable ? OpenPIDecider.isSemanticAvailable() : true;
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{
								status: "active",
								totalBlockedCount,
								totalVerifiedCount,
								neuralSemanticRouterAvailable: semanticAvailable,
								recentBlocks: blockedLog.slice(-5),
							},
							null,
							2
						),
					},
				],
				details: {},
			};
		},
	});
}
