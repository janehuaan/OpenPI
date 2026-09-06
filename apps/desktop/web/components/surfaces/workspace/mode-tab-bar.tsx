import { Folder, MessageSquare, Sparkles, TerminalSquare } from "../../icons.tsx";
import { shortWorkspacePath } from "../../../lib/helpers";

export type AppMode = "chat" | "code" | "personal";

export function ModeTabBar({
	mode,
	onModeChange,
}: {
	mode: AppMode;
	onModeChange(mode: AppMode): void;
	onSelectProject?(): void;
	currentProject?: string;
}) {
	return (
		<div className="mode-tab-bar">
			<div className="segmented mode-switch mode-tab-switch" aria-label="应用模式">
				<button
					type="button"
					className={mode === "chat" ? "active" : ""}
					title="Chat"
					onClick={() => onModeChange("chat")}
				>
					<MessageSquare size={13} />
					Chat
				</button>
				<button
					type="button"
					className={mode === "personal" ? "active" : ""}
					title="Personal"
					onClick={() => onModeChange("personal")}
				>
					<Sparkles size={13} />
					Personal
				</button>
				<button
					type="button"
					className={mode === "code" ? "active" : ""}
					title="Code"
					onClick={() => onModeChange("code")}
				>
					<TerminalSquare size={13} />
					Code
				</button>
			</div>
		</div>
	);
}
