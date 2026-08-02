export function normalizeSpeechLanguage(value) {
	if (typeof value !== "string" || !value.trim()) return "zh-CN";
	try {
		return new Intl.Locale(value).toString();
	} catch {
		return "zh-CN";
	}
}

export function parseSpeechHelperEvent(line) {
	try {
		const event = JSON.parse(line);
		if (!event || typeof event !== "object" || typeof event.type !== "string") return undefined;
		switch (event.type) {
			case "start":
				return { type: "start", onDevice: event.onDevice === true };
			case "result":
				return typeof event.transcript === "string" && typeof event.isFinal === "boolean"
					? { type: "result", transcript: event.transcript, isFinal: event.isFinal }
					: undefined;
			case "error":
				return typeof event.code === "string"
					? {
							type: "error",
							code: event.code,
							detail: typeof event.detail === "string" ? event.detail : undefined,
						}
					: undefined;
			case "end":
				return { type: "end" };
			default:
				return undefined;
		}
	} catch {
		return undefined;
	}
}
