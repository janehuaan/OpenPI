import { type FC, useCallback, useEffect, useState } from "react";
import { desktopApi, type UserProfile } from "../../../../../api";
import { Bot, Check, Save, Sparkles, UserRound, Zap } from "../../../../icons";

export const PersonaTab: FC = () => {
	const [profile, setProfile] = useState<UserProfile>({});
	const [loading, setLoading] = useState(false);
	const [saving, setSaving] = useState(false);
	const [saveToast, setSaveToast] = useState<string | null>(null);

	// User fields
	const [nickname, setNickname] = useState("");
	const [userRole, setUserRole] = useState("");
	const [userHabits, setUserHabits] = useState("");
	const [codeStyle, setCodeStyle] = useState("");

	// Assistant persona fields
	const [assistantName, setAssistantName] = useState("OpenPI 架构助手");
	const [assistantRole, setAssistantRole] = useState("硬核结对工程师 / 交付参谋");
	const [tone, setTone] = useState<"concise" | "professional" | "friendly" | "custom">("concise");
	const [customTonePrompt, setCustomTonePrompt] = useState("");
	const [responseLanguage, setResponseLanguage] = useState("zh-CN");

	const loadProfile = useCallback(async () => {
		setLoading(true);
		try {
			const p = await desktopApi.getUserProfile();
			setProfile(p);
			if (p.nickname) setNickname(p.nickname);
			if (p.userRole) setUserRole(p.userRole);
			if (p.userHabits) setUserHabits(p.userHabits);
			if (p.codeStyle) setCodeStyle(p.codeStyle);
			if (p.assistantName) setAssistantName(p.assistantName);
			if (p.assistantRole) setAssistantRole(p.assistantRole);
			if (p.tone) setTone(p.tone);
			if (p.customTonePrompt) setCustomTonePrompt(p.customTonePrompt);
			if (p.responseLanguage) setResponseLanguage(p.responseLanguage);
		} catch (err) {
			console.error("Failed to load user profile", err);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void loadProfile();
	}, [loadProfile]);

	const handleSave = async () => {
		setSaving(true);
		try {
			const payload: UserProfile = {
				...profile,
				nickname: nickname.trim() || undefined,
				userRole: userRole.trim() || undefined,
				userHabits: userHabits.trim() || undefined,
				codeStyle: codeStyle.trim() || undefined,
				assistantName: assistantName.trim() || undefined,
				assistantRole: assistantRole.trim() || undefined,
				tone,
				customTonePrompt: customTonePrompt.trim() || undefined,
				responseLanguage,
				updatedAt: new Date().toISOString(),
			};
			await desktopApi.saveUserProfile(payload);
			setProfile(payload);
			setSaveToast("人设与偏好已保存，即刻注入后续所有对话！");
			setTimeout(() => setSaveToast(null), 3000);
			window.dispatchEvent(new Event("openpi:profile-changed"));
		} catch (err) {
			setSaveToast(`保存失败: ${err instanceof Error ? err.message : String(err)}`);
		} finally {
			setSaving(false);
		}
	};

	const addHabitTag = (tag: string) => {
		if (userHabits.includes(tag)) return;
		setUserHabits((prev) => (prev ? `${prev}；${tag}` : tag));
	};

	return (
		<div className="settings-scroll-wrapper">
			{/* Top Header Row with Action Button */}
			<div className="persona-header-row">
				<div className="settings-view-header">
					<h2>人设定制与个性化偏好</h2>
					<p>定制你的称谓、开发习惯与助手的语气人设，作为最高优先级系统元指令注入大模型。</p>
				</div>
				<button
					type="button"
					className="persona-save-btn"
					disabled={saving || loading}
					onClick={handleSave}
				>
					{saving ? <Zap size={14} className="spin" /> : <Save size={14} />}
					<span>{saving ? "正在应用…" : "保存并应用"}</span>
				</button>
			</div>

			{saveToast && (
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: "10px",
						padding: "12px 18px",
						borderRadius: "12px",
						background: saveToast.includes("失败") ? "rgba(239, 68, 68, 0.12)" : "rgba(34, 197, 94, 0.12)",
						border: saveToast.includes("失败") ? "1px solid rgba(239, 68, 68, 0.3)" : "1px solid rgba(34, 197, 94, 0.3)",
						color: saveToast.includes("失败") ? "var(--color-danger, #ef4444)" : "var(--color-success, #22c55e)",
						fontSize: "13px",
						fontWeight: 500,
					}}
				>
					<Check size={16} />
					<span>{saveToast}</span>
				</div>
			)}

			{/* ── Section 1: User Profile ── */}
			<section className="settings-section-card">
				<div className="settings-section-card-header">
					<div className="settings-section-card-header-left">
						<div className="settings-section-card-icon">
							<UserRound size={18} />
						</div>
						<div className="settings-section-card-title">
							<h3>用户画像 (我是谁 & 我的习惯)</h3>
							<span>便于助手精准对齐你的工程水准、沟通风格与交付契约</span>
						</div>
					</div>
				</div>

				<div className="settings-section-card-body">
					<div className="setting-item-row" style={{ alignItems: "flex-start" }}>
						<div className="setting-item-meta" style={{ width: "240px", flexShrink: 0 }}>
							<strong>称呼 / 名字</strong>
							<span>助手对你的尊称或昵称</span>
						</div>
						<div style={{ flex: 1 }}>
							<input
								id="user-nickname"
								type="text"
								className="persona-input"
								placeholder="例如：安哥 (华安) / 架构师"
								value={nickname}
								onChange={(e) => setNickname(e.target.value)}
							/>
						</div>
					</div>

					<div className="setting-item-row" style={{ alignItems: "flex-start" }}>
						<div className="setting-item-meta" style={{ width: "240px", flexShrink: 0 }}>
							<strong>身份与技术背景</strong>
							<span>针对你的专业领域调整专业术语深度</span>
						</div>
						<div style={{ flex: 1 }}>
							<input
								id="user-role"
								type="text"
								className="persona-input"
								placeholder="例如：硬核全栈工程师 / 系统架构师"
								value={userRole}
								onChange={(e) => setUserRole(e.target.value)}
							/>
						</div>
					</div>

					<div className="setting-item-row" style={{ alignItems: "flex-start" }}>
						<div className="setting-item-meta" style={{ width: "240px", flexShrink: 0 }}>
							<strong>个人工作习惯与偏好</strong>
							<span>你的协作红线、交付规范与习惯</span>
							<div className="persona-tag-chips-wrap">
								<button type="button" className="persona-tag-chip" onClick={() => addHabitTag("极简原子修改，拒绝大面积无关代码扩散")}>
									+ 极简原子修改
								</button>
								<button type="button" className="persona-tag-chip" onClick={() => addHabitTag("直奔主题，避免官僚反问与客套话")}>
									+ 直奔主题无客套
								</button>
								<button type="button" className="persona-tag-chip" onClick={() => addHabitTag("代码修改后运行测试快速闭环")}>
									+ 单测闭环
								</button>
								<button type="button" className="persona-tag-chip" onClick={() => addHabitTag("严格遵循 MDL 极简代码律")}>
									+ MDL 极简律
								</button>
							</div>
						</div>
						<div style={{ flex: 1 }}>
							<textarea
								id="user-habits"
								className="persona-textarea"
								rows={5}
								placeholder="例如：讲求绝对实效与落地执行；坚守八个零容忍底线；偏好原子级小步微创修改..."
								value={userHabits}
								onChange={(e) => setUserHabits(e.target.value)}
							/>
						</div>
					</div>

					<div className="setting-item-row" style={{ alignItems: "flex-start" }}>
						<div className="setting-item-meta" style={{ width: "240px", flexShrink: 0 }}>
							<strong>代码工程风格规范</strong>
							<span>助手为你编写代码时遵循的工程习惯</span>
						</div>
						<div style={{ flex: 1 }}>
							<input
								id="code-style"
								type="text"
								className="persona-input"
								placeholder="例如：系统级性能优化思维、严格类型安全、零拷贝与低开销"
								value={codeStyle}
								onChange={(e) => setCodeStyle(e.target.value)}
							/>
						</div>
					</div>
				</div>
			</section>

			{/* ── Section 2: Assistant Persona & Tone ── */}
			<section className="settings-section-card">
				<div className="settings-section-card-header">
					<div className="settings-section-card-header-left">
						<div className="settings-section-card-icon">
							<Bot size={18} />
						</div>
						<div className="settings-section-card-title">
							<h3>助手人设与语气风格 (助手是谁 & 怎么跟我说话)</h3>
							<span>定制结对助手身份与语言风格契约</span>
						</div>
					</div>
				</div>

				<div className="settings-section-card-body">
					<div className="setting-item-row" style={{ alignItems: "flex-start" }}>
						<div className="setting-item-meta" style={{ width: "240px", flexShrink: 0 }}>
							<strong>助手名称</strong>
							<span>助手自我认同的名字</span>
						</div>
						<div style={{ flex: 1 }}>
							<input
								id="assistant-name"
								type="text"
								className="persona-input"
								placeholder="例如：OpenPI 架构助手"
								value={assistantName}
								onChange={(e) => setAssistantName(e.target.value)}
							/>
						</div>
					</div>

					<div className="setting-item-row" style={{ alignItems: "flex-start" }}>
						<div className="setting-item-meta" style={{ width: "240px", flexShrink: 0 }}>
							<strong>助手角色定位</strong>
							<span>助手的性格基调与角色定位</span>
						</div>
						<div style={{ flex: 1 }}>
							<input
								id="assistant-role"
								type="text"
								className="persona-input"
								placeholder="例如：硬核结对工程师 / 交付参谋"
								value={assistantRole}
								onChange={(e) => setAssistantRole(e.target.value)}
							/>
						</div>
					</div>

					<div className="setting-item-row" style={{ alignItems: "flex-start" }}>
						<div className="setting-item-meta" style={{ width: "240px", flexShrink: 0 }}>
							<strong>核心回答语气风格</strong>
							<span>选择最符合你心流的交互语气</span>
						</div>
						<div style={{ flex: 1 }}>
							<div className="persona-tone-grid">
								{[
									{
										id: "concise" as const,
										title: "⚡ 极简干练",
										desc: "直奔主题，避免套话与客套反问，先给结论并直接交付解法与代码。",
									},
									{
										id: "professional" as const,
										title: "🔬 严谨专业",
										desc: "逻辑缜密，全面剖析系统根因，结构化分点陈述与权衡考量。",
									},
									{
										id: "friendly" as const,
										title: "🤝 亲切自然",
										desc: "温和耐受，通俗生动，如并肩作战的敏捷结对战友与伙伴。",
									},
									{
										id: "custom" as const,
										title: "🎨 自定义语气",
										desc: "自由输入你期望的特定语气与交互约束细则。",
									},
								].map((item) => {
									const isSelected = tone === item.id;
									return (
										<div
											key={item.id}
											className={`persona-tone-card ${isSelected ? "active" : ""}`}
											onClick={() => setTone(item.id)}
										>
											<div className="persona-tone-card-title">
												<span>{item.title}</span>
												{isSelected && <Sparkles size={14} style={{ color: "var(--accent)" }} />}
											</div>
											<div className="persona-tone-card-desc">{item.desc}</div>
										</div>
									);
								})}
							</div>
						</div>
					</div>

					<div className="setting-item-row" style={{ alignItems: "flex-start" }}>
						<div className="setting-item-meta" style={{ width: "240px", flexShrink: 0 }}>
							<strong>自定义语气细则</strong>
							<span>补充特殊的语调、语言习惯或互动约定</span>
						</div>
						<div style={{ flex: 1 }}>
							<textarea
								id="custom-tone"
								className="persona-textarea"
								rows={4}
								placeholder="例如：回答时使用简洁的要点陈述；遇到报错直接给出定位代码，不要停下来反问；必须使用简体中文。"
								value={customTonePrompt}
								onChange={(e) => setCustomTonePrompt(e.target.value)}
							/>
						</div>
					</div>
				</div>
			</section>
		</div>
	);
};
