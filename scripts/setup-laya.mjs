import { existsSync, mkdirSync, createWriteStream, statSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";

const MODEL_DIR = join(homedir(), ".openpi", "models", "laya");
const BASE_URL = "https://huggingface.co/soyelmismo/laya-multilingual-onnx/resolve/main";

const FILES = [
	{ name: "rl_agent_config.json", expectedMinSize: 100 },
	{ name: "tokenizer.json", expectedMinSize: 1000 * 1000 },
	{ name: "model.onnx", expectedMinSize: 100 * 1024 * 1024 },
];

async function downloadFile(name, minSize) {
	const dest = join(MODEL_DIR, name);
	if (existsSync(dest) && statSync(dest).size >= minSize) {
		console.log(`[Laya Setup] ${name} already present (${(statSync(dest).size / (1024 * 1024)).toFixed(1)} MB)`);
		return;
	}

	const url = `${BASE_URL}/${name}`;
	console.log(`[Laya Setup] Downloading ${name} from HuggingFace...`);
	const res = await fetch(url, { redirect: "follow" });
	if (!res.ok) {
		throw new Error(`Failed to download ${name}: ${res.status} ${res.statusText}`);
	}

	const totalBytes = Number(res.headers.get("content-length")) || 0;
	let downloaded = 0;
	let lastReport = Date.now();

	const fileStream = createWriteStream(dest);
	const reader = res.body.getReader();

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			fileStream.write(Buffer.from(value));
			downloaded += value.length;
			if (Date.now() - lastReport > 1500) {
				const pct = totalBytes ? ` (${((downloaded / totalBytes) * 100).toFixed(1)}%)` : "";
				console.log(`[Laya Setup] ${name}: ${(downloaded / (1024 * 1024)).toFixed(1)} MB${pct}`);
				lastReport = Date.now();
			}
		}
		fileStream.end();
		console.log(`[Laya Setup] Successfully downloaded ${name} (${(downloaded / (1024 * 1024)).toFixed(1)} MB)`);
	} catch (err) {
		fileStream.close();
		if (existsSync(dest)) unlinkSync(dest);
		throw err;
	}
}

async function main() {
	mkdirSync(MODEL_DIR, { recursive: true });
	console.log(`[Laya Setup] Target directory: ${MODEL_DIR}`);
	for (const f of FILES) {
		await downloadFile(f.name, f.expectedMinSize);
	}
	console.log("[Laya Setup] All Laya model assets ready!");
}

main().catch((err) => {
	console.error("[Laya Setup Error]", err);
	process.exit(1);
});
