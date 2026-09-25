import Foundation
import OpenPIProtocol
#if canImport(Darwin)
import Darwin
#elseif canImport(Glibc)
import Glibc
#endif

public actor SocketServer {
    public let socketPath: String
    private let supervisor: Supervisor
    private var serverFd: Int32 = -1
    private var isRunning = false
    private let startTime = Date()

    public init(socketPath: String? = nil, supervisor: Supervisor) {
        if let path = socketPath {
            self.socketPath = path
        } else {
            let home = FileManager.default.homeDirectoryForCurrentUser.path
            let envPath = ProcessInfo.processInfo.environment["OPENPI_SOCKET"]
            self.socketPath = envPath ?? "\(home)/.openpi/openpi.sock"
        }
        self.supervisor = supervisor
    }

    public func start() throws {
        // Ensure parent directory exists
        let socketURL = URL(fileURLWithPath: socketPath)
        try FileManager.default.createDirectory(at: socketURL.deletingLastPathComponent(), withIntermediateDirectories: true)

        // Remove old socket file
        if FileManager.default.fileExists(atPath: socketPath) {
            try? FileManager.default.removeItem(atPath: socketPath)
        }

        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else {
            throw IPCClientError.socketCreationFailed(errno)
        }

        var addr = sockaddr_un()
        addr.sun_family = sa_family_t(AF_UNIX)

        withUnsafeMutablePointer(to: &addr.sun_path) { ptr in
            let raw = UnsafeMutableRawPointer(ptr).assumingMemoryBound(to: CChar.self)
            _ = socketPath.withCString { cstr in
                strcpy(raw, cstr)
            }
        }

        let addrLen = socklen_t(MemoryLayout<sockaddr_un>.size)
        let bindRes = withUnsafePointer(to: &addr) { ptr in
            ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockPtr in
                Darwin.bind(fd, sockPtr, addrLen)
            }
        }

        guard bindRes == 0 else {
            let err = errno
            close(fd)
            throw IPCClientError.connectionFailed(socketPath, err)
        }

        guard Darwin.listen(fd, 128) == 0 else {
            let err = errno
            close(fd)
            throw IPCClientError.connectionFailed(socketPath, err)
        }

        self.serverFd = fd
        self.isRunning = true
        print("⚡️ OpenPI Swift Daemon listening on: \(socketPath)")

        Task.detached { [weak self] in
            await self?.acceptLoop()
        }
    }

    public func stop() {
        isRunning = false
        if serverFd >= 0 {
            close(serverFd)
            serverFd = -1
        }
        try? FileManager.default.removeItem(atPath: socketPath)
    }

    private func acceptLoop() async {
        while isRunning {
            var clientAddr = sockaddr_un()
            var clientLen = socklen_t(MemoryLayout<sockaddr_un>.size)

            let clientFd = withUnsafeMutablePointer(to: &clientAddr) { ptr in
                ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockPtr in
                    Darwin.accept(serverFd, sockPtr, &clientLen)
                }
            }

            guard clientFd >= 0 else {
                if !isRunning { break }
                continue
            }

            Task.detached { [weak self, clientFd] in
                await self?.handleClient(clientFd: clientFd)
            }
        }
    }

    private func handleClient(clientFd: Int32) async {
        defer { close(clientFd) }

        var subscribedSessions = Set<String>()
        var buffer = Data()
        var readBuf = [UInt8](repeating: 0, count: 8192)

        // Subscribe to supervisor events
        let eventStream = await supervisor.subscribeEvents()
        let streamTask = Task.detached { [clientFd] in
            for await (sid, evt) in eventStream {
                let msg = ServerMessage.event(sessionId: sid, event: evt)
                if let encoded = try? JSONLinesCodec.encode(msg) {
                    encoded.withUnsafeBytes { ptr in
                        guard let base = ptr.baseAddress else { return }
                        _ = Darwin.send(clientFd, base, ptr.count, 0)
                    }
                }
            }
        }

        defer { streamTask.cancel() }

        while isRunning {
            let bytesRead = Darwin.recv(clientFd, &readBuf, readBuf.count, 0)
            if bytesRead <= 0 { break }

            let chunk = Data(readBuf[0..<bytesRead])
            let (lines, rest) = JSONLinesCodec.decodeLines(buffer: buffer, newChunk: chunk)
            buffer = rest

            for line in lines {
                let decodeRes = JSONLinesCodec.parseJSON(line, as: ClientRequest.self)
                switch decodeRes {
                case .success(let request):
                    let response = await self.processRequest(request, clientFd: clientFd, subscribed: &subscribedSessions)
                    if let respData = try? JSONLinesCodec.encode(response) {
                        respData.withUnsafeBytes { ptr in
                            guard let base = ptr.baseAddress else { return }
                            _ = Darwin.send(clientFd, base, ptr.count, 0)
                        }
                    }
                case .failure(let err):
                    let errMsg = ServerMessage.errorResponse(id: "unknown", error: "Invalid JSON: \(err.localizedDescription)")
                    if let errData = try? JSONLinesCodec.encode(errMsg) {
                        errData.withUnsafeBytes { ptr in
                            guard let base = ptr.baseAddress else { return }
                            _ = Darwin.send(clientFd, base, ptr.count, 0)
                        }
                    }
                }
            }
        }
    }

    private func processRequest(
        _ request: ClientRequest,
        clientFd: Int32,
        subscribed: inout Set<String>
    ) async -> ServerMessage {
        _ = request.requestId

        switch request {
        case .health(let id):
            let sessions = await supervisor.listSessions()
            let uptime = Date().timeIntervalSince(startTime) * 1000.0
            let health = HealthInfo(
                ok: true,
                pid: Int(ProcessInfo.processInfo.processIdentifier),
                version: "0.2.0-swift",
                cliMtimeMs: 0,
                cliPath: supervisor.rpcEntryPath,
                sessionCount: sessions.count,
                runningCount: sessions.filter { $0.running }.count,
                uptimeMs: uptime
            )
            if let enc = try? JSONEncoder().encode(health),
               let val = try? JSONDecoder().decode(JSONValue.self, from: enc) {
                return .successResponse(id: id, data: val)
            }
            return .successResponse(id: id, data: .object(["ok": .bool(true)]))

        case .shutdown(let id):
            Task {
                try? await Task.sleep(nanoseconds: 100_000_000)
                self.stop()
                exit(0)
            }
            return .successResponse(id: id, data: .object(["shutdown": .bool(true)]))

        case .listSessions(let id):
            let sessions = await supervisor.listSessions()
            if let enc = try? JSONEncoder().encode(sessions),
               let val = try? JSONDecoder().decode(JSONValue.self, from: enc) {
                return .successResponse(id: id, data: val)
            }
            return .successResponse(id: id, data: .array([]))

        case .createSession(let id, let cwd, let mode, let model, let name, let inMemory):
            do {
                let info = try await supervisor.createSession(
                    cwd: cwd,
                    mode: mode ?? .code,
                    model: model,
                    name: name,
                    inMemory: inMemory
                )
                if let enc = try? JSONEncoder().encode(info),
                   let val = try? JSONDecoder().decode(JSONValue.self, from: enc) {
                    return .successResponse(id: id, data: val)
                }
                return .successResponse(id: id, data: .object(["sessionId": .string(info.sessionId)]))
            } catch {
                return .errorResponse(id: id, error: error.localizedDescription)
            }

        case .stopSession(let id, let sessionId):
            let ok = await supervisor.stopSession(sessionId: sessionId)
            return .successResponse(id: id, data: .object(["ok": .bool(ok)]))

        case .deleteSession(let id, let sessionId):
            let ok = await supervisor.deleteSession(sessionId: sessionId)
            return .successResponse(id: id, data: .object(["ok": .bool(ok)]))

        case .renameSession(let id, let sessionId, let name):
            let ok = await supervisor.renameSession(sessionId: sessionId, name: name)
            return .successResponse(id: id, data: .object(["ok": .bool(ok)]))

        case .updateSessionWorkspace(let id, let sessionId, let cwd):
            let ok = await supervisor.updateSessionWorkspace(sessionId: sessionId, cwd: cwd)
            return .successResponse(id: id, data: .object(["ok": .bool(ok)]))

        case .subscribe(let id, let sessionId):
            subscribed.insert(sessionId)
            return .successResponse(id: id, data: .object(["subscribed": .string(sessionId)]))

        case .unsubscribe(let id, let sessionId):
            subscribed.remove(sessionId)
            return .successResponse(id: id, data: .object(["unsubscribed": .string(sessionId)]))

        case .rpc(let id, let sessionId, let command):
            do {
                try await supervisor.forwardRpc(sessionId: sessionId, command: command)
                return .successResponse(id: id, data: .object(["forwarded": .bool(true)]))
            } catch {
                return .errorResponse(id: id, error: error.localizedDescription)
            }

        case .app(let id, let op):
            let res = await AppOpsHandler.handle(op: op)
            switch res {
            case .success(let val):
                return .successResponse(id: id, data: val)
            case .failure(let err):
                return .errorResponse(id: id, error: err.localizedDescription)
            }
        }
    }
}
