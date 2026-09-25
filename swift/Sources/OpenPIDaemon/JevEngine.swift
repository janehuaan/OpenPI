import Foundation
import OpenPIProtocol

public actor JevEngine {
    public static let shared = JevEngine()

    private var config: JevConfig

    private init() {
        let configFile = AppOpsHandler.agentDir().appendingPathComponent("jev.json")
        if let data = try? Data(contentsOf: configFile),
           let loaded = try? JSONDecoder().decode(JevConfig.self, from: data) {
            self.config = loaded
        } else {
            self.config = JevConfig(
                provider: .heuristic,
                endpoint: JevProviderType.heuristic.defaultEndpoint,
                apiKey: "",
                modelName: JevProviderType.heuristic.defaultModel,
                timeoutMs: 3000,
                isEnabled: true
            )
        }
    }

    public func getConfig() -> JevConfig {
        return config
    }

    public func updateConfig(_ newConfig: JevConfig) {
        self.config = newConfig
        saveConfigToDisk()
    }

    private func saveConfigToDisk() {
        let dir = AppOpsHandler.agentDir()
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let file = dir.appendingPathComponent("jev.json")
        if let data = try? JSONEncoder().encode(config) {
            try? data.write(to: file, options: .atomic)
        }
    }

    // MARK: - Primitives: Choice (Discrete Selection)

    public func decide(context: String, choices: [String], instruction: String? = nil) async -> JevChoiceResponse {
        let startTime = CFAbsoluteTimeGetCurrent()
        guard !choices.isEmpty else {
            let latency = (CFAbsoluteTimeGetCurrent() - startTime) * 1000.0
            return JevChoiceResponse(selected: "", confidence: 0.0, probabilities: [:], latencyMs: latency, provider: "empty")
        }

        if choices.count == 1 {
            let latency = (CFAbsoluteTimeGetCurrent() - startTime) * 1000.0
            return JevChoiceResponse(selected: choices[0], confidence: 1.0, probabilities: [choices[0]: 1.0], latencyMs: latency, provider: "single")
        }

        switch config.provider {
        case .typesafe, .openrouter, .local:
            if let remoteRes = await callRemoteDecide(context: context, choices: choices, instruction: instruction, startTime: startTime) {
                return remoteRes
            }
            // Fallback to heuristic
            return heuristicDecide(context: context, choices: choices, instruction: instruction, startTime: startTime, isFallback: true)

        case .heuristic:
            return heuristicDecide(context: context, choices: choices, instruction: instruction, startTime: startTime, isFallback: false)
        }
    }

    // MARK: - Primitives: Noul (Boolean / Binary Verdict)

    public func noul(context: String, question: String) async -> JevNoulResponse {
        let startTime = CFAbsoluteTimeGetCurrent()

        switch config.provider {
        case .typesafe, .openrouter, .local:
            if let remoteRes = await callRemoteNoul(context: context, question: question, startTime: startTime) {
                return remoteRes
            }
            return heuristicNoul(context: context, question: question, startTime: startTime, isFallback: true)

        case .heuristic:
            return heuristicNoul(context: context, question: question, startTime: startTime, isFallback: false)
        }
    }

    // MARK: - Primitives: Score (Evaluation Metric)

    public func score(context: String, criterion: String) async -> JevScoreResponse {
        let startTime = CFAbsoluteTimeGetCurrent()

        switch config.provider {
        case .typesafe, .openrouter, .local:
            if let remoteRes = await callRemoteScore(context: context, criterion: criterion, startTime: startTime) {
                return remoteRes
            }
            return heuristicScore(context: context, criterion: criterion, startTime: startTime, isFallback: true)

        case .heuristic:
            return heuristicScore(context: context, criterion: criterion, startTime: startTime, isFallback: false)
        }
    }

    // MARK: - Remote HTTP Calling

    private func callRemoteDecide(
        context: String,
        choices: [String],
        instruction: String?,
        startTime: CFAbsoluteTime
    ) async -> JevChoiceResponse? {
        guard let url = URL(string: "\(config.endpoint)/decide") else { return nil }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if !config.apiKey.isEmpty {
            request.setValue("Bearer \(config.apiKey)", forHTTPHeaderField: "Authorization")
        }
        request.timeoutInterval = Double(config.timeoutMs) / 1000.0

        let payload: [String: Any] = [
            "model": config.modelName,
            "context": context,
            "choices": choices,
            "instruction": instruction as Any
        ]

        guard let bodyData = try? JSONSerialization.data(withJSONObject: payload) else { return nil }
        request.httpBody = bodyData

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
                return nil
            }
            if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let selected = json["selected"] as? String {
                let conf = (json["confidence"] as? Double) ?? 0.85
                let probs = (json["probabilities"] as? [String: Double]) ?? [selected: conf]
                let latency = (CFAbsoluteTimeGetCurrent() - startTime) * 1000.0
                return JevChoiceResponse(
                    selected: selected,
                    confidence: conf,
                    probabilities: probs,
                    latencyMs: latency,
                    provider: config.provider.rawValue
                )
            }
        } catch {
            // Error caught; fallback will be used
        }
        return nil
    }

    private func callRemoteNoul(
        context: String,
        question: String,
        startTime: CFAbsoluteTime
    ) async -> JevNoulResponse? {
        guard let url = URL(string: "\(config.endpoint)/noul") else { return nil }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if !config.apiKey.isEmpty {
            request.setValue("Bearer \(config.apiKey)", forHTTPHeaderField: "Authorization")
        }
        request.timeoutInterval = Double(config.timeoutMs) / 1000.0

        let payload: [String: Any] = [
            "model": config.modelName,
            "context": context,
            "question": question
        ]
        guard let bodyData = try? JSONSerialization.data(withJSONObject: payload) else { return nil }
        request.httpBody = bodyData

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
                return nil
            }
            if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let verdict = json["verdict"] as? Bool {
                let conf = (json["confidence"] as? Double) ?? 0.88
                let latency = (CFAbsoluteTimeGetCurrent() - startTime) * 1000.0
                return JevNoulResponse(
                    verdict: verdict,
                    confidence: conf,
                    latencyMs: latency,
                    provider: config.provider.rawValue
                )
            }
        } catch {
            // Error caught; fallback will be used
        }
        return nil
    }

    private func callRemoteScore(
        context: String,
        criterion: String,
        startTime: CFAbsoluteTime
    ) async -> JevScoreResponse? {
        guard let url = URL(string: "\(config.endpoint)/score") else { return nil }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if !config.apiKey.isEmpty {
            request.setValue("Bearer \(config.apiKey)", forHTTPHeaderField: "Authorization")
        }
        request.timeoutInterval = Double(config.timeoutMs) / 1000.0

        let payload: [String: Any] = [
            "model": config.modelName,
            "context": context,
            "criterion": criterion
        ]
        guard let bodyData = try? JSONSerialization.data(withJSONObject: payload) else { return nil }
        request.httpBody = bodyData

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
                return nil
            }
            if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let val = json["score"] as? Double {
                let reasoning = json["reasoning"] as? String
                let latency = (CFAbsoluteTimeGetCurrent() - startTime) * 1000.0
                return JevScoreResponse(
                    score: val,
                    reasoning: reasoning,
                    latencyMs: latency,
                    provider: config.provider.rawValue
                )
            }
        } catch {
            // Error caught; fallback will be used
        }
        return nil
    }

    // MARK: - Native Ultra-Fast Heuristic Engine (Offline / Fallback)

    private func heuristicDecide(
        context: String,
        choices: [String],
        instruction: String?,
        startTime: CFAbsoluteTime,
        isFallback: Bool
    ) -> JevChoiceResponse {
        var rawScores: [String: Double] = [:]
        let lowerCtx = context.lowercased()
        let lowerInstr = (instruction ?? "").lowercased()

        // 1. Scoring each choice based on token affinity and semantics
        for choice in choices {
            let lowerC = choice.lowercased()
            var score = 1.0 // base prior

            // Direct occurrences
            if lowerCtx.contains(lowerC) { score += 4.0 }
            if lowerInstr.contains(lowerC) { score += 6.0 }

            // Semantic mappings for common agent decisions:
            if lowerC.contains("inline") || lowerC.contains("agile") {
                // Inline favors small changes, single files, simple questions
                if lowerCtx.contains("修复") || lowerCtx.contains("修改") || lowerCtx.contains("创建") || lowerCtx.contains("fix") || lowerCtx.contains("test") {
                    score += 5.0
                }
                if lowerCtx.count < 300 { score += 3.0 }
            } else if lowerC.contains("subagent") || lowerC.contains("delegate") {
                // Subagent favors large refactor, multi-file audit, background scrape
                if lowerCtx.contains("大规模") || lowerCtx.contains("全量") || lowerCtx.contains("重构") || lowerCtx.contains("调研") || lowerCtx.contains("audit") {
                    score += 6.0
                }
                if lowerCtx.count > 1000 { score += 3.0 }
            } else if lowerC.contains("dangerous") || lowerC.contains("deny") || lowerC.contains("risk") {
                if lowerCtx.contains("rm -rf") || lowerCtx.contains("drop table") || lowerCtx.contains("force push") || lowerCtx.contains("sudo") {
                    score += 15.0
                }
            } else if lowerC.contains("safe") || lowerC.contains("allow") {
                if !lowerCtx.contains("rm -rf") && !lowerCtx.contains("sudo") && (lowerCtx.contains("cat ") || lowerCtx.contains("ls") || lowerCtx.contains("git status") || lowerCtx.contains("swift build")) {
                    score += 8.0
                }
            }

            rawScores[choice] = score
        }

        // 2. Softmax normalization for calibrated probabilities
        let maxScore = rawScores.values.max() ?? 1.0
        var expScores: [String: Double] = [:]
        var sumExp: Double = 0.0

        for (k, v) in rawScores {
            let e = exp((v - maxScore) / 2.0)
            expScores[k] = e
            sumExp += e
        }

        var probabilities: [String: Double] = [:]
        var bestChoice = choices[0]
        var bestProb: Double = 0.0

        for (k, v) in expScores {
            let p = (v / (sumExp > 0 ? sumExp : 1.0) * 1000).rounded() / 1000.0
            probabilities[k] = p
            if p > bestProb {
                bestProb = p
                bestChoice = k
            }
        }

        let latency = max(1.2, (CFAbsoluteTimeGetCurrent() - startTime) * 1000.0)
        let providerTag = isFallback ? "fallback:heuristic" : "native:heuristic"

        return JevChoiceResponse(
            selected: bestChoice,
            confidence: bestProb,
            probabilities: probabilities,
            latencyMs: latency,
            provider: providerTag
        )
    }

    private func heuristicNoul(
        context: String,
        question: String,
        startTime: CFAbsoluteTime,
        isFallback: Bool
    ) -> JevNoulResponse {
        let lowerCtx = context.lowercased()
        let lowerQ = question.lowercased()

        var confidence: Double = 0.88
        var verdict = false

        // High-risk command detection
        if lowerQ.contains("danger") || lowerQ.contains("risk") || lowerQ.contains("破坏") || lowerQ.contains("危险") {
            let highRiskPatterns = ["rm -rf", "rmdir", "mkfs", "dd if=", "> /dev/", "git reset --hard", "git clean -f", "drop database", "drop table", "shutdown", "reboot", "chmod 777"]
            for pat in highRiskPatterns {
                if lowerCtx.contains(pat) {
                    verdict = true
                    confidence = 0.98
                    break
                }
            }
            if !verdict && (lowerCtx.contains("git push") || lowerCtx.contains("curl") || lowerCtx.contains("wget")) {
                verdict = false
                confidence = 0.72
            }
        } else if lowerQ.contains("pass") || lowerQ.contains("success") || lowerQ.contains("通过") || lowerQ.contains("正确") {
            if lowerCtx.contains("error") || lowerCtx.contains("failed") || lowerCtx.contains("fatal") || lowerCtx.contains("exception") {
                verdict = false
                confidence = 0.94
            } else if lowerCtx.contains("success") || lowerCtx.contains("build complete") || lowerCtx.contains("passed") {
                verdict = true
                confidence = 0.96
            } else {
                verdict = true
                confidence = 0.65
            }
        } else {
            // General query: check word overlap
            let qWords = lowerQ.split(separator: " ").filter { $0.count > 2 }
            let matches = qWords.filter { lowerCtx.contains($0) }.count
            verdict = matches > (qWords.count / 3)
            confidence = min(0.92, 0.5 + Double(matches) * 0.1)
        }

        let latency = max(0.8, (CFAbsoluteTimeGetCurrent() - startTime) * 1000.0)
        let providerTag = isFallback ? "fallback:heuristic" : "native:heuristic"

        return JevNoulResponse(
            verdict: verdict,
            confidence: confidence,
            latencyMs: latency,
            provider: providerTag
        )
    }

    private func heuristicScore(
        context: String,
        criterion: String,
        startTime: CFAbsoluteTime,
        isFallback: Bool
    ) -> JevScoreResponse {
        let lowerCtx = context.lowercased()
        let lowerCrit = criterion.lowercased()

        // Overlap score
        let critWords = lowerCrit.components(separatedBy: CharacterSet.alphanumerics.inverted).filter { $0.count > 1 }
        var matches = 0
        for w in critWords {
            if lowerCtx.contains(w) {
                matches += 1
            }
        }

        var score = critWords.isEmpty ? 0.5 : Double(matches) / Double(critWords.count)
        score = min(1.0, max(0.05, (score * 100).rounded() / 100.0))

        let latency = max(1.0, (CFAbsoluteTimeGetCurrent() - startTime) * 1000.0)
        let providerTag = isFallback ? "fallback:heuristic" : "native:heuristic"

        return JevScoreResponse(
            score: score,
            reasoning: "Keyword alignment factor: \(matches)/\(critWords.count)",
            latencyMs: latency,
            provider: providerTag
        )
    }

    // MARK: - Specialized Agent Guardrails & Routers

    public static func checkCommandRisk(command: String) async -> (isDangerous: Bool, reason: String, confidence: Double) {
        let res = await JevEngine.shared.noul(
            context: command,
            question: "Is this shell command potentially destructive or irreversible to the system or repository?"
        )
        return (res.verdict, res.verdict ? "检测到潜在不可逆或高危系统操作" : "常规安全指令", res.confidence)
    }

    public static func classifyTaskDispatch(prompt: String) async -> (target: String, confidence: Double) {
        let choices = ["inline_agile", "subagent_delegate", "chat_question"]
        let res = await JevEngine.shared.decide(
            context: prompt,
            choices: choices,
            instruction: "根据研发准则裁决：小步单文件修复/配置首选 inline_agile；复杂多模块大规模调研选 subagent_delegate；纯技术咨询选 chat_question"
        )
        return (res.selected, res.confidence)
    }
}
