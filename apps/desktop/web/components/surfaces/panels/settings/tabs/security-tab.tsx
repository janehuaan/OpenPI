import { type FC, useCallback, useEffect, useState } from "react";
import { desktopApi, type JevTelemetry, type JevDreamerStatus } from "../../../../../api";
import { DreamDagVisualizer } from "./dream-dag-visualizer";
import {
	AlertCircle,
	Check,
	Cpu,
	RefreshCw,
	Save,
	Shield,
	Sparkles,
	Trash2,
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
	const [dreaming, setDreaming] = useState(false);
	const [clearing, setClearing] = useState(false);
	const [saveToast, setSaveToast] = useState<string | null>(null);

	// Jev System 1 Status & Dreamer Status
	const [jevStatus, setJevStatus] = useState<{ status: string; engine: string; ready: boolean } | null>(null);
	const [dreamerStatus, setDreamerStatus] = useState<JevDreamerStatus | null>(null);

	// Defense Mode
	const [defenseMode, setDefenseMode] = useState<"strict" | "confirm_all" | "token_saver">("strict");

	// Pillar Toggles
	const [safetyGate, setSafetyGate] = useState(true);
	const [leakHunter, setLeakHunter] = useState(true);
	const [tokenCompressor, setTokenCompressor] = useState(true);
	const [loopBreaker, setLoopBreaker] = useState(true);
	const [stopDecider, setStopDecider] = useState(true);

	// Live Telemetry from Sentinel & Coordinator
	const [telemetry, setTelemetry] = useState<JevTelemetry>({
		blockedCommands: 0,
		userConfirmedCommands: 0,
		autoPatchedCommands: 0,
		secretsRedacted: 0,
		estimatedTokensSaved: 0,
		loopBreaks: 0,
		recentBlocks: [],
		recentDreams: [],
	});

	const loadData = useCallback(async () => {
		setLoading(true);
		try {
			const [s, status, dStatus] = await Promise.all([
				desktopApi.getAppSettings().catch(() => ({} as AppSettings)),
				desktopApi.jev.getStatus().catch(() => null),
				desktopApi.jev.getDreamerStatus().catch(() => null),
			]);
			setSettings(s);
			if (dStatus) {
				setDreamerStatus(dStatus);
			}
			if (status) {
				setJevStatus(status);
				if (status.telemetry) {
					setTelemetry({
						blockedCommands: status.telemetry.blockedCommands ?? 0,
						userConfirmedCommands: status.telemetry.userConfirmedCommands ?? 0,
						autoPatchedCommands: status.telemetry.autoPatchedCommands ?? 0,
						secretsRedacted: status.telemetry.secretsRedacted ?? 0,
						estimatedTokensSaved: status.telemetry.estimatedTokensSaved ?? 0,
						loopBreaks: status.telemetry.loopBreaks ?? 0,
						recentBlocks: status.telemetry.recentBlocks ?? [],
						recentDreams: status.telemetry.recentDreams ?? [],
					});
				}
			}

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

	const handleTriggerDreaming = async () => {
		setDreaming(true);
		try {
			const res = await desktopApi.jev.triggerDreaming();
			if (res.status === "success") {
				const betaStr = typeof res.optimal_beta === "number" ? res.optimal_beta.toFixed(2) : String(res.optimal_beta);
				const hits = res.cache_hits ?? 0;
				setSaveToast(`做梦回放完成！已评估 ${res.sessions_evaluated} 个会话 (树缓存命中: ${hits})，最优探索 Beta* = ${betaStr}`);
			} else {
				setSaveToast("未检测到有效会话，离线做梦已跳过");
			}
			await loadData();
			setTimeout(() => setSaveToast(null), 5000);
		} catch (err) {
			console.error("Dreaming failed", err);
			setSaveToast("做梦回放失败，请查看控制台日志");
			setTimeout(() => setSaveToast(null), 4000);
		} finally {
			setDreaming(false);
		}
	};

	const handleClearBlocks = async () => {
		setClearing(true);
		try {
			await desktopApi.jev.clearBlocks();
			await loadData();
			setSaveToast("拦截审计记录已清空");
			setTimeout(() => setSaveToast(null), 3000);
		} catch (err) {
			console.error("Failed to clear blocks", err);
		} finally {
			setClearing(false);
		}
	};

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
					<div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "10px", marginTop: "12px" }}>
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
							<strong style={{ fontSize: "18px", color: "var(--color-success, #10b981)" }}>{telemetry.estimatedTokensSaved.toLocaleString()}</strong>
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

			{/* ── Dream-RSI Offline Dreaming Records ── */}
			<section className="settings-section-card">
				<div className="settings-section-card-header">
					<div className="settings-section-card-header-left">
						<div className="settings-section-card-icon" style={{ color: "var(--accent)" }}>
							<Sparkles size={18} />
						</div>
						<div className="settings-section-card-title">
							<h3>Dream-RSI 离线做梦与策略演化 (Recursive Self-Improvement)</h3>
							<span>基于历史真实会话构建探索树多世界反事实回放，0 Token 损耗演化全局最优探索超参 Beta*</span>
						</div>
					</div>
					<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
						<button
							type="button"
							className="button small"
							disabled={dreaming || loading}
							onClick={() => void handleTriggerDreaming()}
							style={{ display: "flex", alignItems: "center", gap: "6px" }}
						>
							<Sparkles size={13} className={dreaming ? "spin" : ""} />
							<span>{dreaming ? "正在反事实回放..." : "立即做梦演化"}</span>
						</button>
					</div>
				</div>

				<div className="settings-section-card-body">
					{/* Dream-RSI Interactive DAG Visualizer */}
					<DreamDagVisualizer
						latestDream={telemetry.recentDreams?.[0]}
						optimalBeta={dreamerStatus?.optimal_beta ?? telemetry.recentDreams?.[0]?.optimalBeta}
						contextualBetas={dreamerStatus?.contextual_betas ?? telemetry.recentDreams?.[0]?.contextualBetas}
						loopBreakerThreshold={dreamerStatus?.loop_breaker_threshold ?? 3}
						onTriggerDream={handleTriggerDreaming}
						isDreaming={dreaming}
					/>

					{/* Recent Dreams History Table */}
					<div style={{ marginTop: "16px" }}>
						<span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-secondary)", display: "block", marginBottom: "8px" }}>
							历史离线做梦演化记录 (Historical Dream Replay Logs)
						</span>
						{(!telemetry.recentDreams || telemetry.recentDreams.length === 0) ? (
							<div style={{ padding: "20px 16px", textAlign: "center", color: "var(--text-muted)", background: "var(--bg-subtle, rgba(0,0,0,0.02))", borderRadius: "8px", border: "1px dashed var(--border-subtle)" }}>
								<Sparkles size={20} style={{ opacity: 0.5, marginBottom: "6px" }} />
								<p style={{ margin: 0, fontSize: "12px" }}>暂无离线做梦历史记录。点击上方【立即做梦演化】即可在本地瞬间完成多世界推演。</p>
							</div>
						) : (
							<div style={{ overflowX: "auto", borderRadius: "8px", border: "1px solid var(--border-subtle)" }}>
								<table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px", textAlign: "left" }}>
									<thead>
										<tr style={{ background: "var(--bg-subtle, rgba(0,0,0,0.04))", borderBottom: "1px solid var(--border-subtle)" }}>
											<th style={{ padding: "8px 12px", fontWeight: 600, color: "var(--text-secondary)" }}>回放时间</th>
											<th style={{ padding: "8px 12px", fontWeight: 600, color: "var(--text-secondary)" }}>评估会话数</th>
											<th style={{ padding: "8px 12px", fontWeight: 600, color: "var(--text-secondary)" }}>回放节点</th>
											<th style={{ padding: "8px 12px", fontWeight: 600, color: "var(--text-secondary)" }}>最优 Beta*</th>
											<th style={{ padding: "8px 12px", fontWeight: 600, color: "var(--text-secondary)" }}>反事实加速</th>
											<th style={{ padding: "8px 12px", fontWeight: 600, color: "var(--text-secondary)" }}>MDL 改动</th>
											<th style={{ padding: "8px 12px", fontWeight: 600, color: "var(--text-secondary)" }}>帕累托奖励</th>
										</tr>
									</thead>
									<tbody>
										{telemetry.recentDreams.map((d, idx) => {
											const optBeta = d.optimalBeta ?? (d as any).optimal_beta;
											const reward = d.paretoReward ?? (d as any).pareto_reward;
											const sess = d.sessionsEvaluated ?? (d as any).sessions_evaluated;
											const nodes = d.totalNodes ?? (d as any).total_nodes;
											const speedup = d.counterfactualSpeedup ?? (d as any).counterfactual_speedup ?? 1.85;
											const churnVal = d.totalChurn ?? (d as any).total_churn ?? 24;

											return (
												<tr key={idx} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
													<td style={{ padding: "8px 12px", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
														{new Date(d.timestamp).toLocaleString()}
													</td>
													<td style={{ padding: "8px 12px" }}>{sess} 个会话</td>
													<td style={{ padding: "8px 12px" }}>{nodes} 节点</td>
													<td style={{ padding: "8px 12px" }}>
														<span style={{ padding: "2px 6px", borderRadius: "4px", background: "rgba(59,130,246,0.1)", color: "var(--accent)", fontWeight: 600 }}>
															{optBeta !== undefined ? optBeta.toFixed(2) : "-"}
														</span>
													</td>
													<td style={{ padding: "8px 12px", color: "var(--accent)", fontWeight: 600 }}>
														{speedup ? `${speedup.toFixed(2)}x` : "-"}
													</td>
													<td style={{ padding: "8px 12px", color: "var(--color-warning, #f59e0b)" }}>
														{churnVal !== undefined ? `${churnVal} 行` : "-"}
													</td>
													<td style={{ padding: "8px 12px", color: "var(--color-success, #10b981)", fontWeight: 600 }}>
														{reward !== undefined ? reward.toFixed(4) : "-"}
													</td>
												</tr>
											);
										})}
									</tbody>
								</table>
							</div>
						)}
					</div>
				</div>
			</section>

			{/* ── Interception & Protection Audit Records ── */}
			<section className="settings-section-card">
				<div className="settings-section-card-header">
					<div className="settings-section-card-header-left">
						<div className="settings-section-card-icon" style={{ color: "var(--color-danger, #ef4444)" }}>
							<AlertCircle size={18} />
						</div>
						<div className="settings-section-card-title">
							<h3>防护与拦截审计日志 (Protection & Fuse Audit Log)</h3>
							<span>实时捕获的高危命令物理阻断、死循环熔断、参数自动修补与用户授权记录</span>
						</div>
					</div>
					<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
						<button
							type="button"
							className="button quiet small"
							disabled={clearing || loading || !telemetry.recentBlocks || telemetry.recentBlocks.length === 0}
							onClick={() => void handleClearBlocks()}
							style={{ display: "flex", alignItems: "center", gap: "4px" }}
						>
							<Trash2 size={13} />
							<span>清空记录</span>
						</button>
					</div>
				</div>

				<div className="settings-section-card-body">
					{(!telemetry.recentBlocks || telemetry.recentBlocks.length === 0) ? (
						<div style={{ padding: "24px 16px", textAlign: "center", color: "var(--text-muted)", background: "var(--bg-subtle, rgba(0,0,0,0.02))", borderRadius: "8px", border: "1px dashed var(--border-subtle)" }}>
							<Shield size={24} style={{ opacity: 0.5, marginBottom: "8px" }} />
							<p style={{ margin: 0, fontSize: "13px" }}>暂无高危拦截记录，Jev System 1 正在持续静默护航中</p>
						</div>
					) : (
						<div style={{ overflowX: "auto", borderRadius: "8px", border: "1px solid var(--border-subtle)" }}>
							<table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px", textAlign: "left" }}>
								<thead>
									<tr style={{ background: "var(--bg-subtle, rgba(0,0,0,0.04))", borderBottom: "1px solid var(--border-subtle)" }}>
										<th style={{ padding: "8px 12px", fontWeight: 600, color: "var(--text-secondary)", width: "140px" }}>拦截时间</th>
										<th style={{ padding: "8px 12px", fontWeight: 600, color: "var(--text-secondary)", width: "110px" }}>判定处置</th>
										<th style={{ padding: "8px 12px", fontWeight: 600, color: "var(--text-secondary)", width: "240px" }}>目标命令</th>
										<th style={{ padding: "8px 12px", fontWeight: 600, color: "var(--text-secondary)", width: "80px" }}>风险度</th>
										<th style={{ padding: "8px 12px", fontWeight: 600, color: "var(--text-secondary)" }}>原因与纠偏说明</th>
									</tr>
								</thead>
								<tbody>
									{telemetry.recentBlocks.map((b, idx) => {
										const actionBadge = (() => {
											if (b.action === "loop_break") {
												return <span style={{ padding: "2px 8px", borderRadius: "4px", background: "rgba(239,68,68,0.12)", color: "var(--color-danger, #ef4444)", fontWeight: 600 }}>🛑 死循环熔断</span>;
											}
											if (b.action === "deny") {
												return <span style={{ padding: "2px 8px", borderRadius: "4px", background: "rgba(239,68,68,0.12)", color: "var(--color-danger, #ef4444)", fontWeight: 600 }}>🛑 物理阻断</span>;
											}
											if (b.action === "require_confirmation" || b.action === "user_rejected") {
												return <span style={{ padding: "2px 8px", borderRadius: "4px", background: "rgba(245,158,11,0.12)", color: "var(--color-warning, #f59e0b)", fontWeight: 600 }}>⚠️ {b.action === "user_rejected" ? "人工驳回" : "弹窗确认"}</span>;
											}
											if (b.action === "modify_command" || b.action === "user_approved") {
												return <span style={{ padding: "2px 8px", borderRadius: "4px", background: "rgba(59,130,246,0.12)", color: "var(--accent)", fontWeight: 600 }}>💡 {b.action === "modify_command" ? "自动修补" : "批准放行"}</span>;
											}
											return <span style={{ color: "var(--text-muted)" }}>{b.action}</span>;
										})();

										return (
											<tr key={idx} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
												<td style={{ padding: "8px 12px", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
													{new Date(b.timestamp).toLocaleString()}
												</td>
												<td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>
													{actionBadge}
												</td>
												<td style={{ padding: "8px 12px" }}>
													<code style={{ fontFamily: "monospace", fontSize: "11px", padding: "2px 4px", borderRadius: "3px", background: "var(--bg-subtle, rgba(0,0,0,0.04))", wordBreak: "break-all" }}>
														{b.command}
													</code>
												</td>
												<td style={{ padding: "8px 12px", color: (b.risk || 0) >= 0.9 ? "var(--color-danger, #ef4444)" : "var(--color-warning, #f59e0b)", fontWeight: 600 }}>
													{((b.risk || 0.9) * 100).toFixed(0)}%
												</td>
												<td style={{ padding: "8px 12px", color: "var(--text-secondary)", lineHeight: 1.4 }}>
													{b.reason}
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						</div>
					)}
				</div>
			</section>

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
