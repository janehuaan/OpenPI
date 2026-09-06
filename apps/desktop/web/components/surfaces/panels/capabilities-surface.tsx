import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { desktopApi } from "../../../api";
import {
	ArrowLeft,
	Bell,
	Blocks,
	BookOpen,
	Bot,
	Cable,
	Check,
	ChevronDown,
	ChevronRight,
	Copy,
	Cpu,
	Download,
	ExternalLink,
	Github,
	Image as ImageIcon,
	LogIn,
	Menu,
	Package,
	Pencil,
	Plus,
	RefreshCw,
	Save,
	Search,
	Server,
	Sliders,
	Sparkles,
	Store,
	TerminalSquare,
	Trash2,
	UserRound,
	WandSparkles,
	Wrench,
	X,
	Zap,
} from "../../icons.tsx";
import { LOCAL_SLASH, instanceTitle } from "../../../lib/helpers";
import type { AppSettings, CapabilityTab, ModelProviderConfig } from "../../../lib/app-types";
import {
	MARKETPLACE_PACKAGES,
	type MarketplaceKind,
	type MarketplacePackage,
	MCP_ADAPTER_MARKETPLACE_PACKAGE,
} from "../../../marketplace";
import type {
	AvailableModel,
	ConversationCapabilities,
	ConversationSnapshot,
	ProviderPingResult,
	VisionFallbackConfig,
	VisionFallbackModel,
} from "../../../types";

const API_TYPE_OPTIONS = [
	{ value: "openai-completions", label: "OpenAI Completions" },
	{ value: "anthropic-messages", label: "Anthropic Messages" },
	{ value: "openai-responses", label: "OpenAI Responses" },
] as const;

interface ModelTableEntry {
	id: string;
	name: string;
	contextWindow?: number;
	maxTokens?: number;
	cost?: {
		input?: number;
		output?: number;
	};
}

/** Built-in provider IDs known to the agent runtime (pi-ai KnownProvider list). */
const BUILTIN_PROVIDER_IDS: ReadonlySet<string> = new Set([
	"amazon-bedrock",
	"ant-ling",
	"anthropic",
	"google",
	"google-vertex",
	"openai",
	"azure-openai-responses",
	"openai-codex",
	"radius",
	"nvidia",
	"deepseek",
	"github-copilot",
	"xai",
	"groq",
	"cerebras",
	"openrouter",
	"vercel-ai-gateway",
	"zai",
	"zai-coding-cn",
	"mistral",
	"minimax",
	"minimax-cn",
	"moonshotai",
	"moonshotai-cn",
	"huggingface",
	"fireworks",
	"together",
	"opencode",
	"opencode-go",
	"kimi-coding",
	"cloudflare-workers-ai",
	"cloudflare-ai-gateway",
	"xiaomi",
	"xiaomi-token-plan-cn",
	"xiaomi-token-plan-ams",
	"xiaomi-token-plan-sgp",
]);

