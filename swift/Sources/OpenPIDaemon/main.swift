import Foundation
import OpenPIProtocol

let args = CommandLine.arguments
let command = args.count > 1 ? args[1] : "serve"

func printUsage() {
    print("""
    OpenPI Swift Daemon (openpi-daemon)

    Usage:
      openpi-daemon serve              Run the daemon in foreground
      openpi-daemon health             Query running daemon health
      openpi-daemon list               List all active and suspended sessions
      openpi-daemon create <cwd>       Create a new session in <cwd>
      openpi-daemon shutdown           Gracefully shut down running daemon
    """)
}

switch command {
case "serve":
    let supervisor = Supervisor()
    let server = SocketServer(supervisor: supervisor)
    do {
        try await server.start()
        print("🟢 Daemon running. Press Ctrl+C to terminate.")
        // Keep process alive
        while true {
            try await Task.sleep(nanoseconds: 1_000_000_000)
        }
    } catch {
        print("❌ Failed to start daemon: \(error)")
        exit(1)
    }

case "health":
    let client = IPCClient()
    do {
        let req = ClientRequest.health(id: UUID().uuidString)
        let resp = try await client.send(req)
        if let data = resp {
            let enc = JSONEncoder()
            enc.outputFormatting = .prettyPrinted
            let str = String(data: try enc.encode(data), encoding: .utf8) ?? ""
            print(str)
        }
    } catch {
        print("❌ Health check failed: \(error)")
        exit(1)
    }

case "list":
    let client = IPCClient()
    do {
        let req = ClientRequest.listSessions(id: UUID().uuidString)
        let resp = try await client.send(req)
        if let data = resp {
            let enc = JSONEncoder()
            enc.outputFormatting = .prettyPrinted
            let str = String(data: try enc.encode(data), encoding: .utf8) ?? ""
            print(str)
        }
    } catch {
        print("❌ List sessions failed: \(error)")
        exit(1)
    }

case "create":
    guard args.count > 2 else {
        print("❌ Missing workspace path. Usage: openpi-daemon create <path>")
        exit(1)
    }
    let cwd = args[2]
    let client = IPCClient()
    do {
        let req = ClientRequest.createSession(
            id: UUID().uuidString,
            cwd: cwd,
            mode: .code,
            model: nil,
            name: nil,
            inMemory: false
        )
        let resp = try await client.send(req)
        if let data = resp {
            let enc = JSONEncoder()
            enc.outputFormatting = .prettyPrinted
            let str = String(data: try enc.encode(data), encoding: .utf8) ?? ""
            print(str)
        }
    } catch {
        print("❌ Create session failed: \(error)")
        exit(1)
    }

case "shutdown":
    let client = IPCClient()
    do {
        let req = ClientRequest.shutdown(id: UUID().uuidString)
        let _ = try await client.send(req)
        print("🟢 Daemon shutdown requested successfully.")
    } catch {
        print("❌ Shutdown failed: \(error)")
        exit(1)
    }

case "-h", "--help", "help":
    printUsage()

default:
    print("Unknown command: \(command)")
    printUsage()
    exit(1)
}
