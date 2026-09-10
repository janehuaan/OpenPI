import { type FC, useEffect } from "react";
import { Keyboard, X } from "../../icons.tsx";

export interface ShortcutsDialogProps {
	isOpen: boolean;
	onClose: () => void;
}

interface ShortcutItem {
	keys: string[];
	description: string;
}

interface ShortcutSection {
	title: string;
	items: ShortcutItem[];
}

const SHORTCUT_SECTIONS: ShortcutSection[] = [
	{
		title: "核心交互与执行",
		items: [
			{ keys: ["Enter"], description: "发送消息" },
			{ keys: ["⇧", "Enter"], description: "输入框内换行" },
			{ keys: ["⌘", "Enter"], description: "实时干预 Agent" },
			{ keys: ["⇧", "⌘", "Enter"], description: "排队到下一轮任务" },
			{ keys: ["⌘", "."], description: "强制中断当前任务生成" },
			{ keys: ["Tab"], description: "采纳复盘建议 / 补全命令" },
			{ keys: ["/"], description: "快速唤起斜杠指令清单" },
			{ keys: ["@"], description: "引用并附加工作区文件" },
		],
	},
	{
		title: "会话与视图导航",
		items: [
			{ keys: ["⌘", "N"], description: "新建对话会话" },
			{ keys: ["⌘", "B"], description: "展开 / 折叠左侧边栏" },
			{ keys: ["⌘", ","], description: "偏好设置与模型服务管理" },
			{ keys: ["⌘", "K"], description: "搜索对话与工作区项目" },
			{ keys: ["⌘", "⇧", "E"], description: "导出当前对话为 Markdown" },
			{ keys: ["⌘", "⇧", "G"], description: "打开 Git 版本管理面板" },
			{ keys: ["⌘", "/"], description: "打开本快捷键指南" },
		],
	},
	{
		title: "弹窗与状态控制",
		items: [
			{ keys: ["Esc"], description: "关闭弹窗 / 退出补全菜单" },
		],
	},
];

export const ShortcutsDialog: FC<ShortcutsDialogProps> = ({ isOpen, onClose }) => {
	useEffect(() => {
		if (!isOpen) return;
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				onClose();
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [isOpen, onClose]);

	if (!isOpen) return null;

	return (
		<div
			className="dialog-backdrop"
			style={{ zIndex: 9999 }}
			onClick={(e) => {
				if (e.target === e.currentTarget) onClose();
			}}
		>
			<div
				className="dialog"
				style={{
					maxWidth: "580px",
					width: "90vw",
					padding: "20px 24px",
					borderRadius: "16px",
					boxShadow: "0 20px 48px rgba(0, 0, 0, 0.45)",
					background: "var(--bg-elevated, #1a1d24)",
					border: "1px solid var(--border, rgba(255, 255, 255, 0.1))",
				}}
			>
				{/* Header */}
				<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
					<div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
						<div
							style={{
								width: "32px",
								height: "32px",
								borderRadius: "8px",
								background: "rgba(56, 189, 248, 0.12)",
								color: "#38bdf8",
								display: "grid",
								placeItems: "center",
							}}
						>
							<Keyboard size={18} />
						</div>
						<div>
							<h3 style={{ margin: 0, fontSize: "15px", fontWeight: 650, color: "var(--text, #f1f5f9)" }}>
								快捷键指南
							</h3>
							<span style={{ fontSize: "12px", color: "var(--text-tertiary, #94a3b8)" }}>
								极速键盘操作矩阵 · 提升全流程开发效率
							</span>
						</div>
					</div>
					<button
						type="button"
						className="icon-button quiet"
						title="关闭"
						aria-label="关闭"
						onClick={onClose}
					>
						<X size={16} />
					</button>
				</div>

				{/* Sections */}
				<div style={{ display: "flex", flexDirection: "column", gap: "16px", maxHeight: "60vh", overflowY: "auto", paddingRight: "4px" }}>
					{SHORTCUT_SECTIONS.map((sec) => (
						<div key={sec.title} style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
							<span
								style={{
									fontSize: "11.5px",
									fontWeight: 600,
									color: "var(--accent, #38bdf8)",
									textTransform: "uppercase",
									letterSpacing: "0.5px",
									marginBottom: "2px",
								}}
							>
								{sec.title}
							</span>
							<div
								style={{
									display: "grid",
									gridTemplateColumns: "1fr 1fr",
									gap: "6px",
								}}
							>
								{sec.items.map((item) => (
									<div
										key={item.description}
										style={{
											display: "flex",
											alignItems: "center",
											justifyContent: "space-between",
											padding: "6px 10px",
											borderRadius: "8px",
											background: "rgba(255, 255, 255, 0.03)",
											border: "1px solid rgba(255, 255, 255, 0.04)",
										}}
									>
										<span style={{ fontSize: "12px", color: "var(--text-secondary, #cbd5e1)" }}>
											{item.description}
										</span>
										<div style={{ display: "inline-flex", gap: "3px" }}>
											{item.keys.map((k) => (
												<kbd
													key={k}
													style={{
														padding: "2px 6px",
														borderRadius: "4px",
														fontSize: "11px",
														fontWeight: 600,
														background: "rgba(255, 255, 255, 0.08)",
														border: "1px solid rgba(255, 255, 255, 0.12)",
														color: "var(--text, #f1f5f9)",
														boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
														minWidth: "18px",
														textAlign: "center",
													}}
												>
													{k}
												</kbd>
											))}
										</div>
									</div>
								))}
							</div>
						</div>
					))}
				</div>

				{/* Footer */}
				<div
					style={{
						marginTop: "16px",
						paddingTop: "12px",
						borderTop: "1px solid var(--border, rgba(255, 255, 255, 0.08))",
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
						fontSize: "12px",
						color: "var(--text-tertiary, #94a3b8)",
					}}
				>
					<span>提示：Windows / Linux 环境下 <kbd style={{ padding: "1px 4px", borderRadius: "3px", background: "rgba(255, 255, 255, 0.08)" }}>⌘</kbd> 对应 <kbd style={{ padding: "1px 4px", borderRadius: "3px", background: "rgba(255, 255, 255, 0.08)" }}>Ctrl</kbd></span>
					<button
						type="button"
						className="button secondary"
						style={{ padding: "4px 14px", fontSize: "12px" }}
						onClick={onClose}
					>
						关闭
					</button>
				</div>
			</div>
		</div>
	);
};