function formatTokenCount(value: number): string {
	if (value >= 1_000_000) {
		const millions = value / 1_000_000;
		return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M`;
	}
	return `${Math.round(value / 1000)}K`;
}

function ModelCatalogTable({
	models,
	providerId,
	defaultModel,
	onSetDefault,
}: {
	models: ModelTableEntry[];
	providerId?: string;
	defaultModel?: string;
	onSetDefault?(modelId: string, providerId?: string): void;
}) {
	return (
		<table className="model-catalog-table">
			<thead>
				<tr>
					<th>Model</th>
					<th>Context</th>
					<th>Max Output</th>
					<th>Input $/M</th>
					<th>Output $/M</th>
					{onSetDefault && <th>Default</th>}
				</tr>
			</thead>
			<tbody>
				{models.map((model, mIdx) => {
					const isDefault =
						defaultModel === model.id || (providerId && defaultModel === `${providerId}/${model.id}`);
					return (
						<tr key={`model-${model.id || ""}-${mIdx}`}>
							<td>
								<div className="model-catalog-name-cell">
									<strong>{model.name || model.id}</strong>
									{isDefault && <span className="model-default-pill">Default</span>}
								</div>
							</td>
							<td>{model.contextWindow ? formatTokenCount(model.contextWindow) : "—"}</td>
							<td>{model.maxTokens ? formatTokenCount(model.maxTokens) : "—"}</td>
							<td>{model.cost?.input != null ? `$${model.cost.input}` : "—"}</td>
							<td>{model.cost?.output != null ? `$${model.cost.output}` : "—"}</td>
							{onSetDefault && (
								<td>
									{isDefault ? (
										<span className="model-default-active-tag">Active</span>
									) : (
										<button
											type="button"
											className="model-set-default-btn"
											onClick={() => onSetDefault(model.id, providerId)}
										>
											Set Default
										</button>
									)}
								</td>
							)}
						</tr>
					);
				})}
			</tbody>
		</table>
	);
}

function providerDisplayName(providerId: string, models: AvailableModel[], config?: ModelProviderConfig): string {
	return config?.name || models.find((model) => model.name)?.provider || providerId;
}

function providerDefaultBaseUrl(models: AvailableModel[]): string | undefined {
	return models.find((model) => model.baseUrl)?.baseUrl;
}

function providerDefaultApi(models: AvailableModel[]): string {
	return models.find((model) => model.api)?.api ?? "openai-completions";
}

function VisionFallbackPanel({ onSaved }: { onSaved(): Promise<void> | void }) {
	const [config, setConfig] = useState<VisionFallbackConfig>();
	const [models, setModels] = useState<VisionFallbackModel[]>([]);
	const [apiKey, setApiKey] = useState("");
	const [model, setModel] = useState("glm-4.6v-flash");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string>();

	const refresh = useCallback(async (): Promise<void> => {
		try {
			const next = await desktopApi.getVisionFallback();
			setConfig(next);
			setModel(next.model);
			if (next.configured) {
				setModels(await desktopApi.getVisionFallbackModels());
			} else {
				setModels([]);
			}
			setError(undefined);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		}
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const save = async (): Promise<void> => {
		setSaving(true);
		try {
			const next = await desktopApi.configureVisionFallback({
				enabled: config?.enabled !== false,
				model,
				...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
			});
			setConfig(next);
			setModel(next.model);
			setApiKey("");
			setError(undefined);
			setModels(await desktopApi.getVisionFallbackModels());
			await onSaved();
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setSaving(false);
		}
	};

	const toggle = async (): Promise<void> => {
		if (!config?.configured) {
			setError("请先输入智谱 API Key");
			return;
		}
		setSaving(true);
		try {
			setConfig(await desktopApi.configureVisionFallback({ enabled: !config.enabled, model }));
			setError(undefined);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setSaving(false);
		}
	};

	return (
		<section className="vision-fallback-panel">
			<div className="vision-fallback-heading">
				<span className="vision-fallback-icon">
					<ImageIcon size={17} />
				</span>
				<div>
					<strong>智谱视觉补全</strong>
					<span>GLM-4.6V-Flash 为不支持图片的模型提供识图与 OCR</span>
				</div>
				<button
					type="button"
					className={`vision-fallback-toggle ${config?.enabled ? "active" : ""}`}
					aria-label={config?.enabled ? "关闭视觉补全" : "开启视觉补全"}
					title={config?.enabled ? "关闭视觉补全" : "开启视觉补全"}
					disabled={saving || !config?.configured}
					onClick={() => void toggle()}
				>
					<i />
				</button>
			</div>
			<div className="vision-fallback-body">
				<label className="model-form-field">
					<span>智谱 API Key</span>
					<input
						type="password"
						value={apiKey ?? ""}
						placeholder={config?.configured ? "已配置，留空则不修改" : "输入 API Key"}
						onChange={(event) => setApiKey(event.target.value)}
					/>
				</label>
				<label className="model-form-field">
					<span>视觉模型</span>
					<select
						value={model ?? "glm-4.6v-flash"}
						disabled={!config?.configured && !apiKey.trim()}
						onChange={(event) => setModel(event.target.value)}
					>
						{(models.length > 0
							? models
							: [
									{
										id: "glm-4.6v-flash",
										name: "GLM-4.6V Flash",
										inputPrice: 0,
										outputPrice: 0,
										priceLabel: "免费",
									},
								]
						).map((option) => (
							<option key={option.id} value={option.id}>
								{option.name} · {option.priceLabel}
							</option>
						))}
					</select>
				</label>
				<button
					type="button"
					className="primary"
					disabled={saving || (!apiKey.trim() && !config?.configured)}
					onClick={() => void save()}
				>
					{saving ? "保存中…" : config?.configured ? "更新配置" : "启用视觉补全"}
					<Save size={14} />
				</button>
			</div>
			{config?.configured && (
				<p className="vision-fallback-status">
					{config.enabled ? "已启用" : "已关闭"} · 图片发送给纯文本模型时将先由 GLM-4.6V-Flash 解析。
				</p>
			)}
			{error && <p className="vision-fallback-error">{error}</p>}
		</section>
	);
}

function GeneralSettingsPanel({
	instanceId,
	onReload,
}: {
	instanceId?: string;
	onReload?(): Promise<void> | void;
}) {
	const [providers, setProviders] = useState<Record<string, ModelProviderConfig>>({});
	const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
	const [initialLoaded, setInitialLoaded] = useState(false);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [saveNotice, setSaveNotice] = useState<string | null>(null);

	// Settings state
	const [defaultProvider, setDefaultProvider] = useState("");
	const [defaultModel, setDefaultModel] = useState("");
	const [defaultThinkingLevel, setDefaultThinkingLevel] = useState("off");
	const [defaultMode, setDefaultMode] = useState<"chat" | "code" | "personal">("chat");
	const [autoCompact, setAutoCompact] = useState(true);
	const [reserveTokens, setReserveTokens] = useState(16384);
	const [autoMemory, setAutoMemory] = useState(true);
	const [desktopNotifications, setDesktopNotifications] = useState(true);
	const [notificationThresholdSec, setNotificationThresholdSec] = useState(5);
	const [httpProxy, setHttpProxy] = useState("");

	// User Profile state
	const [nickname, setNickname] = useState("");
	const [avatarEmoji, setAvatarEmoji] = useState("");

	const loadData = useCallback(async (isInitial = false) => {
		if (isInitial) setLoading(true);
		try {
			const [appSettings, provs, models, profile] = await Promise.all([
				desktopApi.getAppSettings().catch(() => ({} as AppSettings)),
				desktopApi.getModelProviders().catch(() => ({})),
				instanceId ? desktopApi.getAvailableModels(instanceId).catch(() => []) : Promise.resolve([]),
				desktopApi.getUserProfile().catch(() => undefined),
			]);
			setProviders(provs);
			setAvailableModels(models);

			const pKeys = Object.keys(provs);
			setDefaultProvider(appSettings.defaultProvider || (pKeys.length > 0 ? pKeys[0] : ""));
			setDefaultModel(appSettings.defaultModel || "");
			setDefaultThinkingLevel(appSettings.defaultThinkingLevel || "off");
			setDefaultMode(appSettings.defaultMode || "chat");
			setAutoCompact(appSettings.autoCompact !== false);
			setReserveTokens(appSettings.reserveTokens || 16384);
			setAutoMemory(appSettings.autoMemory !== false);
			setDesktopNotifications(appSettings.desktopNotifications !== false);
			setNotificationThresholdSec(appSettings.notificationThresholdSec || 5);
			setHttpProxy(appSettings.httpProxy || "");

			setNickname(profile?.nickname || "");
			setAvatarEmoji(profile?.avatarEmoji || "");
		} finally {
			setLoading(false);
			setInitialLoaded(true);
		}
	}, [instanceId]);

	useEffect(() => {
		void loadData(true);
	}, [loadData]);

	useEffect(() => {
		const handleRefresh = () => {
			void loadData(false);
		};
		window.addEventListener("openpi:refresh-settings", handleRefresh);
		return () => window.removeEventListener("openpi:refresh-settings", handleRefresh);
	}, [loadData]);

	// Filter models for selected provider
	const modelsForProvider = useMemo(() => {
		if (!defaultProvider) return [];
		const prov = providers[defaultProvider];
		if (prov?.models && prov.models.length > 0) {
			return prov.models.map((m) =>
				typeof m === "string" ? { id: m, name: m } : { id: m.id, name: m.name || m.id },
			);
		}
		return availableModels
			.filter((m) => m.provider === defaultProvider)
			.map((m) => ({ id: m.id, name: m.name || m.id }));
	}, [defaultProvider, providers, availableModels]);

	const handleSave = async () => {
		setSaving(true);
		try {
			await Promise.all([
				desktopApi.updateAppSettings({
					defaultProvider: defaultProvider || undefined,
					defaultModel: defaultModel || undefined,
					defaultThinkingLevel,
					defaultMode,
					autoCompact,
					reserveTokens: Number(reserveTokens) || 16384,
					autoMemory,
					desktopNotifications,
					notificationThresholdSec: Number(notificationThresholdSec) || 5,
					httpProxy: httpProxy.trim() || undefined,
				}),
				desktopApi.saveUserProfile({
					nickname: nickname.trim() || undefined,
					avatarEmoji: avatarEmoji.trim() || undefined,
				}),
			]);
			setSaveNotice("已保存 ✓");
			window.dispatchEvent(new Event("openpi:app-settings-changed"));
			setTimeout(() => setSaveNotice(null), 2500);
			if (onReload) await onReload();
		} catch (err) {
			setSaveNotice(`保存失败: ${err instanceof Error ? err.message : String(err)}`);
		} finally {
			setSaving(false);
		}
	};

	const thinkingLevels: Array<{ id: string; label: string; hint: string }> = [
		{ id: "off", label: "Off (关闭)", hint: "快速响应，不消耗思考预算" },
		{ id: "low", label: "Low (轻度)", hint: "轻量级思考推理 (~4k tokens)" },
		{ id: "medium", label: "Medium (标准)", hint: "标准深度推理 (~10k tokens)" },
		{ id: "high", label: "High (深度)", hint: "深度推理分析 (~32k tokens)" },
		{ id: "max", label: "Max (极客)", hint: "满额思考预算" },
	];

	const workspaceModes: Array<{ id: "chat" | "code" | "personal"; label: string; desc: string }> = [
		{ id: "chat", label: "Chat 通用模式", desc: "通用 AI 助手，支持完整工具套件" },
		{ id: "code", label: "Code 编程模式", desc: "专属编程开发 Agent (read, bash, edit, write, grep)" },
		{ id: "personal", label: "Personal 个人模式", desc: "私人工作空间，深度融入长期记忆与习惯" },
	];

	if (!initialLoaded && loading) {
		return (
			<div className="product-empty">
				<RefreshCw size={24} className="spin" />
				<strong>加载设置中…</strong>
			</div>
		);
	}

	return (
		<div className="general-settings-panel">
			{/* Top Bar with Quick Save Action */}
			<div className="general-settings-topbar">
				<div>
					<strong>偏好首选项</strong>
					<span>保存后即刻生效并持久化到 settings.json</span>
				</div>
				<div className="general-settings-topbar-actions">
					{saveNotice && <span className="save-notice-text">{saveNotice}</span>}
					<button
						type="button"
						className="button primary settings-save-btn"
						disabled={saving}
						onClick={() => void handleSave()}
					>
						{saving ? <RefreshCw size={14} className="spin" /> : <Save size={14} />}
						<span>{saving ? "保存中…" : "保存设置"}</span>
					</button>
				</div>
			</div>

			{/* Model & Thinking Defaults */}
			<section className="settings-card">
				<div className="settings-card-header">
					<div className="settings-card-icon">
						<Cpu size={18} />
					</div>
					<div>
						<h3>模型与推理默认配置</h3>
						<p>新建会话时默认使用的服务商、模型及思考预算 (/model, /thinking)</p>
					</div>
				</div>
				<div className="settings-card-body">
					<div className="settings-form-row">
						<label className="model-form-field">
							<span>默认服务商 (Default Provider)</span>
							<select
								value={defaultProvider ?? ""}
								onChange={(e) => {
									const nextP = e.target.value;
									setDefaultProvider(nextP);
									const prov = providers[nextP];
									const m = prov?.models?.[0];
									if (m) {
										setDefaultModel(typeof m === "string" ? m : m.id);
									}
								}}
							>
								{Object.keys(providers).length === 0 && <option value="">(未配置服务商)</option>}
								{Object.keys(providers).map((p) => (
									<option key={p} value={p}>
										{providers[p]?.name || p}
									</option>
								))}
							</select>
						</label>

						<label className="model-form-field">
							<span>默认模型 (Default Model)</span>
							{modelsForProvider.length > 0 ? (
								<select value={defaultModel ?? ""} onChange={(e) => setDefaultModel(e.target.value)}>
									{!modelsForProvider.some((m) => m.id === defaultModel) && defaultModel && (
										<option value={defaultModel}>{defaultModel} (自定义)</option>
									)}
									{modelsForProvider.map((m) => (
										<option key={m.id} value={m.id}>
											{m.name}
										</option>
									))}
								</select>
							) : (
								<input
									type="text"
									placeholder="例如 claude-3-7-sonnet 或 deepseek-chat"
									value={defaultModel ?? ""}
									onChange={(e) => setDefaultModel(e.target.value)}
								/>
							)}
						</label>
					</div>

					<div className="settings-form-field">
						<span className="field-label">默认思考等级 (Thinking Level)</span>
						<div className="segmented-control">
							{thinkingLevels.map((lvl) => (
								<button
									key={lvl.id}
									type="button"
									className={defaultThinkingLevel === lvl.id ? "active" : ""}
									onClick={() => setDefaultThinkingLevel(lvl.id)}
									title={lvl.hint}
								>
									{lvl.label}
								</button>
							))}
						</div>
						<div className="field-hint-block">
							<span>
								{thinkingLevels.find((l) => l.id === defaultThinkingLevel)?.hint || "控制模型思考深度预算"}
							</span>
						</div>
						<div className="preset-chips">
							<span className="preset-label">快捷斜杠命令:</span>
							<button
								type="button"
								className="chip-button"
								title="切换思考等级为 Off (极速响应)"
								onClick={() => setDefaultThinkingLevel("off")}
							>
								<code>/fast</code> → 极速响应 (Off)
							</button>
							<button
								type="button"
								className="chip-button"
								title="切换思考等级为 Max (深度思考)"
								onClick={() => setDefaultThinkingLevel("max")}
							>
								<code>/deep</code> → 深度推理 (Max)
							</button>
						</div>
					</div>
				</div>
			</section>

			{/* Workspace & Mode Defaults */}
			<section className="settings-card">
				<div className="settings-card-header">
					<div className="settings-card-icon">
						<Sliders size={18} />
					</div>
					<div>
						<h3>工作区与会话模式</h3>
						<p>新建会话时的默认运行环境与交互模式 (/mode)</p>
					</div>
				</div>
				<div className="settings-card-body">
					<div className="mode-selection-grid">
						{workspaceModes.map((mode) => (
							<label
								key={mode.id}
								className={`mode-option-card ${defaultMode === mode.id ? "selected" : ""}`}
							>
								<input
									type="radio"
									name="defaultMode"
									checked={defaultMode === mode.id}
									onChange={() => setDefaultMode(mode.id)}
								/>
								<div className="mode-option-content">
									<strong>{mode.label}</strong>
									<span>{mode.desc}</span>
								</div>
							</label>
						))}
					</div>
				</div>
			</section>

			{/* Context & Automation */}
			<section className="settings-card">
				<div className="settings-card-header">
					<div className="settings-card-icon">
						<Sparkles size={18} />
					</div>
					<div>
						<h3>上下文与自动化</h3>
						<p>自动上下文压缩、Token 缓冲区与长期记忆提取 (/compact, /remember)</p>
					</div>
				</div>
				<div className="settings-card-body">
					<div className="toggle-setting-row">
						<div>
							<strong>自动上下文压缩 (/compact)</strong>
							<span>当对话上下文接近模型上限时，自动总结并压缩前期轮次</span>
						</div>
						<button
							type="button"
							className={`switch-toggle ${autoCompact ? "active" : ""}`}
							onClick={() => setAutoCompact((v) => !v)}
						>
							<span className="switch-thumb" />
						</button>
					</div>

					<div className="settings-form-row">
						<label className="model-form-field">
							<span>预留输出 Token 缓冲 (Reserve Tokens)</span>
							<input
								type="number"
								min={2048}
								max={65536}
								step={1024}
								value={reserveTokens ?? 16384}
								onChange={(e) => setReserveTokens(Number(e.target.value) || 16384)}
							/>
						</label>
						<div className="field-hint-block">
							<span>为模型回答输出保留的安全缓冲。当剩余上下文低于该值时触发自动压缩。默认: 16,384 tokens。</span>
						</div>
					</div>

					<div className="toggle-setting-row">
						<div>
							<strong>自动提取与持久化记忆 (/remember)</strong>
							<span>在对话过程中智能沉淀关键开发习惯、偏好并固化到 MEMORY.md</span>
						</div>
						<button
							type="button"
							className={`switch-toggle ${autoMemory ? "active" : ""}`}
							onClick={() => setAutoMemory((v) => !v)}
						>
							<span className="switch-thumb" />
						</button>
					</div>
				</div>
			</section>

			{/* System & Notifications */}
			<section className="settings-card">
				<div className="settings-card-header">
					<div className="settings-card-icon">
						<Bell size={18} />
					</div>
					<div>
						<h3>系统与通知</h3>
						<p>长耗时任务完成系统级桌面通知与视觉补全服务</p>
					</div>
				</div>
				<div className="settings-card-body">
					<div className="toggle-setting-row">
						<div>
							<strong>长任务完成系统桌面通知</strong>
							<span>当后台执行代码、测试或长耗时 Agent 思考结束时，通过系统通知弹窗提醒</span>
						</div>
						<button
							type="button"
							className={`switch-toggle ${desktopNotifications ? "active" : ""}`}
							onClick={() => setDesktopNotifications((v) => !v)}
						>
							<span className="switch-thumb" />
						</button>
					</div>

					{desktopNotifications && (
						<div className="settings-form-row">
							<label className="model-form-field">
								<span>通知触发耗时阈值</span>
								<select
									value={notificationThresholdSec ?? 5}
									onChange={(e) => setNotificationThresholdSec(Number(e.target.value))}
								>
									<option value={3}>3 秒 (任何非即时任务)</option>
									<option value={5}>5 秒 (推荐标准)</option>
									<option value={10}>10 秒 (仅长耗时任务)</option>
									<option value={30}>30 秒 (仅大型编译/测试)</option>
								</select>
							</label>
						</div>
					)}

					<VisionFallbackPanel onSaved={loadData} />
				</div>
			</section>

			{/* User Profile */}
			<section className="settings-card">
				<div className="settings-card-header">
					<div className="settings-card-icon">
						<UserRound size={18} />
					</div>
					<div>
						<h3>个人偏好与身份</h3>
						<p>设置助手称呼你的昵称及头像 Emoji，将作为上下文注入系统 Prompt</p>
					</div>
				</div>
				<div className="settings-card-body">
					<div className="settings-form-row">
						<label className="model-form-field">
							<span>用户昵称</span>
							<input
								type="text"
								maxLength={40}
								placeholder="例如: 华安"
								value={nickname ?? ""}
								onChange={(e) => setNickname(e.target.value)}
							/>
						</label>
						<label className="model-form-field">
							<span>头像 Emoji</span>
							<input
								type="text"
								maxLength={4}
								placeholder="🧑‍💻"
								value={avatarEmoji ?? ""}
								onChange={(e) => setAvatarEmoji(e.target.value)}
							/>
						</label>
					</div>
				</div>
			</section>

			{/* Bottom Action Footer */}
			<div className="settings-action-footer">
				{saveNotice && <span className="save-notice-text">{saveNotice}</span>}
				<button
					type="button"
					className="button primary settings-save-btn"
					disabled={saving}
					onClick={() => void handleSave()}
				>
					{saving ? <RefreshCw size={14} className="spin" /> : <Save size={14} />}
					<span>{saving ? "保存中…" : "保存设置"}</span>
				</button>
			</div>
		</div>
	);
}

function SlashCommandsDirectoryPanel() {
	const [query, setQuery] = useState("");
	const [category, setCategory] = useState<string>("all");
	const [copiedId, setCopiedId] = useState<string | null>(null);

	const categories = [
		{ id: "all", label: "全部命令" },
		{ id: "session", label: "会话控制" },
		{ id: "model", label: "模型推理" },
		{ id: "memory", label: "记忆与任务" },
		{ id: "tools", label: "工具与操作" },
		{ id: "system", label: "系统与扩展" },
	];

	const getCategory = (id: string): string => {
		if (["clear", "compact", "new", "rename", "export", "copy", "stats"].includes(id)) return "会话控制";
		if (["model", "thinking", "fast", "deep", "mode"].includes(id)) return "模型推理";
		if (["remember", "memory", "task", "tasks"].includes(id)) return "记忆与任务";
		if (["web", "fetch", "code", "kb", "browser", "github"].includes(id)) return "工具与操作";
		return "系统与扩展";
	};

	const filteredCommands = useMemo(() => {
		return LOCAL_SLASH.filter((cmd) => {
			const catName = getCategory(cmd.id);
			const matchesCategory =
				category === "all" ||
				(category === "session" && catName === "会话控制") ||
				(category === "model" && catName === "模型推理") ||
				(category === "memory" && catName === "记忆与任务") ||
				(category === "tools" && catName === "工具与操作") ||
				(category === "system" && catName === "系统与扩展");
			const q = query.trim().toLowerCase();
			const matchesQuery =
				!q ||
				cmd.label.toLowerCase().includes(q) ||
				cmd.hint.toLowerCase().includes(q) ||
				cmd.id.toLowerCase().includes(q);
			return matchesCategory && matchesQuery;
		});
	}, [query, category]);

	const handleCopy = (label: string, id: string) => {
		void navigator.clipboard.writeText(label);
		setCopiedId(id);
		setTimeout(() => setCopiedId(null), 1500);
	};

	return (
		<div className="commands-directory">
			<header className="commands-directory-header">
				<div className="commands-search-box">
					<Search size={15} />
					<input
						type="text"
						placeholder="搜索斜杠命令 (例如 /model, /thinking, /export, /clear)..."
						value={query ?? ""}
						onChange={(e) => setQuery(e.target.value)}
					/>
					{query && (
						<button type="button" className="icon-button quiet" onClick={() => setQuery("")}>
							<X size={14} />
						</button>
					)}
				</div>
				<div className="commands-category-pills" role="tablist">
					{categories.map((cat) => (
						<button
							key={cat.id}
							type="button"
							role="tab"
							aria-selected={category === cat.id}
							className={category === cat.id ? "active" : ""}
							onClick={() => setCategory(cat.id)}
						>
							{cat.label}
						</button>
					))}
				</div>
			</header>

			<div className="commands-grid">
				{filteredCommands.map((cmd) => (
					<div key={cmd.id} className="command-card">
						<div className="command-card-header">
							<code className="command-pill">{cmd.label}</code>
							<span className={`command-kind-badge ${cmd.kind}`}>{cmd.kind}</span>
						</div>
						<p className="command-hint">{cmd.hint}</p>
						<div className="command-footer">
							<span className="command-category-label">{getCategory(cmd.id)}</span>
							<button
								type="button"
								className="command-copy-btn"
								title="复制命令"
								onClick={() => handleCopy(cmd.label, cmd.id)}
							>
								{copiedId === cmd.id ? (
									<>
										<Check size={13} />
										<span>已复制</span>
									</>
								) : (
									<>
										<Copy size={13} />
										<span>复制</span>
									</>
								)}
							</button>
						</div>
					</div>
				))}
				{filteredCommands.length === 0 && (
					<div className="product-empty">
						<Search size={24} />
						<strong>未找到匹配命令</strong>
						<span>尝试搜索其他关键词或切换分类筛选。</span>
					</div>
				)}
			</div>
		</div>
	);
}

export function ModelProvidersPanel({ instanceId }: { instanceId?: string }) {
	const [providers, setProviders] = useState<Record<string, ModelProviderConfig>>({});
	const [authStatuses, setAuthStatuses] = useState<
		Record<string, { type?: string; source?: string; configured: boolean }>
	>({});
	const [loadingProviders, setLoadingProviders] = useState(true);
	const [initialLoaded, setInitialLoaded] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [isNew, setIsNew] = useState(false);
	const [formId, setFormId] = useState("");
	const [formName, setFormName] = useState("");
	const [formBaseUrl, setFormBaseUrl] = useState("");
	const [formApiKey, setFormApiKey] = useState("");
	const [formApi, setFormApi] = useState("openai-completions");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [successNotice, setSuccessNotice] = useState<string | null>(null);
	const [syncingProviderId, setSyncingProviderId] = useState<string | null>(null);
	const [syncingForm, setSyncingForm] = useState(false);
	const [loginBusy, setLoginBusy] = useState<string | null>(null);
	const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
	const [modelCatalog, setModelCatalog] = useState<AvailableModel[]>([]);
	const [loadingCatalog, setLoadingCatalog] = useState(true);
	const [expandedId, setExpandedId] = useState<string | null>(null);
	const [searchQuery, setSearchQuery] = useState("");

	const [defaultModel, setDefaultModel] = useState<string | undefined>(undefined);

	const handleSyncModels = async (providerId: string) => {
		setSyncingProviderId(providerId);
		setError(null);
		setSuccessNotice(null);
		try {
			const res = await desktopApi.fetchProviderRemoteModels({ providerId });
			await loadProviders();
			await loadCatalog();
			setSuccessNotice(`已成功从服务商同步 ${res.count} 个可用模型！`);
			setTimeout(() => setSuccessNotice(null), 4000);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setSyncingProviderId(null);
		}
	};

	const handleSyncFormModels = async () => {
		const targetId = isNew ? formId.trim() : editingId;
		if (!formBaseUrl.trim()) {
			setError("请先输入 Base URL");
			return;
		}
		setSyncingForm(true);
		setError(null);
		setSuccessNotice(null);
		try {
			const res = await desktopApi.fetchProviderRemoteModels({
				providerId: targetId || undefined,
				baseUrl: formBaseUrl.trim(),
				apiKey: formApiKey.trim() || undefined,
			});
			await loadProviders();
			await loadCatalog();
			setSuccessNotice(`已成功从端点拉取 ${res.count} 个可用模型！`);
			setTimeout(() => setSuccessNotice(null), 4000);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setSyncingForm(false);
		}
	};

	const [pingingProviderId, setPingingProviderId] = useState<string | null>(null);
	const [pingResults, setPingResults] = useState<Record<string, ProviderPingResult>>({});

	const handlePingProvider = async (providerId?: string, baseUrlOverride?: string, apiKeyOverride?: string) => {
		const targetId = providerId || (isNew ? formId.trim() : (editingId ?? undefined));
		const effectiveBaseUrl = (baseUrlOverride || formBaseUrl || "").trim();
		const effectiveApiKey = (apiKeyOverride ?? formApiKey ?? "").trim();
		if (!effectiveBaseUrl) {
			setError("请先输入 Base URL");
			return;
		}
		const key = targetId || "current-form";
		setPingingProviderId(key);
		setError(null);
		try {
			const res = await desktopApi.pingModelProvider({
				providerId: targetId,
				baseUrl: effectiveBaseUrl,
				apiKey: effectiveApiKey || undefined,
			});
			setPingResults((prev) => ({ ...prev, [key]: res }));
			if (res.resolvedBaseUrl && !providerId && res.resolvedBaseUrl !== formBaseUrl.trim()) {
				setFormBaseUrl(res.resolvedBaseUrl);
			}
		} catch (err: any) {
			setPingResults((prev) => ({
				...prev,
				[key]: {
					ok: false,
					latencyMs: 0,
					status: 500,
					message: err?.message || String(err),
				},
			}));
		} finally {
			setPingingProviderId(null);
		}
	};

	const loadSettings = useCallback(async () => {
		try {
			const s = await desktopApi.getAppSettings();
			setDefaultModel(s.defaultModel);
		} catch {
			// ignore
		}
	}, []);

	const loadProviders = useCallback(async (isInitial = false) => {
		if (isInitial) setLoadingProviders(true);
		setError(null);
		try {
			const data = await desktopApi.getModelProviders();
			setProviders(data);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setLoadingProviders(false);
			setInitialLoaded(true);
		}
	}, []);

	const loadAuthStatus = useCallback(async () => {
		if (!instanceId) return;
		try {
			const statuses = await desktopApi.getProviderAuthStatus(instanceId);
			const map: Record<string, { type?: string; source?: string; configured: boolean }> = {};
			for (const entry of statuses) {
				map[entry.provider] = { type: entry.type, source: entry.source, configured: entry.configured };
			}
			setAuthStatuses(map);
		} catch {
			// ignore
		}
	}, [instanceId]);

	const loadCatalog = useCallback(async () => {
		if (!instanceId) {
			setModelCatalog([]);
			setAvailableModels([]);
			setLoadingCatalog(false);
			return;
		}
		setLoadingCatalog(true);
		try {
			const [catalog, available] = await Promise.all([
				desktopApi.getModelCatalog(instanceId),
				desktopApi.getAvailableModels(instanceId).catch(() => []),
			]);
			setModelCatalog(catalog ?? []);
			setAvailableModels(available ?? []);
		} catch {
			setModelCatalog([]);
			setAvailableModels([]);
		} finally {
			setLoadingCatalog(false);
		}
	}, [instanceId]);

	useEffect(() => {
		void loadSettings();
	}, [loadSettings]);

	useEffect(() => {
		const onSettingsChanged = () => void loadSettings();
		window.addEventListener("openpi:app-settings-changed", onSettingsChanged);
		return () => window.removeEventListener("openpi:app-settings-changed", onSettingsChanged);
	}, [loadSettings]);

	useEffect(() => {
		void loadProviders(true);
	}, [loadProviders]);

	useEffect(() => {
		void loadAuthStatus();
	}, [loadAuthStatus]);

	useEffect(() => {
		void loadCatalog();
	}, [loadCatalog]);

	useEffect(() => {
		const onRefresh = () => {
			void loadSettings();
			void loadProviders(false);
			void loadAuthStatus();
			void loadCatalog();
		};
		window.addEventListener("openpi:refresh-settings", onRefresh);
		return () => window.removeEventListener("openpi:refresh-settings", onRefresh);
	}, [loadSettings, loadProviders, loadAuthStatus, loadCatalog]);

	const handleSetDefault = async (modelId: string, providerId: string) => {
		try {
			await desktopApi.updateAppSettings({ defaultModel: modelId, defaultProvider: providerId });
			setDefaultModel(modelId);
			window.dispatchEvent(new Event("openpi:app-settings-changed"));
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		}
	};

	const handleLogin = async (provider: string) => {
		if (!instanceId) {
			setError("请先打开一个对话，再登录服务商。");
			return;
		}
		setLoginBusy(provider);
		setError(null);
		try {
			await desktopApi.providerLogin(instanceId, provider, "oauth");
			await loadAuthStatus();
			window.dispatchEvent(new Event("openpi:model-providers-changed"));
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setLoginBusy(null);
		}
	};

	const handleLogout = async (provider: string) => {
		if (!instanceId) return;
		setLoginBusy(provider);
		setError(null);
		try {
			await desktopApi.providerLogout(instanceId, provider);
			await loadAuthStatus();
			window.dispatchEvent(new Event("openpi:model-providers-changed"));
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setLoginBusy(null);
		}
	};

	const openAddForm = () => {
		setIsNew(true);
		setEditingId(null);
		setFormId("");
		setFormName("");
		setFormBaseUrl("");
		setFormApiKey("");
		setFormApi("openai-completions");
	};

	const openEditForm = (id: string) => {
		const config = providers[id];
		const catalogModels = modelCatalog.filter((model) => model.provider === id);
		if (!config && catalogModels.length === 0) return;
		setIsNew(false);
		setEditingId(id);
		setFormId(id);
		setFormName(config?.name ?? "");
		setFormBaseUrl(config?.baseUrl ?? providerDefaultBaseUrl(catalogModels) ?? "");
		setFormApiKey("");
		setFormApi(config?.api ?? providerDefaultApi(catalogModels));
	};

	const openCatalogForm = (id: string) => {
		const config = providers[id];
		const catalogModels = modelCatalog.filter((model) => model.provider === id);
		setIsNew(false);
		setEditingId(null);
		setFormId(id);
		setFormName(config?.name ?? "");
		setFormBaseUrl(config?.baseUrl ?? providerDefaultBaseUrl(catalogModels) ?? "");
		setFormApiKey("");
		setFormApi(config?.api ?? providerDefaultApi(catalogModels));
	};

	const cancelEdit = () => {
		setEditingId(null);
		setIsNew(false);
	};

	const handleSave = async (providerId?: string) => {
		const targetId = isNew ? formId.trim() : (providerId ?? editingId);
		if (!targetId) {
			setError("服务商 ID 不能为空");
			return;
		}
		setSaving(true);
		setError(null);
		try {
			const config: ModelProviderConfig = {};
			if (formName.trim()) config.name = formName.trim();
			if (formBaseUrl.trim()) config.baseUrl = formBaseUrl.trim();
			if (formApiKey.trim()) config.apiKey = formApiKey.trim();
			if (isNew || formApi !== "openai-completions") config.api = formApi;
			await desktopApi.saveModelProvider(targetId, config);
			await loadProviders();
			await loadAuthStatus();
			window.dispatchEvent(new Event("openpi:model-providers-changed"));
			if (isNew || editingId) cancelEdit();
			else setFormApiKey("");
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setSaving(false);
		}
	};

	const handleDelete = async (id: string) => {
		if (!confirm(`确定删除服务商“${id}”？此操作不可恢复。`)) return;
		setError(null);
		try {
			await desktopApi.deleteModelProvider(id);
			await loadProviders();
			if (editingId === id) cancelEdit();
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		}
	};

	interface ProviderEntry {
		id: string;
		name: string;
		custom: boolean;
		configured: boolean;
		models: AvailableModel[];
		config?: ModelProviderConfig;
		auth?: { type?: string; source?: string; configured: boolean };
	}

	const providerEntries = useMemo<ProviderEntry[]>(() => {
		// Full catalog (built-in + custom, configured or not), grouped by provider.
		const groups = new Map<string, AvailableModel[]>();
		for (const model of modelCatalog) {
			const list = groups.get(model.provider) ?? [];
			list.push(model);
			groups.set(model.provider, list);
		}

		// Providers considered configured: present in the available snapshot,
		// authenticated via OAuth, or holding an API key in models.json.
		const availableProviders = new Set(availableModels.map((model) => model.provider));

		const byId = new Map<string, ProviderEntry>();
		const ensure = (id: string): ProviderEntry => {
			let entry = byId.get(id);
			if (!entry) {
				entry = {
					id,
					name: id,
					custom: !BUILTIN_PROVIDER_IDS.has(id),
					configured: false,
					models: [],
					config: providers[id],
					auth: authStatuses[id],
				};
				byId.set(id, entry);
			}
			return entry;
		};

		for (const [id, models] of groups) {
			const entry = ensure(id);
			entry.name = providerDisplayName(id, models, providers[id]);
			entry.models = models
				.slice()
				.sort((left, right) => (left.name || left.id).localeCompare(right.name || right.id));
		}
		for (const [id, config] of Object.entries(providers)) {
			const entry = ensure(id);
			if (entry.models.length === 0) entry.name = config?.name || id;
		}

		for (const entry of byId.values()) {
			entry.configured =
				availableProviders.has(entry.id) || Boolean(entry.auth?.configured) || Boolean(entry.config?.apiKey);
		}

		return [...byId.values()].sort(
			(left, right) => Number(right.configured) - Number(left.configured) || left.name.localeCompare(right.name),
		);
	}, [authStatuses, availableModels, modelCatalog, providers]);

	const enabledEntries = useMemo(() => providerEntries.filter((entry) => entry.configured), [providerEntries]);
	const disabledCustomEntries = useMemo(
		() => providerEntries.filter((entry) => entry.custom && !entry.configured),
		[providerEntries],
	);
	const disabledBuiltinEntries = useMemo(
		() => providerEntries.filter((entry) => !entry.custom && !entry.configured),
		[providerEntries],
	);

	const normalizedSearch = searchQuery.trim().toLowerCase();
	const matchesSearch = (text: string) => text.toLowerCase().includes(normalizedSearch);
	const matchesEntry = (entry: ProviderEntry) =>
		matchesSearch(`${entry.id} ${entry.name} ${entry.config?.baseUrl ?? ""}`);
	const filteredEnabledEntries = normalizedSearch ? enabledEntries.filter(matchesEntry) : enabledEntries;
	const filteredDisabledCustomEntries = normalizedSearch
		? disabledCustomEntries.filter(matchesEntry)
		: disabledCustomEntries;
	const filteredDisabledBuiltinEntries = normalizedSearch
		? disabledBuiltinEntries.filter(matchesEntry)
		: disabledBuiltinEntries;

	const renderProviderItem = (entry: ProviderEntry) => {
		const expanded = expandedId === entry.id;
		const isOauth = entry.auth?.type === "oauth";
		const defaultBaseUrl = providerDefaultBaseUrl(entry.models);
		const currentBaseUrl = entry.config?.baseUrl ?? defaultBaseUrl ?? "默认地址";
		const currentApi = entry.config?.api ?? providerDefaultApi(entry.models);
		// Configured providers and disabled built-ins configure through the inline
		// form; unconfigured customs only offer edit/delete until a key is set.
		const useInlineForm = entry.configured || !entry.custom;
		return (
			<div className="model-provider-catalog-item" key={entry.id}>
				<button
					type="button"
					className="model-provider-catalog-head"
					onClick={() => {
						setExpandedId(expanded ? null : entry.id);
						if (!expanded && useInlineForm) openCatalogForm(entry.id);
					}}
				>
					{expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
					<span className={`model-provider-icon ${entry.custom ? "custom" : "builtin"}`}>
						<Server size={16} />
					</span>
					<span className="model-provider-info">
						<strong>
							{entry.name}
							{entry.custom && <span className="model-provider-kind-badge">自定义</span>}
							{entry.config?.apiKey && <span className="model-api-key-badge">API Key</span>}
						</strong>
						<span>
							{entry.models.length > 0 ? `${entry.models.length} 个模型 · ` : ""}
							{currentBaseUrl}
						</span>
					</span>
					<span className="model-api-key-badge muted">{currentApi}</span>
					{entry.configured && <span className="model-api-key-badge">已启用</span>}
				</button>
				{expanded && (
					<div className="model-provider-catalog-body">
						{useInlineForm ? (
							<>
								<div className="model-provider-inline-form">
									<label className="model-form-field">
										<span>显示名称</span>
										<input
											type="text"
											value={(formId === entry.id ? formName : entry.config?.name) ?? ""}
											placeholder={entry.name}
											onChange={(event) => setFormName(event.target.value)}
										/>
									</label>
									<label className="model-form-field">
										<span>Base URL</span>
										<input
											type="text"
											value={(formId === entry.id ? formBaseUrl : currentBaseUrl) ?? ""}
											placeholder={defaultBaseUrl ?? "默认地址"}
											onChange={(event) => setFormBaseUrl(event.target.value)}
										/>
									</label>
									<label className="model-form-field">
										<span>API Key</span>
										<input
											type="password"
											value={(formId === entry.id ? formApiKey : "") ?? ""}
											placeholder={entry.configured ? "已配置，输入新 Key 覆盖" : "API Key"}
											onChange={(event) => setFormApiKey(event.target.value)}
										/>
									</label>
									<label className="model-form-field">
										<span>API 类型</span>
										<select
											value={(formId === entry.id ? formApi : currentApi) ?? "openai-completions"}
											onChange={(event) => setFormApi(event.target.value)}
										>
											{API_TYPE_OPTIONS.map((option) => (
												<option key={option.value} value={option.value}>
													{option.label}
												</option>
											))}
										</select>
									</label>
									<div className="model-provider-inline-actions">
										<button
											type="button"
											className="primary"
											disabled={saving || formId !== entry.id}
											onClick={() => void handleSave(entry.id)}
										>
											{saving ? <RefreshCw size={14} className="spin" /> : <Save size={14} />}
											{entry.configured ? "更新配置" : "保存配置"}
										</button>
										<button
											type="button"
											className="secondary"
											disabled={pingingProviderId === entry.id}
											onClick={() =>
												void handlePingProvider(
													entry.id,
													formId === entry.id ? formBaseUrl : currentBaseUrl,
													formId === entry.id ? formApiKey : entry.config?.apiKey,
												)
											}
											title="测试与该服务商端点的连通性与网络延迟"
										>
											{pingingProviderId === entry.id ? (
												<RefreshCw size={14} className="spin" />
											) : (
												<Zap size={14} />
											)}
											{pingingProviderId === entry.id ? "测速中…" : "连通性测试"}
										</button>
										<button
											type="button"
											className="secondary"
											disabled={syncingProviderId === entry.id}
											onClick={() => void handleSyncModels(entry.id)}
											title="从远端服务商 Base URL 拉取最新模型列表并保存"
										>
											{syncingProviderId === entry.id ? (
												<RefreshCw size={14} className="spin" />
											) : (
												<Download size={14} />
											)}
											{syncingProviderId === entry.id ? "同步中…" : "同步远端模型"}
										</button>
										{isOauth && (
											<button
												type="button"
												className={entry.configured ? "secondary" : "primary"}
												disabled={loginBusy === entry.id || !instanceId}
												onClick={() =>
													void (entry.configured ? handleLogout(entry.id) : handleLogin(entry.id))
												}
											>
												{loginBusy === entry.id ? (
													<RefreshCw size={14} className="spin" />
												) : (
													<LogIn size={14} />
												)}
												{entry.configured ? "登出" : "登录"}
											</button>
										)}
										{entry.custom && (
											<button type="button" className="danger" onClick={() => void handleDelete(entry.id)}>
												<Trash2 size={14} />
												删除服务商
											</button>
										)}
									</div>
									{pingResults[entry.id] && (
										<div className={`ping-result-pill ${pingResults[entry.id].ok ? "ok" : "fail"}`}>
											<span className="ping-dot" />
											<strong>{pingResults[entry.id].ok ? "连接正常" : "连接失败"}</strong>
											<span>·</span>
											<span>{pingResults[entry.id].latencyMs}ms</span>
											<span>·</span>
											<span>HTTP {pingResults[entry.id].status}</span>
											{pingResults[entry.id].modelCount != null && (
												<>
													<span>·</span>
													<span>{pingResults[entry.id].modelCount} 个模型</span>
												</>
											)}
											{!pingResults[entry.id].ok && (
												<span className="ping-err">({pingResults[entry.id].message})</span>
											)}
										</div>
									)}
								</div>
								{entry.models.length > 0 && (
									<ModelCatalogTable
										models={entry.models}
										providerId={entry.id}
										defaultModel={defaultModel}
										onSetDefault={handleSetDefault}
									/>
								)}
							</>
						) : (
							<>
								<div className="model-provider-custom-actions">
									<button
										type="button"
										disabled={syncingProviderId === entry.id}
										onClick={() => void handleSyncModels(entry.id)}
										title="从远端服务商 Base URL 拉取最新模型列表"
									>
										{syncingProviderId === entry.id ? (
											<RefreshCw size={13} className="spin" />
										) : (
											<Download size={13} />
										)}
										{syncingProviderId === entry.id ? "同步中…" : "同步远端模型"}
									</button>
									<button type="button" onClick={() => openEditForm(entry.id)}>
										<Pencil size={13} />
										编辑配置
									</button>
									<button type="button" className="danger" onClick={() => void handleDelete(entry.id)}>
										<Trash2 size={13} />
										删除服务商
									</button>
								</div>
								{entry.models.length > 0 ? (
									<ModelCatalogTable
										models={entry.models}
										providerId={entry.id}
										defaultModel={defaultModel}
										onSetDefault={handleSetDefault}
									/>
								) : (
									<p className="model-provider-models-empty">
										未配置模型列表，调用时使用服务商返回的默认模型。
									</p>
								)}
							</>
						)}
					</div>
				)}
			</div>
		);
	};

	return (
		<div className="model-providers-panel">
			{successNotice && (
				<div
					className="model-providers-success"
					style={{
						display: "flex",
						alignItems: "center",
						gap: 8,
						padding: "8px 12px",
						background: "rgba(46, 160, 67, 0.15)",
						border: "1px solid rgba(46, 160, 67, 0.3)",
						color: "var(--openpi-success, #3fb950)",
						borderRadius: 6,
						marginBottom: 12,
						fontSize: "0.85rem",
					}}
				>
					<Check size={14} />
					<span style={{ flex: 1 }}>{successNotice}</span>
					<button type="button" className="icon-button quiet" onClick={() => setSuccessNotice(null)} aria-label="关闭">
						<X size={12} />
					</button>
				</div>
			)}
			{error && (
				<div className="model-providers-error">
					<X size={14} />
					<span>{error}</span>
					<button type="button" className="icon-button quiet" onClick={() => setError(null)} aria-label="关闭">
						<X size={12} />
					</button>
				</div>
			)}

			{editingId !== null || isNew ? (
				<div className="model-provider-form">
					<div className="model-form-header">
						<strong>{isNew ? "添加服务商" : `编辑 ${editingId}`}</strong>
						<button type="button" className="icon-button quiet" onClick={cancelEdit} aria-label="取消">
							<X size={16} />
						</button>
					</div>
					<div className="model-form-fields">
						<label className="model-form-field">
							<span>服务商 ID</span>
							<input
								type="text"
								value={formId ?? ""}
								placeholder="例如: my-ollama"
								disabled={!isNew}
								onChange={(e) => setFormId(e.target.value)}
							/>
						</label>
						<label className="model-form-field">
							<span>显示名称</span>
							<input
								type="text"
								value={formName ?? ""}
								placeholder="例如: My Ollama"
								onChange={(e) => setFormName(e.target.value)}
							/>
						</label>
						<label className="model-form-field">
							<span>Base URL</span>
							<input
								type="text"
								value={formBaseUrl ?? ""}
								placeholder="https://api.example.com/v1"
								onChange={(e) => setFormBaseUrl(e.target.value)}
							/>
						</label>
						<label className="model-form-field">
							<span>API Key</span>
							<input
								type="password"
								value={formApiKey ?? ""}
								placeholder="sk-..."
								onChange={(e) => setFormApiKey(e.target.value)}
							/>
						</label>
						<label className="model-form-field">
							<span>API 类型</span>
							<select value={formApi ?? "openai-completions"} onChange={(e) => setFormApi(e.target.value)}>
								{API_TYPE_OPTIONS.map((opt) => (
									<option key={opt.value} value={opt.value}>
										{opt.label}
									</option>
								))}
							</select>
						</label>
					</div>
					<div className="model-form-actions">
						<button
							type="button"
							className="secondary"
							disabled={pingingProviderId === (formId.trim() || "current-form") || !formBaseUrl.trim()}
							onClick={() => void handlePingProvider()}
							title="测试与该端点的网络往返延迟与连通状态"
						>
							{pingingProviderId === (formId.trim() || "current-form") ? (
								<RefreshCw size={14} className="spin" />
							) : (
								<Zap size={14} />
							)}
							{pingingProviderId === (formId.trim() || "current-form") ? "测速中…" : "连通性测试"}
						</button>
						<button
							type="button"
							className="secondary"
							disabled={syncingForm || !formBaseUrl.trim()}
							onClick={() => void handleSyncFormModels()}
							title="根据填写的 Base URL 和 API Key 从远端服务商拉取所有可用模型"
						>
							{syncingForm ? <RefreshCw size={14} className="spin" /> : <Download size={14} />}
							{syncingForm ? "拉取中…" : "从端点拉取模型列表"}
						</button>
						<button
							type="button"
							className="primary"
							disabled={saving || !formId.trim()}
							onClick={() => void handleSave()}
						>
							{saving ? "保存中…" : "保存"}
							<Save size={14} />
						</button>
						<button type="button" onClick={cancelEdit}>
							取消
						</button>
					</div>
					{pingResults[formId.trim() || "current-form"] && (
						<div className={`ping-result-pill ${pingResults[formId.trim() || "current-form"].ok ? "ok" : "fail"}`}>
							<span className="ping-dot" />
							<strong>{pingResults[formId.trim() || "current-form"].ok ? "连接正常" : "连接失败"}</strong>
							<span>·</span>
							<span>{pingResults[formId.trim() || "current-form"].latencyMs}ms</span>
							<span>·</span>
							<span>HTTP {pingResults[formId.trim() || "current-form"].status}</span>
							{pingResults[formId.trim() || "current-form"].modelCount != null && (
								<>
									<span>·</span>
									<span>{pingResults[formId.trim() || "current-form"].modelCount} 个模型</span>
								</>
							)}
							{!pingResults[formId.trim() || "current-form"].ok && (
								<span className="ping-err">({pingResults[formId.trim() || "current-form"].message})</span>
							)}
						</div>
					)}
				</div>
			) : (
				<>
					<div className="model-providers-toolbar">
						<div className="model-providers-toolbar-left">
							<button type="button" className="primary" onClick={openAddForm}>
								<Plus size={14} />
								自定义服务商
							</button>
							<button
								type="button"
								className="secondary"
								title="刷新服务商与模型目录"
								disabled={loadingProviders || loadingCatalog}
								onClick={() => {
									void loadSettings();
									void loadProviders();
									void loadAuthStatus();
									void loadCatalog();
								}}
							>
								<RefreshCw size={13} className={loadingProviders || loadingCatalog ? "spin" : ""} />
								刷新
							</button>
							<div className="model-provider-search">
								<Search size={13} />
								<input
									type="text"
									placeholder="搜索服务商…"
									value={searchQuery ?? ""}
									onChange={(event) => setSearchQuery(event.target.value)}
								/>
							</div>
						</div>
						<span className="model-providers-count">
							{providerEntries.length > 0 ? `共 ${providerEntries.length} 个服务商` : "打开对话后加载服务商目录"}
						</span>
					</div>

					<VisionFallbackPanel onSaved={loadProviders} />

					{!initialLoaded && loadingProviders ? (
						<div className="model-providers-loading">
							<RefreshCw size={18} className="spin" />
							<span>加载中…</span>
						</div>
					) : (
						<>
							{filteredEnabledEntries.length > 0 && (
								<section className="model-provider-group">
									<div className="model-provider-group-heading">
										<strong>已启用的服务商</strong>
										<span>{filteredEnabledEntries.length}</span>
									</div>
									{filteredEnabledEntries.length === 0 ? (
										<div className="model-providers-search-empty">没有匹配的服务商</div>
									) : (
										filteredEnabledEntries.map((entry) => renderProviderItem(entry))
									)}
								</section>
							)}

							{filteredDisabledCustomEntries.length > 0 && (
								<section className="model-provider-group">
									<div className="model-provider-group-heading">
										<strong>自定义服务商</strong>
										<span>{filteredDisabledCustomEntries.length}</span>
									</div>
									{filteredDisabledCustomEntries.length === 0 ? (
										<div className="model-providers-search-empty">没有匹配的服务商</div>
									) : (
										filteredDisabledCustomEntries.map((entry) => renderProviderItem(entry))
									)}
								</section>
							)}

							{filteredDisabledBuiltinEntries.length > 0 && (
								<section className="model-provider-group">
									<div className="model-provider-group-heading">
										<strong>内置服务商</strong>
										<span>{filteredDisabledBuiltinEntries.length}</span>
									</div>
									{loadingCatalog && modelCatalog.length === 0 ? (
										<div className="model-providers-loading">
											<RefreshCw size={18} className="spin" />
											<span>加载目录…</span>
										</div>
									) : filteredDisabledBuiltinEntries.length === 0 ? (
										<div className="model-providers-search-empty">
											{normalizedSearch ? "没有匹配的服务商" : "全部内置服务商已启用"}
										</div>
									) : (
										filteredDisabledBuiltinEntries.map((entry) => renderProviderItem(entry))
									)}
								</section>
							)}
						</>
					)}
				</>
			)}
		</div>
	);
}

export function CapabilitiesSurface({
	conversation,
	capabilities,
	loading,
	busy,
	onClose,
	onReload,
	onUseSkill,
	onConfigureMcp,
	onInstallPackage,
	onRemoveMcp,
}: {
	conversation?: ConversationSnapshot;
	capabilities?: ConversationCapabilities;
	loading: boolean;
	busy?: string;
	onClose(): void;
	onReload(): void;
	onUseSkill(name: string): void;
	onConfigureMcp(): void;
	onInstallPackage(marketPackage: MarketplacePackage): void;
	onRemoveMcp(source: string, local: boolean): void;
}) {
	const [tab, setTab] = useState<CapabilityTab>("general");
	const [marketKind, setMarketKind] = useState<MarketplaceKind>("skills");
	const [marketQuery, setMarketQuery] = useState("");
	const [modelProviderCount, setModelProviderCount] = useState(0);

	const safeCaps: ConversationCapabilities = useMemo(() => ({
		skills: capabilities?.skills ?? [],
		extensions: capabilities?.extensions ?? [],
		tools: capabilities?.tools ?? [],
		packages: capabilities?.packages ?? [],
		diagnostics: capabilities?.diagnostics ?? [],
		mcp: {
			configured: Boolean(capabilities?.mcp?.configured),
			loaded: Boolean(capabilities?.mcp?.loaded),
			packageSources: capabilities?.mcp?.packageSources ?? [],
			extensionPaths: capabilities?.mcp?.extensionPaths ?? [],
			commands: capabilities?.mcp?.commands ?? [],
			tools: capabilities?.mcp?.tools ?? [],
			servers: capabilities?.mcp?.servers ?? [],
		},
	}), [capabilities]);

	// Load model provider count for tab badge
	useEffect(() => {
		desktopApi
			.getModelProviders()
			.then((providers) => {
				setModelProviderCount(Object.keys(providers).length);
			})
			.catch(() => {
				// ignore
			});
	}, [tab]);
	const mcpPackages =
		safeCaps.packages.filter((entry) => safeCaps.mcp.packageSources.includes(entry.source)) ?? [];
	const [refreshing, setRefreshing] = useState(false);

	const handleReload = async () => {
		if (refreshing || loading) return;
		setRefreshing(true);
		try {
			// Notify child panels (GeneralSettings, ModelProviders) to refresh
			window.dispatchEvent(new Event("openpi:refresh-settings"));

			// Refresh provider counts for navigation badge
			void desktopApi
				.getModelProviders()
				.then((providers) => {
					setModelProviderCount(Object.keys(providers).length);
				})
				.catch(() => {});

			// Invoke external onReload handler if provided
			if (onReload) {
				await onReload();
			}
		} finally {
			// Ensure tactile spinner feedback for at least 400ms
			setTimeout(() => {
				setRefreshing(false);
			}, 400);
		}
	};

	const mutationDisabled = !conversation || conversation.state.isStreaming || loading || Boolean(busy);
	const normalizedMarketQuery = marketQuery.trim().toLowerCase();
	const marketplacePackages = MARKETPLACE_PACKAGES.filter((marketPackage) => {
		if (marketPackage.kind !== marketKind) return false;
		if (!normalizedMarketQuery) return true;
		return `${marketPackage.name} ${marketPackage.packageName} ${marketPackage.publisher} ${marketPackage.description} ${marketPackage.tags.join(" ")}`
			.toLowerCase()
			.includes(normalizedMarketQuery);
	});
	const marketplaceCounts = {
		skills: MARKETPLACE_PACKAGES.filter((marketPackage) => marketPackage.kind === "skills").length,
		mcp: MARKETPLACE_PACKAGES.filter((marketPackage) => marketPackage.kind === "mcp").length,
		repositories: MARKETPLACE_PACKAGES.filter((marketPackage) => marketPackage.kind === "repositories").length,
	};
	const isInstalled = (marketPackage: MarketplacePackage): boolean => {
		const sourceIdentity = marketPackage.source.startsWith("git:")
			? `git:github.com/${marketPackage.packageName}`
			: `npm:${marketPackage.packageName}`;
		return (
			safeCaps.packages.some(
				(entry) => entry.source === sourceIdentity || entry.source.startsWith(`${sourceIdentity}@`),
			) ?? false
		);
	};
	const tabs: Array<{
		id: CapabilityTab;
		label: string;
		description: string;
		count: number;
		icon: typeof BookOpen;
	}> = [
		{
			id: "general",
			label: "常规设置",
			description: "默认模型、思考预算、工作区模式与系统偏好",
			count: 0,
			icon: Sliders,
		},
		{
			id: "models",
			label: "模型服务",
			description: "服务商与 API 配置、模型目录列表",
			count: modelProviderCount,
			icon: Cpu,
		},
		{
			id: "commands",
			label: "斜杠命令",
			description: "常用斜杠命令目录、快捷键与触发指令",
			count: LOCAL_SLASH.length,
			icon: TerminalSquare,
		},
		{
			id: "market",
			label: "插件市场",
			description: "安装技能包、MCP 服务和自动化工作流",
			count: MARKETPLACE_PACKAGES.length,
			icon: Store,
		},
		{
			id: "skills",
			label: "技能库",
			description: "当前会话可调用的专业技能 (Skills)",
			count: safeCaps.skills.length ?? 0,
			icon: BookOpen,
		},
		{
			id: "mcp",
			label: "MCP 服务",
			description: "Model Context Protocol 外部工具与服务连接",
			count: safeCaps.mcp.tools.length ?? 0,
			icon: Cable,
		},
		{
			id: "extensions",
			label: "扩展插件",
			description: "已加载的本地扩展与运行时 Hooks",
			count: safeCaps.extensions.length ?? 0,
			icon: Blocks,
		},
		{
			id: "tools",
			label: "可用工具",
			description: "当前会话已注册的工具与操作函数",
			count: safeCaps.tools.length ?? 0,
			icon: Wrench,
		},
		{
			id: "packages",
			label: "依赖包",
			description: "项目级与全局依赖包管理",
			count: safeCaps.packages.length ?? 0,
			icon: Package,
		},
	];
	const selectedTab = tabs.find((item) => item.id === tab) ?? tabs[0];

	return (
		<section className="capabilities-surface settings-surface">
			<header className="surface-header capability-page-header">
				<button className="icon-button quiet" title="返回聊天" aria-label="返回聊天" onClick={onClose}>
					<ArrowLeft size={18} />
				</button>
				<div className="surface-heading">
					<strong>设置</strong>
					<span>偏好首选项、模型服务与扩展能力</span>
				</div>
				<button
					className="icon-button"
					title="重新加载设置与服务"
					aria-label="重新加载设置与服务"
					disabled={loading || refreshing || Boolean(busy)}
					onClick={() => void handleReload()}
				>
					<RefreshCw size={16} className={loading || refreshing ? "spin" : ""} />
				</button>
			</header>

			<div className="settings-workspace">
				<nav className="settings-navigation" role="tablist" aria-label="设置导航">
					<span className="settings-navigation-label">偏好设置</span>
					{tabs.slice(0, 3).map((item) => {
						const Icon = item.icon;
						return (
							<button
								type="button"
								role="tab"
								aria-selected={tab === item.id}
								className={tab === item.id ? "active" : ""}
								key={item.id}
								onClick={() => setTab(item.id)}
							>
								<Icon size={16} />
								<span>{item.label}</span>
								{item.count > 0 && <em>{item.count}</em>}
							</button>
						);
					})}
					<span className="settings-navigation-label" style={{ marginTop: "1rem" }}>
						能力扩展
					</span>
					{tabs.slice(3).map((item) => {
						const Icon = item.icon;
						return (
							<button
								type="button"
								role="tab"
								aria-selected={tab === item.id}
								className={tab === item.id ? "active" : ""}
								key={item.id}
								onClick={() => setTab(item.id)}
							>
								<Icon size={16} />
								<span>{item.label}</span>
								{item.count > 0 && <em>{item.count}</em>}
							</button>
						);
					})}
				</nav>

				<div className="capability-content settings-content">
					<header className="settings-content-header">
						<div>
							<h1>{selectedTab.label}</h1>
							<p>{selectedTab.description}</p>
						</div>
						{conversation && !["general", "commands", "models"].includes(tab) && (
							<span className="settings-session-label">
								{instanceTitle(conversation.instance, conversation.state.sessionName)}
							</span>
						)}
					</header>
					{tab === "general" ? (
						<GeneralSettingsPanel instanceId={conversation?.instance.id} onReload={onReload} />
					) : tab === "commands" ? (
						<SlashCommandsDirectoryPanel />
					) : tab === "models" ? (
						<ModelProvidersPanel instanceId={conversation?.instance.id} />
					) : !conversation ? (
						<div className="product-empty large">
							<Blocks size={32} />
							<strong>未选择当前对话</strong>
							<span>会话能力（技能库、MCP、可用工具）挂载于具体的会话。在左侧新建或打开一个对话即可查看。</span>
						</div>
					) : loading && !safeCaps ? (
						<div className="product-empty">
							<RefreshCw size={24} className="spin" />
							<strong>加载扩展能力中…</strong>
						</div>
					) : safeCaps ? (
						<>
							{safeCaps.diagnostics.length > 0 && (
								<div className="capability-diagnostics">
									{safeCaps.diagnostics.map((diagnostic, index) => (
										<div
											className={diagnostic.type}
											key={`${diagnostic.path ?? diagnostic.message}-${index}`}
										>
											<Bell size={14} />
											<span>
												<strong>{diagnostic.resource}</strong>
												{diagnostic.message}
											</span>
										</div>
									))}
								</div>
							)}

							{tab === "market" && (
								<div className="marketplace-workspace">
									<section className="settings-market-intro">
										<div>
											<span className="settings-market-kicker">
												<Store size={14} /> OpenPI Marketplace
											</span>
											<h2>
												{marketKind === "skills"
													? "为助手增加专业技能"
													: marketKind === "mcp"
														? "连接 MCP 外部工具"
														: "扩展自动化工作流"}
											</h2>
											<p>安装后会写入当前会话的配置。完成安装后重新加载即可查看可用能力。</p>
										</div>
										<div className="settings-market-summary">
											<span>
												<strong>{safeCaps.packages.length}</strong>
												已安装
											</span>
											<span>
												<strong>{marketplaceCounts[marketKind]}</strong>
												可选
											</span>
										</div>
									</section>
									<div className="marketplace-controls settings-market-controls">
										<div className="settings-market-tabs" role="tablist" aria-label="市场分类">
											<button
												type="button"
												role="tab"
												aria-selected={marketKind === "skills"}
												className={marketKind === "skills" ? "active" : ""}
												onClick={() => setMarketKind("skills")}
											>
												<BookOpen size={14} /> 技能 <span>{marketplaceCounts.skills}</span>
											</button>
											<button
												type="button"
												role="tab"
												aria-selected={marketKind === "mcp"}
												className={marketKind === "mcp" ? "active" : ""}
												onClick={() => setMarketKind("mcp")}
											>
												<Cable size={14} /> MCP <span>{marketplaceCounts.mcp}</span>
											</button>
											<button
												type="button"
												role="tab"
												aria-selected={marketKind === "repositories"}
												className={marketKind === "repositories" ? "active" : ""}
												onClick={() => setMarketKind("repositories")}
											>
												<Github size={14} /> 工作流 <span>{marketplaceCounts.repositories}</span>
											</button>
										</div>
										<label className="search-box settings-market-search">
											<Search size={14} />
											<input
												aria-label="Search marketplace"
												value={marketQuery ?? ""}
												onChange={(event) => setMarketQuery(event.target.value)}
												placeholder="搜索包"
											/>
										</label>
									</div>
									<div className="settings-market-grid">
										{marketplacePackages.map((marketPackage) => {
											const installed = isInstalled(marketPackage);
											const installing = busy === `install-market-${marketPackage.id}`;
											return (
												<article className="settings-market-card" key={marketPackage.id}>
													<header>
														<span
															className={`capability-icon ${marketPackage.kind === "skills" ? "skill" : marketPackage.kind === "mcp" ? "mcp" : "package"}`}
														>
															{marketPackage.kind === "skills" ? (
																<BookOpen size={17} />
															) : marketPackage.kind === "mcp" ? (
																<Cable size={17} />
															) : (
																<Github size={17} />
															)}
														</span>
														<div>
															<strong>{marketPackage.name}</strong>
															<span>{marketPackage.publisher}</span>
														</div>
														{installed && <span className="settings-market-installed">已安装</span>}
													</header>
													<p>{marketPackage.description}</p>
													<div className="marketplace-tags">
														{marketPackage.tags.map((tag, tIdx) => (
															<span key={`tag-${marketPackage.id}-${tag}-${tIdx}`}>{tag}</span>
														))}
													</div>
													<footer>
														<code>v{marketPackage.version}</code>
														<button
															className={installed ? "button" : "button primary"}
															disabled={mutationDisabled || installed}
															onClick={() => onInstallPackage(marketPackage)}
														>
															{installing ? (
																<RefreshCw size={14} className="spin" />
															) : installed ? (
																<Check size={14} />
															) : (
																<Download size={14} />
															)}
															{installed ? "Installed" : "Install"}
														</button>
													</footer>
												</article>
											);
										})}
										{marketplacePackages.length === 0 && (
											<div className="capability-empty">
												<Store size={25} />
												<strong>没有匹配的包</strong>
											</div>
										)}
									</div>
								</div>
							)}

							{tab === "skills" && (
								<div className="settings-resource-workspace">
									<section className="settings-resource-banner">
										<div>
											<span className="settings-market-kicker">
												<BookOpen size={14} /> Skills
											</span>
											<strong>为当前助手添加专业工作流</strong>
											<p>安装的技能会在重新加载后显示在这里，并可通过斜杠命令调用。</p>
										</div>
										<button
											type="button"
											className="button primary"
											onClick={() => {
												setMarketKind("skills");
												setTab("market");
											}}
										>
											<Store size={14} /> 浏览技能市场
										</button>
									</section>
									<div className="capability-list">
										{safeCaps.skills.map((skill, index) => (
											<article className="capability-row" key={skill.filePath ? `skill-${skill.filePath}` : `skill-${skill.name || "item"}-${index}`}>
												<span className="capability-icon skill">
													<BookOpen size={17} />
												</span>
												<div className="capability-copy">
													<div>
														<strong>{skill.name}</strong>
														<span className="source-badge">{skill.sourceInfo.scope}</span>
														{skill.disableModelInvocation && (
															<span className="source-badge muted">manual</span>
														)}
													</div>
													<p>{skill.description}</p>
													<code>{skill.filePath}</code>
												</div>
												<button className="button" onClick={() => onUseSkill(skill.name)}>
													Use
												</button>
											</article>
										))}
										{safeCaps.skills.length === 0 && (
											<div className="capability-empty">
												<BookOpen size={25} />
												<strong>还没有技能</strong>
											</div>
										)}
									</div>
								</div>
							)}

							{tab === "mcp" && (
								<div className="mcp-workspace">
									<section className="mcp-status-band">
										<span className={`capability-icon mcp ${safeCaps.mcp.loaded ? "online" : ""}`}>
											<Cable size={19} />
										</span>
										<div>
											<strong>Pi MCP Adapter</strong>
											<span>
												{safeCaps.mcp.loaded
													? "Loaded"
													: safeCaps.mcp.configured
														? "Configured"
														: "Not installed"}
											</span>
										</div>
										<div className="capability-actions">
											{safeCaps.mcp.loaded && (
												<button
													className="button"
													disabled={conversation.state.isStreaming}
													onClick={onConfigureMcp}
												>
													Setup
												</button>
											)}
											<button
												type="button"
												className="button"
												disabled={mutationDisabled}
												onClick={() => {
													setMarketKind("mcp");
													setTab("market");
												}}
											>
												<Store size={14} /> MCP 市场
											</button>
											{!safeCaps.mcp.configured && (
												<button
													className="button primary"
													disabled={mutationDisabled}
													onClick={() => onInstallPackage(MCP_ADAPTER_MARKETPLACE_PACKAGE)}
												>
													{busy === `install-market-${MCP_ADAPTER_MARKETPLACE_PACKAGE.id}` ? (
														<RefreshCw size={14} className="spin" />
													) : (
														<Plus size={15} />
													)}
													Install
												</button>
											)}
											{mcpPackages.map((entry, index) => (
												<button
													className="icon-button danger"
													title="Remove MCP adapter"
													aria-label="Remove MCP adapter"
													disabled={mutationDisabled}
													key={`mcp-pkg-${entry.scope}:${entry.source}-${index}`}
													onClick={() => {
														if (window.confirm(`Remove ${entry.source}?`))
															onRemoveMcp(entry.source, entry.scope === "project");
													}}
												>
													{busy === "remove-mcp" ? (
														<RefreshCw size={15} className="spin" />
													) : (
														<Trash2 size={15} />
													)}
												</button>
											))}
										</div>
									</section>
									<div className="capability-metrics">
										<div>
											<span>Packages</span>
											<strong>{safeCaps.mcp.packageSources.length}</strong>
										</div>
										<div>
											<span>Extensions</span>
											<strong>{safeCaps.mcp.extensionPaths.length}</strong>
										</div>
										<div>
											<span>Commands</span>
											<strong>{safeCaps.mcp.commands.length}</strong>
										</div>
										<div>
											<span>Tools</span>
											<strong>{safeCaps.mcp.tools.length}</strong>
										</div>
									</div>
									{(safeCaps.mcp.servers?.length ?? 0) > 0 && (
										<div className="capability-list compact">
											{safeCaps.mcp.servers?.map((server, index) => (
												<div className="capability-row" key={`mcp-srv-${server?.name ?? "unknown"}-${index}`}>
													<span
														className={`capability-icon mcp ${
															server?.status === "connected" ? "online" : ""
														}`}
													>
														<Cable size={16} />
													</span>
													<div className="capability-copy">
														<strong>{server?.name ?? "MCP server"}</strong>
														<code>
															{server?.status === "connected"
																? `${server?.toolCount ?? 0} tool(s)`
																: server?.status === "starting"
																	? "starting"
																	: (server?.error ?? "error")}
														</code>
													</div>
													<span className="active-indicator">{server?.status ?? "unknown"}</span>
												</div>
											))}
										</div>
									)}
									{safeCaps.mcp.tools.length > 0 && (
										<div className="capability-list compact">
											{safeCaps.mcp.tools.map((tool, index) => (
												<div className="capability-row" key={`mcp-tool-${tool}-${index}`}>
													<span className="capability-icon tool">
														<Wrench size={16} />
													</span>
													<div className="capability-copy">
														<strong>{tool}</strong>
														<code>MCP tool</code>
													</div>
													<span className="active-indicator">Active</span>
												</div>
											))}
										</div>
									)}
								</div>
							)}

							{tab === "extensions" && (
								<div className="capability-list">
									{safeCaps.extensions.map((extension, index) => (
										<article className="capability-row" key={extension.path ? `ext-${extension.path}` : `ext-${extension.sourceInfo?.source || "item"}-${index}`}>
											<span className="capability-icon extension">
												<Blocks size={17} />
											</span>
											<div className="capability-copy">
												<div>
													<strong>{extension.sourceInfo.source}</strong>
													<span className="source-badge">{extension.sourceInfo.scope}</span>
												</div>
												<code>{extension.path}</code>
												<p>
													{extension.commands.length} commands · {extension.tools.length} tools
												</p>
											</div>
										</article>
									))}
									{safeCaps.extensions.length === 0 && (
										<div className="capability-empty">
											<Blocks size={25} />
											<strong>还没有扩展</strong>
										</div>
									)}
								</div>
							)}

							{tab === "tools" && (
								<div className="capability-list compact">
									{safeCaps.tools.map((tool, index) => (
										<article className="capability-row" key={`tool-${tool.sourceInfo?.path || "builtin"}:${tool.name || "item"}-${index}`}>
											<span className="capability-icon tool">
												<Wrench size={16} />
											</span>
											<div className="capability-copy">
												<div>
													<strong>{tool.name}</strong>
													<span className="source-badge">{tool.sourceInfo.source}</span>
												</div>
												<p>{tool.description}</p>
											</div>
											<span className={tool.active ? "active-indicator" : "active-indicator inactive"}>
												{tool.active ? "Active" : "Inactive"}
											</span>
										</article>
									))}
								</div>
							)}

							{tab === "packages" && (
								<div className="capability-list compact">
									{safeCaps.packages.map((entry, index) => (
										<article className="capability-row" key={`pkg-${entry.scope}:${entry.source}-${index}`}>
											<span className="capability-icon package">
												<Package size={17} />
											</span>
											<div className="capability-copy">
												<div>
													<strong>{entry.source}</strong>
													<span className="source-badge">{entry.scope}</span>
													{entry.filtered && <span className="source-badge muted">filtered</span>}
												</div>
												{entry.installedPath && <code>{entry.installedPath}</code>}
											</div>
										</article>
									))}
									{safeCaps.packages.length === 0 && (
										<div className="capability-empty">
											<Package size={25} />
											<strong>还没有配置包</strong>
										</div>
									)}
								</div>
							)}
						</>
					) : null}
				</div>
			</div>
		</section>
	);
}
