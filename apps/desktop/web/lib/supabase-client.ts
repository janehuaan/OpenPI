/**
 * Lightweight, zero-dependency Supabase client for OpenPI Desktop.
 * Directly communicates with Supabase Auth (GoTrue) REST APIs via native fetch().
 */

export interface SupabaseUser {
	id: string;
	email?: string;
	user_metadata?: {
		nickname?: string;
		avatar_emoji?: string;
		full_name?: string;
		[key: string]: any;
	};
	created_at?: string;
}

export interface SupabaseSession {
	access_token: string;
	refresh_token: string;
	expires_at: number;
	user: SupabaseUser;
}

export interface SupabaseConfig {
	url: string;
	anonKey: string;
}

const STORAGE_KEY_CONFIG = "openpi:supabase_config";
const STORAGE_KEY_SESSION = "openpi:supabase_session";

// Built-in Supabase project configuration (can be overridden by user in settings/localStorage)
const DEFAULT_URL =
	(typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_SUPABASE_URL) ||
	(typeof import.meta !== "undefined" && (import.meta as any).env?.NEXT_PUBLIC_SUPABASE_URL) ||
	(typeof process !== "undefined" && process.env?.VITE_SUPABASE_URL) ||
	"https://ibohdnslftdpvixwaxkd.supabase.co";

const DEFAULT_ANON_KEY =
	(typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_SUPABASE_ANON_KEY) ||
	(typeof import.meta !== "undefined" && (import.meta as any).env?.NEXT_PUBLIC_SUPABASE_ANON_KEY) ||
	(typeof process !== "undefined" && process.env?.VITE_SUPABASE_ANON_KEY) ||
	"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlib2hkbnNsZnRkcHZpeHdheGtkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjAxMTM4NDEsImV4cCI6MjA3NTY4OTg0MX0.j9xB-rosYv4Fyorb4iyPTMvMczcDdWfK3cKUr36ymoI";

export class SupabaseClient {
	private config: SupabaseConfig;
	private currentSession: SupabaseSession | null = null;
	private listeners: Set<(user: SupabaseUser | null) => void> = new Set();

	constructor() {
		this.config = this.loadConfig();
		this.currentSession = this.loadSession();
	}

	public isConfigured(): boolean {
		return Boolean(this.config.url?.trim() && this.config.anonKey?.trim());
	}

	public getConfig(): SupabaseConfig {
		return { ...this.config };
	}

