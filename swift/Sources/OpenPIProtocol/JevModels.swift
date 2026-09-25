import Foundation

public enum JevProviderType: String, Codable, Sendable, CaseIterable, Identifiable {
    case typesafe = "typesafe"
    case openrouter = "openrouter"
    case local = "local"
    case heuristic = "heuristic"

    public var id: String { rawValue }

    public var displayName: String {
        switch self {
        case .typesafe: return "TypeSafe AI (官方原厂)"
        case .openrouter: return "OpenRouter (typesafe/jev)"
        case .local: return "本地推理 (poorjev / llama.cpp)"
        case .heuristic: return "内置原生离线后备"
        }
    }

    public var defaultEndpoint: String {
        switch self {
        case .typesafe: return "https://api.typesafe.ai/v1"
        case .openrouter: return "https://openrouter.ai/api/v1"
        case .local: return "http://127.0.0.1:8000/v1"
        case .heuristic: return "internal://heuristic"
        }
    }

    public var defaultModel: String {
        switch self {
        case .typesafe: return "jev-1"
        case .openrouter: return "typesafe/jev"
        case .local: return "poorjev-nli"
        case .heuristic: return "native-fast"
        }
    }
}

public struct JevConfig: Codable, Sendable {
    public var provider: JevProviderType
    public var endpoint: String
    public var apiKey: String
    public var modelName: String
    public var timeoutMs: Int
    public var isEnabled: Bool

    public init(
        provider: JevProviderType = .heuristic,
        endpoint: String = JevProviderType.heuristic.defaultEndpoint,
        apiKey: String = "",
        modelName: String = JevProviderType.heuristic.defaultModel,
        timeoutMs: Int = 3000,
        isEnabled: Bool = true
    ) {
        self.provider = provider
        self.endpoint = endpoint
        self.apiKey = apiKey
        self.modelName = modelName
        self.timeoutMs = timeoutMs
        self.isEnabled = isEnabled
    }
}

public struct JevChoiceRequest: Codable, Sendable {
    public let context: String
    public let choices: [String]
    public let instruction: String?

    public init(context: String, choices: [String], instruction: String? = nil) {
        self.context = context
        self.choices = choices
        self.instruction = instruction
    }
}

public struct JevChoiceResponse: Codable, Sendable {
    public let selected: String
    public let confidence: Double
    public let probabilities: [String: Double]
    public let latencyMs: Double
    public let provider: String

    public init(
        selected: String,
        confidence: Double,
        probabilities: [String: Double],
        latencyMs: Double,
        provider: String
    ) {
        self.selected = selected
        self.confidence = confidence
        self.probabilities = probabilities
        self.latencyMs = latencyMs
        self.provider = provider
    }
}

public struct JevNoulRequest: Codable, Sendable {
    public let context: String
    public let question: String

    public init(context: String, question: String) {
        self.context = context
        self.question = question
    }
}

public struct JevNoulResponse: Codable, Sendable {
    public let verdict: Bool
    public let confidence: Double
    public let latencyMs: Double
    public let provider: String

    public init(
        verdict: Bool,
        confidence: Double,
        latencyMs: Double,
        provider: String
    ) {
        self.verdict = verdict
        self.confidence = confidence
        self.latencyMs = latencyMs
        self.provider = provider
    }
}

public struct JevScoreRequest: Codable, Sendable {
    public let context: String
    public let criterion: String

    public init(context: String, criterion: String) {
        self.context = context
        self.criterion = criterion
    }
}

public struct JevScoreResponse: Codable, Sendable {
    public let score: Double
    public let reasoning: String?
    public let latencyMs: Double
    public let provider: String

    public init(
        score: Double,
        reasoning: String? = nil,
        latencyMs: Double,
        provider: String
    ) {
        self.score = score
        self.reasoning = reasoning
        self.latencyMs = latencyMs
        self.provider = provider
    }
}
