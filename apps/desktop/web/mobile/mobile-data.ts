/**
 * Mobile data layer — reads the data the desktop app already syncs to Supabase.
 *
 * The mobile shell does not talk to the daemon at all: conversations, transcripts,
 * memories, tasks and preferences are all in the cloud already (see the desktop
 * cloud sync), scoped by RLS to the signed-in user. Prompting the Mac is phase 2
 * and will need the bridge, not this module.
 */

import { supabase } from "../lib/supabase-client";

export interface MobileMessage {
	id: string;
	role: string;
	text: string;
	reasoning: string;
	toolName?: string;
	createdAt?: string;
}

export interface MobileConversation {
	id: string;
	name: string;
	model?: string;
	messageCount: number;
	updatedAt: string;
}

async function rest<T>(path: string): Promise<T[]> {
	const cfg = supabase.getConfig();
	const session = supabase.getSession();
	if (!cfg.url || !session?.access_token) return [];
	const res = await fetch(`${cfg.url.replace(/\/$/, "")}/rest/v1/${path}`, {
		headers: {
			apikey: cfg.anonKey,
			Authorization: `Bearer ${session.access_token}`,
			Accept: "application/json",
		},
	});
	if (!res.ok) throw new Error(`cloud read failed (${res.status})`);
	return (await res.json()) as T[];
}

/** Conversations, newest first, with the message count pulled from the messages. */
export async function listConversations(): Promise<MobileConversation[]> {
	const rows = await rest<{ id: string; name?: string; model?: string; updated_at?: string; deleted_at?: string }>(
		"cloud_conversations?select=id,name,model,updated_at,deleted_at&deleted_at=is.null&order=updated_at.desc&limit=60",
	);
	return rows.map((row) => ({
		id: row.id,
		name: (row.name || "").trim() || "未命名会话",
		model: row.model,
		messageCount: 0,
		updatedAt: row.updated_at || "",
	}));
}

/** One conversation's transcript, oldest first. */
export async function loadTranscript(conversationId: string): Promise<MobileMessage[]> {
	const rows = await rest<{ payload: unknown }>(
		`cloud_messages?select=payload&conversation_id=eq.${encodeURIComponent(conversationId)}&order=seq.asc&limit=500`,
	);
	const out: MobileMessage[] = [];
	for (const row of rows) {
		const entry = row.payload as Record<string, unknown> | null;
		if (!entry) continue;
		// Encrypted transcripts (sync passphrase set) arrive as { __enc: … } — the
		// phone has no key, so it can only report that they are not readable here.
		if (entry.__enc) {
			out.push({ id: "encrypted", role: "system", text: "这段会话在云端是端到端加密的，手机端无法解读。", reasoning: "" });
			continue;
		}
		const message = entry.message as Record<string, unknown> | undefined;
		if (!message) continue;
		out.push({
			id: String(entry.id ?? ""),
			role: String(message.role ?? "assistant"),
			text: blocksToText(message.content, "text"),
			reasoning: blocksToText(message.content, "thinking"),
			toolName: toolName(message.content),
			createdAt: typeof entry.timestamp === "string" ? entry.timestamp : undefined,
		});
	}
	return out;
}

export async function listTasks(): Promise<{ id: string; title: string; status: string; nextRunAt?: string }[]> {
	const rows = await rest<{ id: string; title: string; status: string; next_run_at?: string; deleted_at?: string }>(
		"cloud_tasks?select=id,title,status,next_run_at,deleted_at&deleted_at=is.null&order=updated_at.desc&limit=60",
	);
	return rows.map((row) => ({ id: row.id, title: row.title, status: row.status, nextRunAt: row.next_run_at }));
}

export async function listMemories(): Promise<{ path: string; content: string }[]> {
	const rows = await rest<{ path: string; content: string; deleted_at?: string }>(
		"cloud_files?select=path,content,deleted_at&path=like.memories/%25&deleted_at=is.null&order=path.asc&limit=80",
	);
	return rows.map((row) => ({ path: row.path, content: row.content }));
}

function blocksToText(content: unknown, kind: "text" | "thinking"): string {
	if (typeof content === "string") return kind === "text" ? content : "";
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const block of content) {
		if (!block || typeof block !== "object") continue;
		const row = block as Record<string, unknown>;
		if (kind === "text" && typeof row.text === "string") parts.push(row.text);
		if (kind === "thinking" && typeof row.thinking === "string") parts.push(row.thinking);
	}
	return parts.join("\n\n").trim();
}

function toolName(content: unknown): string | undefined {
	if (!Array.isArray(content)) return undefined;
	for (const block of content) {
		if (!block || typeof block !== "object") continue;
		const row = block as Record<string, unknown>;
		if ((row.type === "toolCall" || row.type === "tool_use") && typeof row.name === "string") return row.name;
	}
	return undefined;
}
