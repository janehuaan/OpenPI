export type SpeechInputEvent =
	| { sessionId: string; type: "start"; onDevice: boolean }
	| { sessionId: string; type: "result"; transcript: string; isFinal: boolean }
	| { sessionId: string; type: "error"; message: string }
	| { sessionId: string; type: "end" };

const CJK_CHARACTER = /[\u3400-\u9fff\uf900-\ufaff]/;
const NO_LEADING_SPACE = /^[,.:;!?%\])}，。！？、：；）】》]/;

export function joinSpeechText(base: string, addition: string): string {
	const speech = addition.trim();
	if (!speech) return base;
	if (!base) return speech;
	if (/\s$/.test(base)) return `${base}${speech}`;

	const lastBaseCharacter = base.at(-1) ?? "";
	const firstSpeechCharacter = speech[0] ?? "";
	const needsSpace =
		!CJK_CHARACTER.test(lastBaseCharacter) &&
		!CJK_CHARACTER.test(firstSpeechCharacter) &&
		!NO_LEADING_SPACE.test(speech);
	return `${base}${needsSpace ? " " : ""}${speech}`;
}
