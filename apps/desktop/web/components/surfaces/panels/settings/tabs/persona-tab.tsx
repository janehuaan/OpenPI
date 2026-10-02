import { type FC, useCallback, useEffect, useState } from "react";
import { desktopApi, type UserProfile } from "../../../../../api";
import { Check, Save, Sparkles, UserRound, Zap } from "../../../../icons";

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
	const [assistantName, setAssistantName] = useState("OpenPI");
	const [assistantRole, setAssistantRole] = useState("资深结对架构师伙伴");
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
		<div className="settings-tab-content">
			<div className="settings-section-header">
				<div className="settings-section-title-wrap">
					<UserRound size={20} className="settings-section-icon" />
					<div>
						<h2>人设定制与个性化偏好</h2>
						<p className="settings-section-desc">
							设置你的称谓、开发习惯与助手的语气人设。引擎会在每次对话启动时将此契约自动作为最高优先级元指令注入大模型。
						</p>
					</div>
				</div>
				<button
					type="button"
					className="btn-primary"
					disabled={saving || loading}
					onClick={handleSave}
				>
					{saving ? <Zap size={14} className="spin" /> : <Save size={14} />}
					<span>保存并应用</span>
				</button>
			</div>

			{saveToast && (
				<div className={`settings-banner ${saveToast.includes("失败") ? "warning" : "success"}`} style={{ marginBottom: "1rem" }}>
					<Check size={16} />
					<span>{saveToast}</span>
				</div>
			)}

			{/* Section 1: User Profile */}
			<div className="settings-card" style={{ marginBottom: "1.5rem" }}>
				<div className="settings-card-header">
					<Sparkles size={16} />
					<h3>用户画像（我是谁 & 我的习惯）</h3>
				</div>
				<div className="settings-card-body">
					<div className="settings-form-row">
						<label htmlFor="user-nickname">
							<strong>称呼 / 名字</strong>
							<span>助手对你的尊称或昵称</span>
						</label>
						<input
							id="user-nickname"
							type="text"
							className="settings-input"
							placeholder="例如：Huaan / 老华 / Jane"
							value={nickname}
							onChange={(e) => setNickname(e.target.value)}
						/>
					</div>

					<div className="settings-form-row">
						<label htmlFor="user-role">
							<strong>你的身份与技术背景</strong>
							<span>便于助手针对你的专业领域调整专业术语深度</span>
						</label>
						<input
							id="user-role"
							type="text"
							className="settings-input"
							placeholder="例如：全栈架构师 / 嵌入式系统与 Rust 工程师"
							value={userRole}
							onChange={(e) => setUserRole(e.target.value)}
						/>
					</div>

					<div className="settings-form-row" style={{ alignItems: "flex-start" }}>
						<label htmlFor="user-habits" style={{ paddingTop: "0.25rem" }}>
							<strong>个人工作习惯与偏好</strong>
							<span>你的协作偏好、对交付形式的具体要求</span>
							<div className="settings-tags-list" style={{ marginTop: "0.5rem", display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
								<button type="button" className="btn-tag" onClick={() => addHabitTag("极简原子修改，拒绝大面积无关代码扩散")}>
									+ 极简原子修改
								</button>
								<button type="button" className="btn-tag" onClick={() => addHabitTag("直奔主题，避免官僚反问与客套话")}>
									+ 直奔主题无客套
								</button>
								<button type="button" className="btn-tag" onClick={() => addHabitTag("代码修改后运行测试快速闭环")}>
									+ 单测闭环
								</button>
								<button type="button" className="btn-tag" onClick={() => addHabitTag("严格遵循 MDL 极简代码律")}>
									+ MDL 极简律
								</button>
							</div>
						</label>
						<textarea
							id="user-habits"
							className="settings-textarea"
							rows={4}
							placeholder="例如：偏好极简原子修改，不写过度抽象代码；喜欢直接干练的执行；测试通过后直接说明关键改动。"
							value={userHabits}
							onChange={(e) => setUserHabits(e.target.value)}
						/>
					</div>

					<div className="settings-form-row">
						<label htmlFor="code-style">
							<strong>代码工程风格规范</strong>
							<span>助手为你编写代码时遵循的工程习惯</span>
						</label>
						<input
							id="code-style"
							type="text"
							className="settings-input"
							placeholder="例如：注重类型安全与性能，优先用 Rust/TS，遵循 MDL 极简代码律"
							value={codeStyle}
							onChange={(e) => setCodeStyle(e.target.value)}
						/>
					</div>
				</div>
			</div>

			{/* Section 2: Assistant Persona & Tone */}
			<div className="settings-card">
				<div className="settings-card-header">
					<UserRound size={16} />
					<h3>助手人设与语气风格（助手是谁 & 怎么跟我说话）</h3>
				</div>
				<div className="settings-card-body">
					<div className="settings-form-row">
						<label htmlFor="assistant-name">
							<strong>助手名称</strong>
							<span>助手自我认同的名字</span>
						</label>
						<input
							id="assistant-name"
							type="text"
							className="settings-input"
							placeholder="例如：OpenPI"
							value={assistantName}
							onChange={(e) => setAssistantName(e.target.value)}
						/>
					</div>

					<div className="settings-form-row">
						<label htmlFor="assistant-role">
							<strong>助手角色定位</strong>
							<span>助手的性格基调与角色定位</span>
						</label>
						<input
							id="assistant-role"
							type="text"
							className="settings-input"
							placeholder="例如：资深敏捷结对架构师伙伴"
							value={assistantRole}
							onChange={(e) => setAssistantRole(e.target.value)}
						/>
					</div>

					<div className="settings-form-row" style={{ alignItems: "flex-start" }}>
						<label style={{ paddingTop: "0.25rem" }}>
							<strong>核心回答语气风格</strong>
							<span>选择最符合你心流的交互语气</span>
						</label>
						<div className="settings-tone-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", width: "100%", maxWidth: "420px" }}>
							<div
								className={`settings-tone-card ${tone === "concise" ? "selected" : ""}`}
								onClick={() => setTone("concise")}
								style={{
									padding: "0.75rem",
									borderRadius: "8px",
									border: tone === "concise" ? "2px solid var(--accent, #3b82f6)" : "1px solid var(--border-color, #e2e8f0)",
									cursor: "pointer",
									background: tone === "concise" ? "var(--accent-subtle, rgba(59, 130, 246, 0.08))" : "var(--bg-card, #fff)",
								}}
							>
								<div style={{ fontWeight: 600, fontSize: "0.9rem" }}>⚡ 极简干练</div>
								<div style={{ fontSize: "0.75rem", color: "var(--text-muted, #64748b)", marginTop: "0.25rem" }}>
									直奔主题，避免套话与客套反问，直接交付解法与代码。
								</div>
							</div>

							<div
								className={`settings-tone-card ${tone === "professional" ? "selected" : ""}`}
								onClick={() => setTone("professional")}
								style={{
									padding: "0.75rem",
									borderRadius: "8px",
									border: tone === "professional" ? "2px solid var(--accent, #3b82f6)" : "1px solid var(--border-color, #e2e8f0)",
									cursor: "pointer",
									background: tone === "professional" ? "var(--accent-subtle, rgba(59, 130, 246, 0.08))" : "var(--bg-card, #fff)",
								}}
							>
								<div style={{ fontWeight: 600, fontSize: "0.9rem" }}>🔬 严谨专业</div>
								<div style={{ fontSize: "0.75rem", color: "var(--text-muted, #64748b)", marginTop: "0.25rem" }}>
									逻辑缜密，全面剖析系统根因，结构化分点陈述。
								</div>
							</div>

							<div
								className={`settings-tone-card ${tone === "friendly" ? "selected" : ""}`}
								onClick={() => setTone("friendly")}
								style={{
									padding: "0.75rem",
									borderRadius: "8px",
									border: tone === "friendly" ? "2px solid var(--accent, #3b82f6)" : "1px solid var(--border-color, #e2e8f0)",
									cursor: "pointer",
									background: tone === "friendly" ? "var(--accent-subtle, rgba(59, 130, 246, 0.08))" : "var(--bg-card, #fff)",
								}}
							>
								<div style={{ fontWeight: 600, fontSize: "0.9rem" }}>🤝 亲切自然</div>
								<div style={{ fontSize: "0.75rem", color: "var(--text-muted, #64748b)", marginTop: "0.25rem" }}>
									温和耐受，通俗生动，如并肩作战的敏捷结对战友。
								</div>
							</div>

							<div
								className={`settings-tone-card ${tone === "custom" ? "selected" : ""}`}
								onClick={() => setTone("custom")}
								style={{
									padding: "0.75rem",
									borderRadius: "8px",
									border: tone === "custom" ? "2px solid var(--accent, #3b82f6)" : "1px solid var(--border-color, #e2e8f0)",
									cursor: "pointer",
									background: tone === "custom" ? "var(--accent-subtle, rgba(59, 130, 246, 0.08))" : "var(--bg-card, #fff)",
								}}
							>
								<div style={{ fontWeight: 600, fontSize: "0.9rem" }}>🎨 自定义语气</div>
								<div style={{ fontSize: "0.75rem", color: "var(--text-muted, #64748b)", marginTop: "0.25rem" }}>
									自由输入你期望的特定语气与交互约束细则。
								</div>
							</div>
						</div>
					</div>

					<div className="settings-form-row" style={{ alignItems: "flex-start" }}>
						<label htmlFor="custom-tone" style={{ paddingTop: "0.25rem" }}>
							<strong>自定义语气细则</strong>
							<span>补充特殊的语调、反问规则或互动约定</span>
						</label>
						<textarea
							id="custom-tone"
							className="settings-textarea"
							rows={3}
							placeholder="例如：回答时使用简洁的要点陈述；遇到报错直接给出定位代码，不要停下来反问。"
							value={customTonePrompt}
							onChange={(e) => setCustomTonePrompt(e.target.value)}
						/>
					</div>

					<div className="settings-form-row">
						<label htmlFor="response-lang">
							<strong>回答语言偏好</strong>
							<span>优先使用的交流语言</span>
						</label>
						<select
							id="response-lang"
							className="settings-select"
							value={responseLanguage}
							onChange={(e) => setResponseLanguage(e.target.value)}
						>
							<option value="zh-CN">简体中文 (zh-CN)</option>
							<option value="en-US">English (en-US)</option>
							<option value="auto">与提问语言一致 (Auto)</option>
						</select>
					</div>
				</div>
			</div>
		</div>
	);
};
