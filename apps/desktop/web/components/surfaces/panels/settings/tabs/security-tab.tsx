import { type FC, useCallback, useEffect, useState } from "react";
import { desktopApi } from "../../../../../api";
import {
	AlertCircle,
	Check,
	Cpu,
	RefreshCw,
	Save,
	Shield,
	Zap,
} from "../../../../icons";
import type { AppSettings } from "../../../../../lib/app-types";

interface SecurityTabProps {
	instanceId?: string;
	onReload?: () => Promise<void>;
}

export const SecurityTab: FC<SecurityTabProps> = () => {
	const [settings, setSettings] = useState<AppSettings>({});
	const [loading, setLoading] = useState(false);
	const [saving, setSaving] = useState(false);
	const [saveToast, setSaveToast] = useState<string | null>(null);

	// Jev System 1 Status
	const [jevStatus, setJevStatus] = useState<{ status: string; engine: string; ready: boolean } | null>(null);

	// Defense Mode
	const [defenseMode, setDefenseMode] = useState<"strict" | "confirm_all" | "token_saver">("strict");

	// Pillar Toggles
	const [safetyGate, setSafetyGate] = useState(true);
	const [leakHunter, setLeakHunter] = useState(true);
	const [tokenCompressor, setTokenCompressor] = useState(true);
	const [loopBreaker, setLoopBreaker] = useState(true);
	const [stopDecider, setStopDecider] = useState(true);

	// Live Telemetry from Sentinel Status
	const [telemetry, setTelemetry] = useState<{
		blockedCommands: number;
		userConfirmedCommands: number;
		autoPatchedCommands: number;
		secretsRedacted: number;
		estimatedTokensSaved: number;
		loopBreaks: number;
		recentBlocks: Array<{
			timestamp: number;
			command: string;
			reason: string;
			risk: number;
		}>;
	}>({
		blockedCommands: 0,
		userConfirmedCommands: 0,
		autoPatchedCommands: 0,
		secretsRedacted: 0,
		estimatedTokensSaved: 0,
		loopBreaks: 0,
		recentBlocks: [],
	});

	const loadData = useCallback(async () => {
		setLoading(true);
		try {
			const [s, status] = await Promise.all([
				desktopApi.getAppSettings().catch(() => ({})),
				desktopApi.jev.getStatus().catch(() => null),
			]);
			setSettings(s);
			if (status) setJevStatus(status);

			if (s.jev?.defenseMode) setDefenseMode(s.jev.defenseMode);
			if (s.jev?.safetyGate !== undefined) setSafetyGate(s.jev.safetyGate);
			if (s.jev?.leakHunter !== undefined) setLeakHunter(s.jev.leakHunter);
			if (s.jev?.tokenCompressor !== undefined) setTokenCompressor(s.jev.tokenCompressor);
			if (s.jev?.loopBreaker !== undefined) setLoopBreaker(s.jev.loopBreaker);
			if (s.jev?.stopDecider !== undefined) setStopDecider(s.jev.stopDecider);
		} catch (err) {
			console.error("Failed to load security settings", err);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void loadData();
	}, [loadData]);

	const handleSave = async (overrides?: Partial<AppSettings>) => {
		setSaving(true);
		try {
			const payload: AppSettings = {
				...settings,
				jev: {
					defenseMode: overrides?.jev?.defenseMode ?? defenseMode,
					safetyGate: overrides?.jev?.safetyGate ?? safetyGate,
					leakHunter: overrides?.jev?.leakHunter ?? leakHunter,
					tokenCompressor: overrides?.jev?.tokenCompressor ?? tokenCompressor,
					loopBreaker: overrides?.jev?.loopBreaker ?? loopBreaker,
					stopDecider: overrides?.jev?.stopDecider ?? stopDecider,
				},
			};
			await desktopApi.updateAppSettings(payload);
			setSettings(payload);
			setSaveToast("Jev 神经防御策略已保存并生效");
			setTimeout(() => setSaveToast(null), 3000);
		} catch (err) {
			console.error("Failed to save security settings", err);
			setSaveToast("保存失败，请查看控制台日志");
			setTimeout(() => setSaveToast(null), 4000);
		} finally {
			setSaving(false);
		}
	};

	return (
		<div className="settings-tab-pane">
			{/* Toast */}
			{saveToast && (
				<div className="settings-toast success">
					<Check size={14} />
					<span>{saveToast}</span>
				</div>
			)}

			{/* ── Status Header Card ── */}
			<section className="settings-section-card">
				<div className="settings-section-card-header">
					<div className="settings-section-card-header-left">
						<div className="settings-section-card-icon" style={{ color: "var(--accent)" }}>
							<Shield size={18} />
						</div>
						<div className="settings-section-card-title">
							<h3>Jev 本地全能直觉中枢 (System 1)</h3>
							<span>毫秒级前置安全门禁、敏感脱敏、防死循环与输出智能脱水压缩</span>
						</div>
					</div>
					<div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
						<span className={`provider-badge ${jevStatus?.ready ? "active" : "standby"}`}>
							{jevStatus?.status === "Ready"
								? "⚡ 55ms 极速就绪"
								: jevStatus?.status === "WarmingUp"
									? "异步预热中"
									: "规则降级模式"}
						</span>
						<button
							type="button"
							className="icon-button quiet"
							title="刷新引擎状态"
							aria-label="刷新引擎状态"
							disabled={loading}
							onClick={() => void loadData()}
						>
							<RefreshCw size={13} className={loading ? "spin" : ""} />
						</button>
					</div>
				</div>

				<div className="settings-section-card-body">
					<div className="setting-item-row">
						<div className="setting-item-meta">
							<strong>神经推理引擎 (Inference Engine)</strong>
							<span>{jevStatus?.engine || "ModernBERT-base (FP32 全精度)"} · AVX2 原生指令集加速</span>
						</div>
						<span style={{ fontSize: "12px", color: "var(--text-muted)" }}>零网络依赖 / 零外部服务</span>
					</div>

					{/* Telemetry Metrics Grid */}
					<div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px", marginTop: "12px" }}>
						<div style={{ padding: "10px", background: "var(--bg-subtle, rgba(0,0,0,0.03))", borderRadius: "8px", border: "1px solid var(--border-subtle)" }}>
							<span style={{ fontSize: "11px", color: "var(--text-muted)", display: "block" }}>物理阻断高危</span>
							<strong style={{ fontSize: "18px", color: "var(--color-danger, #ef4444)" }}>{telemetry.blockedCommands}</strong>
							<span style={{ fontSize: "11px", color: "var(--text-muted)", marginLeft: "4px" }}>次</span>
						</div>
						<div style={{ padding: "10px", background: "var(--bg-subtle, rgba(0,0,0,0.03))", borderRadius: "8px", border: "1px solid var(--border-subtle)" }}>
							<span style={{ fontSize: "11px", color: "var(--text-muted)", display: "block" }}>弹窗授权放行</span>
							<strong style={{ fontSize: "18px", color: "var(--color-warning, #f59e0b)" }}>{telemetry.userConfirmedCommands}</strong>
							<span style={{ fontSize: "11px", color: "var(--text-muted)", marginLeft: "4px" }}>次</span>
						</div>
						<div style={{ padding: "10px", background: "var(--bg-subtle, rgba(0,0,0,0.03))", borderRadius: "8px", border: "1px solid var(--border-subtle)" }}>
							<span style={{ fontSize: "11px", color: "var(--text-muted)", display: "block" }}>凭证敏感脱敏</span>
							<strong style={{ fontSize: "18px", color: "var(--accent)" }}>{telemetry.secretsRedacted}</strong>
							<span style={{ fontSize: "11px", color: "var(--text-muted)", marginLeft: "4px" }}>处</span>
						</div>
						<div style={{ padding: "10px", background: "var(--bg-subtle, rgba(0,0,0,0.03))", borderRadius: "8px", border: "1px solid var(--border-subtle)" }}>
							<span style={{ fontSize: "11px", color: "var(--text-muted)", display: "block" }}>死循环熔断</span>
							<strong style={{ fontSize: "18px", color: "var(--color-danger, #ef4444)" }}>{telemetry.loopBreaks}</strong>
							<span style={{ fontSize: "11px", color: "var(--text-muted)", marginLeft: "4px" }}>次</span>
						</div>
						<div style={{ padding: "10px", background: "var(--bg-subtle, rgba(0,0,0,0.03))", borderRadius: "8px", border: "1px solid var(--border-subtle)" }}>
							<span style={{ fontSize: "11px", color: "var(--text-muted)", display: "block" }}>节约 Token 估算</span>
							<strong style={{ fontSize: "18px", color: "var(--color-success, #10b981)" }}>{telemetry.estimatedTokensSaved}</strong>
							<span style={{ fontSize: "11px", color: "var(--text-muted)", marginLeft: "4px" }}>Tokens</span>
						</div>
					</div>
				</div>
			</section>

			{/* ── Defense Mode Preset ── */}
			<section className="settings-section-card">
				<div className="settings-section-card-header">
					<div className="settings-section-card-header-left">
						<div className="settings-section-card-icon">
							<Cpu size={18} />
						</div>
						<div className="settings-section-card-title">
							<h3>防御策略级别 (Defense Policy)</h3>
							<span>决定系统在识别到危险操作时的默认反应逻辑</span>
						</div>
					</div>
				</div>

				<div className="settings-section-card-body">
					<div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px" }}>
						<button
							type="button"
							className={`settings-preset-card ${defenseMode === "strict" ? "active" : ""}`}
							style={{
								padding: "14px",
								textAlign: "left",
								borderRadius: "8px",
								border: defenseMode === "strict" ? "2px solid var(--accent)" : "1px solid var(--border-subtle)",
								background: defenseMode === "strict" ? "var(--accent-subtle, rgba(59,130,246,0.06))" : "transparent",
								cursor: "pointer",
							}}
							onClick={() => {
								setDefenseMode("strict");
								void handleSave({ jev: { defenseMode: "strict", safetyGate, leakHunter, tokenCompressor, loopBreaker, stopDecider } });
							}}
						>
							<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
								<strong style={{ fontSize: "13px" }}>严格物理防御</strong>
								<span className="provider-badge active" style={{ fontSize: "10px" }}>推荐</span>
							</div>
							<p style={{ margin: 0, fontSize: "12px", color: "var(--text-muted)", lineHeight: 1.4 }}>
								高危指令物理阻断不产生子进程；中危操作弹窗需人工批准；自动修补挂起安装指令。
							</p>
						</button>

						<button
							type="button"
							className={`settings-preset-card ${defenseMode === "confirm_all" ? "active" : ""}`}
							style={{
								padding: "14px",
								textAlign: "left",
								borderRadius: "8px",
								border: defenseMode === "confirm_all" ? "2px solid var(--accent)" : "1px solid var(--border-subtle)",
								background: defenseMode === "confirm_all" ? "var(--accent-subtle, rgba(59,130,246,0.06))" : "transparent",
								cursor: "pointer",
							}}
							onClick={() => {
								setDefenseMode("confirm_all");
								void handleSave({ jev: { defenseMode: "confirm_all", safetyGate, leakHunter, tokenCompressor, loopBreaker, stopDecider } });
							}}
						>
							<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
								<strong style={{ fontSize: "13px" }}>全面弹窗确认</strong>
							</div>
							<p style={{ margin: 0, fontSize: "12px", color: "var(--text-muted)", lineHeight: 1.4 }}>
								任何涉及文件删除、Git 变更或终端修改的动作均呼出弹窗，由您逐条授权。
							</p>
						</button>

						<button
							type="button"
							className={`settings-preset-card ${defenseMode === "token_saver" ? "active" : ""}`}
							style={{
								padding: "14px",
								textAlign: "left",
								borderRadius: "8px",
								border: defenseMode === "token_saver" ? "2px solid var(--accent)" : "1px solid var(--border-subtle)",
								background: defenseMode === "token_saver" ? "var(--accent-subtle, rgba(59,130,246,0.06))" : "transparent",
								cursor: "pointer",
							}}
							onClick={() => {
								setDefenseMode("token_saver");
								void handleSave({ jev: { defenseMode: "token_saver", safetyGate, leakHunter, tokenCompressor, loopBreaker, stopDecider } });
							}}
						>
							<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
								<strong style={{ fontSize: "13px" }}>极速节省 Token</strong>
							</div>
							<p style={{ margin: 0, fontSize: "12px", color: "var(--text-muted)", lineHeight: 1.4 }}>
								启用激进输出折叠，仅保留错误带与头尾退出码，单次操作最高节约 95% Token。
							</p>
						</button>
					</div>
				</div>
			</section>

			{/* ── Six Pillars Modular Toggles ── */}
			<section className="settings-section-card">
				<div className="settings-section-card-header">
					<div className="settings-section-card-header-left">
						<div className="settings-section-card-icon">
							<Zap size={18} />
						</div>
						<div className="settings-section-card-title">
							<h3>防护支柱细项控制 (Protection Modules)</h3>
							<span>可按需独立开启或关闭各 System 1 直觉神经组件</span>
						</div>
					</div>
				</div>

				<div className="settings-section-card-body">
					<div className="setting-item-row">
						<div className="setting-item-meta">
							<strong>物理安全与防挂起门禁 (SafetyGate & Hang Breaker)</strong>
							<span>拦截 rm -rf /、磁盘覆写等毁灭性指令，自动为交互包管理器命令追加 -y</span>
						</div>
						<label className="settings-toggle">
							<input
								type="checkbox"
								checked={safetyGate}
								onChange={(e) => {
									setSafetyGate(e.target.checked);
									void handleSave({ jev: { defenseMode, safetyGate: e.target.checked, leakHunter, tokenCompressor, loopBreaker, stopDecider } });
								}}
							/>
							<span className="settings-toggle-slider" />
						</label>
					</div>

					<div className="setting-item-row">
						<div className="setting-item-meta">
							<strong>凭证泄露猎手与自动脱敏 (LeakHunter)</strong>
							<span>微秒级正则预筛 API Key、GitHub PAT、私钥并自动打码为 [REDACTED_...]</span>
						</div>
						<label className="settings-toggle">
							<input
								type="checkbox"
								checked={leakHunter}
								onChange={(e) => {
									setLeakHunter(e.target.checked);
									void handleSave({ jev: { defenseMode, safetyGate, leakHunter: e.target.checked, tokenCompressor, loopBreaker, stopDecider } });
								}}
							/>
							<span className="settings-toggle-slider" />
						</label>
					</div>

					<div className="setting-item-row">
						<div className="setting-item-meta">
							<strong>海量日志三段式 Token 压缩器 (Token Compressor)</strong>
							<span>构建与测试日志超过 150 行时自动折叠中间信息，保留关键报错带</span>
						</div>
						<label className="settings-toggle">
							<input
								type="checkbox"
								checked={tokenCompressor}
								onChange={(e) => {
									setTokenCompressor(e.target.checked);
									void handleSave({ jev: { defenseMode, safetyGate, leakHunter, tokenCompressor: e.target.checked, loopBreaker, stopDecider } });
								}}
							/>
							<span className="settings-toggle-slider" />
						</label>
					</div>

					<div className="setting-item-row">
						<div className="setting-item-meta">
							<strong>死循环原地打转熔断与自愈 (LoopBreaker)</strong>
							<span>连续命中相同错误特征时切断重复执行，向 LLM 注入定位与纠偏建议</span>
						</div>
						<label className="settings-toggle">
							<input
								type="checkbox"
								checked={loopBreaker}
								onChange={(e) => {
									setLoopBreaker(e.target.checked);
									void handleSave({ jev: { defenseMode, safetyGate, leakHunter, tokenCompressor, loopBreaker: e.target.checked, stopDecider } });
								}}
							/>
							<span className="settings-toggle-slider" />
						</label>
					</div>

					<div className="setting-item-row">
						<div className="setting-item-meta">
							<strong>任务完结裁决器 (StopDecider)</strong>
							<span>核对用户原始需求与测试通过状态，目标达成后制止多余操作以防画蛇添足</span>
						</div>
						<label className="settings-toggle">
							<input
								type="checkbox"
								checked={stopDecider}
								onChange={(e) => {
									setStopDecider(e.target.checked);
									void handleSave({ jev: { defenseMode, safetyGate, leakHunter, tokenCompressor, loopBreaker, stopDecider: e.target.checked } });
								}}
							/>
							<span className="settings-toggle-slider" />
						</label>
					</div>
				</div>
			</section>

			{/* ── Save Action ── */}
			<div style={{ display: "flex", justifyContent: "flex-end", marginTop: "16px" }}>
				<button
					type="button"
					className="button primary"
					disabled={saving}
					onClick={() => void handleSave()}
					style={{ display: "flex", alignItems: "center", gap: "6px" }}
				>
					<Save size={14} />
					<span>{saving ? "正在应用策略..." : "保存配置"}</span>
				</button>
			</div>
		</div>
	);
};
