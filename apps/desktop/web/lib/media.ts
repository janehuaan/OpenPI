import type { GeneratedMediaItem } from "../types";

export const MEDIA_HISTORY_STORAGE_KEY = "openpi-media-history-v1";

export const IMAGE_SIZE_OPTIONS = ["1K", "2K", "3K", "4K"] as const;
export const IMAGE_RATIO_OPTIONS = ["1:1", "3:4", "4:3", "16:9", "9:16", "2:3", "3:2", "21:9"] as const;
export const VIDEO_RESOLUTION_OPTIONS = ["480p", "720p", "1080p"] as const;
export const VIDEO_RATIO_OPTIONS = ["16:9", "9:16", "1:1", "4:3", "3:4"] as const;
export const VIDEO_DURATION_OPTIONS = [
	{ label: "约 3 秒", frames: 81 },
	{ label: "约 5 秒", frames: 121 },
	{ label: "约 10 秒", frames: 241 },
	{ label: "约 18 秒", frames: 441 },
] as const;

const VIDEO_DIMENSIONS = {
	"480p": {
		"16:9": [832, 448],
		"9:16": [448, 832],
		"1:1": [512, 512],
		"4:3": [640, 480],
		"3:4": [480, 640],
	},
	"720p": {
		"16:9": [1280, 720],
		"9:16": [720, 1280],
		"1:1": [720, 720],
		"4:3": [960, 720],
		"3:4": [720, 960],
	},
	"1080p": {
		"16:9": [1920, 1080],
		"9:16": [1080, 1920],
		"1:1": [1080, 1080],
		"4:3": [1440, 1080],
		"3:4": [1080, 1440],
	},
} as const;

export type VideoResolution = keyof typeof VIDEO_DIMENSIONS;
export type VideoRatio = keyof (typeof VIDEO_DIMENSIONS)[VideoResolution];

export function videoDimensions(resolution: VideoResolution, ratio: VideoRatio): { width: number; height: number } {
	const [width, height] = VIDEO_DIMENSIONS[resolution][ratio];
	return { width, height };
}

export function loadMediaHistory(raw: string | null): Record<string, GeneratedMediaItem[]> {
	if (!raw) return {};
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
		const history: Record<string, GeneratedMediaItem[]> = {};
		for (const [scope, value] of Object.entries(parsed)) {
			if (!Array.isArray(value)) continue;
			history[scope] = value.filter((item): item is GeneratedMediaItem => {
				if (!item || typeof item !== "object") return false;
				const candidate = item as Partial<GeneratedMediaItem>;
				return (
					typeof candidate.id === "string" &&
					(candidate.kind === "image" || candidate.kind === "video") &&
					typeof candidate.prompt === "string" &&
					typeof candidate.createdAt === "number" &&
					typeof candidate.status === "string"
				);
			});
		}
		return history;
	} catch {
		return {};
	}
}

export function mediaErrorMessage(value: unknown): string {
	if (typeof value === "string" && value.trim()) return value;
	if (value && typeof value === "object") {
		const record = value as Record<string, unknown>;
		if (typeof record.message === "string" && record.message.trim()) return record.message;
		if (typeof record.error === "string" && record.error.trim()) return record.error;
	}
	return "媒体生成失败";
}

/**
 * Read an image file and produce a square-cropped, downscaled PNG data URL
 * (max `maxSize` px on the long edge) for a user avatar.
 */
export async function fileToAvatarDataUrl(file: File, maxSize = 256): Promise<string> {
	const dataUrl = await new Promise<string>((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result));
		reader.onerror = () => reject(reader.error ?? new Error("读取图片失败"));
		reader.readAsDataURL(file);
	});
	const image = await new Promise<HTMLImageElement>((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error("图片加载失败"));
		img.src = dataUrl;
	});
	const scale = Math.min(1, maxSize / Math.max(image.naturalWidth, image.naturalHeight));
	const width = Math.max(1, Math.round(image.naturalWidth * scale));
	const height = Math.max(1, Math.round(image.naturalHeight * scale));
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("无法创建画布");
	ctx.drawImage(image, 0, 0, width, height);
	return canvas.toDataURL("image/png");
}
