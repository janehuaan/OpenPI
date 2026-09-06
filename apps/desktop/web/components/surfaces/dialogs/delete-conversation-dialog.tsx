import { X } from "../../icons.tsx";
import { instanceTitle } from "../../../lib/helpers";
import type { AgentInstance } from "../../../types";

export function DeleteConversationDialog({
	conversation,
	busy,
	onClose,
	onDelete,
}: {
	conversation: AgentInstance;
	busy: boolean;
	onClose(): void;
	onDelete(): Promise<void>;
}) {
	return (
		<div
			className="dialog-backdrop"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget && !busy) onClose();
			}}
		>
			<div className="dialog conversation-dialog">
				<div className="dialog-header">
					<div>
						<span className="eyebrow danger-text">删除对话</span>
						<h2>{instanceTitle(conversation)}</h2>
					</div>
					<button
						type="button"
						className="icon-button quiet"
						title="关闭"
						aria-label="关闭"
						disabled={busy}
						onClick={onClose}
					>
						<X size={17} />
					</button>
				</div>
				<p className="destructive-dialog-copy">将永久删除此对话及其消息记录，无法恢复。</p>
				<div className="dialog-actions">
					<button type="button" className="button" disabled={busy} onClick={onClose}>
						取消
					</button>
					<button
						type="button"
						className="button danger destructive"
						disabled={busy}
						onClick={() => void onDelete()}
					>
						{busy ? "删除中…" : "删除"}
					</button>
				</div>
			</div>
		</div>
	);
}
