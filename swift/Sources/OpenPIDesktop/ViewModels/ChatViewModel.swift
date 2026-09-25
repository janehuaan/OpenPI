import Foundation
import SwiftUI
import Observation
import OpenPIProtocol

@Observable
public final class ChatViewModel {
    public let sessionId: String
    public var cwd: String
    public var messages: [ChatMessage] = []
    public var inputText: String = ""
    public var isGenerating: Bool = false
    public var todos: [DesktopTodoItem] = []
    public var totalTokens: Int = 0

    public var formattedTokens: String {
        let k = Double(totalTokens) / 1000.0
        let percent = min(100, Int(Double(totalTokens) / 200000.0 * 100))
        return String(format: "%.1fk tok %d%%", k, percent)
    }

    public init(sessionId: String, cwd: String) {
        self.sessionId = sessionId
        self.cwd = cwd
        loadHistory()
    }

    public func loadHistory() {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let sessionFile = "\(home)/.openpi/sessions/\(sessionId).jsonl"
        guard FileManager.default.fileExists(atPath: sessionFile),
              let content = try? String(contentsOfFile: sessionFile, encoding: .utf8) else {
            return
        }

        var loadedMessages: [ChatMessage] = []
        var toolCallsMap: [String: (msgIndex: Int, callIndex: Int)] = [:]
        var latestTokens = 0

        let lines = content.components(separatedBy: "\n")
        for line in lines {
            let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty,
                  let data = trimmed.data(using: .utf8),
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                continue
            }

            guard let type = json["type"] as? String else { continue }

            if type == "message", let msgObj = json["message"] as? [String: Any] {
                let role = msgObj["role"] as? String ?? "assistant"
                let id = json["id"] as? String ?? UUID().uuidString

                if let usage = msgObj["usage"] as? [String: Any],
                   let tokens = usage["totalTokens"] as? Int {
                    latestTokens = tokens
                }

                if role == "user" {
                    var userText = ""
                    if let contentStr = msgObj["content"] as? String {
                        userText = contentStr
                    } else if let contentArr = msgObj["content"] as? [[String: Any]] {
                        for part in contentArr {
                            if part["type"] as? String == "text", let t = part["text"] as? String {
                                userText += t
                            }
                        }
                    }
                    loadedMessages.append(ChatMessage(id: id, role: "user", content: userText))
                } else if role == "assistant" {
                    var asstText = ""
                    var asstThinking: String? = nil
                    var tools: [ToolCallItem] = []

                    if let contentStr = msgObj["content"] as? String {
                        asstText = contentStr
                    } else if let contentArr = msgObj["content"] as? [[String: Any]] {
                        for part in contentArr {
                            let pType = part["type"] as? String ?? ""
                            if pType == "text", let t = part["text"] as? String {
                                asstText += t
                            } else if pType == "thinking", let t = part["text"] as? String {
                                asstThinking = (asstThinking ?? "") + t
                            } else if pType == "toolCall" {
                                let tId = part["id"] as? String ?? UUID().uuidString
                                let tName = part["name"] as? String ?? "tool"
                                var argsStr = ""
                                if let argsDict = part["arguments"] as? [String: Any],
                                   let argsData = try? JSONSerialization.data(withJSONObject: argsDict, options: []),
                                   let s = String(data: argsData, encoding: .utf8) {
                                    argsStr = s
                                } else if let s = part["arguments"] as? String {
                                    argsStr = s
                                }

                                if tName == "task",
                                   let argsDict = part["arguments"] as? [String: Any],
                                   let action = argsDict["action"] as? String, action == "set_steps",
                                   let stepsArr = argsDict["steps"] as? [[String: Any]] {
                                    var newTodos: [DesktopTodoItem] = []
                                    for step in stepsArr {
                                        if let c = step["content"] as? String {
                                            newTodos.append(DesktopTodoItem(content: c))
                                        }
                                    }
                                    self.todos = newTodos
                                }

                                let item = ToolCallItem(id: tId, name: tName, args: argsStr, status: "completed")
                                tools.append(item)
                            }
                        }
                    }

                    let msgIdx = loadedMessages.count
                    for (cIdx, t) in tools.enumerated() {
                        toolCallsMap[t.id] = (msgIdx, cIdx)
                    }

                    loadedMessages.append(ChatMessage(id: id, role: "assistant", content: asstText, thinking: asstThinking, isStreaming: false, toolCalls: tools))
                } else if role == "toolResult" {
                    let toolCallId = msgObj["toolCallId"] as? String ?? ""
                    let isError = msgObj["isError"] as? Bool ?? false
                    var outText = ""
                    if let contentArr = msgObj["content"] as? [[String: Any]] {
                        for part in contentArr {
                            if part["type"] as? String == "text", let t = part["text"] as? String {
                                outText += t
                            }
                        }
                    } else if let contentStr = msgObj["content"] as? String {
                        outText = contentStr
                    }

                    if let pos = toolCallsMap[toolCallId], pos.msgIndex < loadedMessages.count, pos.callIndex < loadedMessages[pos.msgIndex].toolCalls.count {
                        loadedMessages[pos.msgIndex].toolCalls[pos.callIndex].output = outText
                        loadedMessages[pos.msgIndex].toolCalls[pos.callIndex].status = isError ? "error" : "completed"
                    }
                }
            }
        }

