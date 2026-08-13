import type { Extension, LoadExtensionsResult } from "./extensions/types.ts";

function isPiShazamExtension(extension: Extension): boolean {
	return [extension.path, extension.resolvedPath].some((value) => value.split(/[\\/]/).includes("pi-shazam"));
}

/**
 * pi-shazam performs a synchronous tree-sitter project scan from its
 * before_agent_start hook. In the desktop RPC process that blocks the IPC
 * stream before the provider request is even started. Keep the extension's
 * tools and commands available, but make project scans explicit instead.
 */
export function disableDesktopPiShazamStartupHooks(result: LoadExtensionsResult): LoadExtensionsResult {
	let changed = false;
	const extensions = result.extensions.map((extension) => {
		if (!isPiShazamExtension(extension) || !extension.handlers.has("before_agent_start")) {
			return extension;
		}

		const handlers = new Map(extension.handlers);
		handlers.delete("before_agent_start");
		changed = true;
		return { ...extension, handlers };
	});

	return changed ? { ...result, extensions } : result;
}
