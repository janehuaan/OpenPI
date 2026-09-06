import { X } from "../../icons.tsx";
import type { AgentInstance } from "../../../types";

export interface DeleteProjectTarget {
	cwd: string;
	projectName: string;
	sessionCount: number;
	instances: AgentInstance[];
}

export function DeleteProjectDialog({
	target,
	busy,
	onClose,
	onDelete,
}: {
	target: DeleteProjectTarget;
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
						<span className="eyebrow danger-text">移除项目</span>
						<h2>{target.projectName}</h2>
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
				<p className="destructive-dialog-copy">
					将从工作区列表中移除此项目，并关闭其包含的 {target.sessionCount} 个 Code 会话记录。项目本地磁盘文件不会受到任何影响或被删除。
				</p>
				<div className="dialog-project-path">
					<code>{target.cwd}</code>
				</div>
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
						{busy ? "移除中…" : "确认移除"}
					</button>
				</div>
			</div>
		</div>
	);
}
