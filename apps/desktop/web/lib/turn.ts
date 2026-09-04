/**
 * Reduce the pi RPC event stream into what the UI renders.
 *
 * A turn arrives as a sequence of events, not a final value: text streams in
 * deltas, tool calls start and finish independently, and a turn can end in an
 * error carried on the assistant message rather than thrown. Keeping that
 * reduction here - pure, on plain data - is what makes it testable without a
 * provider or a DOM.
 */

export type Role = "user" | "assistant";

export interface ToolActivity {
	id: string;
	name: string;
	/** Undefined while running. */
	ok?: boolean;
	durationMs?: number;
}

export interface ChatMessage {
	id: string;
	role: Role;
	text: string;
	/** Set when the provider reported an error for this message. */
	error?: string;
	tools: ToolActivity[];
	/** True while deltas are still arriving. */
	streaming: boolean;
}

export interface TurnState {
	messages: ChatMessage[];
	/** True between agent_start and agent_settled. */
	active: boolean;
	/** Live tool calls, in start order. */
	runningTools: ToolActivity[];
	/** Last error surfaced by the stream. */
	error?: string;
}

export function emptyTurnState(): TurnState {
	return { messages: [], active: false, runningTools: [] };
}

interface RawEvent {
	type: string;
	[key: string]: unknown;
}

interface RawMessage {
	role?: string;
	content?: unknown;
	errorMessage?: string;
	stopReason?: string;
}

/** Concatenate the text parts of a pi message's content array. */
export function textOf(message: unknown): string {
	if (!message || typeof message !== "object") return "";
	const content = (message as RawMessage).content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is { type: "text"; text: string } => {
			return Boolean(part) && typeof part === "object" && (part as { type?: string }).type === "text";
		})
		.map((part) => part.text)
		.join("");
}

/** Tool calls named in a pi assistant message. */
function toolCallsOf(message: unknown): Array<{ id: string; name: string }> {
	if (!message || typeof message !== "object") return [];
	const content = (message as RawMessage).content;
	if (!Array.isArray(content)) return [];
	const out: Array<{ id: string; name: string }> = [];
	for (const part of content) {
		if (!part || typeof part !== "object") continue;
		const record = part as { type?: string; id?: string; name?: string };
		if (record.type === "toolCall" && record.name) {
			out.push({ id: record.id ?? record.name, name: record.name });
		}
	}
	return out;
}

let counter = 0;
const nextId = () => `m${++counter}`;

/**
 * Apply one event, returning the next state.
 *
 * Pure and total: an unrecognized event returns the state unchanged rather than
 * throwing, because the daemon forwards upstream's stream verbatim and upstream
 * adds event types between releases.
 */
export function reduceTurn(state: TurnState, event: RawEvent): TurnState {
	switch (event.type) {
		case "agent_start":
			return { ...state, active: true, error: undefined, runningTools: [] };

		case "message_start": {
			const message = event.message as RawMessage | undefined;
			if (message?.role !== "assistant") return state;
			return {
				...state,
				messages: [
					...state.messages,
					{ id: nextId(), role: "assistant", text: "", tools: [], streaming: true },
				],
			};
		}

		case "message_update": {
			// Deltas land on the newest streaming assistant message.
			const delta = typeof event.delta === "string" ? event.delta : textOf(event.message);
			if (!delta) return state;
			const index = lastStreamingIndex(state.messages);
			if (index < 0) return state;
			const messages = [...state.messages];
			const current = messages[index]!;
			messages[index] = { ...current, text: current.text + delta };
			return { ...state, messages };
		}

		case "message_end": {
			const message = event.message as RawMessage | undefined;
			if (!message) return state;

			if (message.role === "user") {
				const text = textOf(message);
				if (!text) return state;
				return {
					...state,
					messages: [...state.messages, { id: nextId(), role: "user", text, tools: [], streaming: false }],
				};
			}
			if (message.role !== "assistant") return state;

			const index = lastStreamingIndex(state.messages);
			const finished: ChatMessage = {
				id: index >= 0 ? state.messages[index]!.id : nextId(),
				role: "assistant",
				// message_end carries the full text, so it replaces accumulated deltas
				// rather than appending - otherwise a provider that sends both doubles it.
				text: textOf(message),
				error: message.errorMessage,
				tools: toolCallsOf(message).map((call) => ({ id: call.id, name: call.name })),
				streaming: false,
			};
			const messages = index >= 0 ? [...state.messages] : [...state.messages, finished];
			if (index >= 0) messages[index] = finished;
			return { ...state, messages, error: message.errorMessage ?? state.error };
		}

		case "tool_execution_start": {
			const name = typeof event.toolName === "string" ? event.toolName : "tool";
			const id = typeof event.toolCallId === "string" ? event.toolCallId : name;
			if (state.runningTools.some((tool) => tool.id === id)) return state;
			return { ...state, runningTools: [...state.runningTools, { id, name }] };
		}

		case "tool_execution_end": {
			const id = typeof event.toolCallId === "string" ? event.toolCallId : undefined;
			if (!id) return state;
			return { ...state, runningTools: state.runningTools.filter((tool) => tool.id !== id) };
		}

		case "agent_settled":
			return { ...state, active: false, runningTools: [] };

		case "session_exit":
			return { ...state, active: false, runningTools: [], error: "session exited" };

		default:
			return state;
	}
}

function lastStreamingIndex(messages: ChatMessage[]): number {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index]!;
		if (message.role === "assistant" && message.streaming) return index;
	}
	return -1;
}

/** Fold a whole event sequence, for replaying history. */
export function reduceAll(events: RawEvent[], initial: TurnState = emptyTurnState()): TurnState {
	return events.reduce(reduceTurn, initial);
}
