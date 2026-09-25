import Foundation

public enum SessionMode: String, Codable, Sendable {
    case chat
    case code
}

public struct SessionInfo: Codable, Sendable, Identifiable {
    public var id: String { sessionId }
    public let sessionId: String
    public let cwd: String
    public let mode: SessionMode
    public let name: String?
    public let model: String?
    public let inMemory: Bool?
    public let running: Bool
    public let createdAt: String
    public let updatedAt: String

    public init(
        sessionId: String,
        cwd: String,
        mode: SessionMode,
        name: String? = nil,
        model: String? = nil,
        inMemory: Bool? = nil,
        running: Bool,
        createdAt: String,
        updatedAt: String
    ) {
        self.sessionId = sessionId
        self.cwd = cwd
        self.mode = mode
        self.name = name
        self.model = model
        self.inMemory = inMemory
        self.running = running
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

public struct HealthInfo: Codable, Sendable {
    public let ok: Bool
    public let pid: Int
    public let version: String
    public let cliMtimeMs: Double
    public let cliPath: String
    public let sessionCount: Int
    public let runningCount: Int
    public let uptimeMs: Double

    public init(
        ok: Bool = true,
        pid: Int,
        version: String,
        cliMtimeMs: Double,
        cliPath: String,
        sessionCount: Int,
        runningCount: Int,
        uptimeMs: Double
    ) {
        self.ok = ok
        self.pid = pid
        self.version = version
        self.cliMtimeMs = cliMtimeMs
        self.cliPath = cliPath
        self.sessionCount = sessionCount
        self.runningCount = runningCount
        self.uptimeMs = uptimeMs
    }
}

public enum TaskSchedule: Codable, Sendable {
    case once(runAt: String)
    case cron(expression: String, timezone: String?)

    private enum CodingKeys: String, CodingKey {
        case kind, runAt, expression, timezone
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let kind = try container.decode(String.self, forKey: .kind)
        switch kind {
        case "once":
            let runAt = try container.decode(String.self, forKey: .runAt)
            self = .once(runAt: runAt)
        case "cron":
            let expression = try container.decode(String.self, forKey: .expression)
            let timezone = try container.decodeIfPresent(String.self, forKey: .timezone)
            self = .cron(expression: expression, timezone: timezone)
        default:
            throw DecodingError.dataCorrupted(
                DecodingError.Context(codingPath: decoder.codingPath, debugDescription: "Invalid task schedule kind: \(kind)")
            )
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .once(let runAt):
            try container.encode("once", forKey: .kind)
            try container.encode(runAt, forKey: .runAt)
        case .cron(let expression, let timezone):
            try container.encode("cron", forKey: .kind)
            try container.encode(expression, forKey: .expression)
            try container.encodeIfPresent(timezone, forKey: .timezone)
        }
    }
}

public struct TaskStepInput: Codable, Sendable, Identifiable {
    public let id: String
    public let title: String
    public let prompt: String
    public let dependsOn: [String]?
    public let tools: [String]?

    public init(id: String, title: String, prompt: String, dependsOn: [String]? = nil, tools: [String]? = nil) {
        self.id = id
        self.title = title
        self.prompt = prompt
        self.dependsOn = dependsOn
        self.tools = tools
    }
}

public struct CreateTaskInput: Codable, Sendable {
    public let title: String
    public let prompt: String
    public let cwd: String?
    public let schedule: TaskSchedule
    public let model: String?
    public let tools: [String]?
    public let steps: [TaskStepInput]?
    public let maxConcurrentSteps: Int?
    public let retryAttempts: Int?

    public init(
        title: String,
        prompt: String,
        cwd: String? = nil,
        schedule: TaskSchedule,
        model: String? = nil,
        tools: [String]? = nil,
        steps: [TaskStepInput]? = nil,
        maxConcurrentSteps: Int? = nil,
        retryAttempts: Int? = nil
    ) {
        self.title = title
        self.prompt = prompt
        self.cwd = cwd
        self.schedule = schedule
        self.model = model
        self.tools = tools
        self.steps = steps
        self.maxConcurrentSteps = maxConcurrentSteps
        self.retryAttempts = retryAttempts
    }
}

public struct TaskSummary: Codable, Sendable, Identifiable {
    public let id: String
    public let title: String
    public let prompt: String
    public let cwd: String?
    public let schedule: TaskSchedule
    public let status: String
    public let nextRunAt: String?
    public let createdAt: String
    public let updatedAt: String
    public let model: String?
    public let steps: [TaskStepInput]?

    public init(
        id: String,
        title: String,
        prompt: String,
        cwd: String? = nil,
        schedule: TaskSchedule,
        status: String,
        nextRunAt: String? = nil,
        createdAt: String,
        updatedAt: String,
        model: String? = nil,
        steps: [TaskStepInput]? = nil
    ) {
        self.id = id
        self.title = title
        self.prompt = prompt
        self.cwd = cwd
        self.schedule = schedule
        self.status = status
        self.nextRunAt = nextRunAt
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.model = model
        self.steps = steps
    }
}

public struct TaskRunSummary: Codable, Sendable, Identifiable {
    public let id: String
    public let taskId: String
    public let status: String
    public let trigger: String
    public let createdAt: String
    public let startedAt: String?
    public let finishedAt: String?
    public let exitCode: Int?
    public let result: String?
    public let error: String?
    public let attempt: Int?
}

public struct UserProfile: Codable, Sendable {
    public let nickname: String?
    public let avatarEmoji: String?
    public let updatedAt: String?

    public init(nickname: String? = nil, avatarEmoji: String? = nil, updatedAt: String? = nil) {
        self.nickname = nickname
        self.avatarEmoji = avatarEmoji
        self.updatedAt = updatedAt
    }
}

public struct CapabilityEntry: Codable, Sendable {
    public let source: String
    public let resolved: String?
    public let kind: String
    public let present: Bool
}

public struct Capabilities: Codable, Sendable {
    public let agentDir: String
    public let entries: [CapabilityEntry]
}

public struct DocumentText: Codable, Sendable {
    public let name: String
    public let text: String
    public let truncated: Bool
}

public struct WorkspaceSummary: Codable, Sendable {
    public let cwd: String
    public let exists: Bool
    public let isGitRepo: Bool
    public let branch: String?
    public let fileCount: Int
    public let hasMemory: Bool
    public let memoryCount: Int
}

public struct ProviderStatus: Codable, Sendable {
    public let provider: String
    public let configured: Bool
    public let baseUrl: String?
    public let modelCount: Int
}

public struct ModelOption: Codable, Sendable, Identifiable {
    public var id: String { ref }
    public let provider: String
    public let modelId: String
    public let ref: String

    public init(provider: String, modelId: String, ref: String) {
        self.provider = provider
        self.modelId = modelId
        self.ref = ref
    }
}

public struct MemoryEntry: Codable, Sendable, Identifiable {
    public var id: String { "\(type):\(key)" }
    public let type: String
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

// MARK: - App Operations

public enum AppOp: Codable, Sendable {
    case listModels
    case authStatus
    case importGlobalCredentials
    case defaultWorkspace
    case recentWorkspaces
    case workspaceSummary(cwd: String)
    case listMemory(cwd: String, scope: String?)
    case readMemoryTopic(cwd: String, scope: String?, type: String, key: String)
    case writeMemory(cwd: String, scope: String?, type: String, key: String, value: String, body: String?)
    case deleteMemory(cwd: String, scope: String?, type: String, key: String)
    case maintainMemory(cwd: String)
    case listTasks
    case createTask(input: CreateTaskInput)
    case setTaskPaused(taskId: String, paused: Bool)
    case deleteTask(taskId: String)
    case runTask(taskId: String)
    case cancelRun(runId: String)
    case getProfile
    case saveProfile(profile: UserProfile)
    case capabilities
    case extractDocument(fileName: String, dataBase64: String)
    case jevDecide(context: String, choices: [String], instruction: String?)
    case jevNoul(context: String, question: String)
    case jevScore(context: String, criterion: String)
    case jevGetConfig
    case jevUpdateConfig(config: JevConfig)
    case custom(name: String, payload: [String: JSONValue])

    private enum CodingKeys: String, CodingKey {
        case name, cwd, scope, type, key, value, body, taskId, paused, runId, input, profile, fileName, dataBase64
        case context, choices, instruction, question, criterion, config
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let name = try container.decode(String.self, forKey: .name)
        switch name {
        case "list_models": self = .listModels
        case "auth_status": self = .authStatus
        case "import_global_credentials": self = .importGlobalCredentials
        case "default_workspace": self = .defaultWorkspace
        case "recent_workspaces": self = .recentWorkspaces
        case "workspace_summary":
            let cwd = try container.decode(String.self, forKey: .cwd)
            self = .workspaceSummary(cwd: cwd)
        case "list_memory":
            let cwd = try container.decode(String.self, forKey: .cwd)
            let scope = try container.decodeIfPresent(String.self, forKey: .scope)
            self = .listMemory(cwd: cwd, scope: scope)
        case "read_memory_topic":
            let cwd = try container.decode(String.self, forKey: .cwd)
            let scope = try container.decodeIfPresent(String.self, forKey: .scope)
            let type = try container.decode(String.self, forKey: .type)
            let key = try container.decode(String.self, forKey: .key)
            self = .readMemoryTopic(cwd: cwd, scope: scope, type: type, key: key)
        case "write_memory":
            let cwd = try container.decode(String.self, forKey: .cwd)
            let scope = try container.decodeIfPresent(String.self, forKey: .scope)
            let type = try container.decode(String.self, forKey: .type)
            let key = try container.decode(String.self, forKey: .key)
            let value = try container.decode(String.self, forKey: .value)
            let body = try container.decodeIfPresent(String.self, forKey: .body)
            self = .writeMemory(cwd: cwd, scope: scope, type: type, key: key, value: value, body: body)
        case "delete_memory":
            let cwd = try container.decode(String.self, forKey: .cwd)
            let scope = try container.decodeIfPresent(String.self, forKey: .scope)
            let type = try container.decode(String.self, forKey: .type)
            let key = try container.decode(String.self, forKey: .key)
            self = .deleteMemory(cwd: cwd, scope: scope, type: type, key: key)
        case "maintain_memory":
            let cwd = try container.decode(String.self, forKey: .cwd)
            self = .maintainMemory(cwd: cwd)
        case "list_tasks": self = .listTasks
        case "create_task":
            let input = try container.decode(CreateTaskInput.self, forKey: .input)
            self = .createTask(input: input)
        case "set_task_paused":
            let taskId = try container.decode(String.self, forKey: .taskId)
            let paused = try container.decode(Bool.self, forKey: .paused)
            self = .setTaskPaused(taskId: taskId, paused: paused)
        case "delete_task":
            let taskId = try container.decode(String.self, forKey: .taskId)
            self = .deleteTask(taskId: taskId)
        case "run_task":
            let taskId = try container.decode(String.self, forKey: .taskId)
            self = .runTask(taskId: taskId)
        case "cancel_run":
            let runId = try container.decode(String.self, forKey: .runId)
            self = .cancelRun(runId: runId)
        case "get_profile": self = .getProfile
        case "save_profile":
            let profile = try container.decode(UserProfile.self, forKey: .profile)
            self = .saveProfile(profile: profile)
        case "capabilities": self = .capabilities
        case "extract_document":
            let fileName = try container.decode(String.self, forKey: .fileName)
            let dataBase64 = try container.decode(String.self, forKey: .dataBase64)
            self = .extractDocument(fileName: fileName, dataBase64: dataBase64)
        case "jev_decide":
            let context = try container.decode(String.self, forKey: .context)
            let choices = try container.decode([String].self, forKey: .choices)
            let instruction = try container.decodeIfPresent(String.self, forKey: .instruction)
            self = .jevDecide(context: context, choices: choices, instruction: instruction)
        case "jev_noul":
            let context = try container.decode(String.self, forKey: .context)
            let question = try container.decode(String.self, forKey: .question)
            self = .jevNoul(context: context, question: question)
        case "jev_score":
            let context = try container.decode(String.self, forKey: .context)
            let criterion = try container.decode(String.self, forKey: .criterion)
            self = .jevScore(context: context, criterion: criterion)
        case "jev_get_config":
            self = .jevGetConfig
        case "jev_update_config":
            let config = try container.decode(JevConfig.self, forKey: .config)
            self = .jevUpdateConfig(config: config)
        default:
            let payload = try [String: JSONValue](from: decoder)
            self = .custom(name: name, payload: payload)
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .listModels:
            try container.encode("list_models", forKey: .name)
        case .authStatus:
            try container.encode("auth_status", forKey: .name)
        case .importGlobalCredentials:
            try container.encode("import_global_credentials", forKey: .name)
        case .defaultWorkspace:
            try container.encode("default_workspace", forKey: .name)
        case .recentWorkspaces:
            try container.encode("recent_workspaces", forKey: .name)
        case .workspaceSummary(let cwd):
            try container.encode("workspace_summary", forKey: .name)
            try container.encode(cwd, forKey: .cwd)
        case .listMemory(let cwd, let scope):
            try container.encode("list_memory", forKey: .name)
            try container.encode(cwd, forKey: .cwd)
            try container.encodeIfPresent(scope, forKey: .scope)
        case .readMemoryTopic(let cwd, let scope, let type, let key):
            try container.encode("read_memory_topic", forKey: .name)
            try container.encode(cwd, forKey: .cwd)
            try container.encodeIfPresent(scope, forKey: .scope)
            try container.encode(type, forKey: .type)
            try container.encode(key, forKey: .key)
        case .writeMemory(let cwd, let scope, let type, let key, let value, let body):
            try container.encode("write_memory", forKey: .name)
            try container.encode(cwd, forKey: .cwd)
            try container.encodeIfPresent(scope, forKey: .scope)
            try container.encode(type, forKey: .type)
            try container.encode(key, forKey: .key)
            try container.encode(value, forKey: .value)
            try container.encodeIfPresent(body, forKey: .body)
        case .deleteMemory(let cwd, let scope, let type, let key):
            try container.encode("delete_memory", forKey: .name)
            try container.encode(cwd, forKey: .cwd)
            try container.encodeIfPresent(scope, forKey: .scope)
            try container.encode(type, forKey: .type)
            try container.encode(key, forKey: .key)
        case .maintainMemory(let cwd):
            try container.encode("maintain_memory", forKey: .name)
            try container.encode(cwd, forKey: .cwd)
        case .listTasks:
            try container.encode("list_tasks", forKey: .name)
        case .createTask(let input):
            try container.encode("create_task", forKey: .name)
            try container.encode(input, forKey: .input)
        case .setTaskPaused(let taskId, let paused):
            try container.encode("set_task_paused", forKey: .name)
            try container.encode(taskId, forKey: .taskId)
            try container.encode(paused, forKey: .paused)
        case .deleteTask(let taskId):
            try container.encode("delete_task", forKey: .name)
            try container.encode(taskId, forKey: .taskId)
        case .runTask(let taskId):
            try container.encode("run_task", forKey: .name)
            try container.encode(taskId, forKey: .taskId)
        case .cancelRun(let runId):
            try container.encode("cancel_run", forKey: .name)
            try container.encode(runId, forKey: .runId)
        case .getProfile:
            try container.encode("get_profile", forKey: .name)
        case .saveProfile(let profile):
            try container.encode("save_profile", forKey: .name)
            try container.encode(profile, forKey: .profile)
        case .capabilities:
            try container.encode("capabilities", forKey: .name)
        case .extractDocument(let fileName, let dataBase64):
            try container.encode("extract_document", forKey: .name)
            try container.encode(fileName, forKey: .fileName)
            try container.encode(dataBase64, forKey: .dataBase64)
        case .jevDecide(let context, let choices, let instruction):
            try container.encode("jev_decide", forKey: .name)
            try container.encode(context, forKey: .context)
            try container.encode(choices, forKey: .choices)
            try container.encodeIfPresent(instruction, forKey: .instruction)
        case .jevNoul(let context, let question):
            try container.encode("jev_noul", forKey: .name)
            try container.encode(context, forKey: .context)
            try container.encode(question, forKey: .question)
        case .jevScore(let context, let criterion):
            try container.encode("jev_score", forKey: .name)
            try container.encode(context, forKey: .context)
            try container.encode(criterion, forKey: .criterion)
        case .jevGetConfig:
            try container.encode("jev_get_config", forKey: .name)
        case .jevUpdateConfig(let config):
            try container.encode("jev_update_config", forKey: .name)
            try container.encode(config, forKey: .config)
        case .custom(let name, let payload):
            try container.encode(name, forKey: .name)
            for (_, v) in payload {
                try v.encode(to: encoder)
            }
        }
    }
}

// MARK: - Client Request & Server Message

public enum ClientRequest: Codable, Sendable {
    case health(id: String)
    case shutdown(id: String)
    case listSessions(id: String)
    case createSession(id: String, cwd: String, mode: SessionMode?, model: String?, name: String?, inMemory: Bool?)
    case stopSession(id: String, sessionId: String)
    case deleteSession(id: String, sessionId: String)
    case renameSession(id: String, sessionId: String, name: String)
    case updateSessionWorkspace(id: String, sessionId: String, cwd: String)
    case subscribe(id: String, sessionId: String)
    case unsubscribe(id: String, sessionId: String)
    case rpc(id: String, sessionId: String, command: [String: JSONValue])
    case app(id: String, op: AppOp)

    public var requestId: String {
        switch self {
        case .health(let id), .shutdown(let id), .listSessions(let id),
             .createSession(let id, _, _, _, _, _), .stopSession(let id, _),
             .deleteSession(let id, _), .renameSession(let id, _, _),
             .updateSessionWorkspace(let id, _, _), .subscribe(let id, _),
             .unsubscribe(let id, _), .rpc(let id, _, _), .app(let id, _):
            return id
        }
    }

    private enum CodingKeys: String, CodingKey {
        case id, type, cwd, mode, model, name, inMemory, sessionId, command, op
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let id = try container.decode(String.self, forKey: .id)
        let type = try container.decode(String.self, forKey: .type)

        switch type {
        case "health": self = .health(id: id)
        case "shutdown": self = .shutdown(id: id)
        case "list_sessions": self = .listSessions(id: id)
        case "create_session":
            let cwd = try container.decode(String.self, forKey: .cwd)
            let mode = try container.decodeIfPresent(SessionMode.self, forKey: .mode)
            let model = try container.decodeIfPresent(String.self, forKey: .model)
            let name = try container.decodeIfPresent(String.self, forKey: .name)
            let inMemory = try container.decodeIfPresent(Bool.self, forKey: .inMemory)
            self = .createSession(id: id, cwd: cwd, mode: mode, model: model, name: name, inMemory: inMemory)
        case "stop_session":
            let sid = try container.decode(String.self, forKey: .sessionId)
            self = .stopSession(id: id, sessionId: sid)
        case "delete_session":
            let sid = try container.decode(String.self, forKey: .sessionId)
            self = .deleteSession(id: id, sessionId: sid)
        case "rename_session":
            let sid = try container.decode(String.self, forKey: .sessionId)
            let name = try container.decode(String.self, forKey: .name)
            self = .renameSession(id: id, sessionId: sid, name: name)
        case "update_session_workspace":
            let sid = try container.decode(String.self, forKey: .sessionId)
            let cwd = try container.decode(String.self, forKey: .cwd)
            self = .updateSessionWorkspace(id: id, sessionId: sid, cwd: cwd)
        case "subscribe":
            let sid = try container.decode(String.self, forKey: .sessionId)
            self = .subscribe(id: id, sessionId: sid)
        case "unsubscribe":
            let sid = try container.decode(String.self, forKey: .sessionId)
            self = .unsubscribe(id: id, sessionId: sid)
        case "rpc":
            let sid = try container.decode(String.self, forKey: .sessionId)
            let command = try container.decode([String: JSONValue].self, forKey: .command)
            self = .rpc(id: id, sessionId: sid, command: command)
        case "app":
            let op = try container.decode(AppOp.self, forKey: .op)
            self = .app(id: id, op: op)
        default:
            throw DecodingError.dataCorrupted(
                DecodingError.Context(codingPath: decoder.codingPath, debugDescription: "Unknown request type: \(type)")
            )
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .health(let id):
            try container.encode(id, forKey: .id)
            try container.encode("health", forKey: .type)
        case .shutdown(let id):
            try container.encode(id, forKey: .id)
            try container.encode("shutdown", forKey: .type)
        case .listSessions(let id):
            try container.encode(id, forKey: .id)
            try container.encode("list_sessions", forKey: .type)
        case .createSession(let id, let cwd, let mode, let model, let name, let inMemory):
            try container.encode(id, forKey: .id)
            try container.encode("create_session", forKey: .type)
            try container.encode(cwd, forKey: .cwd)
            try container.encodeIfPresent(mode, forKey: .mode)
            try container.encodeIfPresent(model, forKey: .model)
            try container.encodeIfPresent(name, forKey: .name)
            try container.encodeIfPresent(inMemory, forKey: .inMemory)
        case .stopSession(let id, let sid):
            try container.encode(id, forKey: .id)
            try container.encode("stop_session", forKey: .type)
            try container.encode(sid, forKey: .sessionId)
        case .deleteSession(let id, let sid):
            try container.encode(id, forKey: .id)
            try container.encode("delete_session", forKey: .type)
            try container.encode(sid, forKey: .sessionId)
        case .renameSession(let id, let sid, let name):
            try container.encode(id, forKey: .id)
            try container.encode("rename_session", forKey: .type)
            try container.encode(sid, forKey: .sessionId)
            try container.encode(name, forKey: .name)
        case .updateSessionWorkspace(let id, let sid, let cwd):
            try container.encode(id, forKey: .id)
            try container.encode("update_session_workspace", forKey: .type)
            try container.encode(sid, forKey: .sessionId)
            try container.encode(cwd, forKey: .cwd)
        case .subscribe(let id, let sid):
            try container.encode(id, forKey: .id)
            try container.encode("subscribe", forKey: .type)
            try container.encode(sid, forKey: .sessionId)
        case .unsubscribe(let id, let sid):
            try container.encode(id, forKey: .id)
            try container.encode("unsubscribe", forKey: .type)
            try container.encode(sid, forKey: .sessionId)
        case .rpc(let id, let sid, let cmd):
            try container.encode(id, forKey: .id)
            try container.encode("rpc", forKey: .type)
            try container.encode(sid, forKey: .sessionId)
            try container.encode(cmd, forKey: .command)
        case .app(let id, let op):
            try container.encode(id, forKey: .id)
            try container.encode("app", forKey: .type)
            try container.encode(op, forKey: .op)
        }
    }
}

public enum ServerMessage: Codable, Sendable {
    case successResponse(id: String, data: JSONValue?)
    case errorResponse(id: String, error: String)
    case event(sessionId: String, event: [String: JSONValue])

    private enum CodingKeys: String, CodingKey {
        case id, type, ok, data, error, sessionId, event
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(String.self, forKey: .type)

        if type == "event" {
            let sessionId = try container.decode(String.self, forKey: .sessionId)
            let event = try container.decode([String: JSONValue].self, forKey: .event)
            self = .event(sessionId: sessionId, event: event)
        } else if type == "response" {
            let id = try container.decode(String.self, forKey: .id)
            let ok = try container.decode(Bool.self, forKey: .ok)
            if ok {
                let data = try container.decodeIfPresent(JSONValue.self, forKey: .data)
                self = .successResponse(id: id, data: data)
            } else {
                let error = try container.decodeIfPresent(String.self, forKey: .error) ?? "Unknown daemon error"
                self = .errorResponse(id: id, error: error)
            }
        } else {
            throw DecodingError.dataCorrupted(
                DecodingError.Context(codingPath: decoder.codingPath, debugDescription: "Unknown server message type: \(type)")
            )
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .successResponse(let id, let data):
            try container.encode(id, forKey: .id)
            try container.encode("response", forKey: .type)
            try container.encode(true, forKey: .ok)
            try container.encodeIfPresent(data, forKey: .data)
        case .errorResponse(let id, let error):
            try container.encode(id, forKey: .id)
            try container.encode("response", forKey: .type)
            try container.encode(false, forKey: .ok)
            try container.encode(error, forKey: .error)
        case .event(let sessionId, let event):
            try container.encode("event", forKey: .type)
            try container.encode(sessionId, forKey: .sessionId)
            try container.encode(event, forKey: .event)
        }
    }
}
