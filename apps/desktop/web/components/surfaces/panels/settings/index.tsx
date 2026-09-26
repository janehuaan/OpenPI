import { type FC, useEffect, useState } from "react";
import { ArrowLeft, RefreshCw } from "../../../icons";
import { SettingsSidebar, type SettingsTabId } from "./settings-sidebar";
import { GeneralTab } from "./tabs/general-tab";
import { ModelsTab } from "./tabs/models-tab";
import { ExtensionsTab } from "./tabs/extensions-tab";
import { SecurityTab } from "./tabs/security-tab";
import { AboutTab } from "./tabs/about-tab";
import { desktopApi } from "../../../../api";
import type { MarketplacePackage } from "../../../../marketplace";
import type {
	ConversationCapabilities,
	ConversationSnapshot,
} from "../../../../types";
import "./styles/settings-redesign.css";

export interface SettingsSurfaceProps {
	conversation?: ConversationSnapshot;
	capabilities?: ConversationCapabilities;
	loading?: boolean;
	busy?: string;
	initialTab?: SettingsTabId;
	onClose: () => void;
	onReload?: () => Promise<void>;
	onUseSkill?: (name: string) => void;
	onConfigureMcp?: () => void;
	onInstallPackage?: (marketPackage: MarketplacePackage) => void;
	onRemoveMcp?: (source: string, local: boolean) => void;
	onRemovePackage?: (source: string) => void;
	onInstallSkill?: (skill: MarketplacePackage) => void;
	onRemoveSkill?: (id: string) => void;
}

export const SettingsSurface: FC<SettingsSurfaceProps> = ({
	conversation,
	capabilities,
	loading,
	busy,
	initialTab = "general",
	onClose,
	onReload,
	onUseSkill = () => {},
	onConfigureMcp = () => {},
	onInstallPackage = () => {},
	onRemoveMcp = () => {},
	onRemovePackage = () => {},
	onInstallSkill,
	onRemoveSkill,
}) => {
	const [tab, setTab] = useState<SettingsTabId>(initialTab);
	const [refreshing, setRefreshing] = useState(false);
	const [providerCount, setProviderCount] = useState(0);

	const instanceId = conversation?.instance?.id;

	const loadMeta = async () => {
		try {
			const providers = await desktopApi.getModelProviders();
			setProviderCount(Object.keys(providers).length);
		} catch {}
	};

	useEffect(() => {
		void loadMeta();
	}, []);

	const handleReload = async () => {
		setRefreshing(true);
		try {
			if (onReload) await onReload();
			await loadMeta();
			window.dispatchEvent(new Event("openpi:refresh-settings"));
		} finally {
			setRefreshing(false);
		}
	};

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

	return (
		<div className="settings-redesign-shell">
			{/* Top Header */}
			<header className="settings-header" data-tauri-drag-region>
				<div className="settings-header-left">
					<button
						type="button"
						className="icon-button quiet"
						title="返回聊天"
						aria-label="返回聊天"
						onClick={onClose}
					>
						<ArrowLeft size={18} />
					</button>
					<div className="settings-header-title">
						<strong>设置</strong>
						<span>偏好首选项、模型服务与扩展能力</span>
					</div>
				</div>

				<div className="settings-header-right">
					<button
						type="button"
						className="icon-button quiet"
						title="重新加载设置与服务"
						aria-label="重新加载设置与服务"
						disabled={loading || refreshing || Boolean(busy)}
						onClick={() => void handleReload()}
					>
						<RefreshCw size={16} className={loading || refreshing ? "spin" : ""} />
					</button>
				</div>
			</header>

			{/* Main Layout */}
			<div className="settings-body">
				<SettingsSidebar
					activeTab={tab}
					onSelectTab={setTab}
					providerCount={providerCount}
					mcpCount={safeCaps.mcp.packageSources.length}
				/>

				<main className="settings-main">
					{tab === "general" && <GeneralTab instanceId={instanceId} onReload={onReload} />}
					{tab === "models" && <ModelsTab instanceId={instanceId} onReload={onReload} />}
					{tab === "extensions" && (
						<ExtensionsTab
							conversation={conversation}
							capabilities={capabilities}
							loading={loading}
							busy={busy}
							onUseSkill={onUseSkill}
							onConfigureMcp={onConfigureMcp}
							onInstallPackage={onInstallPackage}
							onRemoveMcp={onRemoveMcp}
							onRemovePackage={onRemovePackage}
							onInstallSkill={onInstallSkill}
							onRemoveSkill={onRemoveSkill}
						/>
					)}
					{tab === "security" && <SecurityTab instanceId={instanceId} onReload={onReload} />}
					{tab === "about" && <AboutTab capabilities={capabilities} />}
				</main>
			</div>
		</div>
	);
};

export { ModelsTab as ModelProvidersPanel };
