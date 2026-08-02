import AVFoundation
import Darwin
import Foundation
import whisper

private let outputLock = NSLock()

private func emit(_ event: [String: Any]) {
	guard JSONSerialization.isValidJSONObject(event),
		let data = try? JSONSerialization.data(withJSONObject: event),
		let newline = "\n".data(using: .utf8)
	else {
		return
	}
	outputLock.lock()
	defer { outputLock.unlock() }
	FileHandle.standardOutput.write(data)
	FileHandle.standardOutput.write(newline)
}

private func microphoneAuthorizationName(_ status: AVAuthorizationStatus) -> String {
	switch status {
	case .authorized: return "authorized"
	case .denied: return "denied"
	case .restricted: return "restricted"
	case .notDetermined: return "not-determined"
	@unknown default: return "unknown"
	}
}

private func resolvedModelPath() -> String {
	if let configured = ProcessInfo.processInfo.environment["OPENPI_SPEECH_MODEL_PATH"], !configured.isEmpty {
		return configured
	}
	let executable = URL(fileURLWithPath: CommandLine.arguments[0]).standardizedFileURL
	return executable.deletingLastPathComponent().appendingPathComponent("ggml-small-q5_1.bin").path
}

private func resolvedVADModelPath() -> String {
	if let configured = ProcessInfo.processInfo.environment["OPENPI_SPEECH_VAD_MODEL_PATH"], !configured.isEmpty {
		return configured
	}
	let executable = URL(fileURLWithPath: CommandLine.arguments[0]).standardizedFileURL
	return executable.deletingLastPathComponent().appendingPathComponent("ggml-silero-v6.2.0.bin").path
}

private func whisperLanguage(from identifier: String) -> String {
	let language = identifier.split(separator: "-", maxSplits: 1).first.map(String.init)?.lowercased() ?? "zh"
	return language == "zh" ? "zh" : language
}

private func isCJK(_ character: Character) -> Bool {
	guard let scalar = character.unicodeScalars.first else { return false }
	return (0x3400 ... 0x9FFF).contains(scalar.value) || (0xF900 ... 0xFAFF).contains(scalar.value)
}

private func joinTranscript(_ base: String, _ addition: String) -> String {
	let next = addition.trimmingCharacters(in: .whitespacesAndNewlines)
	guard !next.isEmpty else { return base }
	guard !base.isEmpty else { return next }
	guard let last = base.last, let first = next.first else { return base + next }
	if last.isWhitespace || isCJK(last) || isCJK(first) || "，。！？、：；,.!?;:".contains(first) {
		return base + next
	}
	return base + " " + next
}

private enum SessionInitializationError: Error {
	case modelMissing
	case modelLoadFailed
}

private struct RecognitionWork {
	let samples: [Float]
	let isFinal: Bool
}

private final class WhisperSession {
	private static let sampleRate = 16_000
	private static let preRollSamples = sampleRate / 4
	private static let minimumVoiceSamples = sampleRate / 4
	private static let minimumInferenceSamples = sampleRate * 3 / 4
	private static let finalizeSilenceSamples = sampleRate * 3 / 5
	private static let maximumUtteranceSamples = sampleRate * 12
	private static let inferenceInterval = DispatchTimeInterval.milliseconds(600)

	private let language: String
	private let audioEngine = AVAudioEngine()
	private let stateLock = NSLock()
	private let recognitionQueue = DispatchQueue(label: "works.earendil.openpi.whisper", qos: .userInitiated)
	private var context: OpaquePointer?
	private var vadContext: OpaquePointer?
	private var converter: AVAudioConverter?
	private var outputFormat: AVAudioFormat?
	private var inferenceTimer: DispatchSourceTimer?
	private var tapInstalled = false
	private var stopping = false
	private var finished = false

	private var preRoll: [Float] = []
	private var utterance: [Float] = []
	private var voiceActive = false
	private var voicedSamples = 0
	private var silenceSamples = 0
	private var sampleVersion = 0
	private var scheduledVersion = 0
	private var vadPending: [Float] = []
	private var vadSpeechHoldFrames = 0

	private var committedTranscript = ""
	private var currentPartialTranscript = ""
	private var lastEmittedTranscript = ""

