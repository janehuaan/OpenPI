import { type FC, useCallback, useEffect, useMemo, useState } from "react";
import { desktopApi } from "../../../../../api";
import {
	Activity,
	AlertCircle,
	Bot,
	Check,
	ChevronDown,
	ChevronRight,
	Cpu,
	ExternalLink,
	Eye,
	EyeOff,
	Globe,
	ImageIcon,
	Pencil,
	Plus,
	RefreshCw,
	Search,
	Server,
	Sparkles,
	Trash2,
	X,
	Zap,
} from "../../../../icons";
import type { AppSettings, ModelProviderConfig } from "../../../../../lib/app-types";
import type {
	AvailableModel,
	ProviderPingResult,
	VisionFallbackConfig,
	VisionFallbackModel,
} from "../../../../../types";

interface ModelsTabProps {
	instanceId?: string;
	onReload?: () => Promise<void>;
}

function formatModelContext(context?: number): string {
	if (!context) return "";
	if (context >= 1_000_000) {
		const m = Math.round(context / 1_000_000);
		return `${m}M 上下文`;
	}
	if (context >= 190_000 && context <= 210_000) return "200K 上下文";
	if (context >= 240_000 && context <= 270_000) return "256K 上下文";
	if (context >= 120_000 && context <= 135_000) return "128K 上下文";
	if (context >= 60_000 && context <= 70_000) return "64K 上下文";
	if (context >= 30_000 && context <= 35_000) return "32K 上下文";
	return `${Math.round(context / 1024)}K 上下文`;
}

