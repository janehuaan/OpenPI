/**
 * Path helpers for the renderer.
 *
 * The renderer is sandboxed with no Node access, so `node:path` is unavailable —
 * these handle the small amount of path display the UI needs.
 */

/** Last segment of a path, for showing a workspace name. */
export function basename(path: string): string {
	const trimmed = path.replace(/[/\\]+$/, "");
	const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
	return index >= 0 ? trimmed.slice(index + 1) || trimmed : trimmed;
}

/** Shorten a long path for a one-line label, keeping the tail. */
export function shortenPath(path: string, maxLength = 48): string {
	if (path.length <= maxLength) return path;
	return `…${path.slice(path.length - maxLength + 1)}`;
}
