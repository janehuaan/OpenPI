import SwiftUI
import OpenPIProtocol
import AppKit

public struct MainContentView: View {
    @Bindable var appStore: AppStore

    @State private var showRenameModal: Bool = false
    @State private var renameSessionId: String = ""
    @State private var renameSessionName: String = ""

    public init(appStore: AppStore) {
        self.appStore = appStore
    }

    public var body: some View {
        Group {
            switch appStore.selectedTab {
            case .chat:
                chatView
            case .git:
                GitSurfaceView(appStore: appStore)
            case .memory:
                MemorySurfaceView(appStore: appStore)
            case .tasks:
                TasksSurfaceView(appStore: appStore)
            }
        }
    }

    @ViewBuilder
    private var chatView: some View {
        if let sid = appStore.selectedSessionId {
            let vm = appStore.chatViewModel(for: sid)
            let session = appStore.sessions.first(where: { $0.sessionId == sid })

            VStack(spacing: 0) {
                // Top Header Bar
                HStack(spacing: 10) {
                    // Session Workspace Folder & Name
                    HStack(spacing: 8) {
                        Image(systemName: "folder")
                            .font(.system(size: 13))
                            .foregroundStyle(.blue)

                        VStack(alignment: .leading, spacing: 1) {
                            HStack(spacing: 6) {
                                Text(session?.name ?? "新会话")
                                    .font(.system(size: 13, weight: .semibold))
                                    .lineLimit(1)

                                Button(action: {
                                    renameSessionId = sid
                                    renameSessionName = session?.name ?? ""
                                    showRenameModal = true
                                }) {
                                    Image(systemName: "pencil")
                                        .font(.system(size: 10))
                                        .foregroundStyle(.tertiary)
                                }
                                .buttonStyle(.plain)
                                .help("重命名会话")
                                .sheet(isPresented: $showRenameModal) {
                                    renameModalView
                                }

                                Text(session?.mode == .code ? "Code" : "Chat")
                                    .font(.system(size: 9.5, weight: .medium))
                                    .padding(.horizontal, 5)
                                    .padding(.vertical, 1.5)
                                    .background(Color.blue.opacity(0.1))
                                    .foregroundStyle(.blue)
                                    .clipShape(Capsule())
                            }

                            // Workspace Selector Menu
                            Menu {
                                Text("当前工作区切换")
                                    .font(.system(size: 11))

                                ForEach(appStore.projects) { proj in
                                    Button {
                                        Task {
                                            await appStore.updateSessionWorkspace(sessionId: sid, cwd: proj.path)
                                        }
                                    } label: {
                                        HStack {
                                            Text(proj.name)
                                            if proj.path == (session?.cwd ?? vm.cwd) {
                                                Image(systemName: "checkmark")
                                            }
                                        }
                                    }
                                }

                                Divider()

                                Button {
                                    selectLocalProject(for: sid)
                                } label: {
                                    Label("打开其他本地文件夹...", systemImage: "folder.badge.plus")
                                }

                                Button {
                                    let home = FileManager.default.homeDirectoryForCurrentUser.path
                                    Task {
                                        await appStore.updateSessionWorkspace(sessionId: sid, cwd: home)
                                    }
                                } label: {
                                    Label("脱离工作区 (通用会话)", systemImage: "folder.badge.minus")
                                }
                            } label: {
                                HStack(spacing: 3) {
                                    Text(shortCwd(session?.cwd ?? vm.cwd) + " 工作区")
                                        .font(.system(size: 10.5))
                                        .foregroundStyle(.secondary)
                                    Image(systemName: "chevron.down")
                                        .font(.system(size: 8))
                                        .foregroundStyle(.tertiary)
                                }
                            }
                            .menuStyle(.borderlessButton)
                        }
                    }

                    Spacer()

                    // Right Status & Toolbar Actions
                    HStack(spacing: 10) {
                        if vm.isGenerating {
                            HStack(spacing: 4) {
                                ProgressView()
                                    .controlSize(.mini)
                                Text("处理中...")
                                    .font(.system(size: 11, weight: .medium))
                                    .foregroundStyle(.orange)
                            }
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3.5)
                            .background(Color.orange.opacity(0.1))
                            .clipShape(Capsule())
                        }

                        // Export Button
                        Button(action: {
                            exportSessionToMarkdown(vm: vm, session: session)
                        }) {
                            Image(systemName: "arrow.down.to.line")
                                .font(.system(size: 12))
                                .foregroundStyle(.secondary)
                        }
                        .buttonStyle(.plain)
                        .help("导出对话 Markdown (⌘⇧E)")

                        // Web / Browser Button
                        Button(action: {
                            if let url = URL(string: "http://localhost:3000") {
                                NSWorkspace.shared.open(url)
                            }
                        }) {
                            Image(systemName: "globe")
                                .font(.system(size: 12))
                                .foregroundStyle(.secondary)
                        }
                        .buttonStyle(.plain)
                        .help("在浏览器中打开 (http://localhost:3000)")

                        // Subagents Team Button
                        Button(action: {
                            appStore.selectedTab = .tasks
                        }) {
                            Image(systemName: "person.2")
                                .font(.system(size: 12))
                                .foregroundStyle(.secondary)
                        }
                        .buttonStyle(.plain)
                        .help("任务与子代理调度")

                        // Handbook Button
                        Button(action: {
                            appStore.selectedTab = .memory
                        }) {
                            Image(systemName: "book")
                                .font(.system(size: 12))
                                .foregroundStyle(.secondary)
                        }
                        .buttonStyle(.plain)
                        .help("查看长期记忆与手册")

                        // More Actions Menu
                        Menu {
                            Section("快捷导航") {
                                Button {
                                    appStore.selectedTab = .git
                                } label: {
                                    Label("版本管理 (Git)", systemImage: "point.topleft.down.curvedto.point.bottomright.up")
                                }

                                Button {
                                    appStore.selectedTab = .memory
                                } label: {
                                    Label("长期记忆知识库", systemImage: "book.closed")
                                }

                                Button {
                                    appStore.selectedTab = .tasks
                                } label: {
                                    Label("定时任务与编排", systemImage: "checklist")
                                }

                                Button {
                                    appStore.showSettingsModal = true
                                } label: {
                                    Label("系统设置与模型", systemImage: "gearshape")
                                }
                            }

                            Section("会话管理") {
                                Button {
                                    renameSessionId = sid
                                    renameSessionName = session?.name ?? ""
                                    showRenameModal = true
                                } label: {
                                    Label("重命名会话", systemImage: "pencil")
                                }

                                Button {
                                    exportSessionToMarkdown(vm: vm, session: session)
                                } label: {
                                    Label("导出为 Markdown...", systemImage: "arrow.down.to.line")
                                }

                                Divider()

                                Button(role: .destructive) {
                                    Task {
                                        await appStore.deleteSession(sessionId: sid)
                                    }
                                } label: {
                                    Label("删除会话", systemImage: "trash")
                                }
                            }
                        } label: {
                            Image(systemName: "ellipsis")
                                .font(.system(size: 12))
                                .foregroundStyle(.secondary)
                        }
                        .menuStyle(.borderlessButton)
                    }
                }
                .padding(.horizontal, 18)
                .padding(.vertical, 10)
                .background(Color(nsColor: .windowBackgroundColor).opacity(0.85))

                Divider()

                // Chat Messages Timeline
                ChatTimelineView(viewModel: vm)

                // Bottom Input
                ChatInputBar(viewModel: vm, appStore: appStore)
            }
        } else {
            VStack(spacing: 16) {
                Image(systemName: "bubble.left.and.bubble.right")
                    .font(.system(size: 44))
                    .foregroundStyle(.tertiary)

                Text("请选择或新建一个会话开始探索")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(.secondary)

                Button(action: {
                    Task {
                        _ = await appStore.createSession()
                    }
                }) {
                    Label("新建会话", systemImage: "plus")
                        .font(.system(size: 13, weight: .medium))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(Color.accentColor)
                        .foregroundStyle(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                .buttonStyle(.plain)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    @ViewBuilder
    private var renameModalView: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("重命名会话")
                .font(.system(size: 15, weight: .bold))

            TextField("会话名称", text: $renameSessionName)
                .textFieldStyle(.roundedBorder)
                .font(.system(size: 13))

            HStack {
                Spacer()

                Button("取消") {
                    showRenameModal = false
                }
                .keyboardShortcut(.cancelAction)

                Button("保存") {
                    let sid = renameSessionId
                    let newName = renameSessionName.trimmingCharacters(in: .whitespacesAndNewlines)
                    if !newName.isEmpty {
                        Task {
                            await appStore.renameSession(sessionId: sid, name: newName)
                        }
                    }
                    showRenameModal = false
                }
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.defaultAction)
            }
        }
        .padding(20)
        .frame(width: 360)
    }

    private func selectLocalProject(for sessionId: String) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = true
        panel.prompt = "选择项目"
        panel.begin { response in
            guard response == .OK, let url = panel.url else { return }
            Task {
                await appStore.updateSessionWorkspace(sessionId: sessionId, cwd: url.path)
            }
        }
    }

