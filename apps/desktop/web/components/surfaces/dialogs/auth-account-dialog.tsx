import { useState, useEffect, type FC } from "react";
import { X, Shield, LogIn, LogOut, Check, AlertCircle, Wrench, UserRound, UploadCloud } from "../../icons";
import { supabase, type SupabaseUser } from "../../../lib/supabase-client";

interface AuthAccountDialogProps {
	profile: { nickname?: string; avatarEmoji?: string };
	busy?: boolean;
	onClose(): void;
	onSaveLocalProfile(profile: { nickname?: string; avatarEmoji?: string }): Promise<void>;
	onProfileChanged?(profile: { nickname?: string; avatarEmoji?: string }): void;
}

export const AuthAccountDialog: FC<AuthAccountDialogProps> = ({
	profile,
	busy: parentBusy,
	onClose,
	onSaveLocalProfile,
	onProfileChanged,
}) => {
	const [user, setUser] = useState<SupabaseUser | null>(() => supabase.getUser());
	const [activeTab, setActiveTab] = useState<"signin" | "signup" | "profile">(() =>
		supabase.getUser() ? "profile" : "signin",
	);

	// Auth form inputs
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [nickname, setNickname] = useState(
		user?.user_metadata?.nickname || profile.nickname || "",
	);
	const [avatarEmoji, setAvatarEmoji] = useState(
		user?.user_metadata?.avatar_emoji || profile.avatarEmoji || "🚀",
	);

	// Supabase Project Config
	const [showConfig, setShowConfig] = useState(!supabase.isConfigured());
	const [projectUrl, setProjectUrl] = useState(() => supabase.getConfig().url);
	const [anonKey, setAnonKey] = useState(() => supabase.getConfig().anonKey);
	const [configSavedNotice, setConfigSavedNotice] = useState(false);

	// Operation status
	const [busy, setBusy] = useState(false);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [successMessage, setSuccessMessage] = useState<string | null>(null);

	useEffect(() => {
		const unsub = supabase.onAuthStateChange((nextUser) => {
			setUser(nextUser);
			if (nextUser) {
				setActiveTab("profile");
				if (nextUser.user_metadata?.nickname) {
					setNickname(nextUser.user_metadata.nickname);
				}
				if (nextUser.user_metadata?.avatar_emoji) {
					setAvatarEmoji(nextUser.user_metadata.avatar_emoji);
				}
			}
		});
		return () => unsub();
	}, []);

	const isBusy = busy || parentBusy;

	const handleSaveConfig = () => {
		if (!projectUrl.trim() || !anonKey.trim()) {
			setErrorMessage("项目地址 (Project URL) 与 Anon Public Key 不能为空");
			return;
		}
		supabase.saveConfig({ url: projectUrl, anonKey });
		setConfigSavedNotice(true);
		setErrorMessage(null);
		setTimeout(() => setConfigSavedNotice(false), 3000);
	};

	const handleSignIn = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!email.trim() || !password) {
			setErrorMessage("请输入邮箱和密码");
			return;
		}
		if (!supabase.isConfigured()) {
			setShowConfig(true);
			setErrorMessage("请先配置 Supabase Project URL 与 Anon Key");
			return;
		}

		setBusy(true);
		setErrorMessage(null);
		setSuccessMessage(null);
		try {
			const res = await supabase.signIn(email, password);
			if (res.error) {
				setErrorMessage(res.error);
			} else {
				setSuccessMessage("登录成功！");
				const meta = res.user?.user_metadata;
				if (meta?.nickname) {
					void onSaveLocalProfile({
						nickname: meta.nickname,
						avatarEmoji: meta.avatar_emoji || avatarEmoji,
					});
					onProfileChanged?.({
						nickname: meta.nickname,
						avatarEmoji: meta.avatar_emoji || avatarEmoji,
					});
				}
			}
		} finally {
			setBusy(false);
		}
	};

	const handleSignUp = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!email.trim() || !password) {
			setErrorMessage("请输入邮箱和密码");
			return;
		}
		if (password.length < 6) {
			setErrorMessage("密码长度不能少于 6 位");
			return;
		}
		if (!supabase.isConfigured()) {
			setShowConfig(true);
			setErrorMessage("请先配置 Supabase Project URL 与 Anon Key");
			return;
		}

		setBusy(true);
		setErrorMessage(null);
		setSuccessMessage(null);
		try {
			const res = await supabase.signUp(email, password, {
				nickname: nickname.trim() || email.split("@")[0],
				avatar_emoji: avatarEmoji.trim() || "🧑‍💻",
			});

			if (res.error) {
				setErrorMessage(res.error);
			} else if (res.message) {
				setSuccessMessage(res.message);
			} else {
				setSuccessMessage("注册并登录成功！");
				void onSaveLocalProfile({
					nickname: nickname.trim() || email.split("@")[0],
					avatarEmoji: avatarEmoji.trim() || "🧑‍💻",
				});
				onProfileChanged?.({
					nickname: nickname.trim() || email.split("@")[0],
					avatarEmoji: avatarEmoji.trim() || "🧑‍💻",
				});
			}
		} finally {
			setBusy(false);
		}
	};

	const handleSignOut = async () => {
		setBusy(true);
		try {
			await supabase.signOut();
			setActiveTab("signin");
			setSuccessMessage("已退出登录");
		} finally {
			setBusy(false);
		}
	};

	const handleUpdateProfile = async (e: React.FormEvent) => {
		e.preventDefault();
		setBusy(true);
		setErrorMessage(null);
		setSuccessMessage(null);
		try {
			const cleanNick = nickname.trim() || "用户";
			const cleanEmoji = avatarEmoji.trim() || "🚀";

			// Update in Supabase if logged in
			if (user) {
				const res = await supabase.updateUserProfile({
					nickname: cleanNick,
					avatar_emoji: cleanEmoji,
				});
				if (res.error) {
					setErrorMessage(res.error);
					return;
				}
			}

			// Update local profile
			await onSaveLocalProfile({
				nickname: cleanNick,
				avatarEmoji: cleanEmoji,
			});
			onProfileChanged?.({
				nickname: cleanNick,
				avatarEmoji: cleanEmoji,
			});

			setSuccessMessage("个人资料更新成功！");
			setTimeout(() => {
				onClose();
			}, 700);
		} finally {
			setBusy(false);
		}
	};

	return (
		<div
			className="dialog-backdrop"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget && !isBusy) onClose();
			}}
		>
			<div className="dialog conversation-dialog" style={{ maxWidth: "480px", width: "92%" }}>
				<div className="dialog-header">
					<div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
						<div
							style={{
								width: "32px",
								height: "32px",
								borderRadius: "8px",
								background: "var(--accent-soft)",
								color: "var(--accent)",
								display: "grid",
								placeItems: "center",
							}}
						>
							<UserRound size={18} />
						</div>
						<div>
							<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
								<h2 style={{ margin: 0, fontSize: "16px", fontWeight: 650 }}>账户中心</h2>
								<span
									className={`provider-badge ${user ? "active" : "standby"}`}
									style={{ fontSize: "11px", padding: "1px 7px" }}
								>
									{user ? "🟢 Supabase 已连接" : "离线单机模式"}
								</span>
							</div>
							<span style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>
								{user ? user.email : "本地档案与 Supabase 云端账户管理"}
							</span>
						</div>
					</div>
					<button
						type="button"
						className="icon-button quiet"
						title="关闭"
						aria-label="关闭"
						disabled={isBusy}
						onClick={onClose}
					>
						<X size={17} />
					</button>
				</div>

				{/* Notice Banner */}
				{errorMessage && (
					<div
						style={{
							margin: "12px 0 0",
							padding: "9px 12px",
							borderRadius: "8px",
							background: "rgba(239, 68, 68, 0.12)",
							border: "1px solid rgba(239, 68, 68, 0.25)",
							color: "#ef4444",
							fontSize: "12.5px",
							display: "flex",
							alignItems: "center",
							gap: "8px",
						}}
					>
						<AlertCircle size={15} />
						<span>{errorMessage}</span>
					</div>
				)}

				{successMessage && (
					<div
						style={{
							margin: "12px 0 0",
							padding: "9px 12px",
							borderRadius: "8px",
							background: "rgba(16, 185, 129, 0.12)",
							border: "1px solid rgba(16, 185, 129, 0.25)",
							color: "#10b981",
							fontSize: "12.5px",
							display: "flex",
							alignItems: "center",
							gap: "8px",
						}}
					>
						<Check size={15} />
						<span>{successMessage}</span>
					</div>
				)}

				{/* ── Mode 1: Logged In ── */}
				{user ? (
					<form onSubmit={handleUpdateProfile} style={{ marginTop: "16px" }}>
						<div
							style={{
								padding: "14px",
								borderRadius: "10px",
								background: "var(--bg-muted)",
								border: "1px solid var(--border)",
								marginBottom: "16px",
								display: "flex",
								alignItems: "center",
								gap: "12px",
							}}
						>
							<div
								style={{
									width: "44px",
									height: "44px",
									borderRadius: "50%",
									background: "var(--accent)",
									color: "var(--accent-contrast)",
									display: "grid",
									placeItems: "center",
									fontSize: "20px",
									boxShadow: "0 2px 10px var(--accent-soft)",
								}}
							>
								{avatarEmoji || (nickname || "U").slice(0, 1).toUpperCase()}
							</div>
							<div style={{ flex: 1, minWidth: 0 }}>
								<div style={{ fontWeight: 650, fontSize: "14px", color: "var(--text)" }}>
									{nickname || "OpenPI 用户"}
								</div>
								<div style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "2px" }}>
									{user.email}
								</div>
								<div style={{ fontSize: "10.5px", color: "var(--text-tertiary)", marginTop: "4px" }}>
									UID: {user.id.slice(0, 8)}...
								</div>
							</div>
							<button
								type="button"
								className="button secondary"
								style={{ padding: "6px 10px", fontSize: "12px", display: "flex", alignItems: "center", gap: "5px" }}
								disabled={isBusy}
								onClick={handleSignOut}
							>
								<LogOut size={13} />
								<span>退出</span>
							</button>
						</div>

						<label style={{ display: "block", marginBottom: "12px", fontSize: "13px" }}>
							<span style={{ fontWeight: 600, display: "block", marginBottom: "4px" }}>显示昵称</span>
							<input
								maxLength={40}
								value={nickname}
								onChange={(e) => setNickname(e.target.value)}
								placeholder="你的昵称"
								disabled={isBusy}
							/>
						</label>

						<label style={{ display: "block", marginBottom: "16px", fontSize: "13px" }}>
							<span style={{ fontWeight: 600, display: "block", marginBottom: "4px" }}>专属 Emoji 头像</span>
							<input
								maxLength={4}
								value={avatarEmoji}
								onChange={(e) => setAvatarEmoji(e.target.value)}
								placeholder="如 🚀、🧑‍💻、⚡"
								disabled={isBusy}
							/>
						</label>

						<div className="dialog-actions" style={{ marginTop: "16px" }}>
							<button type="button" className="button" disabled={isBusy} onClick={onClose}>
								关闭
							</button>
							<button className="button primary" disabled={isBusy || nickname.trim().length === 0}>
								{isBusy ? "保存中…" : "保存资料"}
							</button>
						</div>
					</form>
				) : (
					/* ── Mode 2: Not Logged In (Tabs for Sign In / Sign Up) ── */
					<div style={{ marginTop: "16px" }}>
						{/* Tab Switcher */}
						<div
							className="segmented-pill-group"
							style={{ display: "flex", gap: "4px", padding: "3px", borderRadius: "8px", marginBottom: "16px" }}
						>
							<button
								type="button"
								className={`segmented-pill-btn ${activeTab === "signin" ? "active" : ""}`}
								style={{ flex: 1, padding: "6px 0", fontSize: "13px" }}
								onClick={() => {
									setActiveTab("signin");
									setErrorMessage(null);
								}}
							>
								登录已有账号
							</button>
							<button
								type="button"
								className={`segmented-pill-btn ${activeTab === "signup" ? "active" : ""}`}
								style={{ flex: 1, padding: "6px 0", fontSize: "13px" }}
								onClick={() => {
									setActiveTab("signup");
									setErrorMessage(null);
								}}
							>
								注册新账号
							</button>
							<button
								type="button"
								className={`segmented-pill-btn ${activeTab === "profile" ? "active" : ""}`}
								style={{ flex: 1, padding: "6px 0", fontSize: "13px" }}
								onClick={() => {
									setActiveTab("profile");
									setErrorMessage(null);
								}}
							>
								仅本地档案
							</button>
						</div>

						{/* Sub-form: Local Only */}
						{activeTab === "profile" && (
							<form onSubmit={handleUpdateProfile}>
								<p style={{ fontSize: "12.5px", color: "var(--text-secondary)", margin: "0 0 14px" }}>
									无需云端账号，仅在当前电脑保存您的昵称和头像标识。
								</p>
								<label style={{ display: "block", marginBottom: "12px", fontSize: "13px" }}>
									<span style={{ fontWeight: 600, display: "block", marginBottom: "4px" }}>本地昵称</span>
									<input
										maxLength={40}
										value={nickname}
										onChange={(e) => setNickname(e.target.value)}
										placeholder="你的昵称"
										disabled={isBusy}
									/>
								</label>
								<label style={{ display: "block", marginBottom: "16px", fontSize: "13px" }}>
									<span style={{ fontWeight: 600, display: "block", marginBottom: "4px" }}>头像 Emoji</span>
									<input
										maxLength={4}
										value={avatarEmoji}
										onChange={(e) => setAvatarEmoji(e.target.value)}
										placeholder="如 🚀"
										disabled={isBusy}
									/>
								</label>
								<div className="dialog-actions">
									<button type="button" className="button" disabled={isBusy} onClick={onClose}>
										取消
									</button>
									<button className="button primary" disabled={isBusy || nickname.trim().length === 0}>
										{isBusy ? "保存中…" : "保存本地档案"}
									</button>
								</div>
							</form>
						)}

						{/* Sub-form: Sign In */}
						{activeTab === "signin" && (
							<form onSubmit={handleSignIn}>
								<label style={{ display: "block", marginBottom: "12px", fontSize: "13px" }}>
									<span style={{ fontWeight: 600, display: "block", marginBottom: "4px" }}>邮箱地址</span>
									<input
										type="email"
										required
										value={email}
										onChange={(e) => setEmail(e.target.value)}
										placeholder="your.email@example.com"
										disabled={isBusy}
									/>
								</label>
								<label style={{ display: "block", marginBottom: "16px", fontSize: "13px" }}>
									<span style={{ fontWeight: 600, display: "block", marginBottom: "4px" }}>登录密码</span>
									<input
										type="password"
										required
										value={password}
										onChange={(e) => setPassword(e.target.value)}
										placeholder="输入密码"
										disabled={isBusy}
									/>
								</label>
								<div className="dialog-actions">
									<button type="button" className="button" disabled={isBusy} onClick={onClose}>
										取消
									</button>
									<button className="button primary" disabled={isBusy || !email || !password}>
										{isBusy ? "登录中…" : "立即登录"}
									</button>
								</div>
							</form>
						)}

						{/* Sub-form: Sign Up */}
						{activeTab === "signup" && (
							<form onSubmit={handleSignUp}>
								<label style={{ display: "block", marginBottom: "10px", fontSize: "13px" }}>
									<span style={{ fontWeight: 600, display: "block", marginBottom: "4px" }}>邮箱地址</span>
									<input
										type="email"
										required
										value={email}
										onChange={(e) => setEmail(e.target.value)}
										placeholder="your.email@example.com"
										disabled={isBusy}
									/>
								</label>
								<label style={{ display: "block", marginBottom: "10px", fontSize: "13px" }}>
									<span style={{ fontWeight: 600, display: "block", marginBottom: "4px" }}>设定密码 (至少 6 位)</span>
									<input
										type="password"
										required
										minLength={6}
										value={password}
										onChange={(e) => setPassword(e.target.value)}
										placeholder="至少 6 位密码"
										disabled={isBusy}
									/>
								</label>
								<div style={{ display: "grid", gridTemplateColumns: "1fr 90px", gap: "10px", marginBottom: "16px" }}>
									<label style={{ fontSize: "13px" }}>
										<span style={{ fontWeight: 600, display: "block", marginBottom: "4px" }}>个人昵称</span>
										<input
											value={nickname}
											onChange={(e) => setNickname(e.target.value)}
											placeholder="昵称"
											disabled={isBusy}
										/>
									</label>
									<label style={{ fontSize: "13px" }}>
										<span style={{ fontWeight: 600, display: "block", marginBottom: "4px" }}>头像 Emoji</span>
										<input
											value={avatarEmoji}
											onChange={(e) => setAvatarEmoji(e.target.value)}
											placeholder="🚀"
											disabled={isBusy}
										/>
									</label>
								</div>
								<div className="dialog-actions">
									<button type="button" className="button" disabled={isBusy} onClick={onClose}>
										取消
									</button>
									<button className="button primary" disabled={isBusy || !email || !password}>
										{isBusy ? "注册中…" : "创建账号"}
									</button>
								</div>
							</form>
						)}

						{/* Supabase Config Collapsible Section */}
						<div
							style={{
								marginTop: "18px",
								paddingTop: "14px",
								borderTop: "1px solid var(--border)",
							}}
						>
							<button
								type="button"
								style={{
									display: "flex",
									alignItems: "center",
									justifyContent: "space-between",
									width: "100%",
									background: "transparent",
									border: "none",
									padding: "4px 0",
									color: "var(--text-secondary)",
									fontSize: "12px",
									cursor: "pointer",
								}}
								onClick={() => setShowConfig(!showConfig)}
							>
								<div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
									<Wrench size={13} />
									<span>Supabase 接入配置 (REST 原生直连)</span>
								</div>
								<span style={{ color: "var(--accent)", fontSize: "11.5px" }}>
									{showConfig ? "收起" : supabase.isConfigured() ? "已配置" : "需配置"}
								</span>
							</button>

							{showConfig && (
								<div
									style={{
										marginTop: "10px",
										padding: "12px",
										borderRadius: "8px",
										background: "var(--bg-muted)",
										border: "1px solid var(--border)",
										fontSize: "12px",
									}}
								>
									<label style={{ display: "block", marginBottom: "8px" }}>
										<span style={{ display: "block", marginBottom: "3px", fontWeight: 600, color: "var(--text)" }}>
											Supabase Project URL
										</span>
										<input
											style={{ fontSize: "12px", padding: "6px 8px" }}
											value={projectUrl}
											onChange={(e) => setProjectUrl(e.target.value)}
											placeholder="https://xyzcompany.supabase.co"
										/>
									</label>
									<label style={{ display: "block", marginBottom: "10px" }}>
										<span style={{ display: "block", marginBottom: "3px", fontWeight: 600, color: "var(--text)" }}>
											Supabase Anon Public Key
										</span>
										<input
											type="password"
											style={{ fontSize: "12px", padding: "6px 8px" }}
											value={anonKey}
											onChange={(e) => setAnonKey(e.target.value)}
											placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
										/>
									</label>
									<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
										<span style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>
											0 第三方 npm 包，采用纯原生 fetch 交互
										</span>
										<button
											type="button"
											className="button secondary"
											style={{ padding: "4px 10px", fontSize: "11.5px" }}
											onClick={handleSaveConfig}
										>
											{configSavedNotice ? "✓ 已保存" : "保存配置"}
										</button>
									</div>
								</div>
							)}
						</div>
					</div>
				)}
			</div>
		</div>
	);
};