        self.totalTokens = latestTokens
        self.messages = loadedMessages
    }

    @MainActor
    public func sendUserMessage(text: String, ipc: IPCClient) async {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        let userMsg = ChatMessage(role: "user", content: trimmed)
        messages.append(userMsg)
        inputText = ""

        let assistantMsgId = UUID().uuidString
        let assistantMsg = ChatMessage(id: assistantMsgId, role: "assistant", content: "", isStreaming: true)
        messages.append(assistantMsg)
        isGenerating = true

        let promptCmd: [String: JSONValue] = [
            "type": .string("prompt"),
            "id": .string(UUID().uuidString),
            "message": .string(trimmed)
        ]

        let req = ClientRequest.rpc(id: UUID().uuidString, sessionId: sessionId, command: promptCmd)
        do {
            _ = try await ipc.send(req)
        } catch {
            if let idx = messages.firstIndex(where: { $0.id == assistantMsgId }) {
                messages[idx].content = "发送失败: \(error.localizedDescription)"
                messages[idx].isStreaming = false
            }
            isGenerating = false
        }
    }

    @MainActor
    public func cancelGeneration(ipc: IPCClient) async {
        guard isGenerating else { return }
        let abortCmd: [String: JSONValue] = [
            "type": .string("abort"),
            "id": .string(UUID().uuidString)
        ]
        let req = ClientRequest.rpc(id: UUID().uuidString, sessionId: sessionId, command: abortCmd)
        _ = try? await ipc.send(req)

        if let lastIdx = messages.indices.last, messages[lastIdx].role == "assistant" {
            messages[lastIdx].isStreaming = false
        }
        isGenerating = false
    }

    @MainActor
    public func handleEvent(_ event: [String: JSONValue]) {
        let type = event["type"]?.stringValue ?? ""

        switch type {
        case "agent_start", "turn_start":
            isGenerating = true
        case "message_update":
            handleMessageUpdate(event)
        case "message_done", "response_done", "agent_settled":
            if let lastIdx = messages.indices.last, messages[lastIdx].role == "assistant" {
                messages[lastIdx].isStreaming = false
            }
            isGenerating = false
            loadHistory()
        case "tool_execution_start":
            handleToolStart(event)
        case "tool_execution_update":
            handleToolUpdate(event)
        case "tool_execution_end":
            handleToolEnd(event)
        default:
            break
        }
    }

    @MainActor
    private func handleMessageUpdate(_ event: [String: JSONValue]) {
        guard let ame = event["assistantMessageEvent"]?.objectValue else { return }
        let subType = ame["type"]?.stringValue ?? ""

        guard let lastIdx = messages.indices.last, messages[lastIdx].role == "assistant" else {
            let newMsg = ChatMessage(role: "assistant", content: "", isStreaming: true)
            messages.append(newMsg)
            handleMessageUpdate(event)
            return
        }

        if subType == "text_delta" {
            if let delta = ame["delta"]?.stringValue {
                messages[lastIdx].content += delta
            }
        } else if subType == "thinking_delta" || subType == "reasoning_delta" {
            if let delta = ame["delta"]?.stringValue ?? ame["reasoning_delta"]?.stringValue {
                let current = messages[lastIdx].thinking ?? ""
                messages[lastIdx].thinking = current + delta
            }
        } else if subType == "toolcall_start" {
            let id = ame["id"]?.stringValue ?? UUID().uuidString
            let name = ame["toolName"]?.stringValue ?? "tool"
            var argsStr = ""
            if let args = ame["arguments"] {
                if let s = args.stringValue {
                    argsStr = s
                } else if let obj = args.objectValue,
                          let data = try? JSONEncoder().encode(obj),
                          let s = String(data: data, encoding: .utf8) {
                    argsStr = s
                }
            }
            let item = ToolCallItem(id: id, name: name, args: argsStr, status: "running")
            messages[lastIdx].toolCalls.append(item)
        } else if subType == "toolcall_end" {
            if let toolCall = ame["toolCall"]?.objectValue,
               let id = toolCall["id"]?.stringValue,
               let tIdx = messages[lastIdx].toolCalls.firstIndex(where: { $0.id == id }) {
                if let args = toolCall["arguments"]?.objectValue,
                   let data = try? JSONEncoder().encode(args),
                   let s = String(data: data, encoding: .utf8) {
                    messages[lastIdx].toolCalls[tIdx].args = s
                }
            }
        }
    }

    @MainActor
    private func handleToolStart(_ event: [String: JSONValue]) {
        let toolId = event["toolCallId"]?.stringValue ?? UUID().uuidString
        let toolName = event["toolName"]?.stringValue ?? "tool"
        let args = event["args"]?.stringValue ?? ""

        guard let lastIdx = messages.indices.last, messages[lastIdx].role == "assistant" else {
            let newMsg = ChatMessage(role: "assistant", content: "", isStreaming: true, toolCalls: [
                ToolCallItem(id: toolId, name: toolName, args: args, status: "running")
            ])
            messages.append(newMsg)
            return
        }

        if let existingIdx = messages[lastIdx].toolCalls.firstIndex(where: { $0.id == toolId }) {
            messages[lastIdx].toolCalls[existingIdx].status = "running"
            if !args.isEmpty {
                messages[lastIdx].toolCalls[existingIdx].args = args
            }
        } else {
            let item = ToolCallItem(
                id: toolId,
                name: toolName,
                args: args,
                status: "running"
            )
            messages[lastIdx].toolCalls.append(item)
        }
    }

    @MainActor
    private func handleToolUpdate(_ event: [String: JSONValue]) {
        guard let toolId = event["toolCallId"]?.stringValue else { return }
        guard let lastIdx = messages.indices.last, messages[lastIdx].role == "assistant" else { return }

        if let tIdx = messages[lastIdx].toolCalls.firstIndex(where: { $0.id == toolId }) {
            if let out = event["output"]?.stringValue {
                messages[lastIdx].toolCalls[tIdx].output = out
            }
            if let live = event["liveActivity"]?.stringValue {
                messages[lastIdx].toolCalls[tIdx].liveActivity = live
            }
        }
    }

    @MainActor
    private func handleToolEnd(_ event: [String: JSONValue]) {
        guard let toolId = event["toolCallId"]?.stringValue else { return }
        guard let lastIdx = messages.indices.last, messages[lastIdx].role == "assistant" else { return }

        if let tIdx = messages[lastIdx].toolCalls.firstIndex(where: { $0.id == toolId }) {
            let isError = event["isError"]?.boolValue ?? false
            messages[lastIdx].toolCalls[tIdx].status = isError ? "error" : "completed"
            if let out = event["output"]?.stringValue {
                messages[lastIdx].toolCalls[tIdx].output = out
            }
            messages[lastIdx].toolCalls[tIdx].completedAt = Date()
        }
    }
}
