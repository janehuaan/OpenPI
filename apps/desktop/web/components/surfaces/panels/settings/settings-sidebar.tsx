import type { FC } from "react";
import {
	Cable,
	Cpu,
	Info,
	Sliders,
} from "../../../icons";

export type SettingsTabId = "general" | "models" | "extensions" | "about";

interface SettingsSidebarProps {
	activeTab: SettingsTabId;
	onSelectTab: (tab: SettingsTabId) => void;
	providerCount?: number;
	mcpCount?: number;
}

export const SettingsSidebar: FC<SettingsSidebarProps> = ({
	activeTab,
	onSelectTab,
	providerCount = 0,
	mcpCount = 0,
}) => {
	return (
		<aside className="settings-sidebar" role="tablist" aria-label="设置导航">
			<span className="settings-nav-section-title">核心设置</span>
			<button
				type="button"
				role="tab"
				aria-selected={activeTab === "general"}
				className={`settings-nav-item ${activeTab === "general" ? "active" : ""}`}
				onClick={() => onSelectTab("general")}
			>
				<Sliders size={16} />
				<span>常规偏好</span>
			</button>

			<button
				type="button"
				role="tab"
				aria-selected={activeTab === "models"}
				className={`settings-nav-item ${activeTab === "models" ? "active" : ""}`}
				onClick={() => onSelectTab("models")}
			>
				<Cpu size={16} />
				<span>模型服务</span>
				{providerCount > 0 && <span className="settings-nav-item-badge">{providerCount}</span>}
			</button>

			<button
				type="button"
				role="tab"
				aria-selected={activeTab === "extensions"}
				className={`settings-nav-item ${activeTab === "extensions" ? "active" : ""}`}
				onClick={() => onSelectTab("extensions")}
			>
				<Cable size={16} />
				<span>扩展与 MCP</span>
				{mcpCount > 0 && <span className="settings-nav-item-badge">{mcpCount}</span>}
			</button>

			<div className="settings-nav-divider" />

			<span className="settings-nav-section-title">系统</span>
			<button
				type="button"
				role="tab"
				aria-selected={activeTab === "about"}
				className={`settings-nav-item ${activeTab === "about" ? "active" : ""}`}
				onClick={() => onSelectTab("about")}
			>
				<Info size={16} />
				<span>关于与诊断</span>
			</button>
		</aside>
	);
};
