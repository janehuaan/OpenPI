import SwiftUI
import OpenPIProtocol
import AppKit

public struct SidebarView: View {
    @Bindable var appStore: AppStore
    @State private var expandedProjects: Set<String> = []

    public init(appStore: AppStore) {
        self.appStore = appStore
    }

    public var body: some View {
        VStack(spacing: 0) {
            // 1. Sidebar Header (Brand & New Action)
            HStack(spacing: 8) {
                HStack(spacing: 6) {
                    Image(systemName: "cpu.fill")
                        .font(.system(size: 15))
                        .foregroundStyle(Color.blue)
                    Text("OpenPI")
                        .font(.system(size: 15, weight: .bold))
                }

                Spacer()

                Button(action: {
                    Task {
                        _ = await appStore.createSession()
                    }
                }) {
                    Image(systemName: "plus")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(.secondary)
                        .padding(5)
                        .background(Color.primary.opacity(0.06))
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                }
                .buttonStyle(.plain)
                .help("新建对话 (Cmd+N)")

                Button(action: {}) {
                    Image(systemName: "sidebar.left")
                        .font(.system(size: 12))
                        .foregroundStyle(.secondary)
                        .padding(5)
                        .background(Color.primary.opacity(0.06))
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                }
                .buttonStyle(.plain)
                .help("收起侧边栏")
            }
            .padding(.horizontal, 14)
            .padding(.top, 14)
            .padding(.bottom, 10)

            // 2. Search Bar
            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)

                TextField("搜索对话或项目 (⌘K)", text: $appStore.searchQuery)
                    .textFieldStyle(.plain)
                    .font(.system(size: 11.5))

                if !appStore.searchQuery.isEmpty {
                    Button(action: { appStore.searchQuery = "" }) {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 11))
                            .foregroundStyle(.tertiary)
                    }
                    .buttonStyle(.plain)
                } else {
                    Text("⌘K")
                        .font(.system(size: 9.5, weight: .medium, design: .monospaced))
                        .foregroundStyle(.secondary.opacity(0.8))
                        .padding(.horizontal, 4)
                        .padding(.vertical, 1)
                        .background(Color.primary.opacity(0.06))
                        .clipShape(RoundedRectangle(cornerRadius: 3))
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .background(Color.primary.opacity(0.04))
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .padding(.horizontal, 12)
            .padding(.bottom, 10)

            // 3. Top Navigation Actions (Git, Memory, Tasks)
            VStack(spacing: 2) {
                NavigationActionRow(
                    icon: "point.topleft.down.curvedto.point.bottomright.up",
                    title: "版本管理",
                    isSelected: appStore.selectedTab == .git
                ) {
                    appStore.selectedTab = .git
                }

                NavigationActionRow(
                    icon: "book.closed",
                    title: "长期记忆",
                    isSelected: appStore.selectedTab == .memory
                ) {
                    appStore.selectedTab = .memory
                }

                NavigationActionRow(
                    icon: "checklist",
                    title: "定时任务",
                    isSelected: appStore.selectedTab == .tasks
                ) {
                    appStore.selectedTab = .tasks
                }
            }
            .padding(.horizontal, 10)
            .padding(.bottom, 8)

            Divider()
                .padding(.horizontal, 10)

            // 4. Scrollable Content: Project Workspaces & Grouped Sessions
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    // Projects Section
                    if !appStore.projects.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text("项目工程")
                                    .font(.system(size: 11, weight: .semibold))
                                    .foregroundStyle(.secondary)
                                Spacer()
                                Button(action: addProjectFolder) {
                                    Image(systemName: "folder.badge.plus")
                                        .font(.system(size: 11))
                                        .foregroundStyle(.tertiary)
                                }
                                .buttonStyle(.plain)
                                .help("添加本地项目工程...")
                            }
                            .padding(.horizontal, 14)
                            .padding(.top, 6)

                            ForEach(appStore.projects) { project in
                                ProjectFolderSection(
                                    project: project,
                                    isExpanded: expandedProjects.contains(project.path) || expandedProjects.isEmpty,
                                    appStore: appStore,
                                    onToggle: {
                                        if expandedProjects.contains(project.path) {
                                            expandedProjects.remove(project.path)
                                        } else {
                                            expandedProjects.insert(project.path)
                                        }
                                    }
                                )
                            }
                        }
                    }

                    // Grouped Sessions
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text("最近会话 (\(appStore.sessions.count))")
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(.secondary)
                            Spacer()
                        }
                        .padding(.horizontal, 14)

                        ForEach(DateCategory.allCases) { category in
                            let list = appStore.sessions(for: category)
                            if !list.isEmpty {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(category.rawValue)
                                        .font(.system(size: 10, weight: .medium))
                                        .foregroundStyle(.tertiary)
                                        .padding(.horizontal, 14)
                                        .padding(.vertical, 2)

                                    ForEach(list) { session in
                                        SessionRowView(
                                            session: session,
                                            isSelected: appStore.selectedSessionId == session.sessionId,
                                            onSelect: {
                                                Task {
                                                    await appStore.selectSession(sessionId: session.sessionId)
                                                }
                                            },
                                            onDelete: {
                                                Task {
                                                    await appStore.deleteSession(sessionId: session.sessionId)
                                                }
                                            }
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
                .padding(.vertical, 6)
            }

            Divider()

            // 5. User Profile Bar (Huaan, Pro badge, theme & settings)
            HStack(spacing: 8) {
                // User Avatar (H)
                ZStack {
                    Circle()
                        .fill(Color.primary.opacity(0.12))
                        .frame(width: 24, height: 24)
                    Text(appStore.avatarEmoji)
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(.primary)
                }

                Text(appStore.nickname)
                    .font(.system(size: 12, weight: .medium))

                if appStore.isPro {
                    Text("Pro")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(.orange)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 1.5)
                        .background(Color.orange.opacity(0.12))
                        .clipShape(Capsule())
                }

                Spacer()

                // Dark mode toggle
                Button(action: {
                    appStore.isDarkMode.toggle()
                }) {
                    Image(systemName: appStore.isDarkMode ? "sun.max" : "moon")
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)

                // Tuning / Controls
                Button(action: {
                    appStore.showSettingsModal = true
                }) {
                    Image(systemName: "slider.horizontal.3")
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
                .help("模型与系统参数设置")

                // Settings
                Button(action: {
                    appStore.showSettingsModal = true
                }) {
                    Image(systemName: "wrench.and.screwdriver")
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
                .help("系统设置与偏好配置")
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(Color.primary.opacity(0.02))
        }
        .background(Color(nsColor: .windowBackgroundColor))
    }

    private func addProjectFolder() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.prompt = "添加项目"
        panel.begin { response in
            guard response == .OK, let url = panel.url else { return }
            Task {
                _ = await appStore.createSession(cwd: url.path, mode: .code, name: url.lastPathComponent)
            }
        }
    }
}

// ── Components ─────────────────────────────────────────────────────────────

struct NavigationActionRow: View {
    let icon: String
    let title: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: icon)
                    .font(.system(size: 12))
                    .frame(width: 16)
                    .foregroundStyle(isSelected ? Color.accentColor : .secondary)

                Text(title)
                    .font(.system(size: 12, weight: isSelected ? .medium : .regular))
                    .foregroundStyle(isSelected ? Color.primary : .secondary)

                Spacer()
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .background(isSelected ? Color.accentColor.opacity(0.1) : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: 6))
        }
        .buttonStyle(.plain)
    }
}

