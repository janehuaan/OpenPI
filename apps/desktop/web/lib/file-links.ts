import { createContext, useContext } from "react";

export interface ParsedFileLink {
	filePath: string;
	lineStart?: number;
	lineEnd?: number;
	rawHref: string;
}

export interface FilePreviewRequest {
	path: string;
	lineStart?: number;
	lineEnd?: number;
	label?: string;
}

export interface FilePreviewContextValue {
	openFilePreview: (request: FilePreviewRequest | string, line?: number) => void;
}

export const FilePreviewContext = createContext<FilePreviewContextValue | null>(null);

export function useFilePreview(): FilePreviewContextValue | null {
	return useContext(FilePreviewContext);
}

const KNOWN_FILE_EXTENSIONS = new Set([
	"ts", "tsx", "js", "jsx", "mjs", "cjs",
	"json", "css", "scss", "sass", "less", "html", "htm",
	"py", "pyw", "rs", "go", "c", "h", "cpp", "hpp", "cc",
	"java", "kt", "kts", "rb", "sh", "bash", "zsh", "fish",
	"md", "markdown", "yaml", "yml", "toml", "sql", "graphql",
	"txt", "log", "lock", "env", "gitignore", "dockerignore", "xml", "svg"
]);

/**
 * Parses a markdown link href into a file link with optional line number anchors.
 * Supports:
 *   - file:///absolute/path/to/file#L123
 *   - file:///absolute/path/to/file#L10-L25
 *   - relative/path/to/file.ts#L42
 *   - /absolute/path/to/file.tsx
 *   - ./src/main.ts#L10
 */
export function parseFileLink(href: string): ParsedFileLink | null {
	if (!href || typeof href !== "string") return null;
	const trimmed = href.trim();

	// Exclude web protocols, mailto, tel, conversation links
	if (/^(https?|mailto|tel|ftp|javascript|data|conversation):/i.test(trimmed)) {
		return null;
	}

	let pathPart = trimmed;
	let hashPart = "";
	const hashIdx = trimmed.indexOf("#");
	if (hashIdx !== -1) {
		pathPart = trimmed.slice(0, hashIdx);
		hashPart = trimmed.slice(hashIdx + 1);
	}

	let cleanPath = pathPart;
	let isFile = false;

	if (cleanPath.startsWith("file://")) {
		isFile = true;
		try {
			cleanPath = decodeURIComponent(new URL(cleanPath).pathname);
			// On Windows, URL pathname might be "/C:/path", strip leading slash
			if (/^\/[a-zA-Z]:/.test(cleanPath)) {
				cleanPath = cleanPath.slice(1);
			}
		} catch {
			cleanPath = cleanPath.replace(/^file:\/\//, "");
		}
	} else {
		// Check path prefix or known extension
		const hasPrefix = cleanPath.startsWith("/") || cleanPath.startsWith("./") || cleanPath.startsWith("../");
		const extMatch = /\.([a-zA-Z0-9]+)$/.exec(cleanPath);
		const ext = extMatch ? extMatch[1].toLowerCase() : "";
		const hasKnownExt = KNOWN_FILE_EXTENSIONS.has(ext);

		if (hasPrefix || hasKnownExt) {
			isFile = true;
		}
	}

	if (!isFile || !cleanPath) return null;

	let lineStart: number | undefined;
	let lineEnd: number | undefined;

	// Extract #L123 or #L10-L25 or #123
	if (hashPart) {
		const lineMatch = /^(?:L)?(\d+)(?:-(?:L)?(\d+))?$/i.exec(hashPart);
		if (lineMatch) {
			lineStart = parseInt(lineMatch[1], 10);
			if (lineMatch[2]) {
				lineEnd = parseInt(lineMatch[2], 10);
			}
		}
	}

	return {
		filePath: cleanPath,
		lineStart,
		lineEnd,
		rawHref: href,
	};
}
