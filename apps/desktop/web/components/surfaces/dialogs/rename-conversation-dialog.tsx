import { useState } from "react";
import { X } from "../../icons.tsx";
import { instanceTitle } from "../../../lib/helpers";
import type { AgentInstance } from "../../../types";

export function RenameConversationDialog({
	conversation,
	busy,
	onClose,
	onRename,
}: {
	conversation: AgentInstance;
	busy: boolean;
	onClose(): void;
	onRename(name: string): Promise<void>;
}) {
	const [name, setName] = useState(() => instanceTitle(conversation) || "");
	return (
		<div
			className="dialog-backdrop"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget && !busy) onClose();
			}}
		>
			<form
				className="dialog conversation-dialog"
				onSubmit={(event) => {
					event.preventDefault();
					void onRename(name);
				}}
			>
				<div className="dialog-header">
					<div>
						<span className="eyebrow">对话</span>
						<h2>重命名</h2>
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
				<label>
					名称
					<input autoFocus required value={name ?? ""} onChange={(event) => setName(event.target.value)} />
				</label>
				<div className="dialog-actions">
					<button type="button" className="button" disabled={busy} onClick={onClose}>
						取消
					</button>
					<button className="button primary" disabled={busy || name.trim().length === 0}>
						{busy ? "保存中…" : "保存"}
					</button>
				</div>
			</form>
		</div>
	);
}
