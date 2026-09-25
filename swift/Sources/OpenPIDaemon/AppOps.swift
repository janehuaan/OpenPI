import Foundation
import OpenPIProtocol

public struct AppOpsHandler: Sendable {
    public static func openpiDir() -> URL {
        if let p = ProcessInfo.processInfo.environment["OPENPI_DIR"] {
            return URL(fileURLWithPath: p)
        }
        let home = FileManager.default.homeDirectoryForCurrentUser
        return home.appendingPathComponent(".openpi")
    }

    public static func agentDir() -> URL {
        return openpiDir().appendingPathComponent("agent")
    }

    public static func handle(op: AppOp) async -> Result<JSONValue?, Error> {
        switch op {
        case .listModels:
            return .success(listModels())
        case .authStatus:
            return .success(authStatus())
        case .importGlobalCredentials:
            return .success(importGlobalCredentials())
        case .defaultWorkspace:
            let home = FileManager.default.homeDirectoryForCurrentUser.path
            return .success(.string(home))
        case .recentWorkspaces:
            return .success(.array([.string(FileManager.default.homeDirectoryForCurrentUser.path)]))
        case .workspaceSummary(let cwd):
            return .success(workspaceSummary(cwd: cwd))
        case .extractDocument(let fileName, _):
            return .success(.object([
                "name": .string(fileName),
                "text": .string(""),
                "truncated": .bool(false)
            ]))
        case .jevDecide(let context, let choices, let instruction):
            let res = await JevEngine.shared.decide(context: context, choices: choices, instruction: instruction)
            if let data = try? JSONEncoder().encode(res),
               let obj = try? JSONDecoder().decode([String: JSONValue].self, from: data) {
                return .success(.object(obj))
            }
            return .success(.object(["selected": .string(res.selected), "confidence": .number(res.confidence)]))

        case .jevNoul(let context, let question):
            let res = await JevEngine.shared.noul(context: context, question: question)
            if let data = try? JSONEncoder().encode(res),
               let obj = try? JSONDecoder().decode([String: JSONValue].self, from: data) {
                return .success(.object(obj))
            }
            return .success(.object(["verdict": .bool(res.verdict), "confidence": .number(res.confidence)]))

        case .jevScore(let context, let criterion):
            let res = await JevEngine.shared.score(context: context, criterion: criterion)
            if let data = try? JSONEncoder().encode(res),
               let obj = try? JSONDecoder().decode([String: JSONValue].self, from: data) {
                return .success(.object(obj))
            }
            return .success(.object(["score": .number(res.score)]))

        case .jevGetConfig:
            let config = await JevEngine.shared.getConfig()
            if let data = try? JSONEncoder().encode(config),
               let obj = try? JSONDecoder().decode([String: JSONValue].self, from: data) {
                return .success(.object(obj))
            }
            return .success(.object(["provider": .string(config.provider.rawValue)]))

        case .jevUpdateConfig(let config):
            await JevEngine.shared.updateConfig(config)
            return .success(.object(["ok": .bool(true)]))

        default:
            return .success(.object(["ok": .bool(true)]))
        }
    }

    private static func listModels() -> JSONValue {
        let modelsFile = agentDir().appendingPathComponent("models.json")
        if let data = try? Data(contentsOf: modelsFile),
           let obj = try? JSONDecoder().decode([String: JSONValue].self, from: data) {
            return .object(obj)
        }

        // Default standard models catalog
        let defaultCatalog: [String: JSONValue] = [
            "providers": .array([
                .object(["provider": .string("anthropic"), "modelCount": .number(3), "configured": .bool(true)]),
                .object(["provider": .string("openai"), "modelCount": .number(4), "configured": .bool(true)]),
                .object(["provider": .string("gemini"), "modelCount": .number(3), "configured": .bool(true)])
            ]),
            "models": .array([
                .object(["provider": .string("anthropic"), "modelId": .string("claude-3-7-sonnet"), "ref": .string("anthropic/claude-3-7-sonnet")]),
                .object(["provider": .string("openai"), "modelId": .string("gpt-4o"), "ref": .string("openai/gpt-4o")]),
                .object(["provider": .string("gemini"), "modelId": .string("gemini-2.5-pro"), "ref": .string("gemini/gemini-2.5-pro")])
            ])
        ]
        return .object(defaultCatalog)
    }

    private static func authStatus() -> JSONValue {
        let authFile = agentDir().appendingPathComponent("auth.json")
        if let data = try? Data(contentsOf: authFile),
           let obj = try? JSONDecoder().decode([String: JSONValue].self, from: data) {
            return .object(obj)
        }
        return .object(["authenticated": .bool(true), "providers": .array([])])
    }

    private static func importGlobalCredentials() -> JSONValue {
        let home = FileManager.default.homeDirectoryForCurrentUser
        let sourceDir = home.appendingPathComponent(".pi/agent")
        let targetDir = agentDir()

        guard FileManager.default.fileExists(atPath: sourceDir.path) else {
            return .object(["imported": .bool(false), "reason": .string("~/.pi/agent does not exist")])
        }

        try? FileManager.default.createDirectory(at: targetDir, withIntermediateDirectories: true)
        let files = ["models.json", "auth.json", "models-store.json"]
        var count = 0

        for file in files {
            let src = sourceDir.appendingPathComponent(file)
            let dst = targetDir.appendingPathComponent(file)
            if FileManager.default.fileExists(atPath: src.path) {
                try? FileManager.default.removeItem(at: dst)
                if (try? FileManager.default.copyItem(at: src, to: dst)) != nil {
                    count += 1
                }
            }
        }
        return .object(["imported": .bool(true), "copiedFilesCount": .number(Double(count))])
    }

    private static func workspaceSummary(cwd: String) -> JSONValue {
        let exists = FileManager.default.fileExists(atPath: cwd)
        let gitPath = URL(fileURLWithPath: cwd).appendingPathComponent(".git")
        let isGit = FileManager.default.fileExists(atPath: gitPath.path)

        return .object([
            "cwd": .string(cwd),
            "exists": .bool(exists),
            "isGitRepo": .bool(isGit),
            "fileCount": .number(0),
            "hasMemory": .bool(false),
            "memoryCount": .number(0)
        ])
    }
}
