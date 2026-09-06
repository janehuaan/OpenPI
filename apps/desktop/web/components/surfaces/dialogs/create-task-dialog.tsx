import { useEffect, useState } from "react";
import { X } from "../../icons.tsx";
import type { CreateTaskInput, WorkspaceSummary } from "../../../types";

export function CreateTaskDialog({
	onClose,
	onCreate,
	busy,
	initialTitle = "",
	initialPrompt = "",
	initialCwd = "",
}: {
	onClose(): void;
	onCreate(input: CreateTaskInput): Promise<void>;
	busy: boolean;
	initialTitle?: string;
	initialPrompt?: string;
	initialCwd?: string;
	workspaces?: WorkspaceSummary[];
}) {
	const [kind, setKind] = useState<"once" | "cron">("once");
	const [title, setTitle] = useState(initialTitle || "");
	const [prompt, setPrompt] = useState(initialPrompt || "");
	const [cwd, setCwd] = useState(initialCwd || "");
	const [runAt, setRunAt] = useState("");
	const [cron, setCron] = useState("0 9 * * 5");
	useEffect(() => {
		setTitle(initialTitle || "");
		setPrompt(initialPrompt || "");
		setCwd(initialCwd || "");
	}, [initialTitle, initialPrompt, initialCwd]);
	return (
		<div
			className="dialog-backdrop"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) onClose();
			}}
		>
			<form
				className="dialog"
				onSubmit={(event) => {
					event.preventDefault();
					void onCreate({
						title,
						prompt,
						cwd: cwd || undefined,
						schedule:
							kind === "once"
								? { kind, runAt: new Date(runAt).toISOString() }
								: { kind, expression: cron, timezone: "UTC" },
					});
				}}
			>
				<div className="dialog-header">
					<div>
						<span className="eyebrow">自动化</span>
						<h2>新建任务</h2>
					</div>
					<button type="button" className="icon-button quiet" title="关闭" aria-label="关闭" onClick={onClose}>
						<X size={17} />
					</button>
				</div>
				<label>
					标题
					<input
						required
						value={title ?? ""}
						onChange={(event) => setTitle(event.target.value)}
						placeholder="例如：周五进展汇总"
					/>
				</label>
				<label>
					要做什么
					<textarea
						required
						value={prompt ?? ""}
						onChange={(event) => setPrompt(event.target.value)}
						placeholder="用自然语言描述助手每次该做什么"
						rows={5}
					/>
				</label>
				<label>
					工作目录（可选）
					<input value={cwd ?? ""} onChange={(event) => setCwd(event.target.value)} placeholder="/path/to/project" />
				</label>
				<div className="field-group">
					<span>计划类型</span>
					<div className="segmented">
						<button type="button" className={kind === "once" ? "active" : ""} onClick={() => setKind("once")}>
							单次
						</button>
						<button type="button" className={kind === "cron" ? "active" : ""} onClick={() => setKind("cron")}>
							周期
						</button>
					</div>
				</div>
				{kind === "once" ? (
					<label>
						运行时间
						<input
							type="datetime-local"
							required
							value={runAt ?? ""}
							onChange={(event) => setRunAt(event.target.value)}
						/>
					</label>
				) : (
					<label>
						Cron 表达式
						<input required value={cron ?? ""} onChange={(event) => setCron(event.target.value)} />
						<small>五段 cron，按时区 UTC 解释</small>
					</label>
				)}
				<div className="dialog-actions">
					<button type="button" className="button" onClick={onClose}>
						取消
					</button>
					<button className="button primary" disabled={busy}>
						{busy ? "创建中…" : "创建"}
					</button>
				</div>
			</form>
		</div>
	);
}
