import Foundation
import SwiftUI
import Observation
import OpenPIProtocol

public enum MainTab: String, CaseIterable, Identifiable, Sendable {
    case chat = "对话"
    case git = "版本管理"
    case memory = "长期记忆"
    case tasks = "定时任务"

    public var id: String { rawValue }

    public var icon: String {
        switch self {
        case .chat: return "bubble.left.and.bubble.right"
        case .git: return "point.topleft.down.curvedto.point.bottomright.up"
        case .memory: return "book.closed"
        case .tasks: return "checklist"
        }
    }
}

@MainActor
@Observable
public final class AppStore {
    public let ipcClient: IPCClient
    public var connectionState: ConnectionState = .disconnected
    public var selectedTab: MainTab = .chat
    public var searchQuery: String = ""

    public var sessions: [SessionInfo] = []
    public var selectedSessionId: String?
    public var models: [ModelOption] = []
    public var selectedModel: String = "自建/gemini-3.8-flash-high"
    public var selectedThinkingLevel: ThinkingLevelOption = .medium

    public var currentWorkspace: String = FileManager.default.homeDirectoryForCurrentUser.path
    public var recentWorkspaces: [String] = []
    public var projects: [WorkspaceProject] = []

    public var gitState: SessionGitState = SessionGitState(hasGit: true, branch: "main")
    public var tokenStats: SessionTokenStats = SessionTokenStats(usedTokens: 0, maxTokens: 200000)

    // Git Surface State
    public var fullGitStatus: GitStatusModel = GitStatusModel()
    public var gitBranchesList: [String] = []
    public var isGitLoading: Bool = false

    // Memory Surface State
    public var workspaceMemory: [MemoryEntryItem] = []
    public var memoryHandbookContent: String = ""
    public var memoryScope: String = "project"
    public var isMemoryLoading: Bool = false

    // Tasks Surface State
    public var tasksList: [ScheduledTaskItem] = []
    public var isTasksLoading: Bool = false

    // Settings & Skills State
    public var installedSkills: [InstalledSkillItem] = []
    public var showSettingsModal: Bool = false

    // Jev (System 1) Decision State
    public var jevConfig: JevConfig = JevConfig()
    public var isJevTesting: Bool = false
    public var lastJevChoiceResult: JevChoiceResponse?
    public var lastJevNoulResult: JevNoulResponse?
    public var lastJevScoreResult: JevScoreResponse?

    // User Profile
    public var nickname: String = "Huaan"
    public var avatarEmoji: String = "H"
    public var isPro: Bool = true
    public var isDarkMode: Bool = false

    private var chatViewModels: [String: ChatViewModel] = [:]
    private var eventListeningTask: Task<Void, Never>?

    public init(socketPath: String? = nil) {
        self.ipcClient = IPCClient(socketPath: socketPath)
    }

    @MainActor
    public func connect() async {
        connectionState = .connecting
        do {
            try await ipcClient.connect()
            let req = ClientRequest.health(id: UUID().uuidString)
            _ = try await ipcClient.send(req)
            connectionState = .connected
            startEventListener()
            await refreshSessions()
            await refreshModels()
            await refreshWorkspaces()
            refreshGitState()
            refreshFullGitStatus()
            await refreshMemory()
            await refreshTasks()
            refreshSkills()
            await refreshJevConfig()

            if let sid = selectedSessionId {
                await selectSession(sessionId: sid)
            }
        } catch {
            connectionState = .error(error.localizedDescription)
        }
    }

    @MainActor
    public func selectSession(sessionId: String) async {
        selectedSessionId = sessionId
        selectedTab = .chat

        if let s = sessions.first(where: { $0.sessionId == sessionId }) {
            currentWorkspace = s.cwd
            refreshGitState()
        }

        let subReq = ClientRequest.subscribe(id: UUID().uuidString, sessionId: sessionId)
        _ = try? await ipcClient.send(subReq)

        let vm = chatViewModel(for: sessionId)
        vm.loadHistory()
        if vm.totalTokens > 0 {
            tokenStats = SessionTokenStats(usedTokens: vm.totalTokens, maxTokens: 200000)
        }
    }

