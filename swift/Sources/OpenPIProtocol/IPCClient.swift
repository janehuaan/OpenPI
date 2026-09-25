import Foundation
#if canImport(Darwin)
import Darwin
#elseif canImport(Glibc)
import Glibc
#endif

public enum IPCClientError: Error, LocalizedError {
    case socketCreationFailed(Int32)
    case connectionFailed(String, Int32)
    case writeFailed(Int32)
    case connectionClosed
    case responseError(String)
    case requestTimeout(String)
    case invalidPath(String)

    public var errorDescription: String? {
        switch self {
        case .socketCreationFailed(let err):
            return "Failed to create socket: errno \(err)"
        case .connectionFailed(let path, let err):
            return "Failed to connect to socket at \(path): errno \(err)"
        case .writeFailed(let err):
            return "Failed to write to socket: errno \(err)"
        case .connectionClosed:
            return "Daemon connection closed"
        case .responseError(let msg):
            return "Daemon returned error: \(msg)"
        case .requestTimeout(let id):
            return "Request \(id) timed out"
        case .invalidPath(let path):
            return "Invalid socket path: \(path)"
        }
    }
}

public actor IPCClient {
    public let socketPath: String
    private var socketFd: Int32 = -1
    private var pendingRequests: [String: CheckedContinuation<JSONValue?, Error>] = [:]
    private var eventContinuations: [UUID: AsyncStream<(sessionId: String, event: [String: JSONValue])>.Continuation] = [:]
    private var isRunning = false
    private var readTask: Task<Void, Never>?

    public init(socketPath: String? = nil) {
        if let path = socketPath {
            self.socketPath = path
        } else {
            let home = FileManager.default.homeDirectoryForCurrentUser.path
            let envPath = ProcessInfo.processInfo.environment["OPENPI_SOCKET"]
            self.socketPath = envPath ?? "\(home)/.openpi/openpi.sock"
        }
    }

    public var isConnected: Bool {
        return socketFd >= 0 && isRunning
    }

    public func connect() throws {
        guard socketFd < 0 else { return }

        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else {
            throw IPCClientError.socketCreationFailed(errno)
        }

        var addr = sockaddr_un()
        addr.sun_family = sa_family_t(AF_UNIX)

        guard socketPath.utf8.count < MemoryLayout.size(ofValue: addr.sun_path) else {
            close(fd)
            throw IPCClientError.invalidPath(socketPath)
        }

        withUnsafeMutablePointer(to: &addr.sun_path) { ptr in
            let raw = UnsafeMutableRawPointer(ptr).assumingMemoryBound(to: CChar.self)
            _ = socketPath.withCString { cstr in
                strcpy(raw, cstr)
            }
        }

        let addrLen = socklen_t(MemoryLayout<sockaddr_un>.size)
        let connectRes = withUnsafePointer(to: &addr) { ptr in
            ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockPtr in
                Darwin.connect(fd, sockPtr, addrLen)
            }
        }

        guard connectRes == 0 else {
            let err = errno
            close(fd)
            throw IPCClientError.connectionFailed(socketPath, err)
        }

        self.socketFd = fd
        self.isRunning = true
        startReading()
    }

    public func disconnect() {
        isRunning = false
        if socketFd >= 0 {
            close(socketFd)
            socketFd = -1
        }
        readTask?.cancel()
        readTask = nil

        for (_, continuation) in pendingRequests {
            continuation.resume(throwing: IPCClientError.connectionClosed)
        }
        pendingRequests.removeAll()

        for (_, cont) in eventContinuations {
            cont.finish()
        }
        eventContinuations.removeAll()
    }

    public func send(_ request: ClientRequest) async throws -> JSONValue? {
        if socketFd < 0 {
            try connect()
        }

        let id = request.requestId
        let data = try JSONLinesCodec.encode(request)

        return try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<JSONValue?, Error>) in
            pendingRequests[id] = continuation

            let res = data.withUnsafeBytes { ptr -> Int in
                guard let base = ptr.baseAddress else { return 0 }
                return Darwin.send(socketFd, base, ptr.count, 0)
            }

            if res < 0 {
                let err = errno
                pendingRequests.removeValue(forKey: id)
                continuation.resume(throwing: IPCClientError.writeFailed(err))
            }
        }
    }

    public func events() -> AsyncStream<(sessionId: String, event: [String: JSONValue])> {
        let key = UUID()
        return AsyncStream { continuation in
            continuation.onTermination = { [weak self] _ in
                Task { [weak self] in
                    await self?.removeEventContinuation(key: key)
                }
            }
            self.eventContinuations[key] = continuation
        }
    }

    private func removeEventContinuation(key: UUID) {
        eventContinuations.removeValue(forKey: key)
    }

    private func startReading() {
        let fd = self.socketFd
        readTask = Task.detached { [weak self, fd] in
            var buffer = Data()
            var readBuf = [UInt8](repeating: 0, count: 8192)

            while !Task.isCancelled {
                let bytesRead = Darwin.recv(fd, &readBuf, readBuf.count, 0)
                if bytesRead <= 0 {
                    await self?.handleDisconnect()
                    break
                }

                let chunk = Data(readBuf[0..<bytesRead])
                let (lines, rest) = JSONLinesCodec.decodeLines(buffer: buffer, newChunk: chunk)
                buffer = rest

                for line in lines {
                    await self?.processLine(line)
                }
            }
        }
    }

    private func handleDisconnect() {
        disconnect()
    }

    private func processLine(_ data: Data) {
        let result = JSONLinesCodec.parseJSON(data, as: ServerMessage.self)
        switch result {
        case .success(let message):
            switch message {
            case .successResponse(let id, let payload):
                if let cont = pendingRequests.removeValue(forKey: id) {
                    cont.resume(returning: payload)
                }
            case .errorResponse(let id, let errMsg):
                if let cont = pendingRequests.removeValue(forKey: id) {
                    cont.resume(throwing: IPCClientError.responseError(errMsg))
                }
            case .event(let sessionId, let event):
                for cont in eventContinuations.values {
                    cont.yield((sessionId: sessionId, event: event))
                }
            }
        case .failure:
            // Skip invalid JSON frame per protocol specification
            break
        }
    }
}
