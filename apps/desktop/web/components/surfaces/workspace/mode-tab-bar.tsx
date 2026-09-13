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
					title="Code 编程工程与无人值守交付"
					onClick={() => onModeChange("code")}
				>
					<TerminalSquare size={13} />
					Code (无人值守)
				</button>
			</div>
		</div>
	);
}
