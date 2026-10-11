import { useState, useEffect } from "react";
import type { SafetyStatus, DesktopSnapshot } from "../../../lib/app-types";
import { desktopApi } from "../../../api";
import {
	Activity,
	AlertCircle,
	ArrowUpRight,
	Bot,
	Check,
	CheckCircle2,
	Cpu,
	Database,
	Folder,
	HardDrive,
	Lock,
	RefreshCw,
	Server,
	Shield,
	Terminal,
	Zap,
} from "../../icons.tsx";

interface AgentSurfaceProps {
	safetyStatus?: SafetyStatus | null;
	snapshot?: DesktopSnapshot;
	onClose?: () => void;
	onNavigate?: (view: string) => void;
}

export function AgentSurface({
	safetyStatus: initialSafety,
	snapshot,
	onClose,
	onNavigate,
}: AgentSurfaceProps) {
	const [safety, setSafety] = useState<SafetyStatus | null>(initialSafety ?? null);
	const [loading, setLoading] = useState(false);

	const refreshSafety = async () => {
		setLoading(true);
		try {
			const s = await desktopApi.getSafetyStatus();
			if (s) setSafety(s);
		} catch (err) {
			console.error("Failed to load safety status:", err);
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		void refreshSafety();
	}, []);

	const circuitState = safety?.circuitState?.state || "healthy";
	const isHealthy = circuitState.toLowerCase() === "healthy";
	const consecutiveFailures = safety?.circuitState && "consecutive_failures" in safety.circuitState ? safety.circuitState.consecutive_failures : 0;
	const personalUsed = safety?.budgetReport?.personal_used ?? 0;
	const personalLimit = safety?.budgetReport?.personal_limit ?? 30000;
	const executionUsed = safety?.budgetReport?.execution_used ?? 0;
	const executionLimit = safety?.budgetReport?.execution_limit ?? 70000;

	return (
		<div className="agent-surface-container" style={{
			display: "flex",
			flexDirection: "column",
			height: "100%",
			padding: "24px 32px",
			background: "var(--bg)",
			color: "var(--text)",
			overflowY: "auto",
			gap: "24px",
		}}>
			{/* Top Header */}
			<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
				<div>
					<div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
						<span style={{ fontSize: "20px", fontWeight: 700, letterSpacing: "-0.3px", color: "var(--text)" }}>Agent 控制中心</span>
						<span style={{
							display: "inline-flex",
							alignItems: "center",
							gap: "5px",
							padding: "3px 9px",
							borderRadius: "12px",
							fontSize: "11px",
							fontWeight: 600,
							background: isHealthy ? "var(--ok-soft, rgba(16, 185, 129, 0.12))" : "var(--warn-soft, rgba(249, 115, 22, 0.12))",
							color: isHealthy ? "var(--ok, #10b981)" : "var(--warn, #f97316)",
							border: `1px solid ${isHealthy ? "var(--ok, #10b981)" : "var(--warn, #f97316)"}`,
						}}>
							● {circuitState}
						</span>
					</div>
					<p style={{ margin: "4px 0 0", fontSize: "12.5px", color: "var(--text-secondary)" }}>
						个人智能体运行状态、分层资源预算、安全护栏与可靠性熔断中枢
					</p>
				</div>
				<button
					type="button"
					onClick={() => void refreshSafety()}
					disabled={loading}
					style={{
						display: "inline-flex",
						alignItems: "center",
						gap: "6px",
						padding: "6px 12px",
						borderRadius: "8px",
						background: "var(--bg-elevated)",
						border: "1px solid var(--border)",
						color: "var(--text)",
						fontSize: "12px",
						cursor: "pointer",
					}}
				>
					<RefreshCw size={13} className={loading ? "spin" : ""} />
					<span>刷新状态</span>
				</button>
			</div>

			{/* Grid Sections */}
			<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "16px" }}>
				{/* 1. 当前焦点 & 承诺 */}
				<div style={{
					background: "var(--bg-elevated)",
					border: "1px solid var(--border)",
					borderRadius: "14px",
					boxShadow: "var(--shadow-soft)",
					padding: "18px",
					display: "flex",
					flexDirection: "column",
					gap: "14px",
				}}>
					<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
						<span style={{ fontSize: "11.5px", fontWeight: 700, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
							CURRENT FOCUS & COMMITMENTS
						</span>
						<Zap size={14} color="var(--accent)" />
					</div>
					<div>
						<div style={{ fontSize: "15px", fontWeight: 600, color: "var(--text)" }}>OpenPI Personal Agent OS</div>
						<div style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "2px" }}>主线目标：全生命周期 Personal Intelligence 架构贯通</div>
					</div>
					<div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
						<span style={{ fontSize: "11px", color: "var(--text-tertiary)", fontWeight: 600 }}>活跃安全承诺 (Active Commitments)</span>
						<div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "var(--text)" }}>
							<CheckCircle2 size={13} color="var(--ok, #10b981)" />
							<span>严格冻结 Execution Core（openpi-engine 零污染）</span>
						</div>
						<div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "var(--text)" }}>
							<CheckCircle2 size={13} color="var(--ok, #10b981)" />
							<span>保护用户偏好归因，支持原子化回滚</span>
						</div>
						<div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "var(--text)" }}>
							<CheckCircle2 size={13} color="var(--ok, #10b981)" />
							<span>确定性规则决策（离散可测，无浮点黑盒）</span>
						</div>
					</div>
				</div>

				{/* 2. 可靠性 & 熔断器 (Reliability) */}
				<div style={{
					background: "var(--bg-elevated)",
					border: "1px solid var(--border)",
					borderRadius: "14px",
					boxShadow: "var(--shadow-soft)",
					padding: "18px",
					display: "flex",
					flexDirection: "column",
					gap: "14px",
				}}>
					<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
						<span style={{ fontSize: "11.5px", fontWeight: 700, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
							RELIABILITY & CIRCUIT BREAKER
						</span>
						<Shield size={14} color="var(--accent)" />
					</div>
					<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
						<div style={{ background: "var(--bg-muted)", border: "1px solid var(--border-subtle)", padding: "10px 12px", borderRadius: "8px" }}>
							<span style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>熔断器状态</span>
							<div style={{ fontSize: "14px", fontWeight: 600, color: isHealthy ? "var(--ok, #10b981)" : "var(--warn, #f97316)", marginTop: "2px" }}>
								{circuitState}
							</div>
						</div>
						<div style={{ background: "var(--bg-muted)", border: "1px solid var(--border-subtle)", padding: "10px 12px", borderRadius: "8px" }}>
							<span style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>执行失败次数</span>
							<div style={{ fontSize: "14px", fontWeight: 600, color: "var(--text)", marginTop: "2px" }}>
								{consecutiveFailures}
							</div>
						</div>
						<div style={{ background: "var(--bg-muted)", border: "1px solid var(--border-subtle)", padding: "10px 12px", borderRadius: "8px" }}>
							<span style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>事件总线队列</span>
							<div style={{ fontSize: "14px", fontWeight: 600, color: "var(--ok, #10b981)", marginTop: "2px" }}>正常 (0 积压)</div>
						</div>
						<div style={{ background: "var(--bg-muted)", border: "1px solid var(--border-subtle)", padding: "10px 12px", borderRadius: "8px" }}>
							<span style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>探针恢复</span>
							<div style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-secondary)", marginTop: "2px" }}>Canary Probing</div>
						</div>
					</div>
					<div style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>
						硬约束门禁：超时 ≤ 60s · 内存 ≤ 512MB · 重试上限 ≤ 2 · 工具轮次 ≤ 15
					</div>
				</div>

				{/* 3. 分层资源预算 (Resource Budget) */}
				<div style={{
					background: "var(--bg-elevated)",
					border: "1px solid var(--border)",
					borderRadius: "14px",
					boxShadow: "var(--shadow-soft)",
					padding: "18px",
					display: "flex",
					flexDirection: "column",
					gap: "14px",
				}}>
					<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
						<span style={{ fontSize: "11.5px", fontWeight: 700, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
							RESOURCE BUDGET (30% / 70%)
						</span>
						<Cpu size={14} color="var(--accent)" />
					</div>
					{/* 30% 个人智能配额 */}
					<div>
						<div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", marginBottom: "4px" }}>
							<span style={{ color: "var(--text)" }}>个人智能层 (30% 配额)</span>
							<span style={{ color: "var(--text-secondary)", fontFamily: "monospace" }}>
								{personalUsed.toLocaleString()} / {personalLimit.toLocaleString()} tok
							</span>
						</div>
						<div style={{ height: "6px", background: "var(--border-subtle)", borderRadius: "3px", overflow: "hidden" }}>
							<div style={{
								width: `${Math.min(100, Math.round((personalUsed / (personalLimit || 1)) * 100))}%`,
								height: "100%",
								background: "var(--warn, #f97316)",
							}} />
						</div>
					</div>
					{/* 70% 执行核心配额 */}
					<div>
						<div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", marginBottom: "4px" }}>
							<span style={{ color: "var(--text)" }}>核心执行层 (70% 配额)</span>
							<span style={{ color: "var(--text-secondary)", fontFamily: "monospace" }}>
								{executionUsed.toLocaleString()} / {executionLimit.toLocaleString()} tok
							</span>
						</div>
						<div style={{ height: "6px", background: "var(--border-subtle)", borderRadius: "3px", overflow: "hidden" }}>
							<div style={{
								width: `${Math.min(100, Math.round((executionUsed / (executionLimit || 1)) * 100))}%`,
								height: "100%",
								background: "var(--accent)",
							}} />
						</div>
					</div>
					<div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "var(--text-tertiary)", marginTop: "2px" }}>
						<span>遥测结算：预扣 Reserve → 执行 Execute → 扣减 Meter</span>
						<span>警戒线: 85%</span>
					</div>
				</div>

				{/* 4. 权限与自主权门禁 (Permissions) */}
				<div style={{
					background: "var(--bg-elevated)",
					border: "1px solid var(--border)",
					borderRadius: "14px",
					boxShadow: "var(--shadow-soft)",
					padding: "18px",
					display: "flex",
					flexDirection: "column",
					gap: "14px",
				}}>
					<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
						<span style={{ fontSize: "11.5px", fontWeight: 700, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
							PERMISSIONS & AUTONOMY
						</span>
						<Lock size={14} color="var(--ok, #10b981)" />
					</div>
					<div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
						<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "12.5px" }}>
							<span style={{ color: "var(--text)" }}>本地文件系统 (Filesystem)</span>
							<span style={{ color: "var(--ok, #10b981)", fontWeight: 600 }}>✓ 受控授权</span>
						</div>
						<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "12.5px" }}>
							<span style={{ color: "var(--text)" }}>终端执行 (Terminal / Commands)</span>
							<span style={{ color: "var(--ok, #10b981)", fontWeight: 600 }}>✓ 网关拦截</span>
						</div>
						<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "12.5px" }}>
							<span style={{ color: "var(--text)" }}>外部网络访问 (Network)</span>
							<span style={{ color: "var(--accent)", fontWeight: 600 }}>只读优先</span>
						</div>
						<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "12.5px" }}>
							<span style={{ color: "var(--text)" }}>高危破坏性操作 (Destructive Actions)</span>
							<span style={{ color: "var(--warn, #ea580c)", fontWeight: 600 }}>必须请示 (Ask)</span>
						</div>
					</div>
					<div style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>
						遵从十大系统不变量看门狗（Invariants Watchdog）防护。
					</div>
				</div>
			</div>
		</div>
	);
}
