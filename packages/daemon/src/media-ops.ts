/**
 * Media operations: image and video generation via Agnes API.
 *
 * Config is resolved dynamically from the isolated agent dir's `models.json`
 * (where providers like `agnes-cn` live), falling back to process env.
 * In the old desktop this lived in the Electron main process as `agnes-media.mjs`;
 * moving it here keeps the main process minimal and allows media ops to be tested
 * without Electron.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
	CreateVideoInput,
	GenerateImageInput,
	GenerateImageResult,
	GeneratedImageItem,
	MediaCapabilities,
	VideoStatusResult,
} from "@openpi/shared";
import { agentDir } from "./config.ts";

export const AGNES_IMAGE_MODEL = "agnes-image-2.1-flash";
export const AGNES_VIDEO_MODEL = "agnes-video-v2.0";
export const AGNES_IMAGE_SIZES = ["1K", "2K", "3K", "4K"] as const;
export const AGNES_IMAGE_RATIOS = ["1:1", "3:4", "4:3", "16:9", "9:16", "2:3", "3:2", "21:9"] as const;

export interface AgnesConfig {
	apiKey: string;
	baseUrl: string;
}

/** Resolve Agnes API key and base URL from models.json or environment. */
export function resolveAgnesConfig(): AgnesConfig | undefined {
	// 1. Check models.json in agentDir
	const file = join(agentDir(), "models.json");
	if (existsSync(file)) {
		try {
			const parsed = JSON.parse(readFileSync(file, "utf8")) as {
				providers?: Record<string, { apiKey?: string; baseUrl?: string }>;
			};
			for (const [id, config] of Object.entries(parsed.providers ?? {})) {
				if (id.toLowerCase().includes("agnes") && typeof config?.apiKey === "string" && config.apiKey.trim()) {
					const baseUrl = typeof config.baseUrl === "string" && config.baseUrl.trim()
						? config.baseUrl.trim()
						: "https://api.agnes-ai.cn";
					return { apiKey: config.apiKey.trim(), baseUrl };
				}
			}
		} catch {
			// ignore corrupt models.json
		}
	}

	// 2. Check environment variable
	const envKey = process.env.AGNES_API_KEY?.trim() || process.env.AGNES_KEY?.trim();
	if (envKey) {
		return { apiKey: envKey, baseUrl: "https://api.agnes-ai.cn" };
	}

	return undefined;
}

export function mediaCapabilities(): MediaCapabilities {
	const config = resolveAgnesConfig();
	return {
		configured: Boolean(config?.apiKey),
		imageModel: AGNES_IMAGE_MODEL,
		videoModel: AGNES_VIDEO_MODEL,
		sizes: [...AGNES_IMAGE_SIZES],
		ratios: [...AGNES_IMAGE_RATIOS],
	};
}

function parseDataUri(value: string): { data: string; mimeType: string } | undefined {
	if (typeof value !== "string") return undefined;
	const match = value.match(/^data:([^;]+);base64,(.+)$/);
	if (!match) return { data: value, mimeType: "image/png" };
	return { data: match[2] ?? "", mimeType: match[1] ?? "image/png" };
}

function extractErrorMessage(payload: unknown, status: number): string {
	if (typeof payload === "string" && payload.trim()) return payload.trim();
	if (payload && typeof payload === "object") {
		const rec = payload as Record<string, unknown>;
		if (typeof rec.message === "string" && rec.message.trim()) return rec.message.trim();
		if (typeof rec.detail === "string" && rec.detail.trim()) return rec.detail.trim();
		if (typeof rec.error === "string" && rec.error.trim()) return rec.error.trim();
		if (rec.error && typeof rec.error === "object") {
			const errRec = rec.error as Record<string, unknown>;
			if (typeof errRec.message === "string" && errRec.message.trim()) return errRec.message.trim();
		}
	}
	return `Agnes request failed (${status})`;
}

async function agnesFetch(path: string, init: RequestInit, timeoutMs = 120_000): Promise<unknown> {
	const config = resolveAgnesConfig();
	if (!config) {
		throw new Error("Agnes API key not configured. Add an agnes provider in models.json or set AGNES_API_KEY.");
	}

	const root = config.baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const response = await fetch(`${root}${path}`, {
			...init,
			headers: {
				Authorization: `Bearer ${config.apiKey}`,
				"Content-Type": "application/json",
				...init.headers,
			},
			signal: controller.signal,
		});

		const text = await response.text();
		let parsed: unknown;
		try {
			parsed = text ? JSON.parse(text) : {};
		} catch {
			if (!response.ok) throw new Error(extractErrorMessage(text, response.status));
			throw new Error("Agnes returned an invalid JSON response");
		}

		if (!response.ok) throw new Error(extractErrorMessage(parsed, response.status));
		return parsed;
	} catch (error) {
		if (controller.signal.aborted) throw new Error(`Agnes request timed out after ${timeoutMs}ms`);
		throw error;
	} finally {
		clearTimeout(timer);
	}
}

