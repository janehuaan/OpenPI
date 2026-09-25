import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { DecisionQuestion, DecisionResult } from "./types.ts";

export interface LayaEngineConfig {
	modelDir?: string;
}

export class LayaONNXEngine {
	private session: any = null;
	private tokenizer: any = null;
	private modelDir: string;
	private isInitialized = false;
	private initPromise: Promise<void> | null = null;

	constructor(config?: LayaEngineConfig) {
		this.modelDir = config?.modelDir || join(homedir(), ".openpi", "models", "laya");
	}

	isAvailable(): boolean {
		const modelPath = join(this.modelDir, "model.onnx");
		const tokPath = join(this.modelDir, "tokenizer.json");
		return existsSync(modelPath) && existsSync(tokPath);
	}

	async initialize(): Promise<void> {
		if (this.isInitialized) return;
		if (this.initPromise) return this.initPromise;

		this.initPromise = (async () => {
			if (!this.isAvailable()) {
				throw new Error(`Laya ONNX model assets not found in ${this.modelDir}. Run setup script first.`);
			}

			// Dynamically import onnxruntime-node and tokenizers
			const ort = await import("onnxruntime-node");
			const { Tokenizer } = await import("tokenizers");

			const modelPath = join(this.modelDir, "model.onnx");
			const tokPath = join(this.modelDir, "tokenizer.json");

			this.tokenizer = Tokenizer.fromFile(tokPath);
			this.session = await ort.InferenceSession.create(modelPath);
			this.isInitialized = true;
		})();

		return this.initPromise;
	}

	async predict(state: string | Record<string, unknown>, questions: Record<string, DecisionQuestion>): Promise<DecisionResult> {
		await this.initialize();
		const ort = await import("onnxruntime-node");
		const tStart = performance.now();

		const CLS = 2;
		const SEP = 1;
		const MASK = 4;

		const encodeRaw = async (str: string): Promise<number[]> => {
			const enc = await this.tokenizer.encode(str);
			const ids: number[] = enc.getIds();
			let s = 0;
			let e = ids.length;
			if (ids[0] === CLS) s++;
			if (ids[e - 1] === SEP) e--;
			return ids.slice(s, e);
		};

		const stateStr = typeof state === "string" ? state : JSON.stringify(state);
		const answers: DecisionResult["answers"] = {};

		for (const [qid, q] of Object.entries(questions)) {
			let optStrings: string[] = [];
			let qtypeVal = 0n;

			if (q.type === "choice") {
				optStrings = Object.entries(q.criteria).map(([k, v]) => ` ${k}: ${v}`);
				qtypeVal = 0n;
			} else if (q.type === "score") {
				optStrings = q.levels.map((lvl, i) => ` level ${i}: ${lvl}`);
				qtypeVal = 1n;
			} else if (q.type === "noul") {
				optStrings = [
					` false: ${q.criteria?.false || "no, the statement does not hold"}`,
					` true: ${q.criteria?.true || "yes, the statement holds"}`,
				];
				qtypeVal = 2n;
			}

			const insIds = await encodeRaw(`${q.type} question: ${q.instructions}`);
			const optIds: number[][] = [];
			for (const opt of optStrings) {
				optIds.push([MASK, ...(await encodeRaw(opt))]);
			}

			const ids: number[] = [CLS, ...insIds, SEP];
			const markers: number[] = [];
			for (const o of optIds) {
				markers.push(ids.length);
				ids.push(...o);
			}
			ids.push(SEP);
			ids.push(...(await encodeRaw(stateStr)), SEP);

			const input_ids = new ort.Tensor("int64", BigInt64Array.from(ids.map(BigInt)), [1, ids.length]);
			const attention_mask = new ort.Tensor("int64", new BigInt64Array(ids.length).fill(1n), [1, ids.length]);
			const marker_pos = new ort.Tensor("int64", BigInt64Array.from(markers.map(BigInt)), [1, markers.length]);
			const marker_mask = new ort.Tensor("bool", new Uint8Array(markers.length).fill(1), [1, markers.length]);
			const qtype = new ort.Tensor("int64", new BigInt64Array([qtypeVal]), [1]);

			const res = await this.session.run({ input_ids, attention_mask, marker_pos, marker_mask, qtype });
			const logits: number[] = Array.from(res.logits.data as Float32Array).slice(0, markers.length);

			const maxL = Math.max(...logits);
			const exps = logits.map((l) => Math.exp(l - maxL));
			const sumExps = exps.reduce((a, b) => a + b, 0);
			const probs = exps.map((e) => e / sumExps);

			if (q.type === "choice") {
				const keys = Object.keys(q.criteria);
				let bestIdx = 0;
				let bestProb = 0;
				const probMap: Record<string, number> = {};
				keys.forEach((k, i) => {
					probMap[k] = probs[i];
					if (probs[i] > bestProb) {
						bestProb = probs[i];
						bestIdx = i;
					}
				});
				answers[qid] = {
					type: "choice",
					choice: keys[bestIdx] || keys[0],
					probabilities: probMap,
					confidence: bestProb,
				};
			} else if (q.type === "score") {
				let expScore = 0;
				const probMap: Record<string, number> = {};
				probs.forEach((p, i) => {
					expScore += i * p;
					probMap[String(i)] = p;
				});
				answers[qid] = {
					type: "score",
					score: expScore,
					probabilities: probMap,
					confidence: Math.max(...probs),
				};
			} else if (q.type === "noul") {
				answers[qid] = {
					type: "noul",
					noul: probs[1] ?? 0.5,
					confidence: Math.max(probs[0], probs[1]),
				};
			}
		}

		return {
			model: "convaiinnovations/laya-multilingual-onnx",
			latencyMs: Math.round(performance.now() - tStart),
			answers,
		};
	}
}