    private func exportSessionToMarkdown(vm: ChatViewModel, session: SessionInfo?) {
        let panel = NSSavePanel()
        panel.allowedContentTypes = [.plainText]
        let base = (session?.name ?? "OpenPI_Session").replacingOccurrences(of: "/", with: "_")
        panel.nameFieldStringValue = "\(base).md"
        panel.begin { response in
            guard response == .OK, let url = panel.url else { return }
            var md = "# \(session?.name ?? "OpenPI 对话记录")\n\n"
            md += "- **导出时间**: \(Date().formatted())\n"
            md += "- **工作区**: `\(session?.cwd ?? vm.cwd)`\n\n---\n\n"
            for msg in vm.messages {
                let roleName: String
                switch msg.role.lowercased() {
                case "user": roleName = "### 👤 User"
                case "assistant": roleName = "### 🤖 OpenPI Assistant"
                default: roleName = "### ⚙️ System (\(msg.role))"
                }
                md += "\(roleName)\n\n"
                if let thinking = msg.thinking, !thinking.isEmpty {
                    md += "> 💭 **Thinking**:\n"
                    for line in thinking.components(separatedBy: "\n") {
                        md += "> \(line)\n"
                    }
                    md += "\n\n"
                }
                md += "\(msg.content)\n\n---\n\n"
            }
            try? md.write(to: url, atomically: true, encoding: .utf8)
        }
    }

    private func shortCwd(_ path: String) -> String {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        if path.hasPrefix(home) {
            let relative = path.dropFirst(home.count).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            return relative.isEmpty ? "主目录" : relative
        }
        return URL(fileURLWithPath: path).lastPathComponent
    }
}
