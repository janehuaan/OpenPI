import Foundation
import OpenPIProtocol

public actor SessionInstance {
    public private(set) var info: SessionInfo
    private var process: Process?
    private var stdinPipe: Pipe?
    private var stdoutPipe: Pipe?
    private var stderrPipe: Pipe?
    private var isRunning: Bool = false
    private let eventHandler: @Sendable (String, [String: JSONValue]) -> Void

    public init(
        info: SessionInfo,
        eventHandler: @escaping @Sendable (String, [String: JSONValue]) -> Void
    ) {
        self.info = info
        self.eventHandler = eventHandler
    }

    public func start(nodeExecutable: String, rpcEntryPath: String) throws {
        guard process == nil else { return }

        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: nodeExecutable)
        proc.arguments = [rpcEntryPath, "--mode", "rpc"]
        proc.currentDirectoryURL = URL(fileURLWithPath: info.cwd)

        var env = ProcessInfo.processInfo.environment
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let agentDir = env["PI_CODING_AGENT_DIR"] ?? "\(home)/.openpi/agent"
        env["PI_CODING_AGENT_DIR"] = agentDir
        proc.environment = env

        let inPipe = Pipe()
        let outPipe = Pipe()
        let errPipe = Pipe()

        proc.standardInput = inPipe
        proc.standardOutput = outPipe
        proc.standardError = errPipe

        let sessionId = info.sessionId
        let handler = self.eventHandler

        outPipe.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            guard !data.isEmpty else { return }

            let (lines, _) = JSONLinesCodec.decodeLines(buffer: Data(), newChunk: data)
            for line in lines {
                if let dict = try? JSONDecoder().decode([String: JSONValue].self, from: line) {
                    handler(sessionId, dict)
                }
            }
        }

        errPipe.fileHandleForReading.readabilityHandler = { handle in
            let _ = handle.availableData
        }

        proc.terminationHandler = { [weak self] p in
            Task { [weak self] in
                await self?.handleTermination(status: p.terminationStatus)
            }
        }

        try proc.run()
        self.process = proc
        self.stdinPipe = inPipe
        self.stdoutPipe = outPipe
        self.stderrPipe = errPipe
        self.isRunning = true
    }

    private func handleTermination(status: Int32) {
        self.isRunning = false
        self.process = nil
        self.stdinPipe = nil
        self.stdoutPipe?.fileHandleForReading.readabilityHandler = nil
        self.stderrPipe?.fileHandleForReading.readabilityHandler = nil
    }

    public func sendCommand(_ command: [String: JSONValue]) throws {
        guard let inPipe = stdinPipe, isRunning else {
            throw IPCClientError.connectionClosed
        }
        let data = try JSONLinesCodec.encode(command)
        inPipe.fileHandleForWriting.write(data)
    }

    public func stop() {
        if let proc = process, proc.isRunning {
            proc.terminate()
        }
        handleTermination(status: 0)
    }

    public func updateName(_ newName: String) {
        let now = ISO8601DateFormatter().string(from: Date())
        self.info = SessionInfo(
            sessionId: info.sessionId,
            cwd: info.cwd,
            mode: info.mode,
            name: newName,
            model: info.model,
            inMemory: info.inMemory,
            running: isRunning,
            createdAt: info.createdAt,
            updatedAt: now
        )
    }

    public func updateCwd(_ newCwd: String) {
        let now = ISO8601DateFormatter().string(from: Date())
        self.info = SessionInfo(
            sessionId: info.sessionId,
            cwd: newCwd,
            mode: info.mode,
            name: info.name,
            model: info.model,
            inMemory: info.inMemory,
            running: isRunning,
            createdAt: info.createdAt,
            updatedAt: now
        )
    }

    public func updateMode(_ newMode: SessionMode) {
        let now = ISO8601DateFormatter().string(from: Date())
        self.info = SessionInfo(
            sessionId: info.sessionId,
            cwd: info.cwd,
            mode: newMode,
            name: info.name,
            model: info.model,
            inMemory: info.inMemory,
            running: isRunning,
            createdAt: info.createdAt,
            updatedAt: now
        )
    }

    public func toSessionInfo() -> SessionInfo {
        return SessionInfo(
            sessionId: info.sessionId,
            cwd: info.cwd,
            mode: info.mode,
            name: info.name,
            model: info.model,
            inMemory: info.inMemory,
            running: isRunning,
            createdAt: info.createdAt,
            updatedAt: info.updatedAt
        )
    }
}

