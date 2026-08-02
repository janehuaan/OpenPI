import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ContextCandidate } from "../../contract.ts";
import { createCandidate, queryTerms } from "../utils.ts";

function messageText(message: AgentMessage): string {
	if (!("content" in message)) return "";
	if (typeof message.content === "string") return message.content;
	return message.content
		.filter((part) => part.type === "text")
		.map((part) => part.text)
		.join("\n");
}

export function collectConversationCandidates(messages: AgentMessage[], query: string, limit = 8): ContextCandidate[] {
	const terms = queryTerms(query);
	return messages
		.slice(-24)
		.map((message, index) => ({ text: messageText(message), index }))
		.filter(({ text }) => text.length > 0 && terms.some((term) => text.toLowerCase().includes(term)))
		.slice(-limit)
		.map(({ text, index }) =>
			createCandidate(
				"conversation",
				`conversation:${index}`,
				`Recent message ${index + 1}`,
				text.slice(0, 12_000),
				"conversation",
				{ recency: (index + 1) / 24 },
			),
		);
}