    @MainActor
    public func refreshSessions() async {
        guard connectionState.isConnected else { return }
        let req = ClientRequest.listSessions(id: UUID().uuidString)
        if let resp = try? await ipcClient.send(req) {
            let arr = resp["sessions"]?.arrayValue ?? resp.arrayValue ?? []
            var loaded: [SessionInfo] = []
            for item in arr {
                if let data = try? JSONEncoder().encode(item),
                   let info = try? JSONDecoder().decode(SessionInfo.self, from: data) {
                    loaded.append(info)
                }
            }
            loaded.sort { $0.updatedAt > $1.updatedAt }
            self.sessions = loaded
            updateProjects(from: loaded)

            if selectedSessionId == nil, let first = loaded.first {
                await selectSession(sessionId: first.sessionId)
            } else if let cur = selectedSessionId, !loaded.contains(where: { $0.sessionId == cur }) {
                if let first = loaded.first {
                    await selectSession(sessionId: first.sessionId)
                } else {
                    selectedSessionId = nil
                }
            }
        }
    }

    @MainActor
    public func refreshWorkspaces() async {
        guard connectionState.isConnected else { return }
        let req = ClientRequest.app(id: UUID().uuidString, op: .recentWorkspaces)
        if let resp = try? await ipcClient.send(req), let arr = resp["workspaces"]?.arrayValue {
            var list: [String] = []
            for item in arr {
                if let s = item.stringValue {
                    list.append(s)
                }
            }
            self.recentWorkspaces = list
        }
    }

    @MainActor
    public func refreshModels() async {
        var loaded: [ModelOption] = []
        if connectionState.isConnected {
            let req = ClientRequest.app(id: UUID().uuidString, op: .listModels)
            if let resp = try? await ipcClient.send(req), let modelsArr = resp["models"]?.arrayValue {
                for m in modelsArr {
                    if let prov = m["provider"]?.stringValue,
                       let mId = m["modelId"]?.stringValue,
                       let ref = m["ref"]?.stringValue {
                        loaded.append(ModelOption(provider: prov, modelId: mId, ref: ref))
                    }
                }
            }
        }
        if loaded.isEmpty {
            loaded = loadModelsFromDisk()
        }
        self.models = loaded
        if let def = loadDefaultModelFromSettings(), loaded.contains(where: { $0.ref == def }) {
            self.selectedModel = def
        } else if let first = loaded.first, (selectedModel.isEmpty || !loaded.contains(where: { $0.ref == selectedModel })) {
            self.selectedModel = first.ref
        }
    }

    private func loadModelsFromDisk() -> [ModelOption] {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let modelsFile = "\(home)/.openpi/agent/models.json"
        guard let data = try? Data(contentsOf: URL(fileURLWithPath: modelsFile)),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let providers = json["providers"] as? [String: [String: Any]] else {
            return []
        }

        var result: [ModelOption] = []
        for (providerName, providerDict) in providers {
            if let list = providerDict["models"] as? [[String: Any]] {
                for m in list {
                    if let id = m["id"] as? String {
                        result.append(ModelOption(provider: providerName, modelId: id, ref: "\(providerName)/\(id)"))
                    }
                }
            }
        }
        return result
    }

