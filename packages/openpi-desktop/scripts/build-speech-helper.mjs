#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmodSync,
	createReadStream,
	createWriteStream,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WHISPER_VERSION = "v1.9.1";
const WHISPER_RUNTIME_SHA256 = "8c3ecbe73f48b0cb9318fc3058264f951ab336fd530e82c4ccdd2298d1311a4c";
const WHISPER_MODEL_SHA256 = "ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb";
const WHISPER_MODEL_COMMIT = "5359861c739e955e79d9a303bcbc70fb988958b1";
const WHISPER_VAD_SHA256 = "2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987";
const WHISPER_VAD_COMMIT = "9ffd54a1e1ee413ddf265af9913beaf518d1639b";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(desktopRoot, "native", "speech-recognizer.swift");
const buildDir = join(desktopRoot, "build");
const cacheDir = join(buildDir, "speech-cache");
const framework = join(buildDir, "whisper.framework");
const frameworkBinary = join(framework, "Versions", "A", "whisper");
const frameworkMarker = join(buildDir, "whisper-framework.sha256");
const model = join(buildDir, "ggml-small-q5_1.bin");
const vadModel = join(buildDir, "ggml-silero-v6.2.0.bin");
const output = join(buildDir, "speech-recognizer");
const runtimeArchive = join(cacheDir, `whisper-${WHISPER_VERSION}-xcframework.zip`);
const runtimeUrl = `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_VERSION}/whisper-${WHISPER_VERSION}-xcframework.zip`;
const modelUrl = `https://huggingface.co/ggerganov/whisper.cpp/resolve/${WHISPER_MODEL_COMMIT}/ggml-small-q5_1.bin`;
const vadModelUrl = `https://huggingface.co/ggml-org/whisper-vad/resolve/${WHISPER_VAD_COMMIT}/ggml-silero-v6.2.0.bin`;

if (process.platform !== "darwin") {
	console.warn("Local Whisper speech recognition is available on macOS only; skipping helper build.");
	process.exit(0);
}

if (!existsSync(source)) throw new Error(`Missing speech helper source: ${source}`);

async function sha256(path) {
	const hash = createHash("sha256");
	await new Promise((resolvePromise, rejectPromise) => {
		const stream = createReadStream(path);
		stream.on("data", (chunk) => hash.update(chunk));
		stream.on("end", resolvePromise);
		stream.on("error", rejectPromise);
	});
	return hash.digest("hex");
}

async function ensureDownload(url, destination, expectedHash, label) {
	if (existsSync(destination) && (await sha256(destination)) === expectedHash) {
		console.log(`${label} is verified: ${destination}`);
		return;
	}
	if (existsSync(destination)) rmSync(destination, { force: true });
	mkdirSync(dirname(destination), { recursive: true });
	const partial = `${destination}.download`;
	rmSync(partial, { force: true });
	console.log(`Downloading ${label}...`);
	const response = await fetch(url, {
		headers: { "user-agent": "OpenPI speech asset builder" },
		redirect: "follow",
	});
	if (!response.ok || !response.body) throw new Error(`${label} download failed: HTTP ${response.status}`);
	await pipeline(Readable.fromWeb(response.body), createWriteStream(partial, { mode: 0o644 }));
	const actualHash = await sha256(partial);
	if (actualHash !== expectedHash) {
		rmSync(partial, { force: true });
		throw new Error(`${label} checksum mismatch: expected ${expectedHash}, received ${actualHash}`);
	}
	renameSync(partial, destination);
	console.log(`Downloaded and verified ${label}: ${destination}`);
}

async function ensureFramework() {
	const marker = existsSync(frameworkMarker) ? readFileSync(frameworkMarker, "utf8").trim() : "";
	if (marker === WHISPER_RUNTIME_SHA256 && existsSync(frameworkBinary)) return;

	const extraction = join(cacheDir, "xcframework");
	rmSync(extraction, { recursive: true, force: true });
	mkdirSync(extraction, { recursive: true });
	execFileSync(
		"unzip",
		[
			"-q",
			runtimeArchive,
			"build-apple/whisper.xcframework/macos-arm64_x86_64/*",
			"-d",
			extraction,
		],
		{ stdio: "inherit" },
	);
	const extractedFramework = join(
		extraction,
		"build-apple",
		"whisper.xcframework",
		"macos-arm64_x86_64",
		"whisper.framework",
	);
	if (!existsSync(join(extractedFramework, "Versions", "A", "whisper"))) {
		throw new Error("Downloaded Whisper XCFramework does not contain the macOS runtime");
	}
	rmSync(framework, { recursive: true, force: true });
	execFileSync("ditto", [extractedFramework, framework], { stdio: "inherit" });
	writeFileSync(frameworkMarker, `${WHISPER_RUNTIME_SHA256}\n`);
}

mkdirSync(buildDir, { recursive: true });
await ensureDownload(runtimeUrl, runtimeArchive, WHISPER_RUNTIME_SHA256, `whisper.cpp ${WHISPER_VERSION}`);
await ensureFramework();
await ensureDownload(modelUrl, model, WHISPER_MODEL_SHA256, "Whisper small-q5_1 model");
await ensureDownload(vadModelUrl, vadModel, WHISPER_VAD_SHA256, "Silero v6.2 VAD model");

const needsBuild =
	!existsSync(output) ||
	statSync(output).mtimeMs < statSync(source).mtimeMs ||
	statSync(output).mtimeMs < statSync(frameworkBinary).mtimeMs;

if (needsBuild) {
	execFileSync(
		"xcrun",
		[
			"swiftc",
			"-swift-version",
			"5",
			"-O",
			"-parse-as-library",
			"-target",
			"x86_64-apple-macosx12.0",
			"-F",
			buildDir,
			"-framework",
			"whisper",
			"-Xlinker",
			"-rpath",
			"-Xlinker",
			"@executable_path",
			source,
			"-o",
			output,
		],
		{ stdio: "inherit" },
	);
	chmodSync(output, 0o755);
	console.log(`Built local Whisper speech helper: ${output}`);
} else {
	console.log(`Speech helper is up to date: ${output}`);
}

const probe = execFileSync(output, ["--probe", "zh-CN"], { encoding: "utf8" }).trim();
console.log(`Probe: ${probe}`);