	init(language: String, modelPath: String, vadModelPath: String) throws {
		guard FileManager.default.isReadableFile(atPath: modelPath),
			FileManager.default.isReadableFile(atPath: vadModelPath)
		else {
			throw SessionInitializationError.modelMissing
		}
		self.language = whisperLanguage(from: language)
		var parameters = whisper_context_default_params()
		parameters.use_gpu = false
		parameters.flash_attn = false
		guard let loadedContext = modelPath.withCString({
			whisper_init_from_file_with_params($0, parameters)
		}) else {
			throw SessionInitializationError.modelLoadFailed
		}
		var vadParameters = whisper_vad_default_context_params()
		vadParameters.n_threads = 2
		vadParameters.use_gpu = false
		guard let loadedVADContext = vadModelPath.withCString({
			whisper_vad_init_from_file_with_params($0, vadParameters)
		}) else {
			whisper_free(loadedContext)
			throw SessionInitializationError.modelLoadFailed
		}
		context = loadedContext
		vadContext = loadedVADContext
	}

	deinit {
		if let context {
			whisper_free(context)
		}
		if let vadContext {
			whisper_vad_free(vadContext)
		}
	}

	func authorizeAndStart() {
		requestMicrophoneAuthorization { [weak self] granted in
			guard let self else { return }
			guard granted else {
				self.fail(code: "microphone-permission-denied")
				return
			}
			self.startRecording()
		}
	}

	func stop() {
		guard !stopping, !finished else { return }
		stopping = true
		stopAudio()
		inferenceTimer?.cancel()
		inferenceTimer = nil
		recognitionQueue.async { [weak self] in
			self?.finalizeAndExit()
		}
	}

	private func requestMicrophoneAuthorization(completion: @escaping (Bool) -> Void) {
		switch AVCaptureDevice.authorizationStatus(for: .audio) {
		case .authorized:
			completion(true)
		case .notDetermined:
			AVCaptureDevice.requestAccess(for: .audio) { granted in
				DispatchQueue.main.async { completion(granted) }
			}
		default:
			completion(false)
		}
	}

	private func startRecording() {
		guard !finished, !stopping else { return }
		let inputNode = audioEngine.inputNode
		let inputFormat = inputNode.outputFormat(forBus: 0)
		guard inputFormat.sampleRate > 0, inputFormat.channelCount > 0,
			let targetFormat = AVAudioFormat(
				commonFormat: .pcmFormatFloat32,
				sampleRate: Double(Self.sampleRate),
				channels: 1,
				interleaved: false
			),
			let audioConverter = AVAudioConverter(from: inputFormat, to: targetFormat)
		else {
			fail(code: "audio-input-unavailable")
			return
		}
		converter = audioConverter
		outputFormat = targetFormat

		inputNode.installTap(onBus: 0, bufferSize: 1_024, format: inputFormat) { [weak self] buffer, _ in
			guard let self, let samples = self.convert(buffer) else { return }
			self.append(samples)
		}
		tapInstalled = true

		do {
			audioEngine.prepare()
			try audioEngine.start()
			startInferenceTimer()
			emit(["type": "start", "onDevice": true, "engine": "whisper.cpp"])
		} catch {
			fail(code: "audio-engine-failed", detail: error.localizedDescription)
		}
	}

	private func convert(_ input: AVAudioPCMBuffer) -> [Float]? {
		guard let converter, let outputFormat else { return nil }
		let ratio = outputFormat.sampleRate / input.format.sampleRate
		let capacity = AVAudioFrameCount(ceil(Double(input.frameLength) * ratio)) + 32
		guard let output = AVAudioPCMBuffer(pcmFormat: outputFormat, frameCapacity: capacity) else { return nil }
		var suppliedInput = false
		var conversionError: NSError?
		let status = converter.convert(to: output, error: &conversionError) { _, inputStatus in
			if suppliedInput {
				inputStatus.pointee = .noDataNow
				return nil
			}
			suppliedInput = true
			inputStatus.pointee = .haveData
			return input
		}
		guard status != .error, conversionError == nil, let channel = output.floatChannelData?[0] else {
			return nil
		}
		return Array(UnsafeBufferPointer(start: channel, count: Int(output.frameLength)))
	}