export const ModelsTab: FC<ModelsTabProps> = ({ instanceId, onReload }) => {
	const [providers, setProviders] = useState<Record<string, ModelProviderConfig>>({});
	const [modelCatalog, setModelCatalog] = useState<AvailableModel[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Settings
	const [appSettings, setAppSettings] = useState<AppSettings>({});
	const [defaultProvider, setDefaultProvider] = useState<string>("自建");
	const [defaultModel, setDefaultModel] = useState<string>("");
	const [thinkingLevel, setThinkingLevel] = useState<string>("off");

	// Ping states
	const [pingingId, setPingingId] = useState<string | null>(null);
	const [pingResults, setPingResults] = useState<Record<string, ProviderPingResult>>({});

	// Model syncing states (Auto fetch remote models)
	const [syncingProviderId, setSyncingProviderId] = useState<string | null>(null);
	const [syncNotice, setSyncNotice] = useState<{ providerId: string; text: string; ok: boolean } | null>(null);
	const [syncingForm, setSyncingForm] = useState(false);
	const [formNotice, setFormNotice] = useState<{ text: string; ok: boolean } | null>(null);

	// Search & filters for model pool
	const [modelSearch, setModelSearch] = useState("");
	const [modelFilterType, setModelFilterType] = useState<"all" | "reasoning" | "vision">("all");

	// Expanded provider IDs
	const [expandedProviders, setExpandedProviders] = useState<Set<string>>(new Set(["自建"]));

	// Modals & Editing
	const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
	const [isNewProvider, setIsNewProvider] = useState(false);
	const [editFormName, setEditFormName] = useState("");
	const [editFormBaseUrl, setEditFormBaseUrl] = useState("");
	const [editFormApiKey, setEditFormApiKey] = useState("");
	const [showApiKey, setShowApiKey] = useState(false);
	const [editFormApi, setEditFormApi] = useState<string>("openai-completions");
	const [editFormContextWindow, setEditFormContextWindow] = useState<number>(1000000);

	// Batch Operations & Probing
	const [batchMenuOpenId, setBatchMenuOpenId] = useState<string | null>(null);
	const [batchNotice, setBatchNotice] = useState<{ text: string; ok: boolean } | null>(null);
	const [probingProviderId, setProbingProviderId] = useState<string | null>(null);
	const [probingModelId, setProbingModelId] = useState<string | null>(null);

	// Add / Edit Model Modal
	const [addingModelProviderId, setAddingModelProviderId] = useState<string | null>(null);
	const [editingModelId, setEditingModelId] = useState<string | null>(null);
	const [newModelId, setNewModelId] = useState("");
	const [newModelName, setNewModelName] = useState("");
	const [newModelContext, setNewModelContext] = useState<number>(1000000);
	const [newModelReasoning, setNewModelReasoning] = useState(true);
	const [newModelVision, setNewModelVision] = useState(false);

	// Vision Fallback
	const [visionConfig, setVisionConfig] = useState<VisionFallbackConfig | null>(null);
	const [visionModels, setVisionModels] = useState<VisionFallbackModel[]>([]);
	const [visionApiKey, setVisionApiKey] = useState("");
	const [visionModel, setVisionModel] = useState("glm-4.6v-flash");
	const [visionSaving, setVisionSaving] = useState(false);
	const [visionNotice, setVisionNotice] = useState<string | null>(null);

	// Load everything
	const loadData = useCallback(async () => {
		setLoading(true);
		try {
			const [provs, settings, catalog, vf] = await Promise.all([
				desktopApi.getModelProviders().catch(() => ({})),
				desktopApi.getAppSettings().catch(() => null),
				instanceId ? desktopApi.getAvailableModels(instanceId).catch(() => []) : Promise.resolve([]),
				desktopApi.getVisionFallback().catch(() => null),
			]);
			setProviders(provs);
			if (settings) {
				setAppSettings(settings);
				if (settings.defaultProvider) setDefaultProvider(settings.defaultProvider);
				if (settings.defaultModel) setDefaultModel(settings.defaultModel);
				if (settings.defaultThinkingLevel) setThinkingLevel(settings.defaultThinkingLevel);
			}
			if (vf) {
				setVisionConfig(vf);
				setVisionModel(vf.model || "glm-4.6v-flash");
				if (vf.configured) {
					desktopApi.getVisionFallbackModels().then(setVisionModels).catch(() => []);
				}
			}
			setModelCatalog(catalog ?? []);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	}, [instanceId]);

	useEffect(() => {
		void loadData();
	}, [loadData]);

	// Toggle expanded provider card
	const toggleExpand = (providerId: string) => {
		setExpandedProviders((prev) => {
			const next = new Set(prev);
			if (next.has(providerId)) next.delete(providerId);
			else next.add(providerId);
			return next;
		});
	};

	// Save active default model
	const handleSelectDefaultModel = async (modelId: string, providerId: string) => {
		try {
			await desktopApi.updateAppSettings({ defaultModel: modelId, defaultProvider: providerId });
			setDefaultModel(modelId);
			setDefaultProvider(providerId);
			window.dispatchEvent(new Event("openpi:app-settings-changed"));
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	};

	// Save thinking level
	const handleSelectThinkingLevel = async (level: string) => {
		try {
			await desktopApi.updateAppSettings({ defaultThinkingLevel: level });
			setThinkingLevel(level);
			window.dispatchEvent(new Event("openpi:app-settings-changed"));
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	};

	// Ping a provider
	const handlePing = async (providerId: string, baseUrl?: string, apiKey?: string) => {
		const targetUrl = baseUrl || providers[providerId]?.baseUrl;
		if (!targetUrl) return;
		setPingingId(providerId);
		try {
			const res = await desktopApi.pingModelProvider({
				providerId,
				baseUrl: targetUrl,
				apiKey: apiKey ?? providers[providerId]?.apiKey,
			});
			setPingResults((prev) => ({ ...prev, [providerId]: res }));
		} catch (err) {
			setPingResults((prev) => ({
				...prev,
				[providerId]: {
					ok: false,
					status: 0,
					latencyMs: 0,
					message: err instanceof Error ? err.message : String(err),
				},
			}));
		} finally {
			setPingingId(null);
		}
	};

	// Automatically fetch and sync remote models from provider
	const handleSyncModels = async (providerId: string) => {
		setSyncingProviderId(providerId);
		setSyncNotice(null);
		try {
			const res = await desktopApi.fetchProviderRemoteModels({ providerId });
			await loadData();
			setSyncNotice({
				providerId,
				text: `已成功从服务商端点自动同步 ${res.count} 个模型！`,
				ok: true,
			});
			setTimeout(() => setSyncNotice(null), 4000);
			window.dispatchEvent(new Event("openpi:model-providers-changed"));
		} catch (err) {
			setSyncNotice({
				providerId,
				text: `自动获取失败: ${err instanceof Error ? err.message : String(err)}`,
				ok: false,
			});
			setTimeout(() => setSyncNotice(null), 6000);
		} finally {
			setSyncingProviderId(null);
		}
	};

	// Fetch models during provider edit / add form
	const handleSyncFormModels = async () => {
		if (!editFormBaseUrl.trim()) {
			setFormNotice({ text: "请先输入 Base URL", ok: false });
			return;
		}
		setSyncingForm(true);
		setFormNotice(null);
		try {
			const targetId = isNewProvider ? editFormName.trim().toLowerCase().replace(/\s+/g, "-") : editingProviderId;
			const res = await desktopApi.fetchProviderRemoteModels({
				providerId: targetId || undefined,
				baseUrl: editFormBaseUrl.trim(),
				apiKey: editFormApiKey.trim() || undefined,
			});
			await loadData();
			setFormNotice({ text: `已成功从端点获取并同步 ${res.count} 个模型！`, ok: true });
			setTimeout(() => setFormNotice(null), 4000);
			window.dispatchEvent(new Event("openpi:model-providers-changed"));
		} catch (err) {
			setFormNotice({
				text: `获取失败: ${err instanceof Error ? err.message : String(err)}`,
				ok: false,
			});
			setTimeout(() => setFormNotice(null), 6000);
		} finally {
			setSyncingForm(false);
		}
	};

	// Formats model name and initial defaults
	const inferSpecsFromId = (id: string, defaultCtx = 1000000) => {
		const raw = id.trim().toLowerCase();
		if (!raw) return { name: "", context: defaultCtx, reasoning: true, vision: false };

		const name = raw
			.split(/[-_]/)
			.map((p) => p.charAt(0).toUpperCase() + p.slice(1))
			.join(" ")
			.replace(/Gpt/g, "GPT")
			.replace(/Glm/g, "GLM")
			.replace(/Qwen/g, "Qwen")
			.replace(/Kimi/g, "Kimi");

		return { name, context: defaultCtx, reasoning: true, vision: false };
	};

	// Batch Probe All Models in Provider
	const handleBatchProbe = async (providerId: string) => {
		setProbingProviderId(providerId);
		setBatchNotice({ text: "正在对所有模型执行探针测试（测试上下文、最大输出限制与多模态能力）...", ok: true });
		try {
			const res = await desktopApi.batchProbeProviderModels({ providerId });
			await loadData();
			setBatchNotice({
				text: `已成功自动化测定 ${res.count} 个模型的真实上下文与多模态参数！`,
				ok: true,
			});
			setTimeout(() => setBatchNotice(null), 5000);
			window.dispatchEvent(new Event("openpi:model-providers-changed"));
		} catch (err) {
			setBatchNotice({
				text: `自动探测失败: ${err instanceof Error ? err.message : String(err)}`,
				ok: false,
			});
			setTimeout(() => setBatchNotice(null), 6000);
		} finally {
			setProbingProviderId(null);
		}
	};

	// Probe Single Model
	const handleProbeSingleModel = async (providerId: string, modelId: string) => {
		setProbingModelId(modelId);
		try {
			const res = await desktopApi.probeModelCapabilities({ providerId, modelId });
			await loadData();
			const ctxStr = res.contextWindow >= 1000000 ? `${(res.contextWindow / 1000000).toFixed(0)}M` : `${Math.round(res.contextWindow / 1024)}K`;
			const maxStr = res.maxTokens >= 1024 ? `${Math.round(res.maxTokens / 1024)}K` : `${res.maxTokens}`;
			const visStr = res.input.includes("image") ? "🖼️ 支持识图" : "📝 纯文本";
			const reasonStr = res.reasoning ? "🧠 深度思考" : "";
			setBatchNotice({
				text: `「${modelId}」测定完成：上下文 ${ctxStr} · 最大输出 ${maxStr} · ${visStr} ${reasonStr} (耗时 ${res.latencyMs}ms)`,
				ok: true,
			});
			setTimeout(() => setBatchNotice(null), 5000);
			window.dispatchEvent(new Event("openpi:model-providers-changed"));
		} catch (err) {
			setBatchNotice({
				text: `测定失败: ${err instanceof Error ? err.message : String(err)}`,
				ok: false,
			});
			setTimeout(() => setBatchNotice(null), 5000);
		} finally {
			setProbingModelId(null);
		}
	};

	// Batch update models for a provider
	const handleBatchUpdate = async (
		providerId: string,
		updater: (model: any) => any,
		noticeText: string
	) => {
		try {
			const prov = providers[providerId];
			if (!prov || !Array.isArray(prov.models)) return;
			const updatedModels = prov.models.map((m) => {
				const obj = typeof m === "string" ? { id: m, name: m } : { ...m };
				return updater(obj);
			});
			await desktopApi.saveModelProvider(providerId, { ...prov, models: updatedModels as any });
			await loadData();
			setBatchMenuOpenId(null);
			setBatchNotice({ text: noticeText, ok: true });
			setTimeout(() => setBatchNotice(null), 3500);
			window.dispatchEvent(new Event("openpi:model-providers-changed"));
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	};

	// Save provider edit
	const handleSaveProvider = async () => {
		const id = isNewProvider ? editFormName.trim().toLowerCase().replace(/\s+/g, "-") : editingProviderId;
		if (!id) return;
		try {
			const current = providers[id] || {};
			const next: ModelProviderConfig = {
				...current,
				name: editFormName.trim() || id,
				baseUrl: editFormBaseUrl.trim(),
				api: editFormApi,
				enabled: true,
				contextWindow: editFormContextWindow,
			};
			if (editFormApiKey.trim()) next.apiKey = editFormApiKey.trim();
			await desktopApi.saveModelProvider(id, next);
			setEditingProviderId(null);
			setIsNewProvider(false);
			await loadData();
			window.dispatchEvent(new Event("openpi:model-providers-changed"));
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	};

	// Delete provider
	const handleDeleteProvider = async (id: string) => {
		if (!confirm(`确定删除服务商“${providers[id]?.name || id}”？`)) return;
		try {
			await desktopApi.deleteModelProvider(id);
			await loadData();
			window.dispatchEvent(new Event("openpi:model-providers-changed"));
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	};

	// Open Edit Model
	const handleOpenEditModel = (providerId: string, model: any) => {
		setAddingModelProviderId(providerId);
		setEditingModelId(model.id);
		setNewModelId(model.id);
		setNewModelName(model.name || model.id);
		setNewModelContext(model.context || 131072);
		setNewModelReasoning(Boolean(model.reasoning));
		setNewModelVision(Boolean(model.vision));
	};

	// Add or Update Model in Provider
	const handleAddModel = async () => {
		if (!addingModelProviderId || !newModelId.trim()) return;
		try {
			const prov = providers[addingModelProviderId];
			if (!prov) return;
			const currentModels = Array.isArray(prov.models) ? [...prov.models] : [];
			const modelObj = {
				id: newModelId.trim(),
				name: newModelName.trim() || newModelId.trim(),
				reasoning: newModelReasoning,
				contextWindow: newModelContext,
				maxTokens: Math.min(newModelContext, 65536),
				input: newModelVision ? ["text", "image"] : ["text"],
			};

			let nextModels: any[];
			if (editingModelId) {
				nextModels = currentModels.map((m) => {
					const mId = typeof m === "string" ? m : m.id;
					if (mId === editingModelId) {
						return {
							...(typeof m === "object" ? m : {}),
							...modelObj,
						};
					}
					return m;
				});
			} else {
				nextModels = [...currentModels, modelObj];
			}

			await desktopApi.saveModelProvider(addingModelProviderId, { ...prov, models: nextModels as any });
			setAddingModelProviderId(null);
			setEditingModelId(null);
			setNewModelId("");
			setNewModelName("");
			await loadData();
			window.dispatchEvent(new Event("openpi:model-providers-changed"));
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	};

	// Delete Model from Provider
	const handleDeleteModel = async (providerId: string, modelId: string) => {
		if (!confirm(`确定从服务商中移除模型“${modelId}”？`)) return;
		try {
			const prov = providers[providerId];
			if (!prov) return;
			const currentModels = Array.isArray(prov.models) ? prov.models : [];
			const nextModels = currentModels.filter((m) => (typeof m === "string" ? m : m.id) !== modelId);
			await desktopApi.saveModelProvider(providerId, { ...prov, models: nextModels as any });
			await loadData();
			window.dispatchEvent(new Event("openpi:model-providers-changed"));
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	};

	// Vision Fallback Actions
	const handleToggleVisionFallback = async () => {
		if (!visionConfig?.configured && !visionApiKey.trim()) {
			setVisionNotice("请先输入智谱 API Key");
			return;
		}
		setVisionSaving(true);
		try {
			const next = await desktopApi.configureVisionFallback({
				enabled: !visionConfig?.enabled,
				model: visionModel,
				...(visionApiKey.trim() ? { apiKey: visionApiKey.trim() } : {}),
			});
			setVisionConfig(next);
			setVisionModel(next.model);
			setVisionNotice(next.enabled ? "视觉辅助已开启" : "视觉辅助已关闭");
			setTimeout(() => setVisionNotice(null), 2500);
		} catch (caught) {
			setVisionNotice(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setVisionSaving(false);
		}
	};

	const handleSaveVisionFallback = async () => {
		setVisionSaving(true);
		try {
			const next = await desktopApi.configureVisionFallback({
				enabled: visionConfig?.enabled !== false,
				model: visionModel,
				...(visionApiKey.trim() ? { apiKey: visionApiKey.trim() } : {}),
			});
			setVisionConfig(next);
			setVisionModel(next.model);
			setVisionApiKey("");
			setVisionNotice("智谱视觉辅助已更新");
			setTimeout(() => setVisionNotice(null), 2500);
			const models = await desktopApi.getVisionFallbackModels().catch(() => []);
			setVisionModels(models);
		} catch (caught) {
			setVisionNotice(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setVisionSaving(false);
		}
	};

	// All available models flattened
	const allModels = useMemo(() => {
		const out: Array<{ provider: string; id: string; name: string; reasoning?: boolean; vision?: boolean; context?: number }> = [];
		for (const [pId, pCfg] of Object.entries(providers)) {
			if (!pCfg?.models || !Array.isArray(pCfg.models)) continue;
			for (const m of pCfg.models) {
				const id = typeof m === "string" ? m : m.id;
				const name = typeof m === "object" && m.name ? m.name : id;
				const reasoning = typeof m === "object" ? Boolean(m.reasoning) : false;
				const vision = typeof m === "object" && Array.isArray(m.input) ? m.input.includes("image") : false;
				const context = typeof m === "object" && typeof m.contextWindow === "number" ? m.contextWindow : 32768;
				out.push({ provider: pId, id, name, reasoning, vision, context });
			}
		}
		return out;
	}, [providers]);

	// Filtered model pool for the active expanded provider
	const getFilteredModels = (providerId: string) => {
		const prov = providers[providerId];
		if (!prov || !Array.isArray(prov.models)) return [];
		return prov.models
			.map((m) => {
				const id = typeof m === "string" ? m : m.id;
				const name = typeof m === "object" && m.name ? m.name : id;
				const reasoning = typeof m === "object" ? Boolean(m.reasoning) : false;
				const vision = typeof m === "object" && Array.isArray(m.input) ? m.input.includes("image") : false;
				const context = typeof m === "object" && typeof m.contextWindow === "number" ? m.contextWindow : undefined;
				return { id, name, reasoning, vision, context };
			})
			.filter((m) => {
				if (modelFilterType === "reasoning" && !m.reasoning) return false;
				if (modelFilterType === "vision" && !m.vision) return false;
				if (modelSearch.trim()) {
					const query = modelSearch.trim().toLowerCase();
					return m.id.toLowerCase().includes(query) || m.name.toLowerCase().includes(query);
				}
				return true;
			});
	};

	return (
		<div className="settings-scroll-wrapper">
			{error && (
				<div className="model-providers-error">
					<span>{error}</span>
					<button type="button" onClick={() => setError(null)}>
						<X size={14} />
					</button>
				</div>
			)}

			{/* ── 1. Hero Active Model Card ── */}
			<section className="hero-active-model-card">
				<div className="hero-model-top">
					<div className="hero-model-info">
						<div className="hero-model-avatar">
							<Bot size={24} />
						</div>
						<div className="hero-model-details">
							<span className="hero-model-tag">
								<Sparkles size={12} /> 当前主力对话模型
							</span>
							<span className="hero-model-name">{defaultModel || "(未设置主力模型)"}</span>
							<span className="hero-model-provider">服务商: {defaultProvider}</span>
						</div>
					</div>

					<div className="hero-model-actions">
						<div className="hero-select-wrapper">
							<select
								className="hero-select"
								value={defaultModel}
								onChange={(e) => {
									const nextModel = e.target.value;
									const match = allModels.find((m) => m.id === nextModel);
									if (match) handleSelectDefaultModel(match.id, match.provider);
									else setDefaultModel(nextModel);
								}}
							>
								<option value="">快速切换主力模型…</option>
								{allModels.map((m) => (
									<option key={`${m.provider}/${m.id}`} value={m.id}>
										{m.name} ({m.provider})
									</option>
								))}
							</select>
							<ChevronDown size={14} className="hero-select-icon" />
						</div>

						<button
							type="button"
							className="button secondary"
							style={{ padding: "8px 12px", fontSize: "12px", display: "flex", alignItems: "center", gap: "6px" }}
							disabled={pingingId === defaultProvider}
							onClick={() => handlePing(defaultProvider)}
							title="测试当前主力服务商连接"
						>
							<Activity size={14} className={pingingId === defaultProvider ? "spin" : ""} />
							<span>{pingingId === defaultProvider ? "测试中…" : "连通性测试"}</span>
						</button>
					</div>
				</div>

				{/* Latency Pill if tested */}
				{pingResults[defaultProvider] && (
					<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
						<span className={`latency-pill ${pingResults[defaultProvider].ok ? "ok" : "fail"}`}>
							<span className="latency-dot" />
							{pingResults[defaultProvider].ok
								? `连通正常 · ${pingResults[defaultProvider].latencyMs}ms (HTTP ${pingResults[defaultProvider].status})`
								: `连通异常 · ${pingResults[defaultProvider].message || "无法访问"}`}
						</span>
					</div>
				)}

				{/* Thinking Budget Segmented Controller */}
				<div className="thinking-budget-row">
					<div className="thinking-budget-left">
						<strong>
							<Cpu size={14} /> 思考预算等级 (Thinking Level)
						</strong>
						<span>控制模型深度思考推导的上下文配额</span>
					</div>
					<div className="segmented-pill-group">
						{[
							{ id: "off", label: "Off 极速" },
							{ id: "low", label: "Low 轻度" },
							{ id: "medium", label: "Medium 标准" },
							{ id: "high", label: "High 深度" },
							{ id: "max", label: "Max 极客" },
						].map((item) => (
							<button
								key={item.id}
								type="button"
								className={`segmented-pill-btn ${thinkingLevel === item.id ? "active" : ""}`}
								onClick={() => handleSelectThinkingLevel(item.id)}
							>
								{item.label}
							</button>
						))}
					</div>
				</div>
			</section>

			{/* ── 2. Configured Providers & Model Pool ── */}
			<section className="settings-section-card">
				<div className="settings-section-card-header">
					<div className="settings-section-card-header-left">
						<div className="settings-section-card-icon">
							<Server size={18} />
						</div>
						<div className="settings-section-card-title">
							<h3>已配置模型服务商 ({Object.keys(providers).length})</h3>
							<span>管理自定义端点、API 凭据与挂载的模型池</span>
						</div>
					</div>

					<button
						type="button"
						className="button primary"
						style={{ padding: "6px 12px", fontSize: "12px", display: "flex", alignItems: "center", gap: "6px" }}
						onClick={() => {
							setIsNewProvider(true);
							setEditingProviderId(null);
							setShowApiKey(false);
							setEditFormName("");
							setEditFormBaseUrl("");
							setEditFormApiKey("");
							setEditFormApi("openai-completions");
							setEditFormContextWindow(1000000);
						}}
					>
						<Plus size={14} />
						<span>添加服务商</span>
					</button>
				</div>

				<div className="settings-section-card-body">
					{Object.keys(providers).length === 0 ? (
						<div className="product-empty">
							<Server size={32} />
							<strong>暂无已配置的服务商</strong>
							<span>点击上方“添加服务商”快速连接你的自建服务或云端 API</span>
						</div>
					) : (
						<div className="providers-card-list">
							{Object.entries(providers).map(([pId, pCfg]) => {
								const isExpanded = expandedProviders.has(pId);
								const modelsList = getFilteredModels(pId);
								const totalCount = Array.isArray(pCfg.models) ? pCfg.models.length : 0;
								const isCurrentDefault = defaultProvider === pId;

								return (
									<div key={pId} className="provider-item-card">
										{/* Provider Card Header */}
										<div className="provider-item-header" onClick={() => toggleExpand(pId)}>
											<div className="provider-item-header-left">
												<div className="provider-item-avatar">
													<Globe size={18} />
												</div>
												<div className="provider-item-meta">
													<div className="provider-item-title-row">
														<strong>{pCfg.name || pId}</strong>
														{isCurrentDefault && <span className="provider-badge active">主力服务商</span>}
														<span className="provider-badge">{pCfg.api || "openai-completions"}</span>
														<span className="provider-badge">{totalCount} 个模型</span>
													</div>
													<span className="provider-item-url">{pCfg.baseUrl || "默认端点"}</span>
												</div>
											</div>

											<div className="provider-item-header-right" onClick={(e) => e.stopPropagation()}>
												{/* Ping Result Pill */}
												{pingResults[pId] && (
													<span className={`latency-pill ${pingResults[pId].ok ? "ok" : "fail"}`}>
														<span className="latency-dot" />
														{pingResults[pId].ok ? `${pingResults[pId].latencyMs}ms` : "连接异常"}
													</span>
												)}

												<button
													type="button"
													className="icon-button quiet"
													title="自动获取/同步远程模型列表"
													aria-label="自动获取/同步远程模型列表"
													disabled={syncingProviderId === pId}
													onClick={() => void handleSyncModels(pId)}
												>
													<RefreshCw size={14} className={syncingProviderId === pId ? "spin" : ""} />
												</button>

												<button
													type="button"
													className="icon-button quiet"
													title="连通性测试"
													disabled={pingingId === pId}
													onClick={() => handlePing(pId)}
												>
													<Activity size={14} className={pingingId === pId ? "spin" : ""} />
												</button>

												<button
													type="button"
													className="icon-button quiet"
													title="添加模型"
													onClick={() => {
														setAddingModelProviderId(pId);
														setNewModelId("");
														setNewModelName("");
														setNewModelContext(32768);
													}}
												>
													<Plus size={14} />
												</button>

												<button
													type="button"
													className="icon-button quiet"
													title="编辑服务商"
													onClick={() => {
														setEditingProviderId(pId);
														setIsNewProvider(false);
														setShowApiKey(false);
														setEditFormName(pCfg.name || pId);
														setEditFormBaseUrl(pCfg.baseUrl || "");
														setEditFormApiKey("");
														setEditFormApi(pCfg.api || "openai-completions");
														setEditFormContextWindow(pCfg.contextWindow || 1000000);
													}}
												>
													<Pencil size={14} />
												</button>

												<button
													type="button"
													className="icon-button quiet danger"
													title="删除服务商"
													onClick={() => handleDeleteProvider(pId)}
												>
													<Trash2 size={14} />
												</button>

												<div style={{ marginLeft: "4px", color: "var(--text-tertiary)" }}>
													{isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
												</div>
											</div>
										</div>

										{/* Provider Expanded Body (Model Pool Grid) */}
										{isExpanded && (
											<div className="provider-item-body">
												{/* Search & Filter Toolbar */}
												<div className="model-pool-header">
													<div className="model-pool-search-input">
														<Search size={14} style={{ color: "var(--text-tertiary)" }} />
														<input
															type="text"
															placeholder={`在 ${pCfg.name || pId} 的 ${totalCount} 个模型中搜索 (如 claude, gemini, qwen)...`}
															value={modelSearch}
															onChange={(e) => setModelSearch(e.target.value)}
														/>
														{modelSearch && (
															<button
																type="button"
																className="icon-button quiet"
																style={{ width: 18, height: 18 }}
																onClick={() => setModelSearch("")}
															>
																<X size={12} />
															</button>
														)}
													</div>

													<div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
														<button
															type="button"
															className="button secondary"
															style={{
																height: "32px",
																padding: "0 12px",
																fontSize: "12px",
																display: "inline-flex",
																alignItems: "center",
																gap: "6px",
																borderRadius: "999px",
															}}
															disabled={syncingProviderId === pId}
															onClick={() => void handleSyncModels(pId)}
														>
															<RefreshCw size={13} className={syncingProviderId === pId ? "spin" : ""} />
															<span>{syncingProviderId === pId ? "正在获取模型..." : "自动同步模型"}</span>
														</button>

														<button
															type="button"
															className="button secondary"
															style={{
																height: "32px",
																padding: "0 12px",
																fontSize: "12px",
																display: "inline-flex",
																alignItems: "center",
																gap: "6px",
																borderRadius: "999px",
																borderColor: "rgba(56, 189, 248, 0.4)",
															}}
															disabled={probingProviderId === pId}
															onClick={() => void handleBatchProbe(pId)}
															title="自动化探测所有模型的真实上下文、最大输出限制、思考推理与多模态能力"
														>
															<Activity size={13} className={probingProviderId === pId ? "spin" : ""} style={{ color: "#38bdf8" }} />
															<span>{probingProviderId === pId ? "正在测定能力..." : "自动测定能力"}</span>
														</button>

														{/* ⚡ Batch Operations Dropdown */}
														<div style={{ position: "relative" }}>
															<button
																type="button"
																className="button secondary"
																style={{
																	height: "32px",
																	padding: "0 12px",
																	fontSize: "12px",
																	display: "inline-flex",
																	alignItems: "center",
																	gap: "6px",
																	borderRadius: "999px",
																}}
																onClick={() => setBatchMenuOpenId(batchMenuOpenId === pId ? null : pId)}
															>
																<Zap size={13} style={{ color: "#f59e0b" }} />
																<span>批量操作</span>
																<ChevronDown size={12} />
															</button>

															{batchMenuOpenId === pId && (
																<div
																	style={{
																		position: "absolute",
																		top: "calc(100% + 6px)",
																		right: 0,
																		width: "210px",
																		background: "var(--bg-glass-strong, rgba(28, 28, 30, 0.96))",
																		border: "1px solid var(--border-subtle, rgba(255, 255, 255, 0.18))",
																		borderRadius: "12px",
																		padding: "6px",
																		boxShadow: "0 12px 32px rgba(0, 0, 0, 0.4)",
																		backdropFilter: "blur(20px)",
																		zIndex: 50,
																		display: "flex",
																		flexDirection: "column",
																		gap: "2px",
																	}}
																>
																	<button
																		type="button"
																		className="dropdown-item"
																		style={{
																			display: "flex",
																			alignItems: "center",
																			gap: "8px",
																			padding: "8px 10px",
																			borderRadius: "8px",
																			fontSize: "12px",
																			border: "none",
																			background: "transparent",
																			color: "#38bdf8",
																			fontWeight: 600,
																			cursor: "pointer",
																			textAlign: "left",
																		}}
																		onClick={() => {
																			setBatchMenuOpenId(null);
																			void handleBatchProbe(pId);
																		}}
																	>
																		<span>🧪 批量执行能力探针测试</span>
																	</button>
																	<div style={{ height: "1px", background: "rgba(255, 255, 255, 0.1)", margin: "4px 0" }} />
																	<button
																		type="button"
																		className="dropdown-item"
																		style={{
																			display: "flex",
																			alignItems: "center",
																			gap: "8px",
																			padding: "8px 10px",
																			borderRadius: "8px",
																			fontSize: "12px",
																			border: "none",
																			background: "transparent",
																			color: "inherit",
																			cursor: "pointer",
																			textAlign: "left",
																		}}
																		onClick={() =>
																			handleBatchUpdate(
																				pId,
																				(m) => ({ ...m, contextWindow: 1000000, maxTokens: 65536 }),
																				"已将当前服务商全部模型上下文设为 1M"
																			)
																		}
																	>
																		<span>⚡ 全部设为 1M 上下文</span>
																	</button>
																	<button
																		type="button"
																		className="dropdown-item"
																		style={{
																			display: "flex",
																			alignItems: "center",
																			gap: "8px",
																			padding: "8px 10px",
																			borderRadius: "8px",
																			fontSize: "12px",
																			border: "none",
																			background: "transparent",
																			color: "inherit",
																			cursor: "pointer",
																			textAlign: "left",
																		}}
																		onClick={() =>
																			handleBatchUpdate(
																				pId,
																				(m) => ({ ...m, contextWindow: 262144, maxTokens: 65536 }),
																				"已将当前服务商全部模型上下文设为 256K"
																			)
																		}
																	>
																		<span>⚡ 全部设为 256K 上下文</span>
																	</button>
																	<button
																		type="button"
																		className="dropdown-item"
																		style={{
																			display: "flex",
																			alignItems: "center",
																			gap: "8px",
																			padding: "8px 10px",
																			borderRadius: "8px",
																			fontSize: "12px",
																			border: "none",
																			background: "transparent",
																			color: "inherit",
																			cursor: "pointer",
																			textAlign: "left",
																		}}
																		onClick={() =>
																			handleBatchUpdate(
																				pId,
																				(m) => ({ ...m, contextWindow: 131072, maxTokens: 65536 }),
																				"已将当前服务商全部模型上下文设为 128K"
																			)
																		}
																	>
																		<span>⚡ 全部设为 128K 上下文</span>
																	</button>
																	<div style={{ height: "1px", background: "rgba(255, 255, 255, 0.1)", margin: "4px 0" }} />
																	<button
																		type="button"
																		className="dropdown-item"
																		style={{
																			display: "flex",
																			alignItems: "center",
																			gap: "8px",
																			padding: "8px 10px",
																			borderRadius: "8px",
																			fontSize: "12px",
																			border: "none",
																			background: "transparent",
																			color: "inherit",
																			cursor: "pointer",
																			textAlign: "left",
																		}}
																		onClick={() =>
																			handleBatchUpdate(
																				pId,
																				(m) => {
																					const inferred = inferSpecsFromId(m.id || "", pCfg.contextWindow || 1000000);
																					return {
																						...m,
																						name: m.name || inferred.name,
																						contextWindow: inferred.context,
																						reasoning: inferred.reasoning,
																						input: inferred.vision ? ["text", "image"] : (m.input || ["text"]),
																					};
																				},
																				"已智能重构当前服务商全部模型的参数与能力"
																			)
																		}
																	>
																		<span>🧠 智能识别并对齐全部</span>
																	</button>
																</div>
															)}
														</div>

														<div className="segmented-pill-group">
															<button
																type="button"
																className={`segmented-pill-btn ${modelFilterType === "all" ? "active" : ""}`}
																onClick={() => setModelFilterType("all")}
															>
																全部 ({totalCount})
															</button>
															<button
																type="button"
																className={`segmented-pill-btn ${modelFilterType === "reasoning" ? "active" : ""}`}
																onClick={() => setModelFilterType("reasoning")}
															>
																🧠 思考推理
															</button>
															<button
																type="button"
																className={`segmented-pill-btn ${modelFilterType === "vision" ? "active" : ""}`}
																onClick={() => setModelFilterType("vision")}
															>
																🖼️ 视觉识图
															</button>
														</div>
													</div>
												</div>

												{batchNotice && (
													<div
														style={{
															padding: "8px 14px",
															borderRadius: "10px",
															fontSize: "12px",
															fontWeight: 550,
															background: batchNotice.ok ? "rgba(16, 185, 129, 0.14)" : "rgba(239, 68, 68, 0.14)",
															color: batchNotice.ok ? "#059669" : "#dc2626",
															border: `1px solid ${batchNotice.ok ? "rgba(16, 185, 129, 0.3)" : "rgba(239, 68, 68, 0.3)"}`,
															display: "flex",
															alignItems: "center",
															gap: "8px",
															backdropFilter: "blur(16px)",
														}}
													>
														<Check size={14} />
														<span>{batchNotice.text}</span>
													</div>
												)}

												{syncNotice && syncNotice.providerId === pId && (
													<div
														style={{
															padding: "8px 14px",
															borderRadius: "10px",
															fontSize: "12px",
															fontWeight: 550,
															background: syncNotice.ok ? "rgba(16, 185, 129, 0.14)" : "rgba(239, 68, 68, 0.14)",
															color: syncNotice.ok ? "#059669" : "#dc2626",
															border: `1px solid ${syncNotice.ok ? "rgba(16, 185, 129, 0.3)" : "rgba(239, 68, 68, 0.3)"}`,
															display: "flex",
															alignItems: "center",
															gap: "8px",
															backdropFilter: "blur(16px)",
														}}
													>
														{syncNotice.ok ? <Check size={14} /> : <AlertCircle size={14} />}
														<span>{syncNotice.text}</span>
													</div>
												)}

												{/* Models Grid */}
												{modelsList.length === 0 ? (
													<div style={{ padding: "20px", textAlign: "center", color: "var(--text-tertiary)", fontSize: "12px" }}>
														没有找到匹配的模型
													</div>
												) : (
													<div className="model-pool-grid">
														{modelsList.map((m) => {
															const isDef = defaultModel === m.id && defaultProvider === pId;
															return (
																<div key={m.id} className={`model-badge-card ${isDef ? "is-default" : ""}`}>
																	<div className="model-badge-card-top">
																		<span className="model-badge-card-name" title={m.name}>
																			{m.name}
																		</span>
																	</div>

																	<span className="model-badge-card-id" title={m.id}>
																		{m.id}
																	</span>

																	<div className="model-badge-card-tags">
																		{m.context ? (
																			<span className="model-attr-tag">
																				{formatModelContext(m.context)}
																			</span>
																		) : null}
																		{m.reasoning && <span className="model-attr-tag">🧠 深度推理</span>}
																		{m.vision && <span className="model-attr-tag">🖼️ 视觉模态</span>}
																	</div>

																	<div className="model-badge-card-actions">
																		<button
																			type="button"
																			className={`btn-set-default ${isDef ? "current" : ""}`}
																			disabled={isDef}
																			onClick={() => handleSelectDefaultModel(m.id, pId)}
																		>
																			{isDef ? "✓ 当前主力" : "设为主力"}
																		</button>
																		<div className="model-badge-card-buttons">
																			<button
																				type="button"
																				className="icon-button quiet"
																				style={{ width: 22, height: 22, padding: 0 }}
																				title="执行探针测试当前模型的真实上下文与多模态能力"
																				disabled={probingModelId === m.id}
																				onClick={(e) => {
																					e.stopPropagation();
																					void handleProbeSingleModel(pId, m.id);
																				}}
																			>
																				<Activity size={12} className={probingModelId === m.id ? "spin" : ""} style={{ color: "#38bdf8" }} />
																			</button>
																			<button
																				type="button"
																				className="icon-button quiet"
																				style={{ width: 22, height: 22, padding: 0 }}
																				title="编辑模型参数与上下文"
																				onClick={() => handleOpenEditModel(pId, m)}
																			>
																				<Pencil size={12} />
																			</button>
																			<button
																				type="button"
																				className="icon-button quiet danger"
																				style={{ width: 22, height: 22, padding: 0 }}
																				title="移除此模型"
																				onClick={() => handleDeleteModel(pId, m.id)}
																			>
																				<Trash2 size={12} />
																			</button>
																		</div>
																	</div>
																</div>
															);
														})}
													</div>
												)}
											</div>
										)}
									</div>
								);
							})}
						</div>
					)}
				</div>
			</section>

			{/* ── 3. Vision Fallback Card ── */}
			<section className="settings-section-card">
				<div className="settings-section-card-header">
					<div className="settings-section-card-header-left">
						<div className="settings-section-card-icon">
							<ImageIcon size={18} />
						</div>
						<div className="settings-section-card-title">
							<h3>智谱视觉辅助回退 (GLM Vision Fallback)</h3>
							<span>当主力对话模型不支持多模态图片输入时，自动调度 GLM-4.6V 进行图像理解与 OCR</span>
						</div>
					</div>

					<label className="modern-switch">
						<input
							type="checkbox"
							checked={Boolean(visionConfig?.enabled)}
							disabled={visionSaving || (!visionConfig?.configured && !visionApiKey.trim())}
							onChange={() => void handleToggleVisionFallback()}
						/>
						<span className="modern-slider" />
					</label>
				</div>

				<div className="settings-section-card-body">
					<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: "12px", alignItems: "end" }}>
						<label className="model-form-field">
							<span>智谱 API Key</span>
							<input
								type="password"
								value={visionApiKey}
								placeholder={visionConfig?.configured ? "已配置智谱密钥 (留空保持不变)" : "输入智谱 API Key"}
								onChange={(e) => setVisionApiKey(e.target.value)}
							/>
						</label>

						<label className="model-form-field">
							<span>视觉模型</span>
							<select
								value={visionModel}
								disabled={!visionConfig?.configured && !visionApiKey.trim()}
								onChange={(e) => setVisionModel(e.target.value)}
							>
								{(visionModels.length > 0
									? visionModels
									: [
											{ id: "glm-4.6v-flash", name: "GLM-4.6V Flash", inputPrice: 0, outputPrice: 0, priceLabel: "免费" },
											{ id: "glm-4.6v-plus", name: "GLM-4.6V Plus", inputPrice: 0, outputPrice: 0, priceLabel: "高阶" },
										]
								).map((m) => (
									<option key={m.id} value={m.id}>
										{m.name} · {m.priceLabel}
									</option>
								))}
							</select>
						</label>

						<button
							type="button"
							className="button primary"
							disabled={visionSaving || (!visionApiKey.trim() && !visionConfig?.configured)}
							style={{ height: "36px", padding: "0 16px" }}
							onClick={() => void handleSaveVisionFallback()}
						>
							<span>{visionSaving ? "保存中..." : "保存视觉配置"}</span>
						</button>
					</div>

					{visionNotice && (
						<div style={{ marginTop: "10px", fontSize: "12px", color: "var(--accent)", fontWeight: 500 }}>
							{visionNotice}
						</div>
					)}
				</div>
			</section>

			{/* ── Modal: Edit / Add Provider ── */}
			{(editingProviderId || isNewProvider) && (
				<div
					style={{
						position: "fixed",
						inset: 0,
						background: "rgba(0, 0, 0, 0.45)",
						display: "grid",
						placeItems: "center",
						zIndex: 9999,
						padding: "20px",
					}}
					onClick={() => {
						setEditingProviderId(null);
						setIsNewProvider(false);
					}}
				>
					<div
						className="settings-section-card"
						style={{ width: "100%", maxWidth: "520px", boxShadow: "0 12px 36px rgba(0,0,0,0.25)" }}
						onClick={(e) => e.stopPropagation()}
					>
						<div className="settings-section-card-header">
							<div className="settings-section-card-header-left">
								<div className="settings-section-card-icon">
									<Server size={18} />
								</div>
								<div className="settings-section-card-title">
									<h3>{isNewProvider ? "添加自定义模型服务商" : `编辑服务商 · ${editingProviderId}`}</h3>
									<span>配置服务商端点、鉴权密钥与调用协议</span>
								</div>
							</div>
							<button
								type="button"
								className="icon-button quiet"
								onClick={() => {
									setEditingProviderId(null);
									setIsNewProvider(false);
								}}
							>
								<X size={16} />
							</button>
						</div>

						<div className="settings-section-card-body" style={{ gap: "14px" }}>
							<label className="model-form-field">
								<span>服务商显示名称</span>
								<input
									type="text"
									placeholder="例如 自建代理、OpenAI、DeepSeek"
									value={editFormName}
									onChange={(e) => setEditFormName(e.target.value)}
								/>
							</label>

							<label className="model-form-field">
								<span>Base URL (API 端点地址)</span>
								<input
									type="text"
									placeholder="例如 http://127.0.0.1:8089/v1 或 https://api.openai.com/v1"
									value={editFormBaseUrl}
									onChange={(e) => setEditFormBaseUrl(e.target.value)}
								/>
							</label>

							<label className="model-form-field">
								<span>API Key (密钥)</span>
								<div className="model-input-with-action">
									<input
										type={showApiKey ? "text" : "password"}
										placeholder={isNewProvider ? "sk-..." : "留空则保持现有密钥不变"}
										value={editFormApiKey}
										onChange={(e) => setEditFormApiKey(e.target.value)}
									/>
									<button
										type="button"
										className="model-input-action-btn"
										title={showApiKey ? "隐藏密钥" : "显示密钥"}
										aria-label={showApiKey ? "隐藏密钥" : "显示密钥"}
										onClick={() => setShowApiKey((v) => !v)}
									>
										{showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
									</button>
								</div>
							</label>

							<label className="model-form-field">
								<span>接口协议</span>
								<select value={editFormApi} onChange={(e) => setEditFormApi(e.target.value)}>
									<option value="openai-completions">OpenAI Completions (/v1/chat/completions)</option>
									<option value="anthropic-messages">Anthropic Messages (/v1/messages)</option>
									<option value="openai-responses">OpenAI Responses</option>
								</select>
							</label>

							<label className="model-form-field">
								<span>新模型默认上下文 (端点拉取或新增模型时自动应用)</span>
								<select
									value={editFormContextWindow}
									onChange={(e) => setEditFormContextWindow(Number(e.target.value))}
								>
									<option value={1000000}>1M (1,000,000 · 默认推荐 / 大上下文)</option>
									<option value={2000000}>2M (2,000,000 · 超长上下文)</option>
									<option value={262144}>256K (262,144 · 如 Kimi/SenseNova)</option>
									<option value={200000}>200K (200,000 · 如 Claude 3.7/GLM-5)</option>
									<option value={131072}>128K (131,072 · 如 DeepSeek/Qwen)</option>
									<option value={65536}>64K (65,536)</option>
									<option value={32768}>32K (32,768 · 如 视觉生图模型)</option>
								</select>
							</label>

							<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", borderRadius: "10px", background: "rgba(255, 255, 255, 0.12)", border: "1px solid rgba(255, 255, 255, 0.25)" }}>
								<div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
									<strong style={{ fontSize: "12.5px" }}>从端点自动拉取模型</strong>
									<span style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>连接端点自动解析支持的模型清单并载入模型池</span>
								</div>
								<button
									type="button"
									className="button secondary"
									style={{ height: "30px", padding: "0 12px", fontSize: "12px", display: "inline-flex", alignItems: "center", gap: "6px" }}
									disabled={syncingForm || !editFormBaseUrl.trim()}
									onClick={() => void handleSyncFormModels()}
								>
									<RefreshCw size={13} className={syncingForm ? "spin" : ""} />
									<span>{syncingForm ? "正在获取..." : "自动获取模型"}</span>
								</button>
							</div>

							{formNotice && (
								<div
									style={{
										padding: "8px 12px",
										borderRadius: "8px",
										fontSize: "12px",
										fontWeight: 550,
										background: formNotice.ok ? "rgba(16, 185, 129, 0.14)" : "rgba(239, 68, 68, 0.14)",
										color: formNotice.ok ? "#059669" : "#dc2626",
										border: `1px solid ${formNotice.ok ? "rgba(16, 185, 129, 0.3)" : "rgba(239, 68, 68, 0.3)"}`,
										display: "flex",
										alignItems: "center",
										gap: "6px",
									}}
								>
									{formNotice.ok ? <Check size={14} /> : <AlertCircle size={14} />}
									<span>{formNotice.text}</span>
								</div>
							)}

							<div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "10px" }}>
								<button
									type="button"
									className="button secondary"
									onClick={() => {
										setEditingProviderId(null);
										setIsNewProvider(false);
									}}
								>
									取消
								</button>
								<button type="button" className="button primary" onClick={() => void handleSaveProvider()}>
									保存服务商
								</button>
							</div>
						</div>
					</div>
				</div>
			)}

			{/* ── Modal: Add / Edit Model in Provider ── */}
			{addingModelProviderId && (
				<div
					style={{
						position: "fixed",
						inset: 0,
						background: "rgba(0, 0, 0, 0.45)",
						display: "grid",
						placeItems: "center",
						zIndex: 9999,
						padding: "20px",
					}}
					onClick={() => {
						setAddingModelProviderId(null);
						setEditingModelId(null);
					}}
				>
					<div
						className="settings-section-card"
						style={{ width: "100%", maxWidth: "480px", boxShadow: "0 12px 36px rgba(0,0,0,0.25)" }}
						onClick={(e) => e.stopPropagation()}
					>
						<div className="settings-section-card-header">
							<div className="settings-section-card-header-left">
								<div className="settings-section-card-icon">
									{editingModelId ? <Pencil size={18} /> : <Plus size={18} />}
								</div>
								<div className="settings-section-card-title">
									<h3>{editingModelId ? "编辑模型参数" : "挂载新模型"}</h3>
									<span>
										{editingModelId
											? `配置「${editingModelId}」的上下文与能力特性`
											: `添加到服务商「${providers[addingModelProviderId]?.name || addingModelProviderId}」`}
									</span>
								</div>
							</div>
							<button
								type="button"
								className="icon-button quiet"
								onClick={() => {
									setAddingModelProviderId(null);
									setEditingModelId(null);
								}}
							>
								<X size={16} />
							</button>
						</div>

						<div className="settings-section-card-body" style={{ gap: "14px" }}>
							<label className="model-form-field">
								<span>模型 ID (唯一标识，需与服务端完全一致)</span>
								<input
									type="text"
									placeholder="例如 claude-3-7-sonnet、gemini-2.5-flash"
									value={newModelId}
									disabled={Boolean(editingModelId)}
									style={editingModelId ? { opacity: 0.7, cursor: "not-allowed" } : {}}
									onChange={(e) => {
										const val = e.target.value;
										setNewModelId(val);
										if (!editingModelId && val.trim()) {
											const defaultCtx = (addingModelProviderId && providers[addingModelProviderId]?.contextWindow) || 1000000;
											const inferred = inferSpecsFromId(val, defaultCtx);
											if (!newModelName || newModelName === newModelId) {
												setNewModelName(inferred.name);
											}
											setNewModelContext(inferred.context);
											setNewModelReasoning(inferred.reasoning);
											setNewModelVision(inferred.vision);
										}
									}}
								/>
							</label>

							<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "10px" }}>
								<label className="model-form-field" style={{ flex: 1, margin: 0 }}>
									<span>显示别名 (可选)</span>
									<input
										type="text"
										placeholder="例如 Claude 3.7 Sonnet"
										value={newModelName}
										onChange={(e) => setNewModelName(e.target.value)}
									/>
								</label>
								<button
									type="button"
									className="button secondary"
									style={{ height: "36px", padding: "0 10px", fontSize: "11.5px", display: "inline-flex", alignItems: "center", gap: "5px", flexShrink: 0 }}
									disabled={probingModelId === newModelId || !newModelId.trim() || !addingModelProviderId}
									title="向端点发送轻量探针，自动测定真实多模态识图与上下文上限"
									onClick={async () => {
										if (!newModelId.trim() || !addingModelProviderId) return;
										setProbingModelId(newModelId.trim());
										try {
											const res = await desktopApi.probeModelCapabilities({
												providerId: addingModelProviderId,
												modelId: newModelId.trim(),
											});
											setNewModelContext(res.contextWindow);
											setNewModelReasoning(res.reasoning);
											setNewModelVision(res.input.includes("image"));
										} catch (err) {
											console.error(err);
										} finally {
											setProbingModelId(null);
										}
									}}
								>
									<Activity size={12} className={probingModelId === newModelId ? "spin" : ""} style={{ color: "#38bdf8" }} />
									<span>{probingModelId === newModelId ? "正在测定..." : "🧪 实时探针测定"}</span>
								</button>
							</div>

							<label className="model-form-field">
								<span>上下文窗口大小 (Context Window Tokens)</span>
								<select
									value={newModelContext}
									onChange={(e) => setNewModelContext(Number(e.target.value))}
								>
									<option value={8192}>8K (8,192)</option>
									<option value={16384}>16K (16,384)</option>
									<option value={32768}>32K (32,768)</option>
									<option value={65536}>64K (65,536)</option>
									<option value={131072}>128K (131,072 · DeepSeek / Qwen / Claude 3)</option>
									<option value={200000}>200K (200,000 · Claude 3.7 / GLM-5)</option>
									<option value={245760}>245K (245,760 · MiniMax)</option>
									<option value={262144}>256K (262,144 · Kimi / SenseNova / Seed)</option>
									<option value={1000000}>1M (1,000,000 · Gemini / Agnes / Claude 4)</option>
									<option value={2000000}>2M (2,000,000 · Gemini 1.5 Pro)</option>
									{![8192, 16384, 32768, 65536, 131072, 200000, 245760, 262144, 1000000, 2000000].includes(newModelContext) && (
										<option value={newModelContext}>
											{newModelContext >= 1000000
												? `${(newModelContext / 1000000).toFixed(1)}M (${newModelContext})`
												: `${Math.round(newModelContext / 1024)}K (${newModelContext})`}
										</option>
									)}
								</select>
							</label>

							<div style={{ display: "flex", gap: "20px", marginTop: "4px" }}>
								<label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "13px" }}>
									<input
										type="checkbox"
										checked={newModelReasoning}
										onChange={(e) => setNewModelReasoning(e.target.checked)}
									/>
									<span>🧠 支持深度思考/推理</span>
								</label>

								<label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "13px" }}>
									<input
										type="checkbox"
										checked={newModelVision}
										onChange={(e) => setNewModelVision(e.target.checked)}
									/>
									<span>🖼️ 支持图片视觉输入</span>
								</label>
							</div>

							<div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "12px" }}>
								<button
									type="button"
									className="button secondary"
									onClick={() => {
										setAddingModelProviderId(null);
										setEditingModelId(null);
									}}
								>
									取消
								</button>
								<button
									type="button"
									className="button primary"
									disabled={!newModelId.trim()}
									onClick={() => void handleAddModel()}
								>
									{editingModelId ? "保存修改" : "添加模型"}
								</button>
							</div>
						</div>
					</div>
				</div>
			)}
		</div>
	);
};
