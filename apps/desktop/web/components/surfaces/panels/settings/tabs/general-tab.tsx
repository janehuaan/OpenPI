import { type FC, useCallback, useEffect, useState } from "react";
import { desktopApi } from "../../../../../api";
import {
	Bell,
	Bot,
	Check,
	Globe,
	History,
	Monitor,
	Moon,
	Palette,
	RefreshCw,
	Save,
	Sliders,
	Sun,
	Terminal,
	UserRound,
	Zap,
} from "../../../../icons";
import type { AppSettings } from "../../../../../lib/app-types";
import {
	useTheme,
	THEME_PRESETS,
	type ThemeMode,
	type ThemeFlavor,
} from "../../../../../lib/theme-manager";

interface GeneralTabProps {
	instanceId?: string;
	onReload?: () => Promise<void>;
}

export const GeneralTab: FC<GeneralTabProps> = ({ instanceId, onReload }) => {
	const {
		mode: themeMode,
		flavor: themeFlavor,
		effectiveMode,
		setMode: setThemeMode,
		setFlavor: setThemeFlavor,
		setTheme,
	} = useTheme();
	const [settings, setSettings] = useState<AppSettings>({});
	const [loading, setLoading] = useState(false);
	const [saving, setSaving] = useState(false);
	const [saveToast, setSaveToast] = useState<string | null>(null);

	// Fields
	const [defaultMode, setDefaultMode] = useState<"chat" | "code" | "personal">("code");
	const [autoCompact, setAutoCompact] = useState(true);
	const [reserveTokens, setReserveTokens] = useState(16384);
	const [autoMemory, setAutoMemory] = useState(true);
	const [desktopNotifications, setDesktopNotifications] = useState(true);
	const [notificationThresholdSec, setNotificationThresholdSec] = useState(5);
	const [httpProxy, setHttpProxy] = useState("");

	const loadSettings = useCallback(async () => {
		setLoading(true);
		try {
			const s = await desktopApi.getAppSettings();
			setSettings(s);
			if (s.defaultMode) setDefaultMode(s.defaultMode);
			if (s.autoCompact !== undefined) setAutoCompact(Boolean(s.autoCompact));
			if (s.reserveTokens) setReserveTokens(s.reserveTokens);
			if (s.autoMemory !== undefined) setAutoMemory(Boolean(s.autoMemory));
			if (s.desktopNotifications !== undefined) setDesktopNotifications(Boolean(s.desktopNotifications));
			if (s.notificationThresholdSec) setNotificationThresholdSec(s.notificationThresholdSec);
			if (s.httpProxy) setHttpProxy(s.httpProxy);
		} catch (err) {
			console.error("Failed to load settings", err);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void loadSettings();
	}, [loadSettings]);

	const handleSave = async (overrides?: Partial<AppSettings>) => {
		setSaving(true);
		try {
			const payload: AppSettings = {
				...settings,
				defaultMode: overrides?.defaultMode ?? defaultMode,
				autoCompact: overrides?.autoCompact ?? autoCompact,
				reserveTokens: overrides?.reserveTokens ?? reserveTokens,
				autoMemory: overrides?.autoMemory ?? autoMemory,
				desktopNotifications: overrides?.desktopNotifications ?? desktopNotifications,
				notificationThresholdSec: overrides?.notificationThresholdSec ?? notificationThresholdSec,
				httpProxy: overrides?.httpProxy ?? (httpProxy.trim() || undefined),
			};
			await desktopApi.updateAppSettings(payload);
			setSettings(payload);
			setSaveToast("设置已保存并即时生效");
			setTimeout(() => setSaveToast(null), 2500);
			window.dispatchEvent(new Event("openpi:app-settings-changed"));
		} catch (err) {
			setSaveToast(`保存失败: ${err instanceof Error ? err.message : String(err)}`);
		} finally {
			setSaving(false);
		}
	};

	if (loading) {
		return (
			<div className="product-empty">
				<RefreshCw size={24} className="spin" />
				<strong>加载偏好设置中…</strong>
			</div>
		);
	}

	return (
		<div className="settings-scroll-wrapper">
			{/* Save Notice Banner if exists */}
			{saveToast && (
				<div style={{ padding: "10px 16px", borderRadius: "8px", background: "color-mix(in srgb, var(--accent) 15%, transparent)", color: "var(--accent)", fontSize: "13px", fontWeight: 550, display: "flex", alignItems: "center", gap: "8px" }}>
					<Check size={14} />
					<span>{saveToast}</span>
				</div>
			)}

			{/* ── 0. Appearance & Theme ── */}
			<section className="settings-section-card">
				<div className="settings-section-card-header">
					<div className="settings-section-card-header-left">
						<div className="settings-section-card-icon">
							<Palette size={18} />
						</div>
						<div className="settings-section-card-title">
							<h3>外观与主题系统 (Appearance & Theme)</h3>
							<span>全场景自适应色彩、极客暗黑、OLED 纯黑与经典浅色调色盘</span>
						</div>
					</div>
				</div>

				<div className="settings-section-card-body">
					{/* Mode Selector */}
					<div className="theme-modes-grid">
						{[
							{
								id: "system" as ThemeMode,
								label: "跟随系统 (Auto)",
								icon: Monitor,
								desc: "自适应 macOS 外观偏好，暗浅平滑自动联动",
							},
							{
								id: "dark" as ThemeMode,
								label: "深色模式 (Dark)",
								icon: Moon,
								desc: "沉浸暗黑与黑曜玻璃，护眼不刺眼",
							},
							{
								id: "light" as ThemeMode,
								label: "浅色模式 (Light)",
								icon: Sun,
								desc: "清晰明快纸本素雅，日间办公专注首选",
							},
						].map((item) => {
							const Icon = item.icon;
							const isActive = themeMode === item.id;
							return (
								<button
									key={item.id}
									type="button"
									className={`theme-mode-card ${isActive ? "active" : ""}`}
									onClick={() => setThemeMode(item.id)}
								>
									<div className="theme-mode-card-icon">
										<Icon size={16} />
									</div>
									<div className="theme-mode-card-meta">
										<strong>{item.label}</strong>
										<span>{item.desc}</span>
									</div>
								</button>
							);
						})}
					</div>

					{/* Theme Flavor Galleries: Clean Dark & Light Sections */}
					<div style={{ marginTop: "12px", display: "flex", flexDirection: "column", gap: "18px" }}>
						{/* Dark Palettes */}
						<div>
							<div style={{ fontSize: "12px", fontWeight: 650, color: "var(--text-secondary)", marginBottom: "10px", display: "flex", alignItems: "center", gap: "6px" }}>
								<Moon size={14} style={{ color: "var(--accent)" }} />
								<span>深色调色盘 (Dark Flavors)</span>
								<span style={{ fontSize: "11px", color: "var(--text-tertiary)", fontWeight: 400 }}>· 4 款极客护眼与实体配色</span>
							</div>
							<div className="theme-flavors-grid">
								{THEME_PRESETS.filter((p) => p.mode === "dark").map((preset) => {
									const isSelected = effectiveMode === "dark" && themeFlavor === preset.id;
									return (
										<button
											key={preset.id}
											type="button"
											className={`theme-flavor-card ${isSelected ? "active" : ""}`}
											onClick={() => {
												setTheme({ mode: preset.mode, flavor: preset.id });
											}}
										>
											<div
												className="theme-flavor-preview"
												style={{
													background: preset.swatches.bg,
													borderColor: isSelected ? "var(--accent)" : "rgba(255, 255, 255, 0.12)",
												}}
											>
												<div className="theme-flavor-preview-dots">
													<span className="theme-flavor-dot" style={{ background: preset.swatches.accent }} />
													<span className="theme-flavor-dot" style={{ background: preset.swatches.text }} />
													<span style={{ marginLeft: "auto", fontSize: "10px", fontWeight: 600, color: preset.swatches.accent, opacity: 0.9 }}>
														{preset.tag}
													</span>
												</div>
												<div
													className="theme-flavor-preview-content"
													style={{
														background: preset.swatches.elevated,
														borderColor: preset.swatches.accent,
													}}
												>
													<span
														className="theme-flavor-pill"
														style={{ background: preset.swatches.text, opacity: 0.7 }}
													/>
													<span
														className="theme-flavor-accent-badge"
														style={{ background: preset.swatches.accent }}
													/>
												</div>
											</div>
											<div className="theme-flavor-info">
												<div className="theme-flavor-header">
													<strong>{preset.name}</strong>
													{isSelected && (
														<span className="theme-flavor-check">
															<Check size={11} />
														</span>
													)}
												</div>
												<p>{preset.desc}</p>
											</div>
										</button>
									);
								})}
							</div>
						</div>

						{/* Light Palettes */}
						<div>
							<div style={{ fontSize: "12px", fontWeight: 650, color: "var(--text-secondary)", marginBottom: "10px", display: "flex", alignItems: "center", gap: "6px" }}>
								<Sun size={14} style={{ color: "var(--warn)" }} />
								<span>浅色调色盘 (Light Flavors)</span>
								<span style={{ fontSize: "11px", color: "var(--text-tertiary)", fontWeight: 400 }}>· 3 款日间素雅与纸本舒适</span>
							</div>
							<div className="theme-flavors-grid">
								{THEME_PRESETS.filter((p) => p.mode === "light").map((preset) => {
									const isSelected = effectiveMode === "light" && themeFlavor === preset.id;
									return (
										<button
											key={preset.id}
											type="button"
											className={`theme-flavor-card ${isSelected ? "active" : ""}`}
											onClick={() => {
												setTheme({ mode: preset.mode, flavor: preset.id });
											}}
										>
											<div
												className="theme-flavor-preview"
												style={{
													background: preset.swatches.bg,
													borderColor: isSelected ? "var(--accent)" : "rgba(0, 0, 0, 0.10)",
												}}
											>
												<div className="theme-flavor-preview-dots">
													<span className="theme-flavor-dot" style={{ background: preset.swatches.accent }} />
													<span className="theme-flavor-dot" style={{ background: preset.swatches.text }} />
													<span style={{ marginLeft: "auto", fontSize: "10px", fontWeight: 600, color: preset.swatches.accent, opacity: 0.9 }}>
														{preset.tag}
													</span>
												</div>
												<div
													className="theme-flavor-preview-content"
													style={{
														background: preset.swatches.elevated,
														borderColor: preset.swatches.accent,
													}}
												>
													<span
														className="theme-flavor-pill"
														style={{ background: preset.swatches.text, opacity: 0.7 }}
													/>
													<span
														className="theme-flavor-accent-badge"
														style={{ background: preset.swatches.accent }}
													/>
												</div>
											</div>
											<div className="theme-flavor-info">
												<div className="theme-flavor-header">
													<strong>{preset.name}</strong>
													{isSelected && (
														<span className="theme-flavor-check">
															<Check size={11} />
														</span>
													)}
												</div>
												<p>{preset.desc}</p>
											</div>
										</button>
									);
								})}
							</div>
						</div>
					</div>
				</div>
			</section>

			{/* ── 1. Workspace Modes ── */}
			<section className="settings-section-card">
				<div className="settings-section-card-header">
					<div className="settings-section-card-header-left">
						<div className="settings-section-card-icon">
							<Bot size={18} />
						</div>
						<div className="settings-section-card-title">
							<h3>默认工作空间模式 (Workspace Mode)</h3>
							<span>新建会话时默认启用的智能体行为模式与工具配置</span>
						</div>
					</div>
				</div>

				<div className="settings-section-card-body">
					<div className="workspace-modes-grid">
						{[
							{
								id: "chat",
								label: "Chat 通用模式",
								icon: Bot,
								desc: "通用智能助手，适合常规沟通、日常问答与多工具协同。",
							},
							{
								id: "code",
								label: "Code 编程模式",
								icon: Terminal,
								desc: "专属工程开发模式，开箱配备文件读写、Bash 执行、Grep 等全套编程工具。",
							},
							{
								id: "personal",
								label: "Personal 个人模式",
								icon: UserRound,
								desc: "专属个人私密工作空间，深度融合长期记忆沉淀与个性化沟通风格。",
							},
						].map((item) => {
							const Icon = item.icon;
							const isActive = defaultMode === item.id;
							return (
								<button
									key={item.id}
									type="button"
									className={`workspace-mode-card ${isActive ? "active" : ""}`}
									onClick={() => {
										const nextMode = item.id as "chat" | "code" | "personal";
										setDefaultMode(nextMode);
										void handleSave({ defaultMode: nextMode });
									}}
								>
									<div className="workspace-mode-card-header">
										<Icon size={16} style={{ color: isActive ? "var(--accent)" : "var(--text-secondary)" }} />
										<strong>{item.label}</strong>
									</div>
									<p>{item.desc}</p>
								</button>
							);
						})}
					</div>
				</div>
			</section>

			{/* ── 2. Context & Memory ── */}
			<section className="settings-section-card">
				<div className="settings-section-card-header">
					<div className="settings-section-card-header-left">
						<div className="settings-section-card-icon">
							<History size={18} />
						</div>
						<div className="settings-section-card-title">
							<h3>上下文与记忆管理 (Context & Memory)</h3>
							<span>管理长文本会话的自动压缩衰减与跨会话长期记忆提取</span>
						</div>
					</div>
				</div>

				<div className="settings-section-card-body">
					<div className="setting-item-row">
						<div className="setting-item-meta">
							<strong>自动压缩超长会话 (Auto Compaction)</strong>
							<span>当会话上下文接近模型上限时，自动精炼总结历史轮次以保持流畅交互</span>
						</div>
						<div className="setting-item-control">
							<label className="modern-switch">
								<input
									type="checkbox"
									checked={autoCompact}
									onChange={(e) => {
										setAutoCompact(e.target.checked);
										void handleSave({ autoCompact: e.target.checked });
									}}
								/>
								<span className="modern-slider" />
							</label>
						</div>
					</div>

					<div className="setting-item-row">
						<div className="setting-item-meta">
							<strong>保留安全缓冲区 Tokens (Reserve Tokens)</strong>
							<span>为模型生成输出及系统提示词预留的保底上下文窗口配额</span>
						</div>
						<div className="setting-item-control">
							<select
								value={reserveTokens}
								onChange={(e) => {
									const val = Number(e.target.value);
									setReserveTokens(val);
									void handleSave({ reserveTokens: val });
								}}
								style={{ padding: "6px 12px", borderRadius: "8px", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: "13px" }}
							>
								<option value={8192}>8K (8,192 Tokens)</option>
								<option value={16384}>16K (16,384 Tokens) · 推荐</option>
								<option value={32768}>32K (32,768 Tokens)</option>
								<option value={65536}>64K (65,536 Tokens)</option>
							</select>
						</div>
					</div>

					<div className="setting-item-row">
						<div className="setting-item-meta">
							<strong>自动沉淀长期记忆 (Auto Memory)</strong>
							<span>会话过程中自动提取你的工作习惯、编码偏好及重要项目背景并持久化</span>
						</div>
						<div className="setting-item-control">
							<label className="modern-switch">
								<input
									type="checkbox"
									checked={autoMemory}
									onChange={(e) => {
										setAutoMemory(e.target.checked);
										void handleSave({ autoMemory: e.target.checked });
									}}
								/>
								<span className="modern-slider" />
							</label>
						</div>
					</div>
				</div>
			</section>

			{/* ── 3. Desktop & Network ── */}
			<section className="settings-section-card">
				<div className="settings-section-card-header">
					<div className="settings-section-card-header-left">
						<div className="settings-section-card-icon">
							<Globe size={18} />
						</div>
						<div className="settings-section-card-title">
							<h3>系统通知与全局代理 (System & Network)</h3>
							<span>配置 macOS 桌面系统级通知提醒与外部网络代理通道</span>
						</div>
					</div>
				</div>

				<div className="settings-section-card-body">
					<div className="setting-item-row">
						<div className="setting-item-meta">
							<strong>桌面任务完成系统通知</strong>
							<span>当智能体在后台完成复杂任务或长时间运行结束时弹出 macOS 通知提醒</span>
						</div>
						<div className="setting-item-control">
							<label className="modern-switch">
								<input
									type="checkbox"
									checked={desktopNotifications}
									onChange={(e) => {
										setDesktopNotifications(e.target.checked);
										void handleSave({ desktopNotifications: e.target.checked });
									}}
								/>
								<span className="modern-slider" />
							</label>
						</div>
					</div>

					{desktopNotifications && (
						<div className="setting-item-row">
							<div className="setting-item-meta">
								<strong>触发通知时长阈值</strong>
								<span>仅当任务耗时超过此时长时才发出系统通知（避免简短问答频繁打扰）</span>
							</div>
							<div className="setting-item-control">
								<select
									value={notificationThresholdSec}
									onChange={(e) => {
										const val = Number(e.target.value);
										setNotificationThresholdSec(val);
										void handleSave({ notificationThresholdSec: val });
									}}
									style={{ padding: "6px 12px", borderRadius: "8px", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: "13px" }}
								>
									<option value={3}>3 秒</option>
									<option value={5}>5 秒 (默认)</option>
									<option value={10}>10 秒</option>
									<option value={30}>30 秒</option>
								</select>
							</div>
						</div>
					)}

					<div className="setting-item-row" style={{ alignItems: "flex-start" }}>
						<div className="setting-item-meta" style={{ flex: 1 }}>
							<strong>全局网络 HTTP/SOCKS 代理</strong>
							<span>配置 AI 模型接口与扩展市场的专用代理地址（留空则直连）</span>
							<div style={{ display: "flex", gap: "10px", marginTop: "8px" }}>
								<input
									type="text"
									placeholder="例如 http://127.0.0.1:7890 或 socks5://127.0.0.1:1080"
									value={httpProxy}
									onChange={(e) => setHttpProxy(e.target.value)}
									style={{ flex: 1, padding: "8px 12px", borderRadius: "8px", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: "12px", fontFamily: "ui-monospace, monospace" }}
								/>
								<button
									type="button"
									className="button primary"
									style={{ padding: "0 16px" }}
									disabled={saving}
									onClick={() => void handleSave()}
								>
									<span>{saving ? "保存中…" : "保存代理"}</span>
								</button>
							</div>
						</div>
					</div>
				</div>
			</section>
		</div>
	);
};
