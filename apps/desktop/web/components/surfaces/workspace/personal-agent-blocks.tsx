import React, { useState } from "react";
import {
	AlertCircle,
	ArrowRight,
	Bot,
	BrainCircuit,
	Check,
	CheckCircle2,
	ChevronDown,
	Circle,
	Clock3,
	Folder,
	Play,
	RefreshCw,
	Shield,
	Sparkles,
	Target,
	Terminal,
	Zap,
} from "../../icons.tsx";
import { MarkdownText } from "../../../lib/markdown";

/**
 * 5.1 Context Reconstruction Card
 * 用户无需重新解释昨天发生的事情，智能体自动恢复长程目标与上下文上下文。
 */
export function ContextReconstructionCard({
	goalTitle = "OpenPI Personal Agent OS",
	progress = 72,
	completedSteps = [
		"User Model (用户画像)",
		"Memory (记忆系统)",
		"Goal (目标管理)",
		"Decision (决策引擎)",
	],
	nextSteps = [
		"Reliability (可靠性层)",
		"Resource Budget (资源配额)",
		"Learning Attribution (学习归因)",
	],
	onNextClick,
}: {
	goalTitle?: string;
	progress?: number;
	completedSteps?: string[];
	nextSteps?: string[];
	onNextClick?: (step: string) => void;
}) {
	return (
		<div className="pa-context-card">
			<div className="pa-context-card-header">
				<span className="pa-context-goal-title">当前目标: {goalTitle}</span>
				<div className="pa-context-progress-wrap">
					<div className="pa-context-progress-bar">
						<div className="pa-context-progress-fill" style={{ width: `${progress}%` }} />
					</div>
					<span className="pa-context-progress-num">{progress}%</span>
				</div>
			</div>
			<div className="pa-context-card-body">
				<div className="pa-context-col">
					<div className="pa-context-col-title">已完成</div>
					<div className="pa-context-step-list">
						{completedSteps.map((step) => (
							<div key={step} className="pa-context-step-item completed">
								<div className="pa-step-icon check">
									<Check size={11} />
								</div>
								<span>{step}</span>
							</div>
						))}
					</div>
				</div>
				<div className="pa-context-col divider">
					<div className="pa-context-col-title">下一步</div>
					<div className="pa-context-step-list">
						{nextSteps.map((step) => (
							<div
								key={step}
								className="pa-context-step-item next"
								onClick={() => onNextClick?.(step)}
							>
								<div className="pa-step-icon circle" />
								<span>{step}</span>
							</div>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}

/**
 * 6. Working 状态 (Agent Activity: Understanding → Decision → Live Activity)
 * 表达 Agent 正在做什么、为什么这么做。
 */
export function AgentWorkingActivityCard({
	goal = "OpenPI Personal Agent OS",
	intent = "在不污染底层 execution core 的前提下，构建个人可靠性与决策层",
	decision = "严格冻结底层 openpi-engine，通过统一安全网关挂载 Personal Reliability Layer",
	activities = [
		{ title: "检查 Execution Gateway 网关约束", status: "completed" },
		{ title: "建立 Circuit Breaker 熔断状态机", status: "running" },
		{ title: "配置 30% / 70% 分层资源配额", status: "pending" },
		{ title: "注册十大系统不变量看门狗", status: "pending" },
	],
}: {
	goal?: string;
	intent?: string;
	decision?: string;
	activities?: Array<{ title: string; status: "completed" | "running" | "pending" }>;
}) {
	return (
		<div className="agent-working-activity-card" style={{
			margin: "8px 0 12px",
			padding: "14px 16px",
			background: "rgba(18, 24, 38, 0.8)",
			border: "1px solid rgba(255, 255, 255, 0.08)",
			borderRadius: "14px",
			backdropFilter: "blur(20px)",
		}}>
			<div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
				<Zap size={14} color="#f97316" />
				<span style={{ fontSize: "11px", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.5px" }}>
					AGENT ACTIVITY · 理解与决策推演
				</span>
			</div>

			{/* Understanding & Decision */}
			<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", fontSize: "12px", marginBottom: "12px" }}>
				<div style={{ background: "rgba(255, 255, 255, 0.03)", padding: "10px", borderRadius: "8px" }}>
					<span style={{ fontSize: "10.5px", color: "#64748b", fontWeight: 600, display: "block" }}>UNDERSTANDING</span>
					<div style={{ color: "#f8fafc", fontWeight: 600, marginTop: "2px" }}>{goal}</div>
					<div style={{ color: "#94a3b8", fontSize: "11px", marginTop: "2px" }}>{intent}</div>
				</div>
				<div style={{ background: "rgba(255, 255, 255, 0.03)", padding: "10px", borderRadius: "8px" }}>
					<span style={{ fontSize: "10.5px", color: "#64748b", fontWeight: 600, display: "block" }}>DECISION</span>
					<div style={{ color: "#38bdf8", fontWeight: 600, marginTop: "2px" }}>Protect Core & Compose Layer</div>
					<div style={{ color: "#94a3b8", fontSize: "11px", marginTop: "2px" }}>{decision}</div>
				</div>
			</div>

			{/* Live Activity timeline */}
			<div>
				<span style={{ fontSize: "10.5px", color: "#94a3b8", fontWeight: 600, display: "block", marginBottom: "6px" }}>
					LIVE ACTIVITY 流水线
				</span>
				<div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
					{activities.map((act, i) => (
						<div key={i} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px" }}>
							{act.status === "completed" ? (
								<CheckCircle2 size={13} color="#10b981" />
							) : act.status === "running" ? (
								<RefreshCw size={13} color="#38bdf8" className="spin" />
							) : (
								<Circle size={13} color="#64748b" />
							)}
							<span style={{
								color: act.status === "running" ? "#38bdf8" : act.status === "completed" ? "#cbd5e1" : "#64748b",
								fontWeight: act.status === "running" ? 600 : 400,
							}}>
								{act.title}
							</span>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}

/**
 * 7. Decision 状态 (Interactive Decision Engine UI)
 * 当智能体需要用户做关键架构或权限决策时呈现。
 */
export function AgentDecisionPromptCard({
	title = "AGENT NEEDS YOUR DECISION",
	description = "在后台任务失败时检测到两种可行的恢复策略，请选择你的首选方式：",
	optionA = {
		label: "A: 自动重试 (Automatic retry)",
		desc: "最高可靠性，后台自动执行 Canary Probing 恢复，但会消耗稍多资源",
		buttonText: "选择方案 A (自动重试)",
		prompt: "请采用方案 A：自动重试以确保任务最高可靠性，并设置最大重试上限为 2 次。",
	},
	optionB = {
		label: "B: 重试前请示 (Ask before retrying)",
		desc: "极低资源消耗与零自作主张，但在异常发生时需要人工确认",
		buttonText: "选择方案 B (请示确认)",
		prompt: "请采用方案 B：在重试前向我请示确认，节约资源并保持白盒受控。",
	},
	onSelectOption,
}: {
	title?: string;
	description?: string;
	optionA?: { label: string; desc: string; buttonText: string; prompt: string };
	optionB?: { label: string; desc: string; buttonText: string; prompt: string };
	onSelectOption: (prompt: string) => void;
}) {
	return (
		<div className="agent-decision-prompt-card" style={{
			margin: "12px 0 16px",
			padding: "16px",
			background: "rgba(18, 24, 38, 0.9)",
			border: "1px solid rgba(249, 115, 22, 0.35)",
			borderRadius: "14px",
			boxShadow: "0 6px 24px rgba(249, 115, 22, 0.12)",
		}}>
			<div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
				<Shield size={14} color="#f97316" />
				<span style={{ fontSize: "11px", fontWeight: 700, color: "#f97316", letterSpacing: "0.5px" }}>
					{title}
				</span>
			</div>
			<p style={{ margin: "0 0 12px", fontSize: "12.5px", color: "#cbd5e1" }}>
				{description}
			</p>

			<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
				{/* Option A */}
				<div style={{
					background: "rgba(255, 255, 255, 0.03)",
					border: "1px solid rgba(255, 255, 255, 0.08)",
					borderRadius: "10px",
					padding: "12px",
					display: "flex",
					flexDirection: "column",
					justifyContent: "space-between",
					gap: "10px",
				}}>
					<div>
						<div style={{ fontSize: "13px", fontWeight: 600, color: "#f8fafc" }}>{optionA.label}</div>
						<div style={{ fontSize: "11.5px", color: "#94a3b8", marginTop: "4px", lineHeight: 1.4 }}>{optionA.desc}</div>
					</div>
					<button
						type="button"
						onClick={() => onSelectOption(optionA.prompt)}
						style={{
							padding: "7px 12px",
							borderRadius: "7px",
							background: "#f97316",
							border: "none",
							color: "#fff",
							fontSize: "12px",
							fontWeight: 600,
							cursor: "pointer",
							transition: "all 0.15s ease",
						}}
					>
						{optionA.buttonText}
					</button>
				</div>

				{/* Option B */}
				<div style={{
					background: "rgba(255, 255, 255, 0.03)",
					border: "1px solid rgba(255, 255, 255, 0.08)",
					borderRadius: "10px",
					padding: "12px",
					display: "flex",
					flexDirection: "column",
					justifyContent: "space-between",
					gap: "10px",
				}}>
					<div>
						<div style={{ fontSize: "13px", fontWeight: 600, color: "#f8fafc" }}>{optionB.label}</div>
						<div style={{ fontSize: "11.5px", color: "#94a3b8", marginTop: "4px", lineHeight: 1.4 }}>{optionB.desc}</div>
					</div>
					<button
						type="button"
						onClick={() => onSelectOption(optionB.prompt)}
						style={{
							padding: "7px 12px",
							borderRadius: "7px",
							background: "rgba(255, 255, 255, 0.08)",
							border: "1px solid rgba(255, 255, 255, 0.12)",
							color: "#cbd5e1",
							fontSize: "12px",
							fontWeight: 600,
							cursor: "pointer",
							transition: "all 0.15s ease",
						}}
					>
						{optionB.buttonText}
					</button>
				</div>
			</div>
		</div>
	);
}

/**
 * 8. Execution 状态
 * 直接在中间 Workspace 展开，默认抽象，按需展开。
 */
export function AgentExecutionOverviewCard({
	goalTitle = "OpenPI Personal Agent OS",
	workflow = ["Analyze", "Design", "Implement", "Review"],
	currentAction = "Implementing reliability/circuit-breaker.ts",
	tools = ["filesystem", "terminal", "git"],
	backgroundTasks = 2,
}: {
	goalTitle?: string;
	workflow?: string[];
	currentAction?: string;
	tools?: string[];
	backgroundTasks?: number;
}) {
	return (
		<div className="agent-execution-overview-card" style={{
			margin: "8px 0 12px",
			padding: "12px 14px",
			background: "rgba(15, 23, 42, 0.65)",
			border: "1px solid rgba(255, 255, 255, 0.08)",
			borderRadius: "12px",
			fontSize: "12px",
		}}>
			<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
				<div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
					<Terminal size={13} color="#38bdf8" />
					<span style={{ fontSize: "11px", fontWeight: 700, color: "#94a3b8" }}>EXECUTION · 核心执行工作流</span>
				</div>
				<span style={{ fontSize: "11px", color: "#64748b" }}>后台任务: {backgroundTasks} 个活跃</span>
			</div>

			<div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px", flexWrap: "wrap" }}>
				<span style={{ fontSize: "11px", color: "#64748b" }}>Workflow:</span>
				{workflow.map((w, idx) => (
					<React.Fragment key={w}>
						<span style={{
							padding: "1px 6px",
							borderRadius: "4px",
							fontSize: "11px",
							background: idx === 2 ? "rgba(56, 189, 248, 0.15)" : "rgba(255, 255, 255, 0.04)",
							color: idx === 2 ? "#38bdf8" : "#94a3b8",
							fontWeight: idx === 2 ? 600 : 400,
						}}>
							{w}
						</span>
						{idx < workflow.length - 1 && <span style={{ color: "#475569", fontSize: "10px" }}>→</span>}
					</React.Fragment>
				))}
			</div>

			<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "11.5px" }}>
				<div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
					<span style={{ color: "#38bdf8" }}>● 正在执行:</span>
					<span style={{ color: "#f8fafc", fontFamily: "monospace" }}>{currentAction}</span>
				</div>
				<div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
					{tools.map((t) => (
						<span key={t} style={{
							fontSize: "10px",
							padding: "1px 5px",
							borderRadius: "3px",
							background: "rgba(255, 255, 255, 0.05)",
							color: "#94a3b8",
						}}>
							✓ {t}
						</span>
					))}
				</div>
			</div>
		</div>
	);
}

/**
 * 结构化交付成果物模型
 */
export interface ParsedOutcome {
	isStructured: boolean;
	deliverablesTitle?: string;
	deliverables: string[];
	notesTitle?: string;
	notes: string[];
	verificationTitle?: string;
	verificationText?: string;
	actionPills: string[];
	proposalQuestion?: string;
	proposalOptions?: { label: string; text: string; primary?: boolean }[];
	unmatchedText?: string;
}

/**
 * 智能解析智能体回复中的结构化交付与决策内容
 */
export function parseAgentOutcome(rawText: string): ParsedOutcome | null {
	if (!rawText || rawText.trim().length === 0) return null;

	const trimmed = rawText.trim();
	let deliverables: string[] = [];
	let deliverablesTitle = "交付成果与系统变更";
	let notes: string[] = [];
	let notesTitle = "系统运行态说明";
	let verificationTitle = "即刻验证方式";
	let verificationText = "";
	const actionPills: string[] = [];
	let proposalQuestion = "";
	let proposalOptions: { label: string; text: string; primary?: boolean }[] | undefined;

	// 1. 匹配 Deliverables ("做了什么" / "交付成果" / "完成内容")
	const deliverablesMatch = trimmed.match(
		/(?:^|\n)(?:###?\s*|\*\*\s*)(做了什么|交付成果|完成内容|执行结果|变更记录)(?:\*\*|:|：)?\s*\n([\s\S]*?)(?=(?:\n###?\s*|\n\*\*\s*|\n要不要我|\n是否需要|$))/i
	);
	if (deliverablesMatch) {
		deliverablesTitle = deliverablesMatch[1].trim();
		const lines = deliverablesMatch[2].split("\n").map((l) => l.trim()).filter(Boolean);
		deliverables = lines.map((l) => l.replace(/^(?:\d+\.|\-|\*)\s*/, "").trim()).filter(Boolean);
	}

	// 2. 匹配 Notes ("两点说明" / "说明" / "注意事项")
	const notesMatch = trimmed.match(
		/(?:^|\n)(?:###?\s*|\*\*\s*)((?:\d+点)?说明|注意事项|运行态说明|补充说明)(?:\*\*|:|：)?\s*\n([\s\S]*?)(?=(?:\n###?\s*|\n\*\*\s*|\n要不要我|\n是否需要|$))/i
	);
	if (notesMatch) {
		notesTitle = notesMatch[1].trim();
		const lines = notesMatch[2].split("\n").map((l) => l.trim()).filter(Boolean);
		notes = lines.map((l) => l.replace(/^(?:\d+\.|\-|\*)\s*/, "").trim()).filter(Boolean);
	}

	// 3. 匹配 Verification ("验证方式" / "如何验证")
	const verifyMatch = trimmed.match(
		/(?:^|\n)(?:###?\s*|\*\*\s*)(验证方式|如何验证|验证|测试方式)(?:\*\*|:|：)?\s*\n([\s\S]*?)(?=(?:\n###?\s*|\n\*\*\s*|\n要不要我|\n是否需要|$))/i
	);
	if (verifyMatch) {
		verificationTitle = verifyMatch[1].trim();
		verificationText = verifyMatch[2].trim();

		// 从验证文本中抽取带引号的指令，如 "用 radare2 分析这个二进制" 或 “反编译这个 APK”
		const quoteMatches = verificationText.matchAll(/(?:["“])([^"”\n]{4,40})(?:["”])/g);
		for (const q of quoteMatches) {
			if (q[1] && !actionPills.includes(q[1])) {
				actionPills.push(q[1]);
			}
		}
	}

	// 4. 匹配 Proposal / 决策询问 ("要不要我把...存成 skill?" 或 "是否需要...")
	const proposalMatch = trimmed.match(
		/(?:^|\n)(要不要我(?:把)?[\s\S]*?\?|是否需要我[\s\S]*?\?|建议下一步[\s\S]*?(?:\?|。))/i
	);
	if (proposalMatch) {
		proposalQuestion = proposalMatch[1].trim();
		if (/skill/i.test(proposalQuestion)) {
			proposalOptions = [
				{ label: "⚡ 立即存为全局 Skill (推荐)", text: "确认，请将这套流程整理并固化为全局 Skill。", primary: true },
				{ label: "📁 仅记入当前项目经验", text: "仅将该流程记录在当前项目的 ops 文档中。" },
				{ label: "✕ 暂不处理", text: "暂不处理，继续下一步。" },
			];
		} else if (/commit|提交|git/i.test(proposalQuestion)) {
			proposalOptions = [
				{ label: "⚡ 确认提交代码 (推荐)", text: "确认，请执行 git commit 并附带规范说明。", primary: true },
				{ label: "🔍 先查看详细 Diff", text: "请先展示详细的代码变更 diff。" },
				{ label: "✕ 暂不提交", text: "暂不提交当前代码变更。" },
			];
		} else {
			proposalOptions = [
				{ label: "✓ 确认执行 (Proceed)", text: "好的，请继续执行该提议。", primary: true },
				{ label: "✕ 暂不处理 (Skip)", text: "暂不处理该提议，继续当前任务。" },
			];
		}
	}

	// 判断是否构成结构化交付物
	const isStructured = deliverables.length > 0 || (notes.length > 0 && actionPills.length > 0) || Boolean(proposalQuestion && deliverables.length > 0);
	if (!isStructured) return null;

	return {
		isStructured: true,
		deliverablesTitle,
		deliverables,
		notesTitle,
		notes,
		verificationTitle,
		verificationText,
		actionPills,
		proposalQuestion,
		proposalOptions,
	};
}

function HighlightedRichText({ text }: { text: string }) {
	// 拆分冒号前缀如 "定位根因:"
	const colonMatch = text.match(/^([^:：]+[:：])\s*(.*)$/);
	let prefix = "";
	let body = text;
	if (colonMatch) {
		prefix = colonMatch[1];
		body = colonMatch[2];
	}

	// 拆分反引号代码段 `code`
	const parts = body.split(/(`[^`]+`)/);

	return (
		<span>
			{prefix && <strong style={{ color: "#f8fafc", marginRight: 4 }}>{prefix}</strong>}
			{parts.map((p, idx) => {
				if (p.startsWith("`") && p.endsWith("`")) {
					const code = p.slice(1, -1);
					return (
						<code
							key={idx}
							style={{
								padding: "1px 5px",
								borderRadius: "4px",
								fontSize: "11px",
								background: "rgba(245, 158, 11, 0.12)",
								color: "#fbbf24",
								border: "1px solid rgba(245, 158, 11, 0.2)",
								fontFamily: "var(--font-mono, monospace)",
								margin: "0 2px",
							}}
						>
							{code}
						</code>
					);
				}
				return <span key={idx} style={{ color: "#cbd5e1" }}>{p}</span>;
			})}
		</span>
	);
}

/**
 * Personal Agent OS 结构化任务交付看板 (Agent Outcome & Action Workspace Card)
 */
export function AgentOutcomeCard({
	outcome,
	onActionRun,
	onDecisionChoose,
}: {
	outcome: ParsedOutcome;
	onActionRun?: (actionText: string) => void;
	onDecisionChoose?: (decisionText: string) => void;
}) {
	return (
		<div
			className="agent-outcome-card"
			style={{
				display: "flex",
				flexDirection: "column",
				gap: "14px",
				margin: "8px 0 16px",
				padding: "18px 20px",
				background: "rgba(13, 20, 36, 0.8)",
				border: "1px solid rgba(255, 255, 255, 0.09)",
				borderRadius: "14px",
				backdropFilter: "blur(20px)",
				boxShadow: "0 8px 32px rgba(0, 0, 0, 0.35)",
				fontSize: "12.5px",
			}}
		>
			{/* Top Header Banner */}
			<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid rgba(255, 255, 255, 0.06)", paddingBottom: "12px" }}>
				<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
					<div
						style={{
							width: "22px",
							height: "22px",
							borderRadius: "6px",
							background: "linear-gradient(135deg, #f97316 0%, #ea580c 100%)",
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							color: "#fff",
						}}
					>
						<Zap size={13} />
					</div>
					<span style={{ fontSize: "12px", fontWeight: 700, color: "#f8fafc", letterSpacing: "0.5px" }}>
						MISSION DELIVERED · 任务交付与系统变更
					</span>
				</div>
				<span
					style={{
						fontSize: "11px",
						padding: "2px 8px",
						borderRadius: "4px",
						background: "rgba(16, 185, 129, 0.12)",
						color: "#10b981",
						fontWeight: 600,
						border: "1px solid rgba(16, 185, 129, 0.2)",
					}}
				>
					● 交付已验证 (Verified)
				</span>
			</div>

			{/* Deliverables Section */}
			{outcome.deliverables.length > 0 && (
				<div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
					<div style={{ fontSize: "11.5px", fontWeight: 700, color: "#94a3b8", display: "flex", alignItems: "center", gap: "6px" }}>
						<Check size={13} color="#10b981" />
						<span>{outcome.deliverablesTitle}</span>
					</div>
					<div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
						{outcome.deliverables.map((item, idx) => (
							<div
								key={idx}
								style={{
									display: "flex",
									alignItems: "flex-start",
									gap: "8px",
									background: "rgba(255, 255, 255, 0.025)",
									padding: "8px 12px",
									borderRadius: "8px",
									border: "1px solid rgba(255, 255, 255, 0.04)",
									lineHeight: "1.5",
								}}
							>
								<span
									style={{
										minWidth: "18px",
										height: "18px",
										borderRadius: "50%",
										background: "rgba(16, 185, 129, 0.15)",
										color: "#10b981",
										display: "flex",
										alignItems: "center",
										justifyContent: "center",
										fontSize: "10.5px",
										fontWeight: 700,
										marginTop: "1px",
									}}
								>
									{idx + 1}
								</span>
								<div style={{ flex: 1 }}>
									<HighlightedRichText text={item} />
								</div>
							</div>
						))}
					</div>
				</div>
			)}

			{/* Notes Section */}
			{outcome.notes.length > 0 && (
				<div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
					<div style={{ fontSize: "11.5px", fontWeight: 700, color: "#94a3b8", display: "flex", alignItems: "center", gap: "6px" }}>
						<Sparkles size={13} color="#38bdf8" />
						<span>{outcome.notesTitle}</span>
					</div>
					<div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
						{outcome.notes.map((note, idx) => {
							const isSuccess = /无需重启|自动生效|已通过|正常/i.test(note);
							const isWarning = /悬空|未安装|注意|待补/i.test(note);
							const indicatorColor = isSuccess ? "#10b981" : isWarning ? "#eab308" : "#38bdf8";
							return (
								<div
									key={idx}
									style={{
										display: "flex",
										alignItems: "center",
										gap: "8px",
										background: "rgba(255, 255, 255, 0.02)",
										padding: "6px 12px",
										borderRadius: "6px",
										borderLeft: `2px solid ${indicatorColor}`,
										lineHeight: "1.4",
									}}
								>
									<span style={{ color: indicatorColor, fontSize: "10px" }}>●</span>
									<div style={{ flex: 1 }}>
										<HighlightedRichText text={note} />
									</div>
								</div>
							);
						})}
					</div>
				</div>
			)}

			{/* Verification & Action Pills */}
			{(outcome.verificationText || outcome.actionPills.length > 0) && (
				<div style={{ display: "flex", flexDirection: "column", gap: "8px", background: "rgba(56, 189, 248, 0.04)", padding: "10px 14px", borderRadius: "10px", border: "1px solid rgba(56, 189, 248, 0.12)" }}>
					<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
						<span style={{ fontSize: "11px", fontWeight: 700, color: "#38bdf8", textTransform: "uppercase" }}>
							{outcome.verificationTitle}
						</span>
						<span style={{ fontSize: "10.5px", color: "#64748b" }}>点击下方指令一键填入验证</span>
					</div>
					{outcome.verificationText && (
						<p style={{ margin: 0, color: "#94a3b8", fontSize: "12px", lineHeight: "1.5" }}>
							{outcome.verificationText}
						</p>
					)}
					{outcome.actionPills.length > 0 && (
						<div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "4px" }}>
							{outcome.actionPills.map((pill, idx) => (
								<button
									key={idx}
									type="button"
									onClick={() => onActionRun?.(pill)}
									style={{
										display: "flex",
										alignItems: "center",
										gap: "6px",
										padding: "6px 12px",
										background: "rgba(56, 189, 248, 0.1)",
										border: "1px solid rgba(56, 189, 248, 0.3)",
										borderRadius: "6px",
										color: "#e0f2fe",
										fontSize: "12px",
										fontWeight: 500,
										cursor: "pointer",
										transition: "all 0.15s ease",
									}}
									onMouseEnter={(e) => {
										e.currentTarget.style.background = "rgba(56, 189, 248, 0.2)";
										e.currentTarget.style.borderColor = "#38bdf8";
									}}
									onMouseLeave={(e) => {
										e.currentTarget.style.background = "rgba(56, 189, 248, 0.1)";
										e.currentTarget.style.borderColor = "rgba(56, 189, 248, 0.3)";
									}}
								>
									<Play size={11} color="#38bdf8" />
									<span>{pill}</span>
								</button>
							))}
						</div>
					)}
				</div>
			)}

			{/* Interactive Proposal Card */}
			{outcome.proposalQuestion && (
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						gap: "10px",
						background: "rgba(249, 115, 22, 0.05)",
						border: "1px solid rgba(249, 115, 22, 0.2)",
						borderRadius: "10px",
						padding: "12px 14px",
					}}
				>
					<div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
						<Sparkles size={13} color="#f97316" />
						<span style={{ fontSize: "11px", fontWeight: 700, color: "#f97316", textTransform: "uppercase" }}>
							PROPOSAL & DECISION · 智能体提议待裁决
						</span>
					</div>
					<p style={{ margin: 0, fontSize: "12.5px", color: "#f8fafc", fontWeight: 500, lineHeight: "1.5" }}>
						{outcome.proposalQuestion}
					</p>
					{outcome.proposalOptions && (
						<div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "4px" }}>
							{outcome.proposalOptions.map((opt, idx) => (
								<button
									key={idx}
									type="button"
									onClick={() => onDecisionChoose?.(opt.text)}
									style={{
										padding: "7px 14px",
										borderRadius: "6px",
										fontSize: "12px",
										fontWeight: opt.primary ? 600 : 400,
										background: opt.primary
											? "linear-gradient(135deg, #f97316 0%, #ea580c 100%)"
											: "rgba(255, 255, 255, 0.05)",
										color: opt.primary ? "#fff" : "#cbd5e1",
										border: opt.primary ? "none" : "1px solid rgba(255, 255, 255, 0.1)",
										cursor: "pointer",
										boxShadow: opt.primary ? "0 2px 8px rgba(249, 115, 22, 0.35)" : "none",
										transition: "all 0.15s ease",
									}}
									onMouseEnter={(e) => {
										if (!opt.primary) e.currentTarget.style.background = "rgba(255, 255, 255, 0.1)";
									}}
									onMouseLeave={(e) => {
										if (!opt.primary) e.currentTarget.style.background = "rgba(255, 255, 255, 0.05)";
									}}
								>
									{opt.label}
								</button>
							))}
						</div>
					)}
				</div>
			)}
		</div>
	);
}

/**
 * 通用「结论简报」解析结果。
 * 覆盖 `parseAgentOutcome` 覆盖不到的分析 / 建议 / 问答型回复。
 */
export interface AnswerBrief {
	isStructured: boolean;
	status: "done" | "working" | "confirm" | "blocked";
	tldr: string;
	points: string[];
	suggestions: string[];
	body: string;
}

function stripBriefMarkup(s: string): string {
	return s
		.replace(/^[\s>*#\-]+/, "")
		.replace(/\*\*/g, "")
		.replace(/`/g, "")
		.replace(/^[\s、.：:]+/, "")
		.trim();
}

/**
 * 把分析 / 建议 / 问答型回复结构化为 TL;DR + 要点 + 建议 + 折叠正文。
 * 判定过窄时返回 null（真正的短对话保持轻气泡，不强套卡片）。
 */
export function parseAnswerBrief(rawText: string): AnswerBrief | null {
	if (!rawText) return null;
	const trimmed = rawText.trim();
	// 短对话不套卡片
	if (trimmed.length < 45) return null;

	const lines = trimmed.split("\n");

	// 1. TL;DR —— 优先显式总结句式
	let tldr = "";
	const tldrPattern = /(?:一句话总结|一句话概括|结论是|结论|总之|简而言之|核心是|要点是|总结)[：:]\s*(.+)/;
	for (const l of lines) {
		const m = stripBriefMarkup(l).match(tldrPattern);
		if (m && m[1]) {
			tldr = stripBriefMarkup(m[1]).slice(0, 120);
			break;
		}
	}
	// 兜底：首段首句
	if (!tldr) {
		const firstPara = trimmed.split(/\n\s*\n/)[0]?.trim() ?? "";
		const firstSentence = (firstPara.split(/(?<=[。！？.!?])/)[0] ?? firstPara).trim();
		if (
			firstSentence.length >= 8 &&
			firstSentence.length <= 90 &&
			!/^[#*\-\d]/.test(firstSentence)
		) {
			tldr = stripBriefMarkup(firstSentence).slice(0, 120);
		}
	}

	// 2. 要点 —— 所有 bullet 行
	const points: string[] = [];
	for (const l of lines) {
		const m = l.trim().match(/^(?:[-*•]|\d+[.、)])\s+(.+)$/);
		if (m && m[1]) {
			const cleaned = stripBriefMarkup(m[1]);
			if (cleaned.length >= 4 && !points.includes(cleaned)) points.push(cleaned);
		}
		if (points.length >= 6) break;
	}

	// 3. 建议 —— 显式建议句式
	const suggestions: string[] = [];
	const suggestPattern = /(?:建议|下一步|你可以|推荐|不妨|可以尝试)[：:]?\s*(.+)/;
	for (const l of lines) {
		const m = stripBriefMarkup(l).match(suggestPattern);
		if (m && m[1]) {
			const s = stripBriefMarkup(m[1]).replace(/[。！!]+$/, "").slice(0, 40);
			if (s.length >= 4 && !suggestions.includes(s)) suggestions.push(s);
		}
		if (suggestions.length >= 3) break;
	}

	// 结构化判定：既无结论又无明显要点 → 保持轻气泡
	if (!tldr && points.length < 2) return null;

	// 4. 状态推断
	let status: AnswerBrief["status"] = "done";
	if (/(待确认|请确认|需要你|是否(?:开始|需要|要)|要不要|请你决定|等待确认)/.test(trimmed)) {
		status = "confirm";
	} else if (/(进行中|正在|尚未完成|待办|下一步)/.test(trimmed)) {
		status = "working";
	} else if (/(受阻|失败|无法|错误|阻塞|中断)/.test(trimmed)) {
		status = "blocked";
	}

	return { isStructured: true, status, tldr, points, suggestions, body: trimmed };
}


const BRIEF_STATUS_META: Record<AnswerBrief["status"], { label: string; color: string }> = {
	done: { label: "已完成", color: "var(--ok, #10b981)" },
	working: { label: "进行中", color: "var(--accent, #2563eb)" },
	confirm: { label: "待确认", color: "var(--warn, #f59e0b)" },
	blocked: { label: "受阻", color: "var(--danger, #ef4444)" },
};

/**
 * 通用「结论简报」卡片：结论先行 + 要点 + 建议 chips + 折叠正文。
 * 全程使用语义化主题变量，8 套主题自适应。
 */
export function AnswerBriefCard({
	brief,
	onSuggestion,
}: {
	brief: AnswerBrief;
	onSuggestion?: (text: string) => void;
}) {
	const [expanded, setExpanded] = useState(false);
	const meta = BRIEF_STATUS_META[brief.status];

	return (
		<div
			className="pa-answer-brief"
			style={{
				display: "flex",
				flexDirection: "column",
				gap: 12,
				margin: "4px 0 12px",
				padding: "14px 16px",
				background: "var(--bg-elevated)",
				border: "1px solid var(--border)",
				borderRadius: 12,
				boxShadow: "var(--shadow-soft)",
			}}
		>
			<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
				<Sparkles size={13} style={{ color: "var(--accent)" }} />
				<span
					style={{
						fontSize: 11.5,
						fontWeight: 700,
						color: "var(--text-secondary)",
						letterSpacing: "0.04em",
					}}
				>
					结论
				</span>
				<span
					style={{
						marginLeft: "auto",
						fontSize: 11,
						fontWeight: 600,
						padding: "1px 8px",
						borderRadius: 999,
						color: meta.color,
						border: `1px solid ${meta.color}`,
						background: "var(--bg-muted)",
					}}
				>
					● {meta.label}
				</span>
			</div>

			{brief.tldr && (
				<div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", lineHeight: 1.55 }}>
					{brief.tldr}
				</div>
			)}

			{brief.points.length > 0 && (
				<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
					{brief.points.map((p, i) => (
						<div
							key={i}
							style={{
								display: "flex",
								gap: 8,
								fontSize: 12.5,
								color: "var(--text-secondary)",
								lineHeight: 1.5,
							}}
						>
							<span style={{ color: "var(--accent)", flexShrink: 0 }}>•</span>
							<span>{p}</span>
						</div>
					))}
				</div>
			)}

			{brief.suggestions.length > 0 && (
				<div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
					<span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>建议：</span>
					{brief.suggestions.map((s, i) => (
						<button
							key={i}
							type="button"
							onClick={() => onSuggestion?.(s)}
							style={{
								fontSize: 11.5,
								padding: "3px 10px",
								borderRadius: 999,
								border: "1px solid var(--border)",
								background: "var(--accent-soft)",
								color: "var(--accent)",
								cursor: "pointer",
							}}
						>
							{s}
						</button>
					))}
				</div>
			)}

			{brief.body && (
				<div>
					<button
						type="button"
						onClick={() => setExpanded((v) => !v)}
						style={{
							display: "inline-flex",
							alignItems: "center",
							gap: 6,
							fontSize: 11.5,
							color: "var(--text-muted)",
							background: "transparent",
							border: "none",
							cursor: "pointer",
							padding: 0,
						}}
					>
						<ChevronDown
							size={12}
							style={{
								transform: expanded ? "rotate(180deg)" : "none",
								transition: "transform 0.15s ease",
							}}
						/>
						{expanded ? "收起完整回答" : "展开完整回答"}
					</button>
					{expanded && (
						<div
							style={{
								marginTop: 10,
								paddingTop: 10,
								borderTop: "1px solid var(--border-subtle)",
							}}
						>
							<MarkdownText text={brief.body} />
						</div>
					)}
				</div>
			)}
		</div>
	);
}


/* ──────────────────────────────────────────────────────────────
 * dots 式「常驻 Agent 形象卡」：形象 + 实时状态 + 最近活动时间线
 * ────────────────────────────────────────────────────────────── */

export type AgentPresenceStatus = "idle" | "working" | "confirm";

export interface AgentActivityItem {
	id: string;
	time: string;
	label: string;
	detail?: string;
	kind: "card" | "run" | "goal";
}

const PRESENCE_META: Record<AgentPresenceStatus, { label: string; color: string }> = {
	idle: { label: "待命", color: "var(--accent, #2563eb)" },
	working: { label: "执行中", color: "var(--warn, #f59e0b)" },
	confirm: { label: "待你确认", color: "var(--warn, #f59e0b)" },
};

export function AgentPresenceCard({
	agentName,
	status,
	detail,
	weather,
	dateText,
	activity,
	bubble,
}: {
	agentName: string;
	status: AgentPresenceStatus;
	detail?: string;
	weather?: string;
	dateText?: string;
	activity: AgentActivityItem[];
	bubble?: { text: string; detail?: string; tone?: "info" | "warn" };
}) {
	const [open, setOpen] = useState(true);
	const meta = PRESENCE_META[status];

	return (
		<div className={`pa-presence${open ? " open" : ""}`}>
			<div className="pa-presence-head" data-tauri-drag-region>
				<div className={`pa-orb pa-orb-${status}`}>
					<span className="pa-orb-core" />
					<span className="pa-orb-ring" />
				</div>

				<div className="pa-presence-meta">
					<div className="pa-presence-name">
						<span>{agentName}</span>
						<span
							className="pa-presence-badge"
							style={{ color: meta.color, borderColor: meta.color }}
						>
							● {meta.label}
						</span>
					</div>
					<div className="pa-presence-detail">{detail}</div>
					{(weather || dateText) && (
						<div className="pa-presence-sub">
							{weather && <span>{weather}</span>}
							{weather && dateText && <span className="pa-dot-sep">·</span>}
							{dateText && <span>{dateText}</span>}
						</div>
					)}
				</div>

				<button
					type="button"
					className="pa-presence-activity-toggle"
					onClick={() => setOpen((v) => !v)}
				>
					<Clock3 size={12} />
					<span>最近活动 {activity.length}</span>
					<ChevronDown
						size={12}
						style={{
							transform: open ? "rotate(180deg)" : "none",
							transition: "transform 0.15s ease",
						}}
					/>
				</button>
			</div>

			{bubble && (
				<div className={`pa-bubble pa-bubble-${bubble.tone ?? "info"}`}>
					<span className="pa-bubble-icon">
						<Zap size={13} />
					</span>
					<div className="pa-bubble-body">
						<div className="pa-bubble-text">{bubble.text}</div>
						{bubble.detail && <div className="pa-bubble-detail">{bubble.detail}</div>}
					</div>
				</div>
			)}

			{open && (
				<div className="pa-activity">
					{activity.length === 0 ? (
						<div className="pa-activity-empty">今天还没有产生活动记录。</div>
					) : (
						activity.map((it) => (
							<div className="pa-activity-row" key={it.id}>
								<span className="pa-activity-time">{it.time}</span>
								<span className={`pa-activity-dot ${it.kind}`} />
								<div className="pa-activity-body">
									<div className="pa-activity-label">{it.label}</div>
									{it.detail && <div className="pa-activity-detail">{it.detail}</div>}
								</div>
							</div>
						))
					)}
				</div>
			)}
		</div>
	);
}

