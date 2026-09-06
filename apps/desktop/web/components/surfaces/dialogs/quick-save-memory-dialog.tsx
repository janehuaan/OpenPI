import { useState } from "react";
import { BrainCircuit, X } from "../../icons.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/select";

export interface QuickSaveMemoryDialogProps {
	initialText: string;
	workspace?: string;
	busy?: boolean;
	onClose(): void;
	onSave(entry: {
		type: string;
		key: string;
		value: string;
		body: string;
		scope: "project" | "global";
	}): Promise<void>;
}

function generateInitialKey(text: string): string {
	const cleaned = text
		.replace(/^[#*`\-–—\s]+/g, "")
		.split("\n")[0]
		.slice(0, 30)
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return cleaned || `note-${Date.now().toString(36)}`;
}

function generateInitialSummary(text: string): string {
	const firstLine = text
		.replace(/^[#*`\-–—\s]+/g, "")
		.split("\n")
		.map((line) => line.trim())
		.find((line) => line.length > 0);
	return (firstLine || text).slice(0, 100);
}

export function QuickSaveMemoryDialog({
	initialText,
	workspace,
	busy = false,
	onClose,
	onSave,
}: QuickSaveMemoryDialogProps) {
	const [type, setType] = useState<string>("project");
	const [scope, setScope] = useState<"project" | "global">("project");
	const [key, setKey] = useState<string>(() => generateInitialKey(initialText));
	const [value, setValue] = useState<string>(() => generateInitialSummary(initialText));
	const [body, setBody] = useState<string>(initialText);
	const [error, setError] = useState<string | null>(null);

	const handleTypeChange = (newType: string) => {
		setType(newType);
		if (newType === "user" || newType === "feedback") {
			setScope("global");
		} else {
			setScope(workspace ? "project" : "global");
		}
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		const trimmedKey = key.trim();
		const trimmedValue = value.trim();
		if (!trimmedKey || !trimmedValue) {
			setError("键名与摘要不能为空");
			return;
		}

		try {
			setError(null);
			await onSave({
				type,
				key: trimmedKey,
				value: trimmedValue,
				body: body.trim() || trimmedValue,
				scope,
			});
			onClose();
		} catch (err: any) {
			setError(err?.message || "保存记忆失败");
		}
	};

	return (
		<div
			className="dialog-backdrop"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget && !busy) onClose();
			}}
		>
			<form className="dialog conversation-dialog quick-memory-dialog" onSubmit={handleSubmit}>
				<div className="dialog-header">
					<div className="dialog-header-title">
						<span className="eyebrow">长期记忆</span>
						<h2 style={{ display: "flex", alignItems: "center", gap: "8px" }}>
							<BrainCircuit size={18} style={{ color: "var(--accent)" }} />
							存为记忆
						</h2>
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

				<div className="dialog-body" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
					<p style={{ margin: 0, fontSize: "12px", color: "var(--text-muted)" }}>
						保存后，AI 会在后续所有相关对话中按内容自动召回并应用此规则或知识。
					</p>

					<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
						<label>
							<span style={{ fontSize: "12px", fontWeight: 500 }}>分类</span>
							<Select value={type} onValueChange={handleTypeChange} disabled={busy}>
								<SelectTrigger className="operation-select" style={{ marginTop: "4px" }}>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="user">用户偏好 (user)</SelectItem>
									<SelectItem value="feedback">纠偏红线 (feedback)</SelectItem>
									<SelectItem value="project">项目规范 (project)</SelectItem>
									<SelectItem value="lesson">踩坑教训 (lesson)</SelectItem>
								</SelectContent>
							</Select>
						</label>

						<label>
							<span style={{ fontSize: "12px", fontWeight: 500 }}>存储作用域</span>
							<div
								className="memory-scope-toggle"
								style={{
									display: "flex",
									marginTop: "4px",
									background: "var(--bg-subtle)",
									borderRadius: "6px",
									padding: "2px",
								}}
							>
								<button
									type="button"
									className={scope === "project" ? "active" : ""}
									style={{
										flex: 1,
										padding: "4px 8px",
										fontSize: "11px",
										border: 0,
										borderRadius: "4px",
										cursor: "pointer",
										background: scope === "project" ? "var(--bg-surface)" : "transparent",
										color: scope === "project" ? "var(--text)" : "var(--text-muted)",
										fontWeight: scope === "project" ? 600 : 400,
									}}
									disabled={busy || !workspace}
									onClick={() => setScope("project")}
									title={workspace ? "仅当前工作区有效" : "未打开工作区时不可用"}
								>
									项目 (.pi)
								</button>
								<button
									type="button"
									className={scope === "global" ? "active" : ""}
									style={{
										flex: 1,
										padding: "4px 8px",
										fontSize: "11px",
										border: 0,
										borderRadius: "4px",
										cursor: "pointer",
										background: scope === "global" ? "var(--bg-surface)" : "transparent",
										color: scope === "global" ? "var(--text)" : "var(--text-muted)",
										fontWeight: scope === "global" ? 600 : 400,
									}}
									disabled={busy}
									onClick={() => setScope("global")}
									title="所有项目与工作区共享"
								>
									全局 (~)
								</button>
							</div>
						</label>
					</div>

					<label>
						<span style={{ fontSize: "12px", fontWeight: 500 }}>键名 (Key)</span>
						<input
							value={key}
							onChange={(e) => setKey(e.target.value)}
							placeholder="如：coding-style 或 api-spec"
							required
							disabled={busy}
							style={{ marginTop: "4px" }}
						/>
					</label>

					<label>
						<span style={{ fontSize: "12px", fontWeight: 500 }}>摘要 (用于索引与快速召回)</span>
						<input
							value={value}
							onChange={(e) => setValue(e.target.value)}
							placeholder="一句话简短说明要记住的核心事实或偏好"
							required
							disabled={busy}
							style={{ marginTop: "4px" }}
						/>
					</label>

					<label>
						<span style={{ fontSize: "12px", fontWeight: 500 }}>详细正文 (可选)</span>
						<textarea
							rows={3}
							value={body}
							onChange={(e) => setBody(e.target.value)}
							placeholder="完整的规则细节或对话原文"
							disabled={busy}
							style={{ marginTop: "4px", resize: "vertical", fontSize: "12px" }}
						/>
					</label>

					{error && (
						<p style={{ margin: 0, fontSize: "12px", color: "var(--danger)" }}>
							{error}
						</p>
					)}
				</div>

				<div className="dialog-actions" style={{ marginTop: "8px" }}>
					<button type="button" className="button" disabled={busy} onClick={onClose}>
						取消
					</button>
					<button
						type="submit"
						className="button primary"
						disabled={busy || !key.trim() || !value.trim()}
					>
						{busy ? "保存中…" : "记住"}
					</button>
				</div>
			</form>
		</div>
	);
}
