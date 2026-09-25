import { type FC, useEffect, useState } from "react";
import {
	AlertCircle,
	Check,
	ChevronDown,
	ChevronRight,
	Cpu,
	Download,
	ExternalLink,
	Folder,
	Github,
	RefreshCw,
	Shield,
	Terminal,
	Wrench,
} from "../../../../icons";
import { desktopApi, type RuntimeInfo, type RuntimeUpdateCheckResult, type RuntimeUpdateProgress } from "../../../../../api";
import type { ConversationCapabilities } from "../../../../../types";

interface AboutTabProps {
	capabilities?: ConversationCapabilities;
}

export const AboutTab: FC<AboutTabProps> = ({ capabilities }) => {
	const [toolsExpanded, setToolsExpanded] = useState(false);
	const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfo | null>(null);
	const [checkResult, setCheckResult] = useState<RuntimeUpdateCheckResult | null>(null);
	const [checking, setChecking] = useState(false);
	const [installing, setInstalling] = useState(false);
	const [rollingBack, setRollingBack] = useState(false);
	const [progress, setProgress] = useState<RuntimeUpdateProgress | null>(null);
	const [statusMessage, setStatusMessage] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);
	const [jevStatus, setJevStatus] = useState<{ status: string; engine: string; ready: boolean } | null>(null);

	useEffect(() => {
		desktopApi.getJevStatus().then(setJevStatus).catch(() => null);
	}, []);

	const loadRuntimeInfo = async () => {
		try {
			const info = await desktopApi.getRuntimeInfo();
			setRuntimeInfo(info);
		} catch (err: any) {
			console.error("Failed to load runtime info:", err);
		}
	};

	useEffect(() => {
		void loadRuntimeInfo();
		const unsub = desktopApi.onRuntimeUpdateProgress?.((p) => {
			setProgress(p);
			if (p.stage === "completed") {
				setInstalling(false);
				setStatusMessage({ type: "success", text: p.message || "内核热更新成功并已平滑生效！" });
				void loadRuntimeInfo();
			} else if (p.stage === "error") {
				setInstalling(false);
				setStatusMessage({ type: "error", text: p.message || "内核热更新失败" });
			}
		});
		return () => unsub?.();
	}, []);

	const handleCheckUpdate = async () => {
		setChecking(true);
		setStatusMessage(null);
		try {
			const result = await desktopApi.checkRuntimeUpdate();
			setCheckResult(result);
			if (!result.hasUpdate) {
				setStatusMessage({ type: "info", text: "当前内核运行时已是最新版本。" });
			}
		} catch (err: any) {
			setStatusMessage({ type: "error", text: `检查更新失败: ${err?.message || String(err)}` });
		} finally {
			setChecking(false);
		}
	};

	const handleApplyRemoteUpdate = async () => {
		if (!checkResult?.assetUrl) return;
		setInstalling(true);
		setStatusMessage(null);
		try {
			const res = await desktopApi.downloadAndApplyRuntime(checkResult.assetUrl);
			if (res.success) {
				setStatusMessage({ type: "success", text: `内核已成功热更新至 v${res.version ?? checkResult.latestVersion}！` });
				setCheckResult(null);
				await loadRuntimeInfo();
			} else {
				setStatusMessage({ type: "error", text: res.error || "热更新失败" });
			}
		} catch (err: any) {
			setStatusMessage({ type: "error", text: `热更新出错: ${err?.message || String(err)}` });
		} finally {
			setInstalling(false);
		}
	};

	const handleInstallLocalZip = async () => {
		try {
			const zipPath = await desktopApi.selectRuntimeZipFile();
			if (!zipPath) return;

			setInstalling(true);
			setStatusMessage({ type: "info", text: `正在安装本地更新包: ${zipPath}...` });
			const res = await desktopApi.installLocalRuntime(zipPath);
			if (res.success) {
				setStatusMessage({ type: "success", text: `本地内核包已成功安装生效 (v${res.version})！` });
				await loadRuntimeInfo();
			} else {
				setStatusMessage({ type: "error", text: res.error || "本地包安装失败" });
			}
		} catch (err: any) {
			setStatusMessage({ type: "error", text: `安装失败: ${err?.message || String(err)}` });
		} finally {
			setInstalling(false);
		}
	};

	const handleRollback = async () => {
		if (!confirm("确定要回滚到客户端内置的内核运行时版本吗？这将会重启守护进程。")) return;
		setRollingBack(true);
		setStatusMessage(null);
		try {
			const res = await desktopApi.rollbackRuntime();
			if (res.success) {
				setStatusMessage({ type: "success", text: "已成功回滚至客户端内置内核！" });
				await loadRuntimeInfo();
			} else {
				setStatusMessage({ type: "error", text: res.error || "回滚失败" });
			}
		} catch (err: any) {
			setStatusMessage({ type: "error", text: `回滚失败: ${err?.message || String(err)}` });
		} finally {
			setRollingBack(false);
		}
	};

	const safeTools = capabilities?.tools ?? [];

	return (
		<div className="settings-scroll-wrapper">
			{/* ── App Info Card ── */}
			<section className="settings-section-card">
				<div className="settings-section-card-header">
					<div className="settings-section-card-header-left">
						<div className="settings-section-card-icon">
							<Shield size={18} />
						</div>
						<div className="settings-section-card-title">
							<h3>关于 OpenPI Desktop</h3>
							<span>下一代全自主开源智能体编程开发工作台</span>
						</div>
					</div>
				</div>

				<div className="settings-section-card-body">
					<div className="setting-item-row">
						<div className="setting-item-meta">
							<strong>客户端版本 (Client Shell)</strong>
							<span>OpenPI Desktop v1.0.0 (Tauri 2.x + Rust Native)</span>
						</div>
						<span className="provider-badge active">正式版</span>
					</div>

					<div className="setting-item-row">
						<div className="setting-item-meta">
							<strong>开源协议与主页 (Open Source)</strong>
							<span>GitHub 社区持续维护与更新</span>
						</div>
						<a
							href="https://github.com/janehuaan/OpenPI"
							target="_blank"
							rel="noreferrer"
							className="button secondary"
							style={{ padding: "6px 12px", fontSize: "12px", display: "flex", alignItems: "center", gap: "6px", textDecoration: "none" }}
						>
							<Github size={14} />
							<span>GitHub 仓库</span>
							<ExternalLink size={12} />
						</a>
					</div>
				</div>
			</section>

			{/* ── Jev System 1 Decision Engine ── */}
			<section className="settings-section-card">
				<div className="settings-section-card-header">
					<div className="settings-section-card-header-left">
						<div className="settings-section-card-icon" style={{ color: "var(--accent, #6366f1)" }}>
							<Cpu size={18} />
						</div>
						<div className="settings-section-card-title">
							<h3>Jev 本地直觉神经决策中枢 (System 1)</h3>
							<span>毫秒级决策、全流程安全防线与智能 Token 压缩</span>
						</div>
					</div>
					<span className={`provider-badge ${jevStatus?.ready ? "active" : "standby"}`}>
						{jevStatus?.status === "Ready" ? "就绪运行中" : jevStatus?.status === "WarmingUp" ? "异步预热中" : "规则降级模式"}
					</span>
				</div>

				<div className="settings-section-card-body">
					<div className="setting-item-row">
						<div className="setting-item-meta">
							<strong>模型内核 (Neural Kernel)</strong>
							<span>{jevStatus?.engine || "ModernBERT-base (FP32 全精度)"}</span>
						</div>
						<span style={{ fontSize: "12px", color: "var(--text-muted)" }}>~55ms 极速推理 (AVX2 原生加速)</span>
					</div>

					<div className="setting-item-row">
						<div className="setting-item-meta">
							<strong>六大安全与防线支柱 (Six Pillars)</strong>
							<span>意图分流 / 双防门禁 / 日志Token压缩 / 死循环熔断 / 密钥防泄漏 / 终结裁决</span>
						</div>
						<span className="provider-badge active">全量已激活</span>
					</div>
				</div>
			</section>

			{/* ── Kernel Runtime & Independent Hot-Update ── */}
			<section className="settings-section-card">
				<div className="settings-section-card-header">
					<div className="settings-section-card-header-left">
						<div className="settings-section-card-icon">
							<Cpu size={18} />
						</div>
						<div className="settings-section-card-title">
							<h3>内核运行时与独立热更新 (Kernel Runtime)</h3>
							<span>Daemon 调度中枢与智能体引擎独立无感热升级，免除重装应用</span>
						</div>
					</div>
				</div>

				<div className="settings-section-card-body">
					{/* Status Row */}
					<div className="setting-item-row">
						<div className="setting-item-meta">
							<strong>当前内核版本 (Runtime Version)</strong>
							<span>
								版本 v{runtimeInfo?.currentVersion || "0.2.3"}
								{runtimeInfo?.piVersion ? ` (智能体引擎 v${runtimeInfo.piVersion})` : ""}
								{runtimeInfo?.gitCommit ? ` · Commit ${runtimeInfo.gitCommit}` : ""}
							</span>
						</div>
						<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
							{runtimeInfo?.isHotUpdated ? (
								<span className="provider-badge active" title={runtimeInfo.runtimePath} style={{ background: "rgba(34, 197, 94, 0.15)", color: "#22c55e", borderColor: "rgba(34, 197, 94, 0.3)" }}>
									🟢 独立热更版本 (~/.openpi/runtime)
								</span>
							) : (
								<span className="provider-badge" title={runtimeInfo?.builtInPath || "App Resources"}>
									⚪ 内置原生版本 (App Bundle)
								</span>
							)}
						</div>
					</div>

					{/* Actions Row */}
					<div className="setting-item-row" style={{ alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
						<div className="setting-item-meta" style={{ minWidth: "220px" }}>
							<strong>更新与版本维护</strong>
							<span>支持云端检查下载，或直接载入本地编译好的 .zip 离线更新包</span>
						</div>

						<div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
							<button
								type="button"
								className="button secondary"
								onClick={handleCheckUpdate}
								disabled={checking || installing || rollingBack}
								style={{ padding: "6px 12px", fontSize: "12px", display: "inline-flex", alignItems: "center", gap: "6px" }}
							>
								<RefreshCw size={13} className={checking ? "spin" : ""} />
								<span>{checking ? "检查中..." : "检查内核更新"}</span>
							</button>

							<button
								type="button"
								className="button secondary"
								onClick={handleInstallLocalZip}
								disabled={checking || installing || rollingBack}
								style={{ padding: "6px 12px", fontSize: "12px", display: "inline-flex", alignItems: "center", gap: "6px" }}
								title="选择本地打包的 openpi-runtime-*.zip 安装测试"
							>
								<Download size={13} />
								<span>本地离线包安装 (.zip)</span>
							</button>

							{runtimeInfo?.isHotUpdated && (
								<button
									type="button"
									className="button danger"
									onClick={handleRollback}
									disabled={checking || installing || rollingBack}
									style={{ padding: "6px 12px", fontSize: "12px", display: "inline-flex", alignItems: "center", gap: "6px" }}
									title="重置并立即切换回 App 原生内置的内核"
								>
									<span>{rollingBack ? "回滚中..." : "回滚至内置版本"}</span>
								</button>
							)}
						</div>
					</div>

					{/* Update Banner */}
					{checkResult?.hasUpdate && checkResult.assetUrl && (
						<div
							style={{
								padding: "12px 14px",
								borderRadius: "10px",
								background: "var(--accent-soft)",
								border: "1px solid color-mix(in srgb, var(--accent) 30%, transparent)",
								display: "flex",
								alignItems: "center",
								justifyContent: "space-between",
								gap: "12px",
								marginTop: "4px",
							}}
						>
							<div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
								<strong style={{ fontSize: "13px", color: "var(--text)" }}>
									发现内核新版本: v{checkResult.latestVersion}
								</strong>
								<span style={{ fontSize: "11.5px", color: "var(--text-secondary)" }}>
									{checkResult.assetName || "openpi-runtime.zip"}
									{checkResult.assetSize ? ` (${(checkResult.assetSize / (1024 * 1024)).toFixed(1)} MB)` : ""}
									{checkResult.publishedAt ? ` · 发布于 ${new Date(checkResult.publishedAt).toLocaleDateString()}` : ""}
								</span>
							</div>

							<button
								type="button"
								className="button primary"
								onClick={handleApplyRemoteUpdate}
								disabled={installing}
								style={{ padding: "6px 16px", fontSize: "12px", display: "inline-flex", alignItems: "center", gap: "6px" }}
							>
								<Download size={13} />
								<span>{installing ? "正在热更新..." : "一键热更新"}</span>
							</button>
						</div>
					)}

					{/* Progress Bar */}
					{installing && progress && (
						<div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "6px", padding: "10px 12px", borderRadius: "8px", background: "var(--bg-muted)" }}>
							<div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
								<span style={{ color: "var(--text)" }}>{progress.message || "正在处理..."}</span>
								<span style={{ color: "var(--text-secondary)", fontWeight: 600 }}>{progress.percent}%</span>
							</div>
							<div style={{ width: "100%", height: "6px", borderRadius: "999px", background: "var(--border)", overflow: "hidden" }}>
								<div
									style={{
										width: `${progress.percent}%`,
										height: "100%",
										background: "var(--accent)",
										transition: "width 200ms ease",
									}}
								/>
							</div>
						</div>
					)}

					{/* Status Message */}
					{statusMessage && (
						<div
							style={{
								padding: "8px 12px",
								borderRadius: "8px",
								fontSize: "12px",
								marginTop: "4px",
								background:
									statusMessage.type === "success"
										? "rgba(34, 197, 94, 0.12)"
										: statusMessage.type === "error"
										? "rgba(239, 68, 68, 0.12)"
										: "var(--bg-muted)",
								color:
									statusMessage.type === "success"
										? "#22c55e"
										: statusMessage.type === "error"
										? "#ef4444"
										: "var(--text-secondary)",
								border: `1px solid ${
									statusMessage.type === "success"
										? "rgba(34, 197, 94, 0.25)"
										: statusMessage.type === "error"
										? "rgba(239, 68, 68, 0.25)"
										: "var(--border)"
								}`,
							}}
						>
							{statusMessage.text}
						</div>
					)}
				</div>
			</section>

			{/* ── System Diagnostics & Underlying Tools ── */}
			<section className="settings-section-card">
				<div
					className="settings-section-card-header"
					style={{ cursor: "pointer", userSelect: "none" }}
					onClick={() => setToolsExpanded(!toolsExpanded)}
				>
					<div className="settings-section-card-header-left">
						<div className="settings-section-card-icon">
							<Wrench size={18} />
						</div>
						<div className="settings-section-card-title">
							<h3>系统底层工具清单 ({safeTools.length})</h3>
							<span>内核挂载的代码分析、文件编辑、系统调用等核心基础能力</span>
						</div>
					</div>

					<div style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--text-tertiary)" }}>
						<span style={{ fontSize: "12px" }}>{toolsExpanded ? "收起" : "展开诊断"}</span>
						{toolsExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
					</div>
				</div>

				{toolsExpanded && (
					<div className="settings-section-card-body" style={{ background: "var(--bg-muted)" }}>
						{safeTools.length === 0 ? (
							<div style={{ textAlign: "center", padding: "16px", color: "var(--text-tertiary)", fontSize: "12px" }}>
								暂无挂载工具
							</div>
						) : (
							<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "8px" }}>
								{safeTools.map((tool) => (
									<div
										key={tool.name}
										style={{
											padding: "8px 12px",
											borderRadius: "8px",
											border: "1px solid var(--border)",
											background: "var(--bg)",
											display: "flex",
											flexDirection: "column",
											gap: "3px",
										}}
									>
										<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
											<strong style={{ fontSize: "12px", color: "var(--text)", fontFamily: "ui-monospace, monospace" }}>
												{tool.name}
											</strong>
											<span style={{ fontSize: "10px", padding: "1px 4px", borderRadius: "3px", background: "var(--border)", color: "var(--text-tertiary)" }}>
												内置
											</span>
										</div>
										<span style={{ fontSize: "11px", color: "var(--text-tertiary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={tool.description}>
											{tool.description}
										</span>
									</div>
								))}
							</div>
						)}
					</div>
				)}
			</section>
		</div>
	);
};
