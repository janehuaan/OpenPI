import { type FC, useMemo, useState } from "react";
import {
	BookOpen,
	Cable,
	Check,
	Download,
	ExternalLink,
	FolderPlus,
	Github,
	Globe,
	Package,
	Plus,
	RefreshCw,
	Search,
	Store,
	Trash2,
	X,
	FileText,
	Zap,
} from "../../../../icons";
import {
	MARKETPLACE_PACKAGES,
	MARKETPLACE_REGISTRIES,
	MARKETPLACE_REPOSITORIES,
	type MarketplaceKind,
	type MarketplacePackage,
	type MarketplaceRegistry,
	type MarketplaceRepo,
	MCP_ADAPTER_MARKETPLACE_PACKAGE,
} from "../../../../../marketplace";
import { desktopApi } from "../../../../../api";
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
	onRemovePackage?: (source: string) => void;
	onInstallSkill?: (skill: MarketplacePackage) => void;
	onRemoveSkill?: (id: string) => void;
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
	onRemovePackage,
	onInstallSkill,
	onRemoveSkill,
}) => {
	const [activeSubTab, setActiveSubTab] = useState<"repos" | "market" | "skills" | "mcp">("repos");
	const [selectedRepoFilter, setSelectedRepoFilter] = useState<MarketplaceRepo | null>(null);
	const [previewSkill, setPreviewSkill] = useState<MarketplacePackage | null>(null);

	// ── Repositories state & persistence ─────────────────────────────
	const [customRepos, setCustomRepos] = useState<MarketplaceRepo[]>(() => {
		try {
			const saved = localStorage.getItem("openpi_custom_marketplace_repos");
			return saved ? (JSON.parse(saved) as MarketplaceRepo[]) : [];
		} catch {
			return [];
		}
	});
	const [showAddRepoModal, setShowAddRepoModal] = useState(false);
	const [newRepoName, setNewRepoName] = useState("");
	const [newRepoUrl, setNewRepoUrl] = useState("");
	const [newRepoDesc, setNewRepoDesc] = useState("");
	const [newRepoType, setNewRepoType] = useState<"mcp" | "skills" | "plugins" | "all">("mcp");

	const [repoFilterType, setRepoFilterType] = useState<"all" | "mcp" | "skills" | "plugins">("all");
	const [repoQuery, setRepoQuery] = useState("");

	const allRepositories = useMemo(() => {
		return [...customRepos, ...MARKETPLACE_REPOSITORIES];
	}, [customRepos]);

	const filteredRepos = useMemo(() => {
		return allRepositories.filter((r) => {
			if (repoFilterType !== "all" && r.type !== "all" && r.type !== repoFilterType) {
				return false;
			}
			if (repoQuery.trim()) {
				const q = repoQuery.trim().toLowerCase();
				return (
					r.name.toLowerCase().includes(q) ||
					r.fullName.toLowerCase().includes(q) ||
					r.description.toLowerCase().includes(q) ||
					r.tags.some((t) => t.toLowerCase().includes(q))
				);
			}
			return true;
		});
	}, [allRepositories, repoFilterType, repoQuery]);

	const handleAddCustomRepo = () => {
		if (!newRepoName.trim() || !newRepoUrl.trim()) return;
		const cleanFullName = newRepoUrl.trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\/$/, "");
		const newRepo: MarketplaceRepo = {
			id: `custom-${Date.now()}`,
			name: newRepoName.trim(),
			fullName: cleanFullName || newRepoName.trim(),
			url: newRepoUrl.trim().startsWith("http") ? newRepoUrl.trim() : `https://${newRepoUrl.trim()}`,
			description: newRepoDesc.trim() || "用户自定义添加的外部开源仓库源",
			type: newRepoType,
			typeName: newRepoType === "mcp" ? "自定义 MCP 库" : newRepoType === "skills" ? "自定义 Skills 库" : "自定义生态库",
			stars: "自定义源",
			featured: false,
			tags: ["自定义源", newRepoType.toUpperCase()],
			itemsCount: "自定义",
		};
		const updated = [newRepo, ...customRepos];
		setCustomRepos(updated);
		try {
			localStorage.setItem("openpi_custom_marketplace_repos", JSON.stringify(updated));
		} catch {}
		setShowAddRepoModal(false);
		setNewRepoName("");
		setNewRepoUrl("");
		setNewRepoDesc("");
	};

	const handleRemoveCustomRepo = (id: string) => {
		const updated = customRepos.filter((r) => r.id !== id);
		setCustomRepos(updated);
		try {
			localStorage.setItem("openpi_custom_marketplace_repos", JSON.stringify(updated));
		} catch {}
	};

	const handleExploreRepo = (repo: MarketplaceRepo) => {
		setSelectedRepoFilter(repo);
		setActiveSubTab("market");
		setMarketRegistry("all");
		setMarketKind("all");
		setMarketQuery("");
	};

	// ── Market state ─────────────────────────────────────────────────
	const [marketRegistry, setMarketRegistry] = useState<MarketplaceRegistry>("all");
	const [marketKind, setMarketKind] = useState<MarketplaceKind>("all");
	const [marketQuery, setMarketQuery] = useState("");

	const safeCaps: ConversationCapabilities = {
		skills: capabilities?.skills ?? [],
		tools: capabilities?.tools ?? [],
		extensions: capabilities?.extensions ?? [],
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
	};

	const mutationDisabled = Boolean(busy) || !conversation || Boolean(conversation.state?.isStreaming);

	const isInstalled = (pkg: MarketplacePackage) => {
		if (pkg.kind === "skills") {
			const skillId = pkg.id.replace(/^skill-/, "").toLowerCase();
			const rawPkg = pkg.packageName.replace(/^skill:/, "").toLowerCase();
			return safeCaps.skills.some((entry) => {
				const n = entry.name.toLowerCase();
				return n === skillId || n === rawPkg || n === pkg.name.toLowerCase();
			});
		}
		const pkgSource = pkg.source.toLowerCase();
		const pkgName = pkg.packageName.toLowerCase();
		return safeCaps.packages.some((entry) => {
			const eSource = entry.source.toLowerCase();
			return eSource === pkgSource || eSource.includes(pkgName);
		});
	};

	const findMarketPackageForSkill = (skillName: string) => {
		const lower = skillName.toLowerCase();
		return MARKETPLACE_PACKAGES.find(
			(p) =>
				p.kind === "skills" &&
				(p.name.toLowerCase() === lower ||
					p.id.toLowerCase() === `skill-${lower}` ||
					p.packageName.toLowerCase() === `skill:${lower}`),
		);
	};

	const handleOpenSkillDefinition = (skill: { name: string; description: string; filePath?: string; sourceInfo?: { scope: string } }) => {
		const matched = findMarketPackageForSkill(skill.name);
		if (matched) {
			setPreviewSkill(matched);
			return;
		}
		setPreviewSkill({
			id: `skill-${skill.name}`,
			name: skill.name,
			packageName: `skill:${skill.name}`,
			description: skill.description,
			kind: "skills",
			version: "1.0.0",
			publisher: skill.sourceInfo?.scope === "user" ? "本地全局技能" : "工作区技能",
			source: skill.filePath || `skill:${skill.name}`,
			registry: "skills",
			tags: [skill.sourceInfo?.scope === "user" ? "全局技能" : "工作区技能", "已加载"],
			skillContent: `# ${skill.name}\n\n> 本地技能文件: ${skill.filePath || "已加载"}\n\n${skill.description}`,
		});
	};

	const recommendedSkills = useMemo(() => {
		return MARKETPLACE_PACKAGES.filter((p) => p.kind === "skills");
	}, []);

	const filteredPackages = useMemo(() => {
		return MARKETPLACE_PACKAGES.filter((p) => {
			if (selectedRepoFilter) {
				const repoFullName = selectedRepoFilter.fullName.toLowerCase();
				const repoShort = repoFullName.split("/")[1] || repoFullName;
				const matchRepo =
					(p.repoName && (p.repoName.toLowerCase() === repoFullName || p.repoName.toLowerCase().includes(repoShort))) ||
					(p.repoUrl && p.repoUrl.toLowerCase().includes(repoShort)) ||
					(p.publisher && p.publisher.toLowerCase().includes(repoShort));
				if (!matchRepo) return false;
			}
			if (marketRegistry !== "all") {
				if (p.registry && p.registry !== marketRegistry) return false;
			}
			if (marketKind && marketKind !== "all") {
				if (marketKind === "skills" && p.kind !== "skills") return false;
				if (marketKind === "mcp" && p.kind !== "mcp") return false;
				if (marketKind === "plugins" && p.kind !== "plugins" && p.kind !== "repositories") return false;
				if (marketKind === "repositories" && p.kind !== "repositories" && p.kind !== "plugins") return false;
			}
			if (marketQuery.trim()) {
				const q = marketQuery.trim().toLowerCase();
				return (
					p.name.toLowerCase().includes(q) ||
					p.description.toLowerCase().includes(q) ||
					p.packageName.toLowerCase().includes(q) ||
					(p.repoName && p.repoName.toLowerCase().includes(q)) ||
					p.tags.some((t) => t.toLowerCase().includes(q))
				);
			}
			return true;
		});
	}, [selectedRepoFilter, marketRegistry, marketKind, marketQuery]);

	return (
		<div className="settings-scroll-wrapper">
			{/* ── Sub-tabs Segmented Control ── */}
			<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
				<div className="segmented-pill-group" style={{ padding: "4px" }}>
					<button
						type="button"
						className={`segmented-pill-btn ${activeSubTab === "repos" ? "active" : ""}`}
						style={{ padding: "6px 16px", fontSize: "13px" }}
						onClick={() => setActiveSubTab("repos")}
					>
						<span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
							<Github size={15} /> 知名仓库源 ({allRepositories.length})
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
						className={`segmented-pill-btn ${activeSubTab === "mcp" ? "active" : ""}`}
						style={{ padding: "6px 16px", fontSize: "13px" }}
						onClick={() => setActiveSubTab("mcp")}
					>
						<span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
							<Cable size={15} /> MCP 协议服务 ({safeCaps.mcp.packageSources.length})
						</span>
					</button>
				</div>
			</div>

			{/* ── Sub-tab 0: Open Source Repositories ── */}
			{activeSubTab === "repos" && (
				<section className="settings-section-card">
					<div className="settings-section-card-header">
						<div className="settings-section-card-header-left">
							<div className="settings-section-card-icon">
								<Github size={18} />
							</div>
							<div className="settings-section-card-title">
								<h3>OpenPI 官方与社区知名开源仓库源</h3>
								<span>收录 MCP 官方服务仓、Awesome 社区总仓、Anthropic 技能库等海量开源生态，支持一键直达与自定义源</span>
							</div>
						</div>

						<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
							<div className="model-pool-search-input" style={{ minWidth: "220px" }}>
								<Search size={13} style={{ color: "var(--text-tertiary)" }} />
								<input
									type="text"
									placeholder="搜索仓库名称、技术栈..."
									value={repoQuery}
									onChange={(e) => setRepoQuery(e.target.value)}
								/>
							</div>
							<button
								type="button"
								className="button secondary"
								style={{ padding: "6px 12px", fontSize: "12px", display: "inline-flex", alignItems: "center", gap: "6px" }}
								onClick={() => setShowAddRepoModal((prev) => !prev)}
							>
								<Plus size={13} />
								<span>添加仓库源</span>
							</button>
						</div>
					</div>

					<div className="settings-section-card-body">
						{/* Add Custom Repo Form (Expandable) */}
						{showAddRepoModal && (
							<div
								style={{
									padding: "16px",
									marginBottom: "14px",
									borderRadius: "10px",
									background: "var(--bg-muted)",
									border: "1px solid var(--accent)",
									display: "flex",
									flexDirection: "column",
									gap: "10px",
								}}
							>
								<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
									<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
										<FolderPlus size={16} style={{ color: "var(--accent)" }} />
										<strong style={{ fontSize: "13px" }}>添加自定义外部开源仓库源</strong>
									</div>
									<span style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>支持 GitHub 仓库、组织或镜像地址</span>
								</div>

								<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
									<div>
										<label style={{ fontSize: "11px", color: "var(--text-secondary)", display: "block", marginBottom: "4px" }}>
											仓库名称 *
										</label>
										<input
											type="text"
											className="input"
											style={{ width: "100%", fontSize: "12px", padding: "6px 10px" }}
											placeholder="例如: 团队自建 MCP 服务库"
											value={newRepoName}
											onChange={(e) => setNewRepoName(e.target.value)}
										/>
									</div>
									<div>
										<label style={{ fontSize: "11px", color: "var(--text-secondary)", display: "block", marginBottom: "4px" }}>
											GitHub 仓库 URL 或 Registry *
										</label>
										<input
											type="text"
											className="input"
											style={{ width: "100%", fontSize: "12px", padding: "6px 10px" }}
											placeholder="例如: https://github.com/my-org/my-mcp"
											value={newRepoUrl}
											onChange={(e) => setNewRepoUrl(e.target.value)}
										/>
									</div>
								</div>

								<div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "10px" }}>
									<div>
										<label style={{ fontSize: "11px", color: "var(--text-secondary)", display: "block", marginBottom: "4px" }}>
											仓库简介说明
										</label>
										<input
											type="text"
											className="input"
											style={{ width: "100%", fontSize: "12px", padding: "6px 10px" }}
											placeholder="例如: 包含内部数据库、告警系统等特定对接工具"
											value={newRepoDesc}
											onChange={(e) => setNewRepoDesc(e.target.value)}
										/>
									</div>
									<div>
										<label style={{ fontSize: "11px", color: "var(--text-secondary)", display: "block", marginBottom: "4px" }}>
											仓库类型
										</label>
										<select
											className="input"
											style={{ width: "100%", fontSize: "12px", padding: "6px 10px", background: "var(--bg)" }}
											value={newRepoType}
											onChange={(e) => setNewRepoType(e.target.value as any)}
										>
											<option value="mcp">🔌 MCP 服务源</option>
											<option value="skills">📚 技能规范库</option>
											<option value="plugins">⚙️ 插件与工具库</option>
											<option value="all">🌟 综合资源仓</option>
										</select>
									</div>
								</div>

								<div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "4px" }}>
									<button
										type="button"
										className="button secondary"
										style={{ padding: "4px 12px", fontSize: "12px" }}
										onClick={() => setShowAddRepoModal(false)}
									>
										取消
									</button>
									<button
										type="button"
										className="button primary"
										style={{ padding: "4px 14px", fontSize: "12px" }}
										disabled={!newRepoName.trim() || !newRepoUrl.trim()}
										onClick={handleAddCustomRepo}
									>
										保存并加入列表
									</button>
								</div>
							</div>
						)}

						{/* Repository Type Filters */}
						<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px", flexWrap: "wrap", gap: "8px" }}>
							<div className="segmented-pill-group" style={{ padding: "4px" }}>
								<button
									type="button"
									className={`segmented-pill-btn ${repoFilterType === "all" ? "active" : ""}`}
									style={{ padding: "5px 12px", fontSize: "12px" }}
									onClick={() => setRepoFilterType("all")}
								>
									全部仓库 ({allRepositories.length})
								</button>
								<button
									type="button"
									className={`segmented-pill-btn ${repoFilterType === "mcp" ? "active" : ""}`}
									style={{ padding: "5px 12px", fontSize: "12px" }}
									onClick={() => setRepoFilterType("mcp")}
								>
									🔌 MCP 仓库
								</button>
								<button
									type="button"
									className={`segmented-pill-btn ${repoFilterType === "skills" ? "active" : ""}`}
									style={{ padding: "5px 12px", fontSize: "12px" }}
									onClick={() => setRepoFilterType("skills")}
								>
									📚 技能仓库
								</button>
								<button
									type="button"
									className={`segmented-pill-btn ${repoFilterType === "plugins" ? "active" : ""}`}
									style={{ padding: "5px 12px", fontSize: "12px" }}
									onClick={() => setRepoFilterType("plugins")}
								>
									⚙️ 官方与工具
								</button>
							</div>
							<span style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>
								共匹配到 {filteredRepos.length} 个开源仓库源
							</span>
						</div>

						{/* Repositories Grid */}
						<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "12px" }}>
							{filteredRepos.map((repo) => {
								const isCustom = repo.id.startsWith("custom-");
								return (
									<div
										key={repo.id}
										className="model-badge-card"
										style={{
											padding: "16px",
											display: "flex",
											flexDirection: "column",
											justifyContent: "space-between",
											border: repo.featured ? "1px solid rgba(56, 189, 248, 0.3)" : "1px solid var(--border)",
										}}
									>
										<div>
											<div className="model-badge-card-top" style={{ marginBottom: "6px" }}>
												<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
													<Github size={17} style={{ color: "var(--accent)" }} />
													<span className="model-badge-card-name" style={{ fontSize: "14px" }}>
														{repo.name}
													</span>
												</div>
												<div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
													{repo.stars && (
														<span
															className="provider-badge"
															style={{
																background: "rgba(234, 179, 8, 0.15)",
																color: "#eab308",
																borderColor: "rgba(234, 179, 8, 0.3)",
																fontSize: "10px",
																padding: "1px 6px",
															}}
														>
															{repo.stars}
														</span>
													)}
													<span className="model-attr-tag" style={{ fontSize: "10px", padding: "1px 6px" }}>
														{repo.typeName}
													</span>
												</div>
											</div>

											<div
												style={{
													fontFamily: "var(--font-mono, monospace)",
													fontSize: "11px",
													color: "var(--accent)",
													marginBottom: "8px",
												}}
											>
												{repo.fullName}
											</div>

											<p style={{ fontSize: "12px", color: "var(--text-secondary)", margin: "0 0 10px 0", lineHeight: 1.45 }}>
												{repo.description}
											</p>

											<div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "12px" }}>
												{repo.tags.map((tag) => (
													<span
														key={tag}
														style={{
															fontSize: "10px",
															padding: "2px 6px",
															borderRadius: "4px",
															background: "var(--bg-muted)",
															color: "var(--text-tertiary)",
															border: "1px solid var(--border)",
														}}
													>
														{tag}
													</span>
												))}
											</div>
										</div>

										<div
											className="model-badge-card-actions"
											style={{
												marginTop: "8px",
												paddingTop: "10px",
												borderTop: "1px solid var(--border-subtle)",
												display: "flex",
												alignItems: "center",
												justifyContent: "space-between",
												flexWrap: "wrap",
												gap: "6px",
											}}
										>
											<button
												type="button"
												className="button secondary"
												style={{ padding: "5px 12px", fontSize: "11px", display: "inline-flex", alignItems: "center", gap: "4px" }}
												onClick={() => void desktopApi.openExternal(repo.url)}
												title={`在浏览器中打开 ${repo.url}`}
											>
												<ExternalLink size={12} />
												<span>访问 GitHub</span>
											</button>

											<div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
												<button
													type="button"
													className="button primary"
													style={{ padding: "5px 12px", fontSize: "11px", display: "inline-flex", alignItems: "center", gap: "4px" }}
													onClick={() => handleExploreRepo(repo)}
													title="查看此仓库收录的扩展"
												>
													<Search size={12} />
													<span>查看收录扩展</span>
												</button>

												{isCustom && (
													<button
														type="button"
														className="icon-button quiet danger"
														title="删除此自定义仓库源"
														onClick={() => handleRemoveCustomRepo(repo.id)}
													>
														<Trash2 size={13} />
													</button>
												)}
											</div>
										</div>
									</div>
								);
							})}
						</div>
					</div>
				</section>
			)}

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
									disabled={Boolean(conversation?.state?.isStreaming)}
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
								<span>当前工作空间与全局智能体已掌握的专业技能提示词与指令包（通过 /skill:&lt;名称&gt; 唤醒）</span>
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

					<div className="settings-section-card-body" style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
						{/* Installed Skills Section */}
						<div>
							<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
								<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
									<span style={{ fontSize: "13px", fontWeight: 600, color: "var(--text)" }}>已加载技能</span>
									<span className="model-attr-tag">{safeCaps.skills.length}</span>
								</div>
								<span style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>
									存放路径: <code>~/.openpi/agent/skills/</code> 或当前工作区
								</span>
							</div>

							{safeCaps.skills.length === 0 ? (
								<div className="product-empty" style={{ padding: "24px 16px" }}>
									<BookOpen size={28} />
									<strong>暂无已加载的技能</strong>
									<span>下方提供来自知名开源仓库精选的高频实战技能，可一键激活并投入使用</span>
								</div>
							) : (
								<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "10px" }}>
									{safeCaps.skills.map((skill, index) => {
										const skillRemoving = busy === `remove-skill-${skill.name}`;
										return (
											<div
												key={skill.filePath ? `skill-${skill.filePath}` : `skill-${skill.name || "item"}-${index}`}
												className="model-badge-card"
												style={{ display: "flex", flexDirection: "column" }}
											>
												<div className="model-badge-card-top">
													<span className="model-badge-card-name">{skill.name}</span>
													<span className="model-attr-tag">
														{skill.sourceInfo.scope === "user" ? "全局用户技能" : skill.sourceInfo.scope === "temporary" ? "临时技能" : "工作区技能"}
													</span>
												</div>

												<p style={{ fontSize: "12px", color: "var(--text-tertiary)", margin: "4px 0 8px 0", lineHeight: 1.4, flex: 1, minHeight: "34px", overflow: "hidden" }}>
													{skill.description}
												</p>

												<div className="model-badge-card-actions" style={{ justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--border-subtle)", paddingTop: "8px", marginTop: "auto" }}>
													<button
														type="button"
														className="button secondary"
														style={{ padding: "3px 8px", fontSize: "11px", display: "inline-flex", alignItems: "center", gap: "4px" }}
														onClick={() => handleOpenSkillDefinition(skill)}
														title="查看技能定义与规则"
													>
														<FileText size={12} />
														<span>查看定义</span>
													</button>

													<div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
														<button
															type="button"
															className="button primary"
															style={{ padding: "3px 10px", fontSize: "11px", display: "inline-flex", alignItems: "center", gap: "4px" }}
															onClick={() => onUseSkill(skill.name)}
														>
															<Zap size={11} />
															<span>调用测试</span>
														</button>

														<button
															type="button"
															className="icon-button quiet danger"
															title={`卸载技能 ${skill.name}`}
															disabled={mutationDisabled || skillRemoving}
															onClick={() => {
																if (confirm(`确定卸载技能「${skill.name}」？`)) {
																	if (onRemoveSkill) {
																		onRemoveSkill(skill.name);
																	} else if (onRemovePackage) {
																		onRemovePackage(`skill:${skill.name}`);
																	}
																}
															}}
														>
															{skillRemoving ? <RefreshCw size={12} className="spin" /> : <Trash2 size={12} />}
														</button>
													</div>
												</div>
											</div>
										);
									})}
								</div>
							)}
						</div>

						{/* Recommended Skills Grid */}
						<div>
							<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
								<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
									<span style={{ fontSize: "13px", fontWeight: 600, color: "var(--text)" }}>精选热门专业技能推荐</span>
									<span className="model-attr-tag" style={{ background: "rgba(56, 189, 248, 0.1)", color: "var(--accent)" }}>
										来自 Superpowers / Anthropic / Awesome-Cursorrules
									</span>
								</div>
								<button
									type="button"
									className="button secondary"
									style={{ padding: "3px 8px", fontSize: "11px" }}
									onClick={() => {
										setActiveSubTab("market");
										setMarketKind("skills");
									}}
								>
									查看全部技能 ({recommendedSkills.length}) →
								</button>
							</div>

							<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "10px" }}>
								{recommendedSkills.slice(0, 8).map((pkg) => {
									const installed = isInstalled(pkg);
									const installing = busy === `install-market-${pkg.id}`;
									return (
										<div
											key={pkg.id}
											className="model-badge-card"
											style={{ display: "flex", flexDirection: "column", padding: "12px" }}
										>
											<div className="model-badge-card-top">
												<span className="model-badge-card-name" style={{ fontSize: "13px" }}>{pkg.name}</span>
												{installed ? (
													<span className="provider-badge active" style={{ fontSize: "10px" }}>已启用</span>
												) : (
													<span className="model-attr-tag" style={{ fontSize: "10px" }}>{pkg.publisher}</span>
												)}
											</div>

											<p style={{ fontSize: "12px", color: "var(--text-tertiary)", margin: "4px 0 8px 0", lineHeight: 1.4, flex: 1, minHeight: "34px", overflow: "hidden" }}>
												{pkg.description}
											</p>

											<div className="model-badge-card-actions" style={{ justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--border-subtle)", paddingTop: "8px", marginTop: "auto" }}>
												<button
													type="button"
													className="button secondary"
													style={{ padding: "3px 8px", fontSize: "11px", display: "inline-flex", alignItems: "center", gap: "4px" }}
													onClick={() => setPreviewSkill(pkg)}
												>
													<FileText size={11} />
													<span>预览规则</span>
												</button>

												{installed ? (
													<button
														type="button"
														className="button secondary"
														style={{ padding: "3px 10px", fontSize: "11px", display: "inline-flex", alignItems: "center", gap: "4px" }}
														onClick={() => onUseSkill(pkg.name)}
													>
														<Zap size={11} />
														<span>测试</span>
													</button>
												) : (
													<button
														type="button"
														className="button primary"
														style={{ padding: "3px 10px", fontSize: "11px", display: "inline-flex", alignItems: "center", gap: "4px" }}
														disabled={installing || mutationDisabled}
														onClick={() => onInstallPackage(pkg)}
													>
														{installing ? <RefreshCw size={11} className="spin" /> : <Download size={11} />}
														<span>一键启用</span>
													</button>
												)}
											</div>
										</div>
									);
								})}
							</div>
						</div>
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
								placeholder="搜索扩展包与技能..."
								value={marketQuery}
								onChange={(e) => setMarketQuery(e.target.value)}
							/>
						</div>
					</div>

					<div className="settings-section-card-body">
						{/* Active Repo Filter Banner */}
						{selectedRepoFilter && (
							<div
								style={{
									display: "flex",
									alignItems: "center",
									justifyContent: "space-between",
									padding: "10px 14px",
									borderRadius: "8px",
									background: "rgba(56, 189, 248, 0.08)",
									border: "1px solid rgba(56, 189, 248, 0.25)",
									marginBottom: "12px",
								}}
							>
								<div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
									<Github size={16} style={{ color: "var(--accent)" }} />
									<div style={{ fontSize: "13px" }}>
										<span>正在展示开源仓库 </span>
										<strong style={{ color: "var(--accent)" }}>{selectedRepoFilter.name}</strong>
										<span style={{ color: "var(--text-tertiary)", marginLeft: "6px" }}>({selectedRepoFilter.fullName})</span>
										<span style={{ marginLeft: "8px", color: "var(--text-secondary)" }}>
											收录项目 ({filteredPackages.length} 项)
										</span>
									</div>
								</div>

								<button
									type="button"
									className="button secondary"
									style={{ padding: "4px 10px", fontSize: "11px", display: "inline-flex", alignItems: "center", gap: "4px" }}
									onClick={() => setSelectedRepoFilter(null)}
								>
									<X size={12} />
									<span>清除仓库筛选</span>
								</button>
							</div>
						)}

						{/* Multi-Registry & Category Filter Controls */}
						<div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "8px" }}>
							<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}>
								<div className="segmented-pill-group" style={{ display: "flex", flexWrap: "wrap", gap: "4px", padding: "4px" }}>
									{MARKETPLACE_REGISTRIES.map((reg) => (
										<button
											key={reg.id}
											type="button"
											className={`segmented-pill-btn ${marketRegistry === reg.id ? "active" : ""}`}
											style={{ padding: "5px 12px", fontSize: "12px" }}
											onClick={() => setMarketRegistry(reg.id)}
											title={reg.description}
										>
											{reg.name}
										</button>
									))}
								</div>

								<div className="segmented-pill-group" style={{ padding: "3px" }}>
									<button
										type="button"
										className={`segmented-pill-btn ${marketKind === "all" ? "active" : ""}`}
										style={{ padding: "4px 10px", fontSize: "12px" }}
										onClick={() => setMarketKind("all")}
									>
										全部扩展
									</button>
									<button
										type="button"
										className={`segmented-pill-btn ${marketKind === "skills" ? "active" : ""}`}
										style={{ padding: "4px 10px", fontSize: "12px" }}
										onClick={() => setMarketKind("skills")}
									>
										📚 技能
									</button>
									<button
										type="button"
										className={`segmented-pill-btn ${marketKind === "mcp" ? "active" : ""}`}
										style={{ padding: "4px 10px", fontSize: "12px" }}
										onClick={() => setMarketKind("mcp")}
									>
										🔌 MCP 服务
									</button>
									<button
										type="button"
										className={`segmented-pill-btn ${marketKind === "repositories" ? "active" : ""}`}
										style={{ padding: "4px 10px", fontSize: "12px" }}
										onClick={() => setMarketKind("repositories")}
									>
										⚙️ 插件与工作流
									</button>
								</div>
							</div>
						</div>

						{/* Packages Grid */}
						{filteredPackages.length === 0 ? (
							<div className="product-empty" style={{ padding: "30px 16px" }}>
								<Store size={28} />
								<strong>未检索到符合条件的扩展包</strong>
								<span>请尝试更换搜索词或清除分类/仓库筛选</span>
								{selectedRepoFilter && (
									<button
										type="button"
										className="button secondary"
										style={{ marginTop: "10px" }}
										onClick={() => setSelectedRepoFilter(null)}
									>
										清除仓库筛选
									</button>
								)}
							</div>
						) : (
							<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "12px" }}>
								{filteredPackages.map((pkg) => {
									const installed = isInstalled(pkg);
									const installing = busy === `install-market-${pkg.id}`;
									const removing = busy === `remove-${pkg.source}` || busy === `remove-skill-${pkg.id.replace(/^skill-/, "")}`;
									const regInfo = MARKETPLACE_REGISTRIES.find((r) => r.id === pkg.registry);
									return (
										<div key={pkg.id} className="model-badge-card" style={{ padding: "14px", display: "flex", flexDirection: "column" }}>
											<div className="model-badge-card-top">
												<div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
													<span className="model-badge-card-name">{pkg.name}</span>
													{regInfo && (
														<span className="model-attr-tag" style={{ fontSize: "10px", padding: "1px 6px" }}>
															{regInfo.badge}
														</span>
													)}
												</div>
												{installed && <span className="provider-badge active">已安装</span>}
											</div>

											<p style={{ fontSize: "12px", color: "var(--text-secondary)", margin: "6px 0", lineHeight: 1.4, flex: 1, minHeight: "36px" }}>
												{pkg.description}
											</p>

											<div style={{ display: "flex", flexWrap: "wrap", gap: "4px", margin: "6px 0" }}>
												{pkg.tags.map((tag) => (
													<span
														key={tag}
														style={{
															fontSize: "10px",
															padding: "2px 6px",
															borderRadius: "4px",
															background: "var(--bg-muted)",
															color: "var(--text-tertiary)",
															border: "1px solid var(--border)",
														}}
													>
														{tag}
													</span>
												))}
											</div>

											{pkg.repoName && (
												<div
													style={{
														display: "flex",
														alignItems: "center",
														justifyContent: "space-between",
														margin: "4px 0 8px 0",
														padding: "4px 8px",
														borderRadius: "6px",
														background: "var(--bg-muted)",
														border: "1px solid var(--border)",
														fontSize: "11px",
													}}
												>
													<span style={{ color: "var(--text-tertiary)", display: "inline-flex", alignItems: "center", gap: "4px" }}>
														<Github size={12} />
														<span>开源仓库</span>
													</span>
													<button
														type="button"
														onClick={() => pkg.repoUrl && void desktopApi.openExternal(pkg.repoUrl)}
														style={{
															background: "none",
															border: "none",
															color: "var(--accent)",
															cursor: "pointer",
															display: "inline-flex",
															alignItems: "center",
															gap: "3px",
															padding: 0,
															fontSize: "11px",
															fontWeight: 500,
														}}
														title={`在浏览器中打开开源仓库: ${pkg.repoUrl}`}
													>
														<span>{pkg.repoName}</span>
														<ExternalLink size={10} />
													</button>
												</div>
											)}

											<div className="model-badge-card-actions" style={{ marginTop: "8px", justifyContent: "space-between", alignItems: "center" }}>
												<div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
													{pkg.kind === "skills" && (
														<button
															type="button"
															className="button secondary"
															style={{ padding: "3px 8px", fontSize: "11px", display: "inline-flex", alignItems: "center", gap: "3px" }}
															onClick={() => setPreviewSkill(pkg)}
															title="预览技能规则与 SKILL.md 定义"
														>
															<FileText size={11} />
															<span>预览</span>
														</button>
													)}
													<span style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>
														v{pkg.version} · {pkg.publisher}
													</span>
												</div>

												{installed ? (
													<div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
														{pkg.kind === "skills" && (
															<button
																type="button"
																className="button secondary"
																style={{ padding: "3px 8px", fontSize: "11px", display: "inline-flex", alignItems: "center", gap: "3px" }}
																onClick={() => onUseSkill(pkg.name)}
																title="在当前对话中调用此技能"
															>
																<Zap size={11} />
																<span>测试</span>
															</button>
														)}
														<button
															type="button"
															className="button secondary"
															style={{ padding: "3px 8px", fontSize: "11px", color: "var(--text-danger, #f87171)" }}
															disabled={removing || mutationDisabled}
															onClick={() => {
																if (confirm(`确定卸载 ${pkg.name}？`)) {
																	if (pkg.kind === "skills") {
																		const skillId = pkg.id.replace(/^skill-/, "");
																		if (onRemoveSkill) {
																			onRemoveSkill(skillId);
																		} else if (onRemovePackage) {
																			onRemovePackage(pkg.source);
																		}
																	} else if (onRemovePackage) {
																		onRemovePackage(pkg.source);
																	}
																}
															}}
															title="从当前环境中卸载"
														>
															{removing ? <RefreshCw size={11} className="spin" /> : <Trash2 size={11} />}
															<span>卸载</span>
														</button>
													</div>
												) : (
													<button
														type="button"
														className="button primary"
														style={{ padding: "4px 10px", fontSize: "11px" }}
														disabled={installing || mutationDisabled}
														onClick={() => onInstallPackage(pkg)}
													>
														{installing ? <RefreshCw size={12} className="spin" /> : <Download size={12} />}
														<span>{pkg.kind === "skills" ? "一键启用" : "一键安装"}</span>
													</button>
												)}
											</div>
										</div>
									);
								})}
							</div>
						)}
					</div>
				</section>
			)}

			{/* ── Preview Skill Modal Dialog ── */}
			{previewSkill && (
				<div
					style={{
						position: "fixed",
						top: 0,
						left: 0,
						right: 0,
						bottom: 0,
						background: "rgba(0, 0, 0, 0.7)",
						backdropFilter: "blur(6px)",
						zIndex: 99999,
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						padding: "24px",
					}}
					onClick={() => setPreviewSkill(null)}
				>
					<div
						style={{
							background: "var(--bg-panel, #18181b)",
							border: "1px solid var(--border)",
							borderRadius: "14px",
							width: "100%",
							maxWidth: "720px",
							maxHeight: "88vh",
							display: "flex",
							flexDirection: "column",
							boxShadow: "0 24px 48px rgba(0,0,0,0.6)",
							overflow: "hidden",
						}}
						onClick={(e) => e.stopPropagation()}
					>
						{/* Modal Header */}
						<div
							style={{
								display: "flex",
								alignItems: "center",
								justifyContent: "space-between",
								padding: "16px 20px",
								borderBottom: "1px solid var(--border)",
								background: "var(--bg-muted)",
							}}
						>
							<div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
								<div
									style={{
										width: "34px",
										height: "34px",
										borderRadius: "8px",
										background: "rgba(56, 189, 248, 0.15)",
										color: "var(--accent)",
										display: "flex",
										alignItems: "center",
										justifyContent: "center",
									}}
								>
									<BookOpen size={18} />
								</div>
								<div>
									<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
										<h3 style={{ margin: 0, fontSize: "16px", fontWeight: 600 }}>{previewSkill.name}</h3>
										<span
											style={{
												fontSize: "11px",
												padding: "1px 6px",
												borderRadius: "4px",
												background: "var(--bg)",
												border: "1px solid var(--border)",
												color: "var(--text-secondary)",
											}}
										>
											v{previewSkill.version}
										</span>
										{isInstalled(previewSkill) && (
											<span className="provider-badge active" style={{ fontSize: "10px" }}>
												已安装启用
											</span>
										)}
									</div>
									<div style={{ fontSize: "12px", color: "var(--text-tertiary)", marginTop: "2px" }}>
										发布者: {previewSkill.publisher}
										{previewSkill.repoName && (
											<>
												{" · 来源仓库: "}
												<button
													type="button"
													onClick={() => previewSkill.repoUrl && void desktopApi.openExternal(previewSkill.repoUrl)}
													style={{
														background: "none",
														border: "none",
														color: "var(--accent)",
														cursor: "pointer",
														padding: 0,
														fontSize: "12px",
														textDecoration: "underline",
													}}
												>
													{previewSkill.repoName}
												</button>
											</>
										)}
									</div>
								</div>
							</div>

							<button
								type="button"
								className="icon-button quiet"
								onClick={() => setPreviewSkill(null)}
								title="关闭"
							>
								<X size={18} />
							</button>
						</div>

						{/* Modal Body */}
						<div
							style={{
								padding: "18px 20px",
								overflowY: "auto",
								display: "flex",
								flexDirection: "column",
								gap: "14px",
								flex: 1,
							}}
						>
							<div>
								<div style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-tertiary)", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
									技能简介
								</div>
								<p style={{ margin: 0, fontSize: "13px", lineHeight: 1.5, color: "var(--text-secondary)" }}>
									{previewSkill.description}
								</p>
							</div>

							{previewSkill.tags && previewSkill.tags.length > 0 && (
								<div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
									{previewSkill.tags.map((t) => (
										<span
											key={t}
											style={{
												fontSize: "11px",
												padding: "2px 8px",
												borderRadius: "4px",
												background: "var(--bg-muted)",
												color: "var(--text-secondary)",
												border: "1px solid var(--border)",
											}}
										>
											{t}
										</span>
									))}
								</div>
							)}

							<div>
								<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
									<div style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
										SKILL.md 规则定义内容
									</div>
									<span style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>
										唤醒指令: <code style={{ fontFamily: "var(--font-mono)", color: "var(--accent)" }}>/skill:{previewSkill.id.replace(/^skill-/, "")}</code>
									</span>
								</div>

								<pre
									style={{
										margin: 0,
										padding: "12px 14px",
										background: "var(--bg-code, #0f1015)",
										borderRadius: "8px",
										border: "1px solid var(--border)",
										fontSize: "12px",
										fontFamily: "var(--font-mono, monospace)",
										color: "var(--text-secondary)",
										lineHeight: 1.55,
										whiteSpace: "pre-wrap",
										wordBreak: "break-word",
										maxHeight: "320px",
										overflowY: "auto",
									}}
								>
									{previewSkill.skillContent || previewSkill.description}
								</pre>
							</div>
						</div>

						{/* Modal Footer */}
						<div
							style={{
								display: "flex",
								alignItems: "center",
								justifyContent: "space-between",
								padding: "14px 20px",
								borderTop: "1px solid var(--border)",
								background: "var(--bg-muted)",
							}}
						>
							<button
								type="button"
								className="button secondary"
								onClick={() => setPreviewSkill(null)}
							>
								关闭
							</button>

							<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
								{isInstalled(previewSkill) ? (
									<>
										<button
											type="button"
											className="button secondary"
											style={{ color: "var(--text-danger, #f87171)" }}
											onClick={() => {
												const skillId = previewSkill.id.replace(/^skill-/, "");
												if (onRemoveSkill) {
													onRemoveSkill(skillId);
												} else if (onRemovePackage) {
													onRemovePackage(previewSkill.source);
												}
												setPreviewSkill(null);
											}}
										>
											<Trash2 size={13} />
											<span>卸载此技能</span>
										</button>

										<button
											type="button"
											className="button primary"
											onClick={() => {
												onUseSkill(previewSkill.name);
												setPreviewSkill(null);
											}}
										>
											<Zap size={13} />
											<span>调用测试</span>
										</button>
									</>
								) : (
									<button
										type="button"
										className="button primary"
										disabled={mutationDisabled || busy === `install-market-${previewSkill.id}`}
										onClick={() => {
											onInstallPackage(previewSkill);
											setPreviewSkill(null);
										}}
									>
										<Download size={13} />
										<span>一键启用此技能</span>
									</button>
								)}
							</div>
						</div>
					</div>
				</div>
			)}
		</div>
	);
};
