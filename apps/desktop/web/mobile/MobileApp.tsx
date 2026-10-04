/**
 * Mobile companion shell (phase 1, read-only).
 *
 * Shows what the desktop app has already synced to the cloud: conversations and
 * their transcripts, scheduled tasks, and memory files. It never talks to the
 * daemon — prompting the Mac is phase 2.
 */

import { useCallback, useEffect, useState } from "react";
import { supabase, type SupabaseUser } from "../lib/supabase-client";
import { MarkdownText } from "../lib/markdown";
import {
	listConversations,
	listMemories,
	listTasks,
	loadTranscript,
	type MobileConversation,
	type MobileMessage,
} from "./mobile-data";
import "../styles/mobile.css";

type Tab = "chats" | "tasks" | "memory";

function relativeTime(value?: string): string {
	if (!value) return "";
	const ms = Date.now() - new Date(value).getTime();
	if (Number.isNaN(ms)) return "";
	if (ms < 60_000) return "刚刚";
	if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} 分钟前`;
	if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} 小时前`;
	return `${Math.floor(ms / 86_400_000)} 天前`;
}

export function MobileApp() {
	const [user, setUser] = useState<SupabaseUser | null>(() => supabase.getUser());
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const [tab, setTab] = useState<Tab>("chats");
	const [conversations, setConversations] = useState<MobileConversation[]>([]);
	const [openConversation, setOpenConversation] = useState<MobileConversation | null>(null);
	const [messages, setMessages] = useState<MobileMessage[]>([]);
	const [tasks, setTasks] = useState<{ id: string; title: string; status: string; nextRunAt?: string }[]>([]);
	const [memories, setMemories] = useState<{ path: string; content: string }[]>([]);
	const [loading, setLoading] = useState(false);

	useEffect(() => supabase.onAuthStateChange(setUser), []);

	const refresh = useCallback(async () => {
		if (!user) return;
		setLoading(true);
		setError(null);
		try {
			if (tab === "chats") setConversations(await listConversations());
			if (tab === "tasks") setTasks(await listTasks());
			if (tab === "memory") setMemories(await listMemories());
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	}, [tab, user]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const openTranscript = useCallback(async (conversation: MobileConversation) => {
		setOpenConversation(conversation);
		setLoading(true);
		try {
			setMessages(await loadTranscript(conversation.id));
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	}, []);

	const handleSignIn = async (event: React.FormEvent) => {
		event.preventDefault();
		setBusy(true);
		setError(null);
		try {
			await supabase.signIn(email.trim(), password);
			setUser(supabase.getUser());
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(false);
		}
	};

	if (!user) {
		return (
			<div className="m-root m-centered">
				<div className="m-login">
					<div className="m-logo">OpenPI</div>
					<p className="m-login-sub">登录后即可在手机上查看 Mac 上的会话、任务与记忆。</p>
					<form onSubmit={handleSignIn}>
						<input
							type="email"
							inputMode="email"
							autoComplete="username"
							placeholder="邮箱"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
						/>
						<input
							type="password"
							autoComplete="current-password"
							placeholder="密码"
							value={password}
							onChange={(e) => setPassword(e.target.value)}
						/>
						<button type="submit" disabled={busy || !email.trim() || !password}>
							{busy ? "登录中…" : "登录"}
						</button>
					</form>
					{!supabase.isConfigured() && <p className="m-hint">还没有配置云端账号，请先在桌面端登录一次。</p>}
					{error && <p className="m-error">{error}</p>}
				</div>
			</div>
		);
	}

	return (
		<div className="m-root">
			<header className="m-header">
				{openConversation ? (
					<button type="button" className="m-back" onClick={() => setOpenConversation(null)}>
						‹ 返回
					</button>
				) : (
					<span className="m-brand">OpenPI</span>
				)}
				<span className="m-header-title">
					{openConversation ? openConversation.name : tab === "chats" ? "会话" : tab === "tasks" ? "任务" : "记忆"}
				</span>
				<button type="button" className="m-ghost" onClick={() => void supabase.signOut()}>
					退出
				</button>
			</header>

			<main className="m-body">
				{error && <div className="m-error m-error-inline">{error}</div>}
				{loading && <div className="m-muted">加载中…</div>}

				{openConversation ? (
					<div className="m-transcript">
						{messages.length === 0 && !loading && <div className="m-muted">这个会话还没有可显示的消息。</div>}
						{messages.map((message) => (
							<article key={message.id} className={`m-message ${message.role}`}>
								{message.role !== "system" && (
									<div className="m-role">{message.role === "user" ? "你" : message.toolName || "Sakurana"}</div>
								)}
								{message.reasoning && <details className="m-think"><summary>思考</summary><pre>{message.reasoning}</pre></details>}
								<MarkdownText text={message.text} />
							</article>
						))}
					</div>
				) : tab === "chats" ? (
					<ul className="m-list">
						{conversations.map((conversation) => (
							<li key={conversation.id}>
								<button type="button" className="m-row" onClick={() => void openTranscript(conversation)}>
									<span className="m-row-title">{conversation.name}</span>
									<span className="m-row-meta">
										{conversation.model ? `${conversation.model} · ` : ""}
										{relativeTime(conversation.updatedAt)}
									</span>
								</button>
							</li>
						))}
						{conversations.length === 0 && !loading && <li className="m-muted">还没有同步过来的会话。</li>}
					</ul>
				) : tab === "tasks" ? (
					<ul className="m-list">
						{tasks.map((task) => (
							<li key={task.id} className="m-row static">
								<span className="m-row-title">{task.title}</span>
								<span className="m-row-meta">
									{task.status}
									{task.nextRunAt ? ` · 下次 ${relativeTime(task.nextRunAt)}` : ""}
								</span>
							</li>
						))}
						{tasks.length === 0 && !loading && <li className="m-muted">还没有同步过来的任务。</li>}
					</ul>
				) : (
					<ul className="m-list">
						{memories.map((memory) => (
							<li key={memory.path} className="m-row static column">
								<span className="m-row-title">{memory.path.replace(/^memories\//, "")}</span>
								<pre className="m-memory">{memory.content.slice(0, 280)}</pre>
							</li>
						))}
						{memories.length === 0 && !loading && <li className="m-muted">还没有同步过来的记忆文件。</li>}
					</ul>
				)}
			</main>

			<nav className="m-tabs">
				{(["chats", "tasks", "memory"] as Tab[]).map((item) => (
					<button
						key={item}
						type="button"
						className={`m-tab ${tab === item && !openConversation ? "active" : ""}`}
						onClick={() => {
							setOpenConversation(null);
							setTab(item);
						}}
					>
						{item === "chats" ? "会话" : item === "tasks" ? "任务" : "记忆"}
					</button>
				))}
			</nav>
		</div>
	);
}
