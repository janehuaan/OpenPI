import { type FC, useState } from "react";
import {
	ChevronDown,
	ChevronRight,
	ExternalLink,
	Folder,
	Github,
	Info,
	Shield,
	Terminal,
	Wrench,
} from "../../../../icons";
import type { ConversationCapabilities } from "../../../../../types";

interface AboutTabProps {
	capabilities?: ConversationCapabilities;
}

export const AboutTab: FC<AboutTabProps> = ({ capabilities }) => {
	const [toolsExpanded, setToolsExpanded] = useState(false);

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
							<strong>客户端版本 (Client Version)</strong>
							<span>OpenPI Desktop v0.2.0 (Electron Shell)</span>
						</div>
						<span className="provider-badge active">最新版本</span>
					</div>

					<div className="setting-item-row">
						<div className="setting-item-meta">
							<strong>内核运行时 (Kernel Runtime)</strong>
							<span>pi-agent-core / TypeScript & Node.js Engine</span>
						</div>
						<span className="provider-badge">v0.84.2</span>
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
											borderRadius: "6px",
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
