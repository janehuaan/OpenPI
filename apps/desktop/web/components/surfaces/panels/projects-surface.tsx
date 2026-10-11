import { useState } from "react";
import {
	Folder,
	FolderPlus,
	GitBranch,
	Plus,
	MessageSquare,
	ChevronRight,
	Terminal,
	RefreshCw,
	Layers,
	Sparkles,
} from "../../icons.tsx";
import type { AgentInstance } from "../../../types.ts";
import { shortWorkspacePath } from "../../../lib/helpers.ts";
import "../today/styles/today-os-dashboard.css";

interface ProjectsSurfaceProps {
	projects?: AgentInstance[];
	activeWorkspace?: string;
	onOpenProject: (instanceId: string) => void;
	onNewProjectSession: (workspace: string) => void;
	onSelectProjectFolder: () => void;
}

export function ProjectsSurface({
	projects = [],
	activeWorkspace,
	onOpenProject,
	onNewProjectSession,
	onSelectProjectFolder,
}: ProjectsSurfaceProps) {
	const [search, setSearch] = useState("");

	// Group projects by cwd
	const workspaceGroups = new Map<string, AgentInstance[]>();
	for (const p of projects) {
		const cwd = p.cwd || "default";
		const list = workspaceGroups.get(cwd) || [];
		list.push(p);
		workspaceGroups.set(cwd, list);
	}

	const groups = Array.from(workspaceGroups.entries()).filter(([cwd]) => {
		if (!search) return true;
		return cwd.toLowerCase().includes(search.toLowerCase());
	});

	return (
		<div style={{ flex: 1, height: "100%", overflowY: "auto", padding: "24px 32px", background: "var(--bg)", color: "var(--text)" }}>
			{/* Top Hero Bar */}
			<div
				style={{
					background: "var(--bg-elevated)",
					border: "1px solid var(--border)",
					borderRadius: 14,
					padding: "20px 24px",
					marginBottom: 20,
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					boxShadow: "var(--shadow-soft)",
				}}
			>
				<div>
					<div style={{ display: "flex", alignItems: "center", gap: 10 }}>
						<div
							style={{
								width: 32,
								height: 32,
								borderRadius: 8,
								background: "var(--accent-soft)",
								color: "var(--accent)",
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
							}}
						>
							<Folder size={18} />
						</div>
						<h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "var(--text)" }}>
							正在进行的项目工程 (Projects & Workspaces)
						</h2>
					</div>
					<p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--text-secondary)" }}>
						多工作空间与工程上下文隔离 · 自动代码审查与会话溯源 · 随时无缝切换到任意工程进行研发
					</p>
				</div>
				<div style={{ display: "flex", gap: 10, alignItems: "center" }}>
					<button
						type="button"
						style={{
							height: 34,
							padding: "0 14px",
							fontSize: 12.5,
							fontWeight: 600,
							borderRadius: 8,
							border: "none",
							background: "var(--accent)",
							color: "var(--accent-contrast, #ffffff)",
							cursor: "pointer",
							display: "flex",
							alignItems: "center",
							gap: 6,
						}}
						onClick={onSelectProjectFolder}
					>
						<FolderPlus size={14} />
						<span>打开新工程目录</span>
					</button>
				</div>
			</div>

			{/* Filter Search Input */}
			<div style={{ marginBottom: 18, maxWidth: 360 }}>
				<input
					type="text"
					placeholder="过滤项目路径或名称..."
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					style={{
						width: "100%",
						background: "var(--bg-elevated)",
						border: "1px solid var(--border)",
						borderRadius: 8,
						padding: "8px 12px",
						color: "var(--text)",
						fontSize: 13,
						outline: "none",
						boxShadow: "var(--shadow-soft)",
					}}
				/>
			</div>

			{/* Project Cards Grid */}
			<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 16 }}>
				{groups.map(([cwd, instances]) => {
					const parts = cwd.split(/[/\\]/).filter(Boolean);
					const folderName = parts[parts.length - 1] || cwd;
					const isCurrent = activeWorkspace && cwd === activeWorkspace;
					const activeSessionCount = instances.filter((i) => i.status === "online" || i.status === "starting").length;

					return (
						<div
							key={cwd}
							style={{
								background: isCurrent ? "var(--accent-soft)" : "var(--bg-elevated)",
								border: "1px solid",
								borderColor: isCurrent ? "var(--accent)" : "var(--border)",
								borderRadius: 12,
								padding: "18px 20px",
								display: "flex",
								flexDirection: "column",
								gap: 12,
								boxShadow: "var(--shadow-soft)",
								transition: "all 0.2s ease",
							}}
						>
							<div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
								<div style={{ display: "flex", alignItems: "center", gap: 10 }}>
									<div
										style={{
											width: 36,
											height: 36,
											borderRadius: 8,
											background: isCurrent ? "var(--accent-soft)" : "var(--bg-muted)",
											color: "var(--accent)",
											display: "flex",
											alignItems: "center",
											justifyContent: "center",
										}}
									>
										<Folder size={18} />
									</div>
									<div>
										<h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
											{folderName}
										</h3>
										<span style={{ fontSize: 11, color: "var(--text-secondary)" }}>{shortWorkspacePath(cwd)}</span>
									</div>
								</div>
								{isCurrent && (
									<span
										style={{
											fontSize: 10,
											padding: "2px 8px",
											borderRadius: 4,
											background: "var(--accent)",
											color: "var(--accent-contrast, #ffffff)",
											fontWeight: 700,
										}}
									>
										当前空间
									</span>
								)}
							</div>

							{/* Status metadata */}
							<div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 12, color: "var(--text-secondary)" }}>
								<div style={{ display: "flex", alignItems: "center", gap: 4 }}>
									<MessageSquare size={13} />
									<span>{instances.length} 个历史会话</span>
								</div>
								{activeSessionCount > 0 && (
									<div style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--accent)", fontWeight: 600 }}>
										<Sparkles size={13} />
										<span>{activeSessionCount} 个正在运行</span>
									</div>
								)}
							</div>

							<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, fontSize: 11.5, background: "var(--bg-muted)", border: "1px solid var(--border-subtle)", padding: "10px", borderRadius: 8 }}>
								<div>
									<span style={{ color: "var(--text-secondary)", fontWeight: 600 }}>GOALS (主线目标):</span>
									<div style={{ color: "var(--text)", marginTop: 2 }}>Personal Agent OS · Reliability Layer</div>
								</div>
								<div>
									<span style={{ color: "var(--text-secondary)", fontWeight: 600 }}>CONTEXT (环境与依赖):</span>
									<div style={{ color: "var(--accent)", marginTop: 2 }}>Git Repository · Worktree · {instances.length} Sessions</div>
								</div>
							</div>

							{/* Recent Sessions list snippet */}
							<div
								style={{
									background: "var(--bg-muted)",
									border: "1px solid var(--border-subtle)",
									borderRadius: 8,
									padding: "8px 12px",
									display: "flex",
									flexDirection: "column",
									gap: 6,
								}}
							>
								<span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)" }}>关联会话:</span>
								{instances.slice(0, 3).map((inst) => (
									<div
										key={inst.id}
										onClick={() => onOpenProject(inst.id)}
										style={{
											display: "flex",
											alignItems: "center",
											justifyContent: "space-between",
											fontSize: 12,
											color: "var(--text)",
											cursor: "pointer",
											padding: "3px 6px",
											borderRadius: 4,
											transition: "background 0.15s ease",
										}}
										onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-elevated)")}
										onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
									>
										<span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}>
											{inst.label || inst.id}
										</span>
										<ChevronRight size={12} color="var(--text-tertiary)" />
									</div>
								))}
							</div>

							{/* Actions */}
							<div style={{ display: "flex", gap: 10, marginTop: "auto", paddingTop: 4 }}>
								<button
									type="button"
									style={{
										flex: 1,
										height: 32,
										fontSize: 12,
										fontWeight: 600,
										borderRadius: 8,
										border: "none",
										background: "var(--accent)",
										color: "var(--accent-contrast, #ffffff)",
										cursor: "pointer",
										display: "flex",
										alignItems: "center",
										justifyContent: "center",
									}}
									onClick={() => {
										if (instances.length > 0) onOpenProject(instances[0].id);
										else onNewProjectSession(cwd);
									}}
								>
									<span>进入工程工作区</span>
								</button>
								<button
									type="button"
									style={{
										width: 32,
										height: 32,
										borderRadius: 8,
										border: "1px solid var(--border)",
										background: "var(--bg-muted)",
										color: "var(--text-secondary)",
										cursor: "pointer",
										display: "flex",
										alignItems: "center",
										justifyContent: "center",
									}}
									title="新建 Code 会话"
									onClick={() => onNewProjectSession(cwd)}
								>
									<Plus size={14} />
								</button>
							</div>
						</div>
					);
				})}

				{groups.length === 0 && (
					<div style={{ textAlign: "center", padding: "40px 20px", color: "var(--text-secondary)", gridColumn: "1 / -1" }}>
						<Folder size={36} style={{ opacity: 0.4, marginBottom: 10 }} />
						<p style={{ margin: 0, fontSize: 14 }}>暂无项目，点击右上角“打开新工程目录”开始！</p>
					</div>
				)}
			</div>
		</div>
	);
}
