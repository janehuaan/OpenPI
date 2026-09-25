export type DecisionType = "choice" | "score" | "noul";

export interface ChoiceQuestion {
	type: "choice";
	instructions: string;
	criteria: Record<string, string>;
}

export interface ScoreQuestion {
	type: "score";
	instructions: string;
	levels: string[];
}

export interface NoulQuestion {
	type: "noul";
	instructions: string;
	criteria?: {
		false?: string;
		true?: string;
	};
}

export type DecisionQuestion = ChoiceQuestion | ScoreQuestion | NoulQuestion;

export interface ChoiceAnswer {
	type: "choice";
	choice: string;
	probabilities: Record<string, number>;
	confidence: number;
}

export interface ScoreAnswer {
	type: "score";
	score: number;
	probabilities: Record<string, number>;
	confidence: number;
}

export interface NoulAnswer {
	type: "noul";
	noul: number; // Probability of true (0.0 - 1.0)
	confidence: number;
}

export type DecisionAnswer = ChoiceAnswer | ScoreAnswer | NoulAnswer;

export interface DecisionResult {
	model: string;
	latencyMs: number;
	answers: Record<string, DecisionAnswer>;
}

export interface SentinelCheckResult {
	isDangerous: boolean;
	riskScore: number; // 0.0 to 1.0
	reason?: string;
	matchedRule?: string;
}

export interface ModeRoutingResult {
	mode: "chat" | "code";
	confidence: number;
	requiresWorkspace: boolean;
	reason: string;
}

export interface RoutingContext {
	cwd?: string;
	hasWorkspace?: boolean;
	previousMode?: "chat" | "code";
	lastToolUsed?: string;
	activeFile?: string;
}

export interface VerificationResult {
	passed: boolean;
	isLooping: boolean;
	severity: "info" | "warning" | "error";
	correctiveHint?: string;
}
