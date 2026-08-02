import { spawn } from "node:child_process";
import { constants, existsSync, accessSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { app, systemPreferences } from "electron";
import { normalizeSpeechLanguage, parseSpeechHelperEvent } from "./speech-protocol.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

let activeSession;

function helperPath() {
	const candidates = [
		...(app.isPackaged || !process.env.OPENPI_SPEECH_HELPER_PATH
			? []
			: [process.env.OPENPI_SPEECH_HELPER_PATH]),
		join(process.resourcesPath ?? "", "speech-recognizer"),
		join(__dirname, "../build/speech-recognizer"),
	];
	for (const candidate of candidates) {
		if (!candidate || !existsSync(candidate)) continue;
		try {
			accessSync(candidate, constants.X_OK);
			return candidate;
		} catch {
			// Continue to the development fallback.
		}
	}
	return undefined;
}

function errorMessage(code, detail) {
	switch (code) {
		case "speech-permission-denied":
			return "没有语音识别权限，请在系统设置的隐私与安全性中允许 OpenPI 使用语音识别";
		case "microphone-permission-denied":
			return "没有麦克风权限，请在系统设置的隐私与安全性中允许 OpenPI 使用麦克风";
		case "recognizer-unavailable":
			return "系统语音识别当前不可用，请确认已安装中文听写语言";
		case "language-not-supported":
			return "当前系统语言不支持语音识别";
		case "audio-input-unavailable":
			return "没有检测到可用的麦克风";
		case "audio-engine-failed":
			return `麦克风启动失败${detail ? `：${detail}` : ""}`;
		case "model-missing":
			return "本地语音模型缺失，请重新安装当前版本的 OpenPI";
		case "model-load-failed":
			return "本地语音模型加载失败，请重新安装当前版本的 OpenPI";
		case "transcription-failed":
			return "本地语音识别失败，请重新启动 OpenPI 后重试";
		default:
			return `语音识别失败${detail ? `：${detail}` : ""}`;
	}
}

function sendEvent(sender, sessionId, event) {
	if (sender.isDestroyed()) return;
	sender.send("openpi:speech-event", { ...event, sessionId });
}

function terminateSession(session) {
	if (!session.child) return;
	try {
		session.child.stdin.write("stop\n");
	} catch {
		// The helper may already be closing.
	}
	const timer = setTimeout(() => {
		if (!session.child.killed) session.child.kill("SIGTERM");
	}, 800);
	timer.unref();
}

export function stopSpeechRecognitionHelper() {
	const session = activeSession;
	activeSession = undefined;
	if (session) terminateSession(session);
}

export function registerSpeechBridge(ipcMain, getMainWindow) {
	ipcMain.handle("openpi:start_speech_recognition", async (event, args = {}) => {
		const window = getMainWindow();
		if (!window || event.sender !== window.webContents) throw new Error("Invalid speech recognition sender");
		if (process.platform !== "darwin") throw new Error("语音输入目前仅支持 macOS");

		const sessionId = typeof args.sessionId === "string" ? args.sessionId.trim() : "";
		if (!sessionId || sessionId.length > 128) throw new Error("Invalid speech recognition session");
		const executable = helperPath();
		if (!executable) throw new Error("语音组件未构建，请重新安装当前版本的 OpenPI");
		stopSpeechRecognitionHelper();
		const session = {
			child: undefined,
			id: sessionId,
			sender: event.sender,
			sawEnd: false,
			sawError: false,
			stderr: "",
		};
		activeSession = session;

		if (systemPreferences.getMediaAccessStatus("microphone") !== "granted") {
			const granted = await systemPreferences.askForMediaAccess("microphone");
			if (activeSession !== session) return true;
			if (!granted) {
				activeSession = undefined;
				throw new Error("没有麦克风权限，请在系统设置中允许 OpenPI 使用麦克风");
			}
		}
		if (activeSession !== session) return true;

		const language = normalizeSpeechLanguage(args.language);
		const child = spawn(executable, [language], { stdio: ["pipe", "pipe", "pipe"] });
		session.child = child;
		const lines = createInterface({ input: child.stdout });
		lines.on("line", (line) => {
			if (activeSession !== session) return;
			const helperEvent = parseSpeechHelperEvent(line);
			if (!helperEvent) return;
			if (helperEvent.type === "error") {
				session.sawError = true;
				sendEvent(session.sender, session.id, {
					type: "error",
					message: errorMessage(helperEvent.code, helperEvent.detail),
				});
				return;
			}
			if (helperEvent.type === "end") session.sawEnd = true;
			sendEvent(session.sender, session.id, helperEvent);
		});
		child.stderr.on("data", (chunk) => {
			session.stderr = `${session.stderr}${chunk.toString()}`.slice(-2_000);
		});
		child.on("error", (error) => {
			if (activeSession !== session) return;
			session.sawError = true;
			sendEvent(session.sender, session.id, { type: "error", message: `语音组件启动失败：${error.message}` });
		});
		child.on("close", (code) => {
			if (activeSession !== session) return;
			if (code && !session.sawError) {
				sendEvent(session.sender, session.id, {
					type: "error",
					message: errorMessage("recognition-failed", session.stderr.trim()),
				});
			}
			if (!session.sawEnd) sendEvent(session.sender, session.id, { type: "end" });
			activeSession = undefined;
		});
		return true;
	});

	ipcMain.handle("openpi:stop_speech_recognition", async (_event, args = {}) => {
		if (activeSession && activeSession.id === args.sessionId) stopSpeechRecognitionHelper();
		return true;
	});
}