export async function generateImage(input: GenerateImageInput): Promise<GenerateImageResult> {
	const prompt = input.prompt?.trim();
	if (!prompt) throw new Error("prompt is required");

	const size = input.size ?? "2K";
	const ratio = input.ratio ?? "1:1";
	if (!AGNES_IMAGE_SIZES.includes(size as typeof AGNES_IMAGE_SIZES[number])) {
		throw new Error(`Unsupported image size: ${size}. Allowed: ${AGNES_IMAGE_SIZES.join(", ")}`);
	}
	if (!AGNES_IMAGE_RATIOS.includes(ratio as typeof AGNES_IMAGE_RATIOS[number])) {
		throw new Error(`Unsupported image ratio: ${ratio}. Allowed: ${AGNES_IMAGE_RATIOS.join(", ")}`);
	}

	const responseFormat = input.returnBase64 ? "b64_json" : "url";
	const extraBody: Record<string, unknown> = { response_format: responseFormat };
	if (Array.isArray(input.images) && input.images.length > 0) {
		extraBody.image = input.images.map((img) => img.trim()).filter(Boolean);
	}

	const payload = (await agnesFetch(
		"/v1/images/generations",
		{
			method: "POST",
			body: JSON.stringify({
				model: AGNES_IMAGE_MODEL,
				prompt,
				size,
				ratio,
				...(input.returnBase64 ? { return_base64: true } : {}),
				extra_body: extraBody,
			}),
		},
		180_000,
	)) as Record<string, unknown>;

	const data = Array.isArray(payload.data) ? payload.data : [];
	const images: GeneratedImageItem[] = [];

	for (const item of data) {
		if (!item || typeof item !== "object") continue;
		const rec = item as Record<string, unknown>;
		if (typeof rec.url === "string" && rec.url.trim()) {
			images.push({
				url: rec.url.trim(),
				revisedPrompt: typeof rec.revised_prompt === "string" ? rec.revised_prompt : undefined,
			});
		} else if (typeof rec.b64_json === "string" && rec.b64_json.trim()) {
			const parsed = parseDataUri(rec.b64_json);
			if (parsed) {
				images.push({
					data: parsed.data,
					mimeType: parsed.mimeType,
					revisedPrompt: typeof rec.revised_prompt === "string" ? rec.revised_prompt : undefined,
				});
			}
		}
	}

	if (images.length === 0) throw new Error("Agnes returned no generated image");
	return {
		model: AGNES_IMAGE_MODEL,
		created: typeof payload.created === "number" ? payload.created : undefined,
		images,
	};
}

export async function createVideo(input: CreateVideoInput): Promise<VideoStatusResult> {
	const prompt = input.prompt?.trim();
	if (!prompt) throw new Error("prompt is required");

	const width = input.width ?? 1280;
	const height = input.height ?? 720;
	const numFrames = input.numFrames ?? 121;
	const frameRate = input.frameRate ?? 24;

	if ((numFrames - 1) % 8 !== 0) {
		throw new Error(`numFrames must follow the 8n + 1 rule (e.g., 49, 97, 121, 145), got ${numFrames}`);
	}

	const payload = (await agnesFetch(
		"/v1/videos",
		{
			method: "POST",
			body: JSON.stringify({
				model: AGNES_VIDEO_MODEL,
				prompt,
				width,
				height,
				num_frames: numFrames,
				frame_rate: frameRate,
				...(input.image ? { image: input.image.trim() } : {}),
				...(input.negativePrompt ? { negative_prompt: input.negativePrompt.trim() } : {}),
				...(Number.isInteger(input.seed) ? { seed: input.seed } : {}),
			}),
		},
		120_000,
	)) as Record<string, unknown>;

	return normalizeVideo(payload);
}

export async function getVideo(videoId: string): Promise<VideoStatusResult> {
	const id = videoId?.trim();
	if (!id) throw new Error("videoId is required");

	// Try standard /v1/videos/:id first
	try {
		const payload = (await agnesFetch(`/v1/videos/${encodeURIComponent(id)}`, { method: "GET" }, 60_000)) as Record<string, unknown>;
		return normalizeVideo(payload);
	} catch (firstErr) {
		// Fallback to legacy /agnesapi?video_id=:id
		try {
			const payload = (await agnesFetch(`/agnesapi?video_id=${encodeURIComponent(id)}`, { method: "GET" }, 60_000)) as Record<string, unknown>;
			return normalizeVideo(payload);
		} catch {
			throw firstErr;
		}
	}
}

function normalizeVideo(payload: Record<string, unknown>): VideoStatusResult {
	const taskId = typeof payload.task_id === "string" ? payload.task_id : typeof payload.id === "string" ? payload.id : undefined;
	const videoId = typeof payload.video_id === "string" ? payload.video_id : taskId;
	if (!taskId && !videoId) throw new Error("Agnes video response is missing task_id and video_id");

	const meta = (payload.metadata ?? {}) as Record<string, unknown>;
	const url = typeof meta.url === "string" ? meta.url : typeof payload.url === "string" ? payload.url : undefined;

	return {
		model: typeof payload.model === "string" ? payload.model : AGNES_VIDEO_MODEL,
		taskId,
		videoId: videoId!,
		status: typeof payload.status === "string" ? payload.status : "queued",
		progress: typeof payload.progress === "number" ? payload.progress : 0,
		createdAt: typeof payload.created_at === "number" ? payload.created_at : undefined,
		completedAt: typeof payload.completed_at === "number" ? payload.completed_at : undefined,
		seconds: typeof payload.seconds === "string" || typeof payload.seconds === "number" ? String(payload.seconds) : undefined,
		size: typeof payload.size === "string" ? payload.size : undefined,
		url,
		error: typeof payload.error === "string" ? payload.error : undefined,
	};
}
