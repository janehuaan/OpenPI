/**
 * Cloud sync bridge — forwards the Supabase session (owned by the renderer) to
 * the Rust daemon, which does the actual data sync (Supabase PostgREST + RLS).
 *
 * The renderer is the single owner of the session because Supabase rotates the
 * refresh token; two independent refreshers would invalidate each other. So we
 * push the current access token to the daemon on every auth change and shortly
 * before expiry, and clear it on sign-out.
 */

import { desktopApi } from "../api";
import { supabase, type SupabaseSession } from "./supabase-client";

let started = false;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleRefresh(session: SupabaseSession | null) {
	if (refreshTimer) {
		clearTimeout(refreshTimer);
		refreshTimer = null;
	}
	if (!session?.expires_at) return;
	// Refresh ~2 minutes before expiry (and never less than 15s from now).
	const msUntilRefresh = Math.max(15_000, (session.expires_at - 120) * 1000 - Date.now());
	refreshTimer = setTimeout(async () => {
		const next = await supabase.refreshSession();
		if (next) {
			await pushSession(next);
		} else {
			scheduleRefresh(null);
		}
	}, msUntilRefresh);
}

async function pushSession(session: SupabaseSession | null) {
	if (!session) {
		scheduleRefresh(null);
		try {
			await desktopApi.cloudClearAuth();
		} catch {
			/* daemon may be offline */
		}
		return;
	}
	const cfg = supabase.getConfig();
	try {
		await desktopApi.cloudSetAuth({
			url: cfg.url,
			anonKey: cfg.anonKey,
			accessToken: session.access_token,
			expiresAt: session.expires_at,
		});
	} catch (err) {
		console.warn("[cloud-sync] failed to push auth to daemon:", err);
	}
	scheduleRefresh(session);
}

/** Call once from the main window only (not the island). Idempotent. */
export function initCloudSyncBridge() {
	if (started || !desktopApi.isNative) return;
	started = true;

	// Initial sync of whatever session we already have.
	void pushSession(supabase.getSession());

	// React to login / logout / token refresh.
	supabase.onAuthStateChange((user) => {
		void pushSession(user ? supabase.getSession() : null);
	});
}
