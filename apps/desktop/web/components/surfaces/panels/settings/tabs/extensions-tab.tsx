import { type FC, useMemo, useState } from "react";
import {
	BookOpen,
	Cable,
	Check,
	Download,
	ExternalLink,
	Github,
	Package,
	Plus,
	RefreshCw,
	Search,
	Store,
	Trash2,
	Zap,
} from "../../../../icons";
import {
	MARKETPLACE_PACKAGES,
	type MarketplaceKind,
	type MarketplacePackage,
	MCP_ADAPTER_MARKETPLACE_PACKAGE,
} from "../../../../../marketplace";
import type {
	ConversationCapabilities,
	ConversationSnapshot,
} from "../../../../../types";

interface ExtensionsTabProps {
	conversation?: ConversationSnapshot;
	capabilities?: ConversationCapabilities;
	loading?: boolean;
	busy?: string;
	onUseSkill: (name: string) => void;
	onConfigureMcp: () => void;
	onInstallPackage: (marketPackage: MarketplacePackage) => void;
	onRemoveMcp: (source: string, local: boolean) => void;
}

export const ExtensionsTab: FC<ExtensionsTabProps> = ({
	conversation,
	capabilities,
	loading,
	busy,
	onUseSkill,
	onConfigureMcp,
	onInstallPackage,
	onRemoveMcp,
}) => {
	const [activeSubTab, setActiveSubTab] = useState<"mcp" | "skills" | "market">("mcp");

	// Market state
	const [marketKind, setMarketKind] = useState<MarketplaceKind>("skills");
	const [marketQuery, setMarketQuery] = useState("");

	const safeCaps: ConversationCapabilities = capabilities ?? {
		skills: [],
		tools: [],
		extensions: [],
		packages: [],
		diagnostics: [],
		mcp: {
			configured: false,
			loaded: false,
			packageSources: [],
			extensionPaths: [],
			commands: [],
			tools: [],
			servers: [],
		},
	};

	const mutationDisabled = Boolean(busy) || !conversation || conversation.state.isStreaming;

	const isInstalled = (pkg: MarketplacePackage) =>
		safeCaps.packages.some((entry) => entry.source.toLowerCase() === pkg.source.toLowerCase());

	const filteredPackages = useMemo(() => {
		const targetKind = marketKind === "repositories" ? "skills" : marketKind;
		return MARKETPLACE_PACKAGES.filter((p) => {
			if (p.kind !== targetKind && p.kind !== marketKind) return false;
			if (marketQuery.trim()) {
				const q = marketQuery.trim().toLowerCase();
				return p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q);
			}
			return true;
		});
	}, [marketKind, marketQuery]);

	return (
		<div className="settings-scroll-wrapper">
			{/* ── Sub-tabs Segmented Control ── */}
			<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
				<div className="segmented-pill-group" style={{ padding: "4px" }}>
					<button
						type="button"
						className={`segmented-pill-btn ${activeSubTab === "mcp" ? "active" : ""}`}
						style={{ padding: "6px 16px", fontSize: "13px" }}
						onClick={() => setActiveSubTab("mcp")}
					>
						<span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
							<Cable size={15} /> MCP 协议服务 ({safeCaps.mcp.packageSources.length})
						</span>
					</button>

					<button
						type="button"
						className={`segmented-pill-btn ${activeSubTab === "skills" ? "active" : ""}`}
						style={{ padding: "6px 16px", fontSize: "13px" }}
						onClick={() => setActiveSubTab("skills")}
					>
						<span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
							<BookOpen size={15} /> 技能库 ({safeCaps.skills.length})
						</span>
					</button>

					<button
						type="button"
						className={`segmented-pill-btn ${activeSubTab === "market" ? "active" : ""}`}
						style={{ padding: "6px 16px", fontSize: "13px" }}
						onClick={() => setActiveSubTab("market")}
					>
						<span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
							<Store size={15} /> 插件市场 ({MARKETPLACE_PACKAGES.length})
						</span>
					</button>
				</div>
			</div>

			{/* ── Sub-tab 1: MCP Servers ── */}
			{activeSubTab === "mcp" && (
				<section className="settings-section-card">
					<div className="settings-section-card-header">
						<div className="settings-section-card-header-left">
							<div className="settings-section-card-icon">
								<Cable size={18} />
							</div>
							<div className="settings-section-card-title">
								<h3>Model Context Protocol (MCP) 服务</h3>
								<span>对标 Claude Desktop 标准，通过 MCP 协议挂载外部数据源与系统级工具</span>
							</div>
						</div>

						<div style={{ display: "flex", gap: "8px" }}>
							{safeCaps.mcp.loaded && (
								<button
									type="button"
									className="button secondary"
									disabled={conversation?.state.isStreaming}
									onClick={onConfigureMcp}
								>
									<span>配置服务</span>
								</button>
							)}

							{!safeCaps.mcp.configured && (
								<button
									type="button"
									className="button primary"
									disabled={mutationDisabled}
									onClick={() => onInstallPackage(MCP_ADAPTER_MARKETPLACE_PACKAGE)}
								>
									{busy === `install-market-${MCP_ADAPTER_MARKETPLACE_PACKAGE.id}` ? (
										<RefreshCw size={14} className="spin" />
									) : (
										<Plus size={14} />
									)}
									<span>安装 MCP 适配器</span>
								</button>
							)}
						</div>
					</div>

					<div className="settings-section-card-body">
						<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderRadius: "10px", background: "var(--bg-muted)", border: "1px solid var(--border)" }}>
							<div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
								<span className={`latency-pill ${safeCaps.mcp.loaded ? "ok" : "fail"}`}>
									<span className="latency-dot" />
									{safeCaps.mcp.loaded ? "运行中 (Online)" : safeCaps.mcp.configured ? "已配置" : "未安装适配器"}
								</span>
								<span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
									已挂载 <strong>{safeCaps.mcp.packageSources.length}</strong> 个 MCP 实例
								</span>
							</div>
						</div>

						{safeCaps.mcp.packageSources.length === 0 ? (
							<div className="product-empty">
								<Cable size={32} />
								<strong>尚未添加外部 MCP 服务</strong>
								<span>支持通过 Stdio 或 SSE 协议连接 Postgres、GitHub、Filesystem、Brave Search 等服务</span>
								<button
									type="button"
									className="button primary"
									style={{ marginTop: "12px" }}
									onClick={() => {
										setActiveSubTab("market");
										setMarketKind("mcp");
									}}
								>
									<Store size={14} /> 浏览 MCP 扩展市场
								</button>
							</div>
						) : (
							<div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
								{safeCaps.mcp.packageSources.map((source, idx) => (
									<div
										key={`${source}-${idx}`}
										style={{
											display: "flex",
											alignItems: "center",
											justifyContent: "space-between",
											padding: "12px 16px",
											borderRadius: "8px",
											border: "1px solid var(--border)",
											background: "var(--bg)",
										}}
									>
										<div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
											<Cable size={16} style={{ color: "var(--accent)" }} />
											<strong style={{ fontSize: "13px" }}>{source}</strong>
										</div>

										<button
											type="button"
											className="icon-button quiet danger"
											title="移除此 MCP 服务"
											disabled={mutationDisabled}
											onClick={() => {
												if (confirm(`确定移除 ${source}？`)) {
													onRemoveMcp(source, true);
												}
											}}
										>
											<Trash2 size={14} />
										</button>
									</div>
								))}
							</div>
						)}
					</div>
				</section>
			)}

			{/* ── Sub-tab 2: Skills Library ── */}
			{activeSubTab === "skills" && (
				<section className="settings-section-card">
					<div className="settings-section-card-header">
						<div className="settings-section-card-header-left">
							<div className="settings-section-card-icon">
								<BookOpen size={18} />
							</div>
							<div className="settings-section-card-title">
								<h3>技能库 (Skills Library)</h3>
								<span>当前工作空间与全局智能体已掌握的专业技能提示词与指令包</span>
							</div>
						</div>

						<button
							type="button"
							className="button primary"
							onClick={() => {
								setActiveSubTab("market");
								setMarketKind("skills");
							}}
						>
							<Store size={14} /> 浏览技能市场
						</button>
					</div>

					<div className="settings-section-card-body">
						{safeCaps.skills.length === 0 ? (
							<div className="product-empty">
								<BookOpen size={32} />
								<strong>暂无技能</strong>
								<span>在技能市场中一键安装或在项目工作区编写 SKILL.md 注入能力</span>
							</div>
						) : (
							<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "10px" }}>
								{safeCaps.skills.map((skill, index) => (
									<div
										key={skill.filePath ? `skill-${skill.filePath}` : `skill-${skill.name || "item"}-${index}`}
										className="model-badge-card"
									>
										<div className="model-badge-card-top">
											<span className="model-badge-card-name">{skill.name}</span>
											<span className="model-attr-tag">
												{skill.sourceInfo.scope === "user" ? "全局用户技能" : skill.sourceInfo.scope === "temporary" ? "临时技能" : "工作区技能"}
											</span>
										</div>

										<p style={{ fontSize: "12px", color: "var(--text-tertiary)", margin: "4px 0", lineHeight: 1.4, height: "34px", overflow: "hidden" }}>
											{skill.description}
										</p>

										<div className="model-badge-card-actions">
											<button
												type="button"
												className="btn-set-default"
												onClick={() => onUseSkill(skill.name)}
											>
												调用测试
											</button>
										</div>
									</div>
								))}
							</div>
						)}
					</div>
				</section>
			)}

			{/* ── Sub-tab 3: Marketplace ── */}
			{activeSubTab === "market" && (
				<section className="settings-section-card">
					<div className="settings-section-card-header">
						<div className="settings-section-card-header-left">
							<div className="settings-section-card-icon">
								<Store size={18} />
							</div>
							<div className="settings-section-card-title">
								<h3>OpenPI 官方与社区插件市场</h3>
								<span>一键扩充工作流、代码审计、MCP 服务以及多领域智能体专业能力</span>
							</div>
						</div>

						<div className="model-pool-search-input" style={{ minWidth: "200px" }}>
							<Search size={13} style={{ color: "var(--text-tertiary)" }} />
							<input
								type="text"
								placeholder="搜索扩展包..."
								value={marketQuery}
								onChange={(e) => setMarketQuery(e.target.value)}
							/>
						</div>
					</div>

					<div className="settings-section-card-body">
						{/* Category Pills */}
						<div className="segmented-pill-group" style={{ alignSelf: "flex-start" }}>
							<button
								type="button"
								className={`segmented-pill-btn ${marketKind === "skills" ? "active" : ""}`}
								onClick={() => setMarketKind("skills")}
							>
								📚 技能包
							</button>
							<button
								type="button"
								className={`segmented-pill-btn ${marketKind === "mcp" ? "active" : ""}`}
								onClick={() => setMarketKind("mcp")}
							>
								🔌 MCP 集成
							</button>
						</div>

						{/* Packages Grid */}
						<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "12px" }}>
							{filteredPackages.map((pkg) => {
								const installed = isInstalled(pkg);
								const installing = busy === `install-market-${pkg.id}`;
								return (
									<div key={pkg.id} className="model-badge-card" style={{ padding: "14px" }}>
										<div className="model-badge-card-top">
											<span className="model-badge-card-name">{pkg.name}</span>
											{installed && <span className="provider-badge active">已安装</span>}
										</div>

										<p style={{ fontSize: "12px", color: "var(--text-secondary)", margin: "6px 0", lineHeight: 1.4, minHeight: "34px" }}>
											{pkg.description}
										</p>

										<div className="model-badge-card-actions">
											{installed ? (
												<span style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>已就绪</span>
											) : (
												<button
													type="button"
													className="button primary"
													style={{ padding: "4px 10px", fontSize: "11px" }}
													disabled={installing || mutationDisabled}
													onClick={() => onInstallPackage(pkg)}
												>
													{installing ? <RefreshCw size={12} className="spin" /> : <Download size={12} />}
													<span>安装</span>
												</button>
											)}
										</div>
									</div>
								);
							})}
						</div>
					</div>
				</section>
			)}
		</div>
	);
};
