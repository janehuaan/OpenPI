/**
 * Document attachments.
 *
 * A dropped file becomes text appended to the prompt, not a provider attachment:
 * that works with every model regardless of whether it accepts documents, and it
 * is what the old desktop did too. Extraction happens in the daemon — the
 * renderer only ships bytes.
 */

import type { DocumentText } from "@openpi/shared";
import { api } from "./api.ts";

/** Cap per attachment, before the daemon's own limit. */
const MAX_BYTES = 8 * 1024 * 1024;

export interface Attachment extends DocumentText {
	bytes: number;
}

async function toBase64(file: File): Promise<string> {
	const buffer = await file.arrayBuffer();
	const bytes = new Uint8Array(buffer);
	// Chunked: String.fromCharCode(...bytes) on a multi-MB array overflows the
	// argument limit and throws.
	let binary = "";
	const chunk = 0x8000;
	for (let index = 0; index < bytes.length; index += chunk) {
		binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
	}
	return btoa(binary);
}

export async function readAttachment(file: File): Promise<Attachment> {
	if (file.size > MAX_BYTES) {
		throw new Error(`${file.name} is ${Math.round(file.size / 1024 / 1024)} MB; the limit is 8 MB.`);
	}
	const extracted = await api.extractDocument(file.name, await toBase64(file));
	return { ...extracted, bytes: file.size };
}

/**
 * Build the message sent to the agent.
 *
 * Attachments go after the user's text in fenced blocks tagged with the file
 * name, so the model can tell prose from attached content and cite which file a
 * detail came from.
 */
export function messageWithAttachments(message: string, attachments: Attachment[]): string {
	if (attachments.length === 0) return message;
	const blocks = attachments.map((attachment) => {
		const note = attachment.truncated ? " (truncated)" : "";
		return `<attachment name="${escapeName(attachment.name)}"${note ? ` note="truncated"` : ""}>\n${attachment.text}\n</attachment>`;
	});
	return [message.trim(), "", ...blocks].join("\n");
}

/** A quote in a file name would break out of the attribute. */
function escapeName(name: string): string {
	return name.replace(/"/g, "'");
}

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