	private func append(_ samples: [Float]) {
		guard !samples.isEmpty else { return }
		let containsVoice = detectVoice(in: samples)

		stateLock.lock()
		defer { stateLock.unlock() }
		guard !stopping, !finished else { return }

		if !voiceActive {
			preRoll.append(contentsOf: samples)
			if preRoll.count > Self.preRollSamples {
				preRoll.removeFirst(preRoll.count - Self.preRollSamples)
			}
			guard containsVoice else { return }
			voiceActive = true
			utterance = preRoll
			preRoll.removeAll(keepingCapacity: true)
			voicedSamples = samples.count
			silenceSamples = 0
			sampleVersion += 1
			return
		}

		utterance.append(contentsOf: samples)
		if containsVoice {
			voicedSamples += samples.count
			silenceSamples = 0
		} else {
			silenceSamples += samples.count
		}
		sampleVersion += 1
	}

	private func detectVoice(in samples: [Float]) -> Bool {
		guard let vadContext else { return false }
		vadPending.append(contentsOf: samples)
		var detected = false
		while vadPending.count >= 512 {
			let frame = Array(vadPending.prefix(512))
			vadPending.removeFirst(512)
			let frameDetected = frame.withUnsafeBufferPointer { buffer in
				whisper_vad_detect_speech_no_reset(vadContext, buffer.baseAddress, Int32(buffer.count))
			}
			if frameDetected {
				detected = true
				vadSpeechHoldFrames = 6
			} else if vadSpeechHoldFrames > 0 {
				vadSpeechHoldFrames -= 1
			}
		}
		return detected || vadSpeechHoldFrames > 0
	}

	private func startInferenceTimer() {
		let timer = DispatchSource.makeTimerSource(queue: recognitionQueue)
		timer.schedule(
			deadline: .now() + Self.inferenceInterval,
			repeating: Self.inferenceInterval,
			leeway: .milliseconds(50)
		)
		timer.setEventHandler { [weak self] in
			self?.processNextWork()
		}
		timer.resume()
		inferenceTimer = timer
	}

	private func takeWork(forceFinal: Bool = false) -> RecognitionWork? {
		stateLock.lock()
		defer { stateLock.unlock() }
		guard voiceActive, voicedSamples >= Self.minimumVoiceSamples else {
			if forceFinal {
				resetUtteranceLocked()
			}
			return nil
		}

		let shouldFinalize =
			forceFinal ||
			silenceSamples >= Self.finalizeSilenceSamples ||
			utterance.count >= Self.maximumUtteranceSamples
		if shouldFinalize {
			let samples = utterance
			let tail = Array(utterance.suffix(Self.preRollSamples))
			resetUtteranceLocked()
			preRoll = tail
			return RecognitionWork(samples: samples, isFinal: true)
		}

		guard utterance.count >= Self.minimumInferenceSamples, sampleVersion != scheduledVersion else {
			return nil
		}
		scheduledVersion = sampleVersion
		return RecognitionWork(samples: utterance, isFinal: false)
	}

	private func resetUtteranceLocked() {
		utterance.removeAll(keepingCapacity: true)
		voiceActive = false
		voicedSamples = 0
		silenceSamples = 0
		scheduledVersion = sampleVersion
	}

	private func processNextWork() {
		guard !finished, let work = takeWork() else { return }
		guard let transcript = transcribe(work.samples) else {
			DispatchQueue.main.async { [weak self] in
				self?.fail(code: "transcription-failed")
			}
			return
		}
		apply(transcript: transcript, finalizingUtterance: work.isFinal)
	}

	private func transcribe(_ samples: [Float]) -> String? {
		guard let context else { return nil }
		var parameters = whisper_full_default_params(WHISPER_SAMPLING_GREEDY)
		parameters.n_threads = Int32(max(2, min(8, ProcessInfo.processInfo.activeProcessorCount - 2)))
		parameters.translate = false
		parameters.no_context = true
		parameters.no_timestamps = true
		parameters.single_segment = false
		parameters.print_special = false
		parameters.print_progress = false
		parameters.print_realtime = false
		parameters.print_timestamps = false
		parameters.suppress_blank = true
		parameters.suppress_nst = true
		parameters.temperature = 0
		parameters.temperature_inc = 0

		let prompt = "OpenPI，代码，模型，项目，工作区，Claude，Codex，GPT，Agnes"
		let result = language.withCString { languagePointer in
			prompt.withCString { promptPointer in
				parameters.language = languagePointer
				parameters.initial_prompt = promptPointer
				return samples.withUnsafeBufferPointer { buffer in
					whisper_full(context, parameters, buffer.baseAddress, Int32(buffer.count))
				}
			}
		}
		guard result == 0 else { return nil }

		var transcript = ""
		let segmentCount = Int(whisper_full_n_segments(context))
		for index in 0 ..< segmentCount {
			guard let text = whisper_full_get_segment_text(context, Int32(index)) else { continue }
			transcript += String(cString: text)
		}
		let normalized = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
		let ignored = ["[BLANK_AUDIO]", "[SILENCE]", "(silence)", "（无声）"]
		return ignored.contains(normalized) ? "" : normalized
	}