	public saveConfig(config: SupabaseConfig): void {
		let cleanUrl = config.url.trim().replace(/\/+$/, "");
		this.config = {
			url: cleanUrl,
			anonKey: config.anonKey.trim(),
		};
		try {
			if (typeof localStorage !== "undefined") {
				localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(this.config));
			}
		} catch (e) {
			console.warn("Failed to persist Supabase config to localStorage:", e);
		}
	}

	public getSession(): SupabaseSession | null {
		if (!this.currentSession) return null;
		// Check token expiration (with 60s buffer)
		if (this.currentSession.expires_at && Date.now() / 1000 > this.currentSession.expires_at - 60) {
			// Trigger background refresh if refresh token is present
			void this.refreshSession();
		}
		return this.currentSession;
	}

	public getUser(): SupabaseUser | null {
		const session = this.getSession();
		return session?.user ?? null;
	}

	public onAuthStateChange(listener: (user: SupabaseUser | null) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	private notifyAuthStateChange(): void {
		const user = this.getUser();
		for (const listener of this.listeners) {
			try {
				listener(user);
			} catch (e) {
				console.error("Auth state listener error:", e);
			}
		}
		if (typeof window !== "undefined") {
			window.dispatchEvent(new CustomEvent("openpi:supabase-auth-changed", { detail: { user } }));
		}
	}

	private loadConfig(): SupabaseConfig {
		try {
			if (typeof localStorage !== "undefined") {
				const saved = localStorage.getItem(STORAGE_KEY_CONFIG);
				if (saved) {
					const parsed = JSON.parse(saved);
					if (parsed.url && parsed.anonKey) {
						return {
							url: parsed.url.trim().replace(/\/+$/, ""),
							anonKey: parsed.anonKey.trim(),
						};
					}
				}
			}
		} catch (e) {
			console.warn("Failed to read Supabase config:", e);
		}
		return {
			url: DEFAULT_URL,
			anonKey: DEFAULT_ANON_KEY,
		};
	}

	private loadSession(): SupabaseSession | null {
		try {
			if (typeof localStorage !== "undefined") {
				const saved = localStorage.getItem(STORAGE_KEY_SESSION);
				if (saved) {
					return JSON.parse(saved);
				}
			}
		} catch (e) {
			console.warn("Failed to read Supabase session:", e);
		}
		return null;
	}

	private persistSession(session: SupabaseSession | null): void {
		this.currentSession = session;
		try {
			if (typeof localStorage !== "undefined") {
				if (session) {
					localStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(session));
				} else {
					localStorage.removeItem(STORAGE_KEY_SESSION);
				}
			}
		} catch (e) {
			console.warn("Failed to persist Supabase session:", e);
		}
		this.notifyAuthStateChange();
	}

	private getHeaders(token?: string): Record<string, string> {
		const headers: Record<string, string> = {
			apikey: this.config.anonKey,
			"Content-Type": "application/json",
		};
		if (token) {
			headers["Authorization"] = `Bearer ${token}`;
		}
		return headers;
	}

	private async fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 6000): Promise<Response> {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			return await fetch(url, { ...options, signal: controller.signal });
		} finally {
			clearTimeout(timer);
		}
	}

	/**
	 * Sign up a new user with email, password and optional metadata (e.g. nickname, avatar).
	 */
	public async signUp(
		email: string,
		password: string,
		metadata?: { nickname?: string; avatar_emoji?: string; [key: string]: any },
	): Promise<{ user?: SupabaseUser; session?: SupabaseSession; error?: string; message?: string }> {
		if (!this.isConfigured()) {
			return { error: "尚未配置 Supabase 项目地址与 Anon Key，请先配置。" };
		}

		try {
			const res = await this.fetchWithTimeout(`${this.config.url}/auth/v1/signup`, {
				method: "POST",
				headers: this.getHeaders(),
				body: JSON.stringify({
					email: email.trim(),
					password,
					data: metadata || {},
				}),
			});

			const data = await res.json();
			if (!res.ok) {
				return { error: data.msg || data.message || data.error_description || "注册失败，请检查邮箱与密码格式。" };
			}

			if (data.access_token) {
				const session: SupabaseSession = {
					access_token: data.access_token,
					refresh_token: data.refresh_token,
					expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
					user: data.user,
				};
				this.persistSession(session);
				return { user: data.user, session };
			}

			// If email confirmation is required by Supabase project settings
			return {
				user: data,
				message: "注册成功！请前往邮箱查收确认链接后即可登录。",
			};
		} catch (err: any) {
			return { error: `网络请求失败: ${err?.message || String(err)}` };
		}
	}

	/**
	 * Sign in with email and password.
	 */
	public async signIn(
		email: string,
		password: string,
	): Promise<{ user?: SupabaseUser; session?: SupabaseSession; error?: string }> {
		if (!this.isConfigured()) {
			return { error: "尚未配置 Supabase 项目地址与 Anon Key，请先配置。" };
		}

		try {
			const res = await this.fetchWithTimeout(`${this.config.url}/auth/v1/token?grant_type=password`, {
				method: "POST",
				headers: this.getHeaders(),
				body: JSON.stringify({
					email: email.trim(),
					password,
				}),
			});

			const data = await res.json();
			if (!res.ok) {
				const errMsg =
					data.error_description ||
					data.msg ||
					data.message ||
					(data.error === "invalid_grant" ? "邮箱或密码错误，请重试。" : "登录失败");
				return { error: errMsg };
			}

			const session: SupabaseSession = {
				access_token: data.access_token,
				refresh_token: data.refresh_token,
				expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
				user: data.user,
			};
			this.persistSession(session);
			return { user: data.user, session };
		} catch (err: any) {
			return { error: `登录网络请求失败: ${err?.message || String(err)}` };
		}
	}

	/**
	 * Get the OAuth authorize URL for GitHub or Google.
	 */
	public getOAuthUrl(provider: "github" | "google", redirectTo?: string): string {
		const redirect =
			redirectTo ||
			(typeof window !== "undefined"
				? window.location.origin.includes("tauri") || window.location.protocol === "file:"
					? "http://127.0.0.1:5179/"
					: window.location.origin
				: "");
		const url = new URL(`${this.config.url}/auth/v1/authorize`);
		url.searchParams.set("provider", provider);
		if (redirect) {
			url.searchParams.set("redirect_to", redirect);
		}
		return url.toString();
	}

	/**
	 * Parse and set session from URL hash after OAuth redirection.
	 */
	public async handleOAuthCallbackFromHash(
		hash?: string,
	): Promise<{ user?: SupabaseUser; session?: SupabaseSession; error?: string } | null> {
		const h = hash || (typeof window !== "undefined" ? window.location.hash : "");
		if (!h || !h.includes("access_token=")) return null;

		try {
			const params = new URLSearchParams(h.startsWith("#") ? h.slice(1) : h);
			const accessToken = params.get("access_token");
			const refreshToken = params.get("refresh_token") || "";
			const expiresIn = Number(params.get("expires_in") || "3600");

			if (!accessToken) return null;

			// Fetch user info with the accessToken
			const userRes = await this.fetchWithTimeout(`${this.config.url}/auth/v1/user`, {
				headers: this.getHeaders(accessToken),
			});

			if (!userRes.ok) {
				return { error: "无法验证 OAuth 用户身份信息" };
			}

			const user: SupabaseUser = await userRes.json();
			const session: SupabaseSession = {
				access_token: accessToken,
				refresh_token: refreshToken,
				expires_at: Math.floor(Date.now() / 1000) + expiresIn,
				user,
			};

			this.persistSession(session);

			// Clean up the hash in the browser URL so it doesn't expose tokens
			if (typeof window !== "undefined" && window.history?.replaceState) {
				window.history.replaceState(null, "", window.location.pathname + window.location.search);
			}

			return { user, session };
		} catch (err: any) {
			return { error: `OAuth 认证失败: ${err?.message || String(err)}` };
		}
	}

	/**
	 * Sign out current session.
	 */
	public async signOut(): Promise<void> {
		if (this.currentSession?.access_token && this.isConfigured()) {
			try {
				await this.fetchWithTimeout(
					`${this.config.url}/auth/v1/logout`,
					{
						method: "POST",
						headers: this.getHeaders(this.currentSession.access_token),
					},
					3000,
				);
			} catch (e) {
				console.warn("Supabase remote logout error:", e);
			}
		}
		this.persistSession(null);
	}

	/**
	 * Refresh access token using refresh_token.
	 */
	public async refreshSession(): Promise<SupabaseSession | null> {
		if (!this.currentSession?.refresh_token || !this.isConfigured()) {
			return null;
		}

		try {
			const res = await this.fetchWithTimeout(`${this.config.url}/auth/v1/token?grant_type=refresh_token`, {
				method: "POST",
				headers: this.getHeaders(),
				body: JSON.stringify({
					refresh_token: this.currentSession.refresh_token,
				}),
			});

			if (!res.ok) {
				return null;
			}

			const data = await res.json();
			const session: SupabaseSession = {
				access_token: data.access_token,
				refresh_token: data.refresh_token,
				expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
				user: data.user || this.currentSession.user,
			};
			this.persistSession(session);
			return session;
		} catch (e) {
			console.warn("Supabase refresh session failed:", e);
			return null;
		}
	}

	/**
	 * Update user profile/metadata in Supabase Auth.
	 */
	public async updateUserProfile(metadata: {
		nickname?: string;
		avatar_emoji?: string;
		[key: string]: any;
	}): Promise<{ user?: SupabaseUser; error?: string }> {
		if (!this.currentSession?.access_token || !this.isConfigured()) {
			return { error: "尚未登录或未配置 Supabase" };
		}

		try {
			const res = await this.fetchWithTimeout(
				`${this.config.url}/auth/v1/user`,
				{
					method: "PUT",
					headers: this.getHeaders(this.currentSession.access_token),
					body: JSON.stringify({
						data: metadata,
					}),
				},
				4000,
			);

			const data = await res.json();
			if (!res.ok) {
				return { error: data.msg || data.message || "更新用户档案失败" };
			}

			if (this.currentSession) {
				const updatedSession: SupabaseSession = {
					...this.currentSession,
					user: data,
				};
				this.persistSession(updatedSession);
			}
			return { user: data };
		} catch (err: any) {
			return { error: `更新资料请求失败: ${err?.message || String(err)}` };
		}
	}
}

export const supabase = new SupabaseClient();
