import Foundation
import SwiftUI
import OpenPIProtocol

public enum ConnectionState: Equatable, Sendable {
    case disconnected
    case connecting
    case connected
    case error(String)

    public var isConnected: Bool {
        if case .connected = self { return true }
        return false
    }

    public var title: String {
        switch self {
        case .disconnected: return "未连接"
        case .connecting: return "连接中..."
        case .connected: return "已就绪"
        case .error(let msg): return "异常: \(msg)"
        }
    }
}

public enum DateCategory: String, CaseIterable, Sendable, Identifiable {
    case today = "今天"
    case yesterday = "昨天"
    case last7Days = "近7天"
    case earlier = "更早"

    public var id: String { rawValue }
}

public struct WorkspaceProject: Identifiable, Sendable, Equatable {
    public var id: String { path }
    public let name: String
    public let path: String
    public var isExpanded: Bool

    public init(name: String, path: String, isExpanded: Bool = true) {
        self.name = name
        self.path = path
        self.isExpanded = isExpanded
    }
}

public enum ThinkingLevelOption: String, CaseIterable, Identifiable, Sendable {
    case none = "无思考"
    case low = "轻度思考"
    case medium = "中度思考"
    case high = "深度思考"
    case max = "最大思考"

    public var id: String { rawValue }

    public var apiValue: String {
        switch self {
        case .none: return "none"
        case .low: return "low"
        case .medium: return "medium"
        case .high: return "high"
        case .max: return "max"
        }
    }
}

public struct SessionGitState: Sendable, Equatable {
    public var hasGit: Bool
    public var branch: String?

    public init(hasGit: Bool = false, branch: String? = nil) {
        self.hasGit = hasGit
        self.branch = branch
    }
}

public struct SessionTokenStats: Sendable, Equatable {
    public var usedTokens: Int
    public var maxTokens: Int

    public var percent: Int {
        guard maxTokens > 0 else { return 0 }
        return min(100, Int(Double(usedTokens) / Double(maxTokens) * 100))
    }

    public var formattedText: String {
        let k = Double(usedTokens) / 1000.0
        return String(format: "%.1fk tok %d%%", k, percent)
    }

    public init(usedTokens: Int = 0, maxTokens: Int = 200000) {
        self.usedTokens = usedTokens
        self.maxTokens = maxTokens
    }
}

public struct ToolCallItem: Identifiable, Sendable, Equatable {
    public let id: String
    public var name: String
    public var args: String
    public var status: String // "running", "completed", "error"
    public var output: String?
    public var liveActivity: String?
    public var startedAt: Date
    public var completedAt: Date?

    public init(
        id: String,
        name: String,
        args: String = "",
        status: String = "running",
        output: String? = nil,
        liveActivity: String? = nil,
        startedAt: Date = Date(),
        completedAt: Date? = nil
    ) {
        self.id = id
        self.name = name
        self.args = args
        self.status = status
        self.output = output
        self.liveActivity = liveActivity
        self.startedAt = startedAt
        self.completedAt = completedAt
    }
}

public struct ChatMessage: Identifiable, Sendable, Equatable {
    public let id: String
    public let role: String // "user", "assistant", "system"
    public var content: String
    public var thinking: String?
    public var isStreaming: Bool
    public var toolCalls: [ToolCallItem]
    public let timestamp: Date

    public init(
        id: String = UUID().uuidString,
        role: String,
        content: String,
        thinking: String? = nil,
        isStreaming: Bool = false,
        toolCalls: [ToolCallItem] = [],
        timestamp: Date = Date()
    ) {
        self.id = id
        self.role = role
        self.content = content
        self.thinking = thinking
        self.isStreaming = isStreaming
        self.toolCalls = toolCalls
        self.timestamp = timestamp
    }
}

public struct DesktopTodoItem: Identifiable, Sendable, Equatable {
    public let id: UUID
    public var content: String
    public var status: String // "pending", "in_progress", "completed"

    public init(id: UUID = UUID(), content: String, status: String = "pending") {
        self.id = id
        self.content = content
        self.status = status
    }
}

public extension SessionInfo {
    var dateCategory: DateCategory {
        guard let date = ISO8601DateFormatter().date(from: updatedAt) else {
            return .earlier
        }
        let cal = Calendar.current
        if cal.isDateInToday(date) {
            return .today
        } else if cal.isDateInYesterday(date) {
            return .yesterday
        } else if let daysAgo7 = cal.date(byAdding: .day, value: -7, to: Date()), date >= daysAgo7 {
            return .last7Days
        } else {
            return .earlier
        }
    }

    var displayTime: String {
        guard let date = ISO8601DateFormatter().date(from: updatedAt) else {
            return ""
        }
        let cal = Calendar.current
        if cal.isDateInToday(date) {
            let df = DateFormatter()
            df.dateFormat = "HH:mm"
            return df.string(from: date)
        } else {
            let df = DateFormatter()
            df.dateFormat = "M/d"
            return df.string(from: date)
        }
    }
}

public struct GitFileChangeItem: Identifiable, Sendable, Equatable {
    public var id: String { "\(staged ? "staged" : "unstaged"):\(path)" }
    public let path: String
    public let status: String // "modified", "added", "deleted", "untracked", "conflicted"
    public let staged: Bool

    public init(path: String, status: String, staged: Bool) {
        self.path = path
        self.status = status
        self.staged = staged
    }
}

public struct GitStatusModel: Sendable, Equatable {
    public var isRepo: Bool
    public var branch: String
    public var ahead: Int
    public var behind: Int
    public var files: [GitFileChangeItem]

    public init(isRepo: Bool = false, branch: String = "", ahead: Int = 0, behind: Int = 0, files: [GitFileChangeItem] = []) {
        self.isRepo = isRepo
        self.branch = branch
        self.ahead = ahead
        self.behind = behind
        self.files = files
    }
}

public struct MemoryEntryItem: Identifiable, Sendable, Equatable {
    public var id: String { "\(type):\(key)" }
    public let type: String // "user", "project", "lesson", "rule", "context"
    public let key: String
    public let value: String
    public let body: String?

    public init(type: String, key: String, value: String, body: String? = nil) {
        self.type = type
        self.key = key
        self.value = value
        self.body = body
    }
}

public struct ScheduledTaskItem: Identifiable, Sendable, Equatable {
    public let id: String
    public var title: String
    public var prompt: String
    public var cwd: String?
    public var schedule: String
    public var status: String // "active", "paused", "completed"
    public var nextRunAt: String?
    public var lastRunAt: String?

    public init(
        id: String = UUID().uuidString,
        title: String,
        prompt: String,
        cwd: String? = nil,
        schedule: String = "每天 09:00",
        status: String = "active",
        nextRunAt: String? = nil,
        lastRunAt: String? = nil
    ) {
        self.id = id
        self.title = title
        self.prompt = prompt
        self.cwd = cwd
        self.schedule = schedule
        self.status = status
        self.nextRunAt = nextRunAt
        self.lastRunAt = lastRunAt
    }
}

public struct InstalledSkillItem: Identifiable, Sendable, Equatable {
    public var id: String { name }
    public let name: String
    public let description: String
    public let path: String

    public init(name: String, description: String, path: String) {
        self.name = name
        self.description = description
        self.path = path
    }
}