	private func apply(transcript: String, finalizingUtterance: Bool) {
		if finalizingUtterance {
			let finalized = transcript.isEmpty ? currentPartialTranscript : transcript
			committedTranscript = joinTranscript(committedTranscript, finalized)
			currentPartialTranscript = ""
			emitTranscript(committedTranscript, isFinal: false)
			return
		}
		guard !transcript.isEmpty else { return }
		currentPartialTranscript = transcript
		emitTranscript(joinTranscript(committedTranscript, currentPartialTranscript), isFinal: false)
	}

	private func emitTranscript(_ transcript: String, isFinal: Bool) {
		guard !transcript.isEmpty, transcript != lastEmittedTranscript || isFinal else { return }
		lastEmittedTranscript = transcript
		emit(["type": "result", "transcript": transcript, "isFinal": isFinal])
	}

	private func finalizeAndExit() {
		if let work = takeWork(forceFinal: true), let transcript = transcribe(work.samples) {
			apply(transcript: transcript, finalizingUtterance: true)
		}
		let finalTranscript = joinTranscript(committedTranscript, currentPartialTranscript)
		if !finalTranscript.isEmpty {
			emitTranscript(finalTranscript, isFinal: true)
		}
		finish(exitCode: 0)
	}

	private func fail(code: String, detail: String? = nil) {
		guard !finished else { return }
		stopping = true
		stopAudio()
		inferenceTimer?.cancel()
		inferenceTimer = nil
		var event: [String: Any] = ["type": "error", "code": code]
		if let detail, !detail.isEmpty {
			event["detail"] = detail
		}
		emit(event)
		finish(exitCode: 2)
	}

	private func stopAudio() {
		if audioEngine.isRunning {
			audioEngine.stop()
		}
		if tapInstalled {
			audioEngine.inputNode.removeTap(onBus: 0)
			tapInstalled = false
		}
	}

	private func finish(exitCode: Int32) {
		guard !finished else { return }
		finished = true
		if let context {
			whisper_free(context)
			self.context = nil
		}
		if let vadContext {
			whisper_vad_free(vadContext)
			self.vadContext = nil
		}
		emit(["type": "end"])
		FileHandle.standardOutput.synchronizeFile()
		DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
			exit(exitCode)
		}
	}
}

@main
private struct SpeechRecognizerMain {
	static func main() {
		let arguments = Array(CommandLine.arguments.dropFirst())
		let language = arguments.first(where: { !$0.hasPrefix("--") }) ?? "zh-CN"
		let modelPath = resolvedModelPath()
		let vadModelPath = resolvedVADModelPath()
		if arguments.contains("--probe") {
			emit([
				"type": "probe",
				"available": FileManager.default.isReadableFile(atPath: modelPath) &&
					FileManager.default.isReadableFile(atPath: vadModelPath),
				"engine": "whisper.cpp",
				"engineVersion": String(cString: whisper_version()),
				"model": URL(fileURLWithPath: modelPath).lastPathComponent,
				"vadModel": URL(fileURLWithPath: vadModelPath).lastPathComponent,
				"microphoneAuthorization": microphoneAuthorizationName(
					AVCaptureDevice.authorizationStatus(for: .audio)
				),
			])
			return
		}

		let session: WhisperSession
		do {
			session = try WhisperSession(language: language, modelPath: modelPath, vadModelPath: vadModelPath)
		} catch SessionInitializationError.modelMissing {
			emit(["type": "error", "code": "model-missing"])
			emit(["type": "end"])
			exit(2)
		} catch {
			emit(["type": "error", "code": "model-load-failed"])
			emit(["type": "end"])
			exit(2)
		}

		FileHandle.standardInput.readabilityHandler = { handle in
			let data = handle.availableData
			guard !data.isEmpty, let command = String(data: data, encoding: .utf8) else { return }
			if command.contains("stop") {
				DispatchQueue.main.async { session.stop() }
			}
		}
		session.authorizeAndStart()
		RunLoop.main.run()
	}
}
