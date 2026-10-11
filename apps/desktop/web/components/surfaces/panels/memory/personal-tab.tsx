import { useState } from "react";
import { BrainCircuit, Plus, Trash2, RefreshCw, X, Sparkles } from "../../../icons.tsx";
import type { PersonalMemoryRecord } from "../../../../lib/app-types.ts";
import { desktopApi } from "../../../../api.ts";

const CATEGORIES = [
	{ id: "all", label: "全部" },
	{ id: "profile", label: "用户画像 Profile", color: "#3b82f6" },
	{ id: "preference", label: "偏好准则 Preference", color: "#8b5cf6" },
	{ id: "project", label: "工程上下文 Project", color: "#06b6d4" },
	{ id: "decision", label: "关键架构决策 Decision", color: "#10b981" },
	{ id: "experience", label: "排错经验 Experience", color: "#f59e0b" },
	{ id: "feedback", label: "正负反馈 Feedback", color: "#ec4899" },
	{ id: "temporary", label: "会话临时 Temporary", color: "#64748b" },
];

export function PersonalTab({
	memories,
	loading,
	onRefresh,
}: {
	memories: PersonalMemoryRecord[];
	loading: boolean;
	onRefresh: () => void;
}) {
	const [categoryFilter, setCategoryFilter] = useState<string>("all");
	const [showNewMemory, setShowNewMemory] = useState(false);
	const [newCategory, setNewCategory] = useState<any>("preference");
	const [newContent, setNewContent] = useState("");
	const [newImportance, setNewImportance] = useState(0.8);
	const [newTags, setNewTags] = useState("");
	const [submitting, setSubmitting] = useState(false);

	const filteredMemories = memories.filter((m) => {
		if (categoryFilter === "all") return true;
		return m.category === categoryFilter;
	});

	const handleCreateMemory = async () => {
		if (!newContent.trim()) return;
		setSubmitting(true);
		try {
			const tagList = newTags
				.split(/[,，\s]+/)
				.map((s) => s.trim())
				.filter(Boolean);

			const newRecord: PersonalMemoryRecord = {
				id: `mem-${Date.now()}`,
				category: newCategory,
				content: newContent.trim(),
				source: "user",
				confidence: 1.0,
				importance: newImportance,
				accessCount: 1,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				tags: tagList,
				relatedEntities: [],
			};

			await desktopApi.upsertPersonalMemory(newRecord);
			setNewContent("");
			setNewTags("");
			setShowNewMemory(false);
			onRefresh();
		} catch {
			// ignore
		} finally {
			setSubmitting(false);
		}
	};

	const handleDeleteMemory = async (id: string) => {
		try {
			await desktopApi.deletePersonalMemory(id);
			onRefresh();
		} catch {
			// ignore
		}
	};

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 960, margin: "0 auto" }}>
			{/* Header */}
			<div
				className="glass-card"
				style={{
					padding: "16px 22px",
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					gap: 16,
				}}
			>
				<div>
					<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
						<BrainCircuit size={18} style={{ color: "var(--accent)" }} />
						<h3 style={{ margin: 0, fontSize: 15, fontWeight: 650 }}>7维个人记忆与准则 (Personal Memories)</h3>
					</div>
					<p style={{ margin: "4px 0 0", fontSize: 12.5, color: "var(--text-secondary)" }}>
						艾宾浩斯动态半衰期衰减 · 1500 Tokens 硬顶动态切片拼装 · 白盒透明管理
					</p>
				</div>
				<div style={{ display: "flex", gap: 8 }}>
					<button
						type="button"
						className="button secondary"
						onClick={onRefresh}
						disabled={loading}
						title="刷新"
					>
						<RefreshCw size={13} className={loading ? "spin" : undefined} />
					</button>
					<button
						type="button"
						className="button primary"
						onClick={() => setShowNewMemory((prev) => !prev)}
						style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
					>
						<Plus size={14} />
						<span>添加记忆</span>
					</button>
				</div>
			</div>

			{/* Category Filter Tabs */}
			<div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
				{CATEGORIES.map((cat) => {
					const count =
						cat.id === "all"
							? memories.length
							: memories.filter((m) => m.category === cat.id).length;
					return (
						<button
							key={cat.id}
							type="button"
							className={`context-tab ${categoryFilter === cat.id ? "active" : ""}`}
							onClick={() => setCategoryFilter(cat.id)}
							style={{ fontSize: 12, padding: "5px 10px" }}
						>
							<span>{cat.label}</span>
							<span style={{ opacity: 0.7, marginLeft: 4 }}>({count})</span>
						</button>
					);
				})}
			</div>

			{/* New Memory Drawer/Card */}
			{showNewMemory && (
				<div
					className="glass-card"
					style={{
						padding: "18px 22px",
						borderRadius: 12,
						border: "1px solid var(--accent)",
						display: "flex",
						flexDirection: "column",
						gap: 12,
					}}
				>
					<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
						<h4 style={{ margin: 0, fontSize: 14, fontWeight: 650 }}>添加结构化记忆准则</h4>
						<button
							type="button"
							className="icon-button quiet"
							onClick={() => setShowNewMemory(false)}
						>
							<X size={14} />
						</button>
					</div>

					<div style={{ display: "flex", gap: 14 }}>
						<div style={{ flex: 1 }}>
							<label style={{ display: "block", fontSize: 12, color: "var(--text-secondary)", marginBottom: 4 }}>
								记忆分类
							</label>
							<select
								value={newCategory}
								onChange={(e) => setNewCategory(e.target.value)}
								style={{
									width: "100%",
									padding: "8px 10px",
									borderRadius: 6,
									border: "1px solid var(--border)",
									background: "var(--bg-muted)",
									color: "var(--text)",
									fontSize: 13,
								}}
							>
								{CATEGORIES.filter((c) => c.id !== "all").map((c) => (
									<option key={c.id} value={c.id}>
										{c.label}
									</option>
								))}
							</select>
						</div>
						<div style={{ flex: 1 }}>
							<label style={{ display: "block", fontSize: 12, color: "var(--text-secondary)", marginBottom: 4 }}>
								重要度 ({Math.round(newImportance * 100)}%)
							</label>
							<input
								type="range"
								min="0.1"
								max="1.0"
								step="0.05"
								value={newImportance}
								onChange={(e) => setNewImportance(parseFloat(e.target.value))}
								style={{ width: "100%", marginTop: 8 }}
							/>
						</div>
					</div>

					<div>
						<label style={{ display: "block", fontSize: 12, color: "var(--text-secondary)", marginBottom: 4 }}>
							记忆内容 (对 Agent 的要求、偏好或背景)
						</label>
						<textarea
							value={newContent}
							onChange={(e) => setNewContent(e.target.value)}
							placeholder="例如：优先使用 Bun 和 ESM；重构时冻结核心 Execution Core 底层..."
							rows={3}
							style={{
								width: "100%",
								padding: "8px 12px",
								borderRadius: 6,
								border: "1px solid var(--border)",
								background: "var(--bg-muted)",
								color: "var(--text)",
								fontSize: 13,
								resize: "vertical",
							}}
						/>
					</div>

					<div>
						<label style={{ display: "block", fontSize: 12, color: "var(--text-secondary)", marginBottom: 4 }}>
							标签 (以逗号隔开)
						</label>
						<input
							type="text"
							value={newTags}
							onChange={(e) => setNewTags(e.target.value)}
							placeholder="architecture, coding-style, rule"
							style={{
								width: "100%",
								padding: "8px 12px",
								borderRadius: 6,
								border: "1px solid var(--border)",
								background: "var(--bg-muted)",
								color: "var(--text)",
								fontSize: 13,
							}}
						/>
					</div>

					<div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
						<button
							type="button"
							className="button secondary"
							onClick={() => setShowNewMemory(false)}
						>
							取消
						</button>
						<button
							type="button"
							className="button primary"
							disabled={!newContent.trim() || submitting}
							onClick={handleCreateMemory}
						>
							{submitting ? "正在保存..." : "确认添加"}
						</button>
					</div>
				</div>
			)}

			{/* Memory Cards */}
			{filteredMemories.length === 0 ? (
				<div className="glass-card" style={{ padding: 32, textAlign: "center", color: "var(--text-secondary)" }}>
					暂无此分类的结构化记忆。可以在此手动添加，或等待 Agent 在对话中自适应沉淀。
				</div>
			) : (
				<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 12 }}>
					{filteredMemories.map((mem) => {
						const catObj = CATEGORIES.find((c) => c.id === mem.category);
						const catColor = catObj?.color || "var(--accent)";

						return (
							<div
								key={mem.id}
								className="glass-card"
								style={{
									padding: "16px 18px",
									borderRadius: 12,
									display: "flex",
									flexDirection: "column",
									justifyContent: "space-between",
									gap: 12,
								}}
							>
								<div>
									<div
										style={{
											display: "flex",
											alignItems: "center",
											justifyContent: "space-between",
											marginBottom: 8,
										}}
									>
										<span
											style={{
												fontSize: 11,
												padding: "2px 8px",
												borderRadius: 4,
												background: `${catColor}20`,
												color: catColor,
												fontWeight: 650,
												textTransform: "uppercase",
											}}
										>
											{mem.category}
										</span>
										<button
											type="button"
											className="button quiet danger"
											onClick={() => handleDeleteMemory(mem.id)}
											title="删除记忆"
											style={{ padding: "2px 6px" }}
										>
											<Trash2 size={12} />
										</button>
									</div>
									<div style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.55 }}>
										{mem.content}
									</div>
								</div>

								{/* Footer stats */}
								<div
									style={{
										paddingTop: 8,
										borderTop: "1px solid var(--border)",
										display: "flex",
										alignItems: "center",
										justifyContent: "space-between",
										fontSize: 11,
										color: "var(--text-secondary)",
									}}
								>
									<div style={{ display: "flex", alignItems: "center", gap: 6 }}>
										<span>重要度: {Math.round(mem.importance * 100)}%</span>
										<span>·</span>
										<span>访问: {mem.accessCount}次</span>
									</div>
									{mem.tags.length > 0 && (
										<div style={{ display: "flex", gap: 4, overflow: "hidden" }}>
											{mem.tags.slice(0, 2).map((t, i) => (
												<span
													key={i}
													style={{
														padding: "1px 5px",
														borderRadius: 3,
														background: "var(--bg-muted)",
														fontSize: 10,
													}}
												>
													#{t}
												</span>
											))}
										</div>
									)}
								</div>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