public actor Supervisor {
    private var sessions: [String: SessionInstance] = [:]
    private var eventContinuations: [UUID: AsyncStream<(sessionId: String, event: [String: JSONValue])>.Continuation] = [:]
    public let nodeExecutable: String
    public let rpcEntryPath: String

    public init() {
        let (node, _) = Supervisor.resolveNodeExecutable()
        self.nodeExecutable = node
        self.rpcEntryPath = Supervisor.resolvePiRpcEntry()
    }

    public func createSession(
        cwd: String,
        mode: SessionMode = .code,
        model: String? = nil,
        name: String? = nil,
        inMemory: Bool? = nil
    ) async throws -> SessionInfo {
        let sid = UUID().uuidString.lowercased()
        let now = ISO8601DateFormatter().string(from: Date())

        let info = SessionInfo(
            sessionId: sid,
            cwd: cwd,
            mode: mode,
            name: name ?? "Session \(sid.prefix(6))",
            model: model,
            inMemory: inMemory,
            running: true,
            createdAt: now,
            updatedAt: now
        )

        let instance = SessionInstance(info: info) { [weak self] sId, evt in
            Task { [weak self] in
                await self?.broadcastEvent(sessionId: sId, event: evt)
            }
        }

        if !rpcEntryPath.isEmpty && FileManager.default.fileExists(atPath: nodeExecutable) {
            try? await instance.start(nodeExecutable: nodeExecutable, rpcEntryPath: rpcEntryPath)
        }

        sessions[sid] = instance
        return await instance.toSessionInfo()
    }

    public func listSessions() async -> [SessionInfo] {
        var list: [SessionInfo] = []
        for (_, instance) in sessions {
            list.append(await instance.toSessionInfo())
        }
        return list.sorted { $0.createdAt > $1.createdAt }
    }

    public func stopSession(sessionId: String) async -> Bool {
        guard let instance = sessions[sessionId] else { return false }
        await instance.stop()
        return true
    }

    public func deleteSession(sessionId: String) async -> Bool {
        guard let instance = sessions.removeValue(forKey: sessionId) else { return false }
        await instance.stop()
        return true
    }

    public func renameSession(sessionId: String, name: String) async -> Bool {
        guard let instance = sessions[sessionId] else { return false }
        await instance.updateName(name)
        return true
    }

    public func updateSessionWorkspace(sessionId: String, cwd: String) async -> Bool {
        guard let instance = sessions[sessionId] else { return false }
        await instance.updateCwd(cwd)
        return true
    }

    public func forwardRpc(sessionId: String, command: [String: JSONValue]) async throws {
        guard let instance = sessions[sessionId] else {
            throw IPCClientError.responseError("Session \(sessionId) not found")
        }
        try await instance.sendCommand(command)
    }

    public func subscribeEvents() -> AsyncStream<(sessionId: String, event: [String: JSONValue])> {
        let id = UUID()
        return AsyncStream { continuation in
            continuation.onTermination = { [weak self] _ in
                Task { [weak self] in
                    await self?.removeEventContinuation(id: id)
                }
            }
            self.eventContinuations[id] = continuation
        }
    }

    private func removeEventContinuation(id: UUID) {
        eventContinuations.removeValue(forKey: id)
    }

    private func broadcastEvent(sessionId: String, event: [String: JSONValue]) {
        for cont in eventContinuations.values {
            cont.yield((sessionId: sessionId, event: event))
        }
    }

    public static func resolveNodeExecutable() -> (String, Bool) {
        if let p = ProcessInfo.processInfo.environment["OPENPI_NODE_PATH"], FileManager.default.fileExists(atPath: p) {
            return (p, p.lowercased().contains("electron"))
        }

        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let candidates = [
            "/Applications/OpenPI.app/Contents/MacOS/OpenPI",
            "\(home)/.local/bin/node",
            "/opt/homebrew/bin/node",
            "/usr/local/bin/node",
            "/usr/bin/node"
        ]
        for c in candidates {
            if FileManager.default.fileExists(atPath: c) {
                return (c, c.lowercased().contains("electron"))
            }
        }
        return ("/usr/local/bin/node", false)
    }

    public static func resolvePiRpcEntry() -> String {
        if let p = ProcessInfo.processInfo.environment["OPENPI_PI_RPC_ENTRY"], FileManager.default.fileExists(atPath: p) {
            return p
        }

        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let candidates = [
            "/usr/local/lib/node_modules/@earendil-works/pi-coding-agent/dist/bundle/rpc-entry.js",
            "\(home)/.openpi/agent/rpc-entry.js",
            "./dist/bundle/rpc-entry.js"
        ]
        for c in candidates {
            if FileManager.default.fileExists(atPath: c) {
                return c
            }
        }
        return ""
    }
}