struct ProjectFolderSection: View {
    let project: WorkspaceProject
    let isExpanded: Bool
    let appStore: AppStore
    let onToggle: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Button(action: onToggle) {
                HStack(spacing: 6) {
                    Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                        .font(.system(size: 9))
                        .foregroundStyle(.tertiary)
                        .frame(width: 10)

                    Image(systemName: "folder")
                        .font(.system(size: 12))
                        .foregroundStyle(.blue)

                    VStack(alignment: .leading, spacing: 0) {
                        Text(project.name)
                            .font(.system(size: 12, weight: .medium))
                            .lineLimit(1)
                        Text(project.path)
                            .font(.system(size: 9))
                            .foregroundStyle(.tertiary)
                            .lineLimit(1)
                    }

                    Spacer()
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 4)
            }
            .buttonStyle(.plain)

            if isExpanded {
                let projectSessions = appStore.sessions(in: project.path)
                ForEach(projectSessions) { s in
                    SessionRowView(
                        session: s,
                        isSelected: appStore.selectedSessionId == s.sessionId,
                        indent: true,
                        onSelect: {
                            Task {
                                await appStore.selectSession(sessionId: s.sessionId)
                            }
                        },
                        onDelete: {
                            Task {
                                await appStore.deleteSession(sessionId: s.sessionId)
                            }
                        }
                    )
                }
            }
        }
    }
}

struct SessionRowView: View {
    let session: SessionInfo
    let isSelected: Bool
    var indent: Bool = false
    let onSelect: () -> Void
    let onDelete: () -> Void

    var body: some View {
        Button(action: onSelect) {
            HStack(spacing: 8) {
                Image(systemName: "bubble.left")
                    .font(.system(size: 11))
                    .foregroundStyle(isSelected ? Color.accentColor : .secondary)

                Text(session.name ?? "未命名会话")
                    .font(.system(size: 12))
                    .foregroundStyle(isSelected ? Color.primary : .secondary)
                    .lineLimit(1)

                Spacer()

                if session.running {
                    Circle()
                        .fill(Color.green)
                        .frame(width: 6, height: 6)
                }

                Text(session.displayTime)
                    .font(.system(size: 10))
                    .foregroundStyle(.tertiary)
            }
            .padding(.leading, indent ? 24 : 14)
            .padding(.trailing, 12)
            .padding(.vertical, 6)
            .background(isSelected ? Color.orange.opacity(0.12) : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .padding(.horizontal, 6)
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button {
                let url = URL(fileURLWithPath: session.cwd)
                NSWorkspace.shared.activateFileViewerSelecting([url])
            } label: {
                Label("在访达中显示工作区", systemImage: "folder")
            }

            Button {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(session.sessionId, forType: .string)
            } label: {
                Label("复制会话 ID", systemImage: "doc.on.doc")
            }

            Divider()

            Button(role: .destructive, action: onDelete) {
                Label("删除会话", systemImage: "trash")
            }
        }
    }
}
