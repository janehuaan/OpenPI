const STREAM_SPEED_SLOW = 90;
const STREAM_SPEED_MEDIUM = 240;
const STREAM_SPEED_FAST = 720;
const STREAM_SPEED_CATCH_UP = 1_800;

/** Returns the next UTF-16 offset for an adaptive streaming-text reveal. */
export function nextStreamingTextOffset(currentOffset: number, target: string, elapsedMs: number): number {
	if (currentOffset >= target.length) return target.length;

	const remaining = target.length - currentOffset;
	const charactersPerSecond =
		remaining <= 24
			? STREAM_SPEED_SLOW
			: remaining <= 120
				? STREAM_SPEED_MEDIUM
				: remaining <= 480
					? STREAM_SPEED_FAST
					: STREAM_SPEED_CATCH_UP;
	const timedStep = Math.ceil((charactersPerSecond * Math.min(Math.max(elapsedMs, 16), 50)) / 1_000);
	const backlogStep = remaining > 480 ? Math.ceil(remaining * 0.08) : 0;
	const step = Math.max(1, timedStep, backlogStep);
	let nextOffset = Math.min(target.length, currentOffset + step);

	// Never expose half of a surrogate pair while slicing incremental text.
	if (
		nextOffset < target.length &&
		isHighSurrogate(target.charCodeAt(nextOffset - 1)) &&
		isLowSurrogate(target.charCodeAt(nextOffset))
	) {
		nextOffset += 1;
	}
	return nextOffset;
}

function isHighSurrogate(value: number): boolean {
	return value >= 0xd800 && value <= 0xdbff;
}

function isLowSurrogate(value: number): boolean {
	return value >= 0xdc00 && value <= 0xdfff;
}