    private func loadDefaultModelFromSettings() -> String? {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let settingsFile = "\(home)/.openpi/agent/settings.json"
        guard let data = try? Data(contentsOf: URL(fileURLWithPath: settingsFile)),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }
        if let model = json["defaultModel"] as? String,
           let provider = json["defaultProvider"] as? String {
            return "\(provider)/\(model)"
        }
        return nil
    }

    public func refreshGitState() {
        let gitHead = URL(fileURLWithPath: currentWorkspace).appendingPathComponent(".git/HEAD")
        if FileManager.default.fileExists(atPath: gitHead.path) {
            if let content = try? String(contentsOf: gitHead, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines) {
                let branch = content.hasPrefix("ref: refs/heads/") ? String(content.dropFirst("ref: refs/heads/".count)) : "HEAD"
                self.gitState = SessionGitState(hasGit: true, branch: branch)
                return
            }
        }
        self.gitState = SessionGitState(hasGit: false, branch: nil)
    }

    @MainActor
    public func createSession(cwd: String? = nil, mode: SessionMode = .code, name: String? = nil) async -> String? {
        guard connectionState.isConnected else { return nil }
        let targetCwd = cwd ?? currentWorkspace
        let req = ClientRequest.createSession(
            id: UUID().uuidString,
            cwd: targetCwd,
            mode: mode,
            model: selectedModel,
            name: name,
            inMemory: false
        )
        do {
            if let resp = try await ipcClient.send(req), let sid = resp["sessionId"]?.stringValue {
                await refreshSessions()
                await selectSession(sessionId: sid)
                return sid
            }
        } catch {
            print("Create session failed: \(error)")
        }
        return nil
    }

    @MainActor
    public func deleteSession(sessionId: String) async {
        guard connectionState.isConnected else { return }
        let req = ClientRequest.deleteSession(id: UUID().uuidString, sessionId: sessionId)
        _ = try? await ipcClient.send(req)
        chatViewModels.removeValue(forKey: sessionId)
        await refreshSessions()
        if selectedSessionId == sessionId {
            if let first = sessions.first {
                await selectSession(sessionId: first.sessionId)
            } else {
                selectedSessionId = nil
            }
        }
    }

    @MainActor
    public func renameSession(sessionId: String, name: String) async {
        guard connectionState.isConnected else { return }
        let req = ClientRequest.renameSession(id: UUID().uuidString, sessionId: sessionId, name: name)
        _ = try? await ipcClient.send(req)
        await refreshSessions()
    }

    @MainActor
    public func updateSessionWorkspace(sessionId: String, cwd: String) async {
        guard connectionState.isConnected else { return }
        let req = ClientRequest.updateSessionWorkspace(id: UUID().uuidString, sessionId: sessionId, cwd: cwd)
        _ = try? await ipcClient.send(req)
        currentWorkspace = cwd
        refreshGitState()
        refreshFullGitStatus()
        Task {
            await refreshMemory()
            await refreshTasks()
        }
        await refreshSessions()
    }

    @MainActor
    public func switchWorkspace(to cwd: String) {
        currentWorkspace = cwd
        refreshGitState()
        refreshFullGitStatus()
        Task {
            await refreshMemory()
            await refreshTasks()
        }
    }

    @MainActor
    public func chatViewModel(for sessionId: String) -> ChatViewModel {
        if let vm = chatViewModels[sessionId] {
            return vm
        }
        let cwd = sessions.first(where: { $0.sessionId == sessionId })?.cwd ?? currentWorkspace
        let vm = ChatViewModel(sessionId: sessionId, cwd: cwd)
        chatViewModels[sessionId] = vm
        return vm
    }

    private func updateProjects(from loaded: [SessionInfo]) {
        var paths = Set<String>()
        var list: [WorkspaceProject] = []
        for s in loaded {
            let path = s.cwd.trimmingCharacters(in: .whitespacesAndNewlines)
            if !path.isEmpty && !paths.contains(path) {
                paths.insert(path)
                let name = URL(fileURLWithPath: path).lastPathComponent
                list.append(WorkspaceProject(name: name, path: path))
            }
        }
        self.projects = list
    }

    public var filteredSessions: [SessionInfo] {
        if searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return sessions
        }
        let q = searchQuery.lowercased()
        return sessions.filter { s in
            (s.name?.lowercased().contains(q) ?? false) || s.cwd.lowercased().contains(q)
        }
    }

    public func sessions(for category: DateCategory) -> [SessionInfo] {
        return filteredSessions.filter { $0.dateCategory == category }
    }

    public func sessions(in projectPath: String) -> [SessionInfo] {
        return filteredSessions.filter { $0.cwd == projectPath }
    }

    private func startEventListener() {
        eventListeningTask?.cancel()
        let client = self.ipcClient
        eventListeningTask = Task { @MainActor [weak self] in
            let stream = await client.events()
            for await (sid, evt) in stream {
                self?.routeEvent(sessionId: sid, event: evt)
            }
        }
    }

    @MainActor
    private func routeEvent(sessionId: String, event: [String: JSONValue]) {
        if let vm = chatViewModels[sessionId] {
            vm.handleEvent(event)
        }
    }

    // MARK: - Process Execution Helper
    public func runCommand(_ args: [String], cwd: String? = nil) -> (exitCode: Int32, stdout: String, stderr: String) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/git")
        process.arguments = args
        process.currentDirectoryURL = URL(fileURLWithPath: cwd ?? currentWorkspace)
        let outPipe = Pipe()
        let errPipe = Pipe()
        process.standardOutput = outPipe
        process.standardError = errPipe
        do {
            try process.run()
            process.waitUntilExit()
            let outData = outPipe.fileHandleForReading.readDataToEndOfFile()
            let errData = errPipe.fileHandleForReading.readDataToEndOfFile()
            let out = String(data: outData, encoding: .utf8) ?? ""
            let err = String(data: errData, encoding: .utf8) ?? ""
            return (process.terminationStatus, out, err)
        } catch {
            return (-1, "", error.localizedDescription)
        }
    }

    // MARK: - Git Operations
    public func refreshFullGitStatus() {
        isGitLoading = true
        defer { isGitLoading = false }

        let check = runCommand(["rev-parse", "--is-inside-work-tree"])
        guard check.exitCode == 0 else {
            fullGitStatus = GitStatusModel(isRepo: false)
            gitState = SessionGitState(hasGit: false, branch: nil)
            return
        }

        let res = runCommand(["status", "--porcelain=v1", "-b", "-uall"])
        var branchName = "main"
        var ahead = 0
        var behind = 0
        var items: [GitFileChangeItem] = []

        let lines = res.stdout.components(separatedBy: "\n")
        for line in lines {
            if line.hasPrefix("## ") {
                let header = String(line.dropFirst(3))
                let parts = header.components(separatedBy: "...")
                branchName = parts.first?.components(separatedBy: " ").first ?? "main"
                if let aheadRange = header.range(of: "ahead (\\d+)", options: .regularExpression),
                   let match = Int(header[aheadRange].replacingOccurrences(of: "ahead ", with: "")) {
                    ahead = match
                }
                if let behindRange = header.range(of: "behind (\\d+)", options: .regularExpression),
                   let match = Int(header[behindRange].replacingOccurrences(of: "behind ", with: "")) {
                    behind = match
                }
                continue
            }
            guard line.count >= 3 else { continue }
            let x = line[line.startIndex]
            let y = line[line.index(line.startIndex, offsetBy: 1)]
            let path = String(line.dropFirst(3)).trimmingCharacters(in: .whitespaces)

            if x == "?" && y == "?" {
                items.append(GitFileChangeItem(path: path, status: "untracked", staged: false))
            } else if x == "U" || y == "U" {
                items.append(GitFileChangeItem(path: path, status: "conflicted", staged: false))
            } else {
                if x != " " {
                    let st = x == "A" ? "added" : (x == "D" ? "deleted" : "modified")
                    items.append(GitFileChangeItem(path: path, status: st, staged: true))
                }
                if y != " " {
                    let st = y == "D" ? "deleted" : "modified"
                    items.append(GitFileChangeItem(path: path, status: st, staged: false))
                }
            }
        }

        fullGitStatus = GitStatusModel(isRepo: true, branch: branchName, ahead: ahead, behind: behind, files: items)
        gitState = SessionGitState(hasGit: true, branch: branchName)

        // Load branches
        let bRes = runCommand(["branch", "--format=%(refname:short)"])
        if bRes.exitCode == 0 {
            gitBranchesList = bRes.stdout.components(separatedBy: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        }
    }

    public func gitDiff(path: String, staged: Bool) -> String {
        var args = ["diff"]
        if staged { args.append("--cached") }
        args.append("--")
        args.append(path)
        let res = runCommand(args)
        return res.stdout
    }

    public func gitStage(path: String, all: Bool = false) {
        if all {
            _ = runCommand(["add", "-A"])
        } else {
            _ = runCommand(["add", "--", path])
        }
        refreshFullGitStatus()
    }

    public func gitUnstage(path: String, all: Bool = false) {
        if all {
            _ = runCommand(["restore", "--staged", "."])
        } else {
            _ = runCommand(["restore", "--staged", "--", path])
        }
        refreshFullGitStatus()
    }

    public func gitDiscard(path: String) {
        _ = runCommand(["restore", "--", path])
        _ = runCommand(["clean", "-fd", "--", path])
        refreshFullGitStatus()
    }

    public func gitCommit(message: String) -> (success: Bool, message: String) {
        let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return (false, "提交信息不能为空") }
        let res = runCommand(["commit", "-m", trimmed])
        refreshFullGitStatus()
        return (res.exitCode == 0, res.exitCode == 0 ? "提交成功" : (res.stderr.isEmpty ? res.stdout : res.stderr))
    }

    public func gitSync() -> (success: Bool, message: String) {
        let pullRes = runCommand(["pull", "--rebase"])
        let pushRes = runCommand(["push"])
        refreshFullGitStatus()
        let ok = pullRes.exitCode == 0 && pushRes.exitCode == 0
        let msg = ok ? "同步完成" : (pushRes.stderr.isEmpty ? pullRes.stderr : pushRes.stderr)
        return (ok, msg)
    }

    public func gitCheckout(branch: String) {
        _ = runCommand(["checkout", branch])
        refreshFullGitStatus()
    }

    public func gitCreateBranch(branch: String) {
        _ = runCommand(["checkout", "-b", branch])
        refreshFullGitStatus()
    }

    // MARK: - Memory Operations
    public func refreshMemory() async {
        isMemoryLoading = true
        defer { isMemoryLoading = false }
        loadMemoryHandbook()

        if connectionState.isConnected {
            let req = ClientRequest.app(id: UUID().uuidString, op: .listMemory(cwd: currentWorkspace, scope: memoryScope))
            if let resp = try? await ipcClient.send(req), let arr = resp["entries"]?.arrayValue ?? resp.arrayValue {
                var loaded: [MemoryEntryItem] = []
                for item in arr {
                    if let t = item["type"]?.stringValue, let k = item["key"]?.stringValue, let v = item["value"]?.stringValue {
                        loaded.append(MemoryEntryItem(type: t, key: k, value: v, body: item["body"]?.stringValue))
                    }
                }
                self.workspaceMemory = loaded
                return
            }
        }

        loadDefaultStarterMemory()
    }

    public func loadMemoryHandbook() {
        let candidates = [
            "\(currentWorkspace)/MEMORY.md",
            "\(FileManager.default.homeDirectoryForCurrentUser.path)/.openpi/agent/MEMORY.md"
        ]
        for path in candidates {
            if FileManager.default.fileExists(atPath: path),
               let str = try? String(contentsOfFile: path, encoding: .utf8) {
                self.memoryHandbookContent = str
                return
            }
        }
        self.memoryHandbookContent = "# OpenPI 知识手册 (MEMORY.md)\n\n记录项目架构规范、工程约定与关键经验。\n"
    }

    public func saveMemoryHandbook(content: String) {
        self.memoryHandbookContent = content
        let target = "\(currentWorkspace)/MEMORY.md"
        try? content.write(toFile: target, atomically: true, encoding: .utf8)
        let globalTarget = "\(FileManager.default.homeDirectoryForCurrentUser.path)/.openpi/agent/MEMORY.md"
        try? content.write(toFile: globalTarget, atomically: true, encoding: .utf8)
    }

    public func writeMemory(type: String, key: String, value: String, body: String? = nil) async {
        if connectionState.isConnected {
            let op = AppOp.writeMemory(cwd: currentWorkspace, scope: memoryScope, type: type, key: key, value: value, body: body)
            let req = ClientRequest.app(id: UUID().uuidString, op: op)
            _ = try? await ipcClient.send(req)
        }
        let newItem = MemoryEntryItem(type: type, key: key, value: value, body: body)
        workspaceMemory.removeAll(where: { $0.key == key && $0.type == type })
        workspaceMemory.insert(newItem, at: 0)
    }

    public func deleteMemory(type: String, key: String) async {
        if connectionState.isConnected {
            let op = AppOp.deleteMemory(cwd: currentWorkspace, scope: memoryScope, type: type, key: key)
            let req = ClientRequest.app(id: UUID().uuidString, op: op)
            _ = try? await ipcClient.send(req)
        }
        workspaceMemory.removeAll(where: { $0.key == key && $0.type == type })
    }

    private func loadDefaultStarterMemory() {
        if workspaceMemory.isEmpty {
            workspaceMemory = [
                MemoryEntryItem(type: "user", key: "reply-style", value: "偏好简洁中文：先结论，再必要细节；少套话。"),
                MemoryEntryItem(type: "project", key: "openpi-context", value: "本仓库是 OpenPI monorepo；轻量化原生系统。"),
                MemoryEntryItem(type: "lesson", key: "dev-habit", value: "改完相关代码再跑针对性测试；不要为了过检查而降级功能。")
            ]
        }
    }

    // MARK: - Tasks Operations
    public func refreshTasks() async {
        isTasksLoading = true
        defer { isTasksLoading = false }

        if connectionState.isConnected {
            let req = ClientRequest.app(id: UUID().uuidString, op: .listTasks)
            if let resp = try? await ipcClient.send(req), let arr = resp["tasks"]?.arrayValue ?? resp.arrayValue {
                var loaded: [ScheduledTaskItem] = []
                for item in arr {
                    let taskObj = item["task"] ?? item
                    if let id = taskObj["id"]?.stringValue,
                       let title = taskObj["title"]?.stringValue {
                        let prompt = taskObj["prompt"]?.stringValue ?? ""
                        let cwd = taskObj["cwd"]?.stringValue
                        let status = taskObj["status"]?.stringValue ?? "active"
                        let nextRun = taskObj["nextRunAt"]?.stringValue
                        var schedStr = "每天 09:00"
                        if let s = taskObj["schedule"]?.stringValue {
                            schedStr = s
                        } else if let sobj = taskObj["schedule"]?.objectValue {
                            schedStr = sobj["kind"]?.stringValue ?? "定时"
                        }
                        loaded.append(ScheduledTaskItem(
                            id: id,
                            title: title,
                            prompt: prompt,
                            cwd: cwd,
                            schedule: schedStr,
                            status: status,
                            nextRunAt: nextRun
                        ))
                    }
                }
                self.tasksList = loaded
                return
            }
        }

        if tasksList.isEmpty {
            tasksList = [
                ScheduledTaskItem(title: "代码质量与安全巡检", prompt: "检查仓库分支健康度与依赖漏洞", schedule: "每天 09:00", status: "active"),
                ScheduledTaskItem(title: "长期记忆自动脱水精炼", prompt: "整理会话历史知识沉淀至 MEMORY.md", schedule: "每周一 02:00", status: "active")
            ]
        }
    }

    public func createTask(title: String, prompt: String, schedule: String) async {
        let input = CreateTaskInput(
            title: title,
            prompt: prompt,
            cwd: currentWorkspace,
            schedule: TaskSchedule.cron(expression: schedule, timezone: nil),
            model: selectedModel
        )
        if connectionState.isConnected {
            let req = ClientRequest.app(id: UUID().uuidString, op: .createTask(input: input))
            _ = try? await ipcClient.send(req)
        }
        let newItem = ScheduledTaskItem(
            title: title,
            prompt: prompt,
            cwd: currentWorkspace,
            schedule: schedule,
            status: "active"
        )
        tasksList.insert(newItem, at: 0)
    }

    public func toggleTaskPause(taskId: String) async {
        guard let idx = tasksList.firstIndex(where: { $0.id == taskId }) else { return }
        let current = tasksList[idx].status == "active"
        let next = current ? "paused" : "active"
        tasksList[idx].status = next

        if connectionState.isConnected {
            let req = ClientRequest.app(id: UUID().uuidString, op: .setTaskPaused(taskId: taskId, paused: current))
            _ = try? await ipcClient.send(req)
        }
    }

    public func deleteTask(taskId: String) async {
        tasksList.removeAll(where: { $0.id == taskId })
        if connectionState.isConnected {
            let req = ClientRequest.app(id: UUID().uuidString, op: .deleteTask(taskId: taskId))
            _ = try? await ipcClient.send(req)
        }
    }

    public func runTask(taskId: String) async {
        if connectionState.isConnected {
            let req = ClientRequest.app(id: UUID().uuidString, op: .runTask(taskId: taskId))
            _ = try? await ipcClient.send(req)
        }
    }

    // MARK: - Skills Discovery
    public func refreshSkills() {
        let skillsDir = "\(FileManager.default.homeDirectoryForCurrentUser.path)/.openpi/agent/skills"
        guard let subdirs = try? FileManager.default.contentsOfDirectory(atPath: skillsDir) else { return }

        var list: [InstalledSkillItem] = []
        for dirName in subdirs {
            let skillMd = "\(skillsDir)/\(dirName)/SKILL.md"
            if FileManager.default.fileExists(atPath: skillMd),
               let content = try? String(contentsOfFile: skillMd, encoding: .utf8) {
                var desc = "智能体技能包"
                let lines = content.components(separatedBy: "\n")
                for line in lines {
                    if line.hasPrefix("description:") {
                        desc = String(line.dropFirst("description:".count)).trimmingCharacters(in: .whitespacesAndNewlines)
                        break
                    }
                }
                list.append(InstalledSkillItem(name: dirName, description: desc, path: "\(skillsDir)/\(dirName)"))
            }
        }
        self.installedSkills = list
    }

    // MARK: - Jev (System 1) Actions

    @MainActor
    public func refreshJevConfig() async {
        guard connectionState.isConnected else { return }
        let req = ClientRequest.app(id: UUID().uuidString, op: .jevGetConfig)
        if let resp = try? await ipcClient.send(req),
           let obj = resp["data"]?.objectValue {
            if let provStr = obj["provider"]?.stringValue,
               let prov = JevProviderType(rawValue: provStr) {
                let endpoint = obj["endpoint"]?.stringValue ?? prov.defaultEndpoint
                let apiKey = obj["apiKey"]?.stringValue ?? ""
                let model = obj["modelName"]?.stringValue ?? prov.defaultModel
                let timeout = Int(obj["timeoutMs"]?.numberValue ?? 3000)
                let enabled = obj["isEnabled"]?.boolValue ?? true
                self.jevConfig = JevConfig(
                    provider: prov,
                    endpoint: endpoint,
                    apiKey: apiKey,
                    modelName: model,
                    timeoutMs: timeout,
                    isEnabled: enabled
                )
            }
        }
    }

    @MainActor
    public func saveJevConfig(_ config: JevConfig) async {
        self.jevConfig = config
        guard connectionState.isConnected else { return }
        let req = ClientRequest.app(id: UUID().uuidString, op: .jevUpdateConfig(config: config))
        _ = try? await ipcClient.send(req)
    }

    @MainActor
    public func jevDecide(context: String, choices: [String], instruction: String? = nil) async -> JevChoiceResponse? {
        isJevTesting = true
        defer { isJevTesting = false }
        guard connectionState.isConnected else { return nil }
        let req = ClientRequest.app(id: UUID().uuidString, op: .jevDecide(context: context, choices: choices, instruction: instruction))
        if let resp = try? await ipcClient.send(req),
           let obj = resp["data"]?.objectValue {
            let selected = obj["selected"]?.stringValue ?? choices.first ?? ""
            let confidence = obj["confidence"]?.numberValue ?? 0.8
            var probs: [String: Double] = [:]
            if let pObj = obj["probabilities"]?.objectValue {
                for (k, v) in pObj {
                    if let n = v.numberValue { probs[k] = n }
                }
            }
            let latency = obj["latencyMs"]?.numberValue ?? 10.0
            let prov = obj["provider"]?.stringValue ?? jevConfig.provider.rawValue
            let result = JevChoiceResponse(
                selected: selected,
                confidence: confidence,
                probabilities: probs,
                latencyMs: latency,
                provider: prov
            )
            self.lastJevChoiceResult = result
            return result
        }
        return nil
    }

    @MainActor
    public func jevNoul(context: String, question: String) async -> JevNoulResponse? {
        isJevTesting = true
        defer { isJevTesting = false }
        guard connectionState.isConnected else { return nil }
        let req = ClientRequest.app(id: UUID().uuidString, op: .jevNoul(context: context, question: question))
        if let resp = try? await ipcClient.send(req),
           let obj = resp["data"]?.objectValue {
            let verdict = obj["verdict"]?.boolValue ?? false
            let confidence = obj["confidence"]?.numberValue ?? 0.8
            let latency = obj["latencyMs"]?.numberValue ?? 10.0
            let prov = obj["provider"]?.stringValue ?? jevConfig.provider.rawValue
            let result = JevNoulResponse(
                verdict: verdict,
                confidence: confidence,
                latencyMs: latency,
                provider: prov
            )
            self.lastJevNoulResult = result
            return result
        }
        return nil
    }

    @MainActor
    public func jevScore(context: String, criterion: String) async -> JevScoreResponse? {
        isJevTesting = true
        defer { isJevTesting = false }
        guard connectionState.isConnected else { return nil }
        let req = ClientRequest.app(id: UUID().uuidString, op: .jevScore(context: context, criterion: criterion))
        if let resp = try? await ipcClient.send(req),
           let obj = resp["data"]?.objectValue {
            let score = obj["score"]?.numberValue ?? 0.5
            let reasoning = obj["reasoning"]?.stringValue
            let latency = obj["latencyMs"]?.numberValue ?? 10.0
            let prov = obj["provider"]?.stringValue ?? jevConfig.provider.rawValue
            let result = JevScoreResponse(
                score: score,
                reasoning: reasoning,
                latencyMs: latency,
                provider: prov
            )
            self.lastJevScoreResult = result
            return result
        }
        return nil
    }
}

