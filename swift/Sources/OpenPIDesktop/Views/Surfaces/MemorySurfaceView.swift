import SwiftUI
import OpenPIProtocol

public struct MemorySurfaceView: View {
    @Bindable var appStore: AppStore
    @State private var selectedTab: MemoryTab = .handbook
    @State private var searchQuery: String = ""
    @State private var showAddEntrySheet: Bool = false
    @State private var newType: String = "project"
    @State private var newKey: String = ""
    @State private var newValue: String = ""
    @State private var isSavedFeedback: Bool = false

    public enum MemoryTab: String, CaseIterable, Identifiable {
        case handbook = "记忆手册 (MEMORY.md)"
        case entries = "沉淀条目 (Entries)"
        public var id: String { rawValue }
    }

    public init(appStore: AppStore) {
        self.appStore = appStore
    }

    public var body: some View {
        VStack(spacing: 0) {
            // Header
            headerBar

            Divider()

            // Main Tab Content
            switch selectedTab {
            case .handbook:
                handbookEditor
            case .entries:
                entriesListView
            }
        }
        .onAppear {
            Task {
                await appStore.refreshMemory()
            }
        }
        .sheet(isPresented: $showAddEntrySheet) {
            addEntrySheet
        }
    }

    // MARK: - Header Bar
    private var headerBar: some View {
        HStack(spacing: 12) {
            Button(action: { appStore.selectedTab = .chat }) {
                HStack(spacing: 4) {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 12, weight: .semibold))
                    Text("返回对话")
                        .font(.system(size: 13))
                }
                .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)

            Divider()
                .frame(height: 16)

            HStack(spacing: 8) {
                Image(systemName: "book.closed.fill")
                    .font(.system(size: 14))
                    .foregroundStyle(.orange)

                Text("长期记忆知识库")
                    .font(.system(size: 14, weight: .semibold))
            }

            Spacer()

            // Scope Picker
            Picker("", selection: $appStore.memoryScope) {
                Text("项目级 (Project)").tag("project")
                Text("全局级 (Global)").tag("global")
            }
            .pickerStyle(.segmented)
            .frame(width: 190)
            .onChange(of: appStore.memoryScope) {
                Task {
                    await appStore.refreshMemory()
                }
            }

            // Tab Switcher
            Picker("", selection: $selectedTab) {
                ForEach(MemoryTab.allCases) { tab in
                    Text(tab.rawValue).tag(tab)
                }
            }
            .pickerStyle(.segmented)
            .frame(width: 260)

            // Refresh
            Button(action: {
                Task {
                    await appStore.refreshMemory()
                }
            }) {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 11))
                    .padding(5)
                    .background(Color.primary.opacity(0.06))
                    .clipShape(RoundedRectangle(cornerRadius: 6))
            }
            .buttonStyle(.plain)
            .help("刷新记忆数据")
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 10)
        .background(Color(nsColor: .windowBackgroundColor))
    }

    // MARK: - Tab 1: Handbook Editor
    private var handbookEditor: some View {
        VStack(spacing: 0) {
            // Handbook Sub-header
            HStack {
                HStack(spacing: 6) {
                    Image(systemName: "doc.plaintext")
                        .font(.system(size: 12))
                        .foregroundStyle(.secondary)
                    Text("当前手册: \(appStore.currentWorkspace)/MEMORY.md")
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                Spacer()

                if isSavedFeedback {
                    HStack(spacing: 4) {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 11))
                        Text("已保存")
                            .font(.system(size: 11, weight: .medium))
                    }
                    .foregroundStyle(.green)
                    .transition(.opacity)
                }

                Button(action: {
                    appStore.saveMemoryHandbook(content: appStore.memoryHandbookContent)
                    withAnimation { isSavedFeedback = true }
                    DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                        withAnimation { isSavedFeedback = false }
                    }
                }) {
                    HStack(spacing: 4) {
                        Image(systemName: "square.and.arrow.down")
                            .font(.system(size: 11))
                        Text("保存手册")
                            .font(.system(size: 12, weight: .medium))
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 5)
                    .background(Color.orange)
                    .foregroundStyle(.white)
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 8)
            .background(Color.primary.opacity(0.02))

            Divider()

            // TextEditor
            TextEditor(text: $appStore.memoryHandbookContent)
                .font(.system(size: 13, design: .monospaced))
                .padding(14)
                .scrollContentBackground(.hidden)
                .background(Color(nsColor: .textBackgroundColor))
        }
    }

    // MARK: - Tab 2: Entries List
    private var entriesListView: some View {
        VStack(spacing: 0) {
            // Filter Bar
            HStack(spacing: 8) {
                HStack(spacing: 6) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                    TextField("搜索记忆条目...", text: $searchQuery)
                        .textFieldStyle(.plain)
                        .font(.system(size: 12))
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 5)
                .background(Color.primary.opacity(0.04))
                .clipShape(RoundedRectangle(cornerRadius: 6))

                Spacer()

                Button(action: { showAddEntrySheet = true }) {
                    HStack(spacing: 4) {
                        Image(systemName: "plus")
                            .font(.system(size: 11, weight: .semibold))
                        Text("新增条目")
                            .font(.system(size: 12))
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(Color.blue)
                    .foregroundStyle(.white)
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 8)
            .background(Color.primary.opacity(0.02))

            Divider()

            // Entries List
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 10) {
                    let filtered = filteredEntries
                    if filtered.isEmpty {
                        VStack(spacing: 8) {
                            Image(systemName: "book.closed")
                                .font(.system(size: 32))
                                .foregroundStyle(.tertiary)
                            Text("暂无符合条件的记忆条目")
                                .font(.system(size: 12))
                                .foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.top, 50)
                    } else {
                        ForEach(filtered) { entry in
                            entryCard(entry)
                        }
                    }
                }
                .padding(18)
            }
        }
    }

    private var filteredEntries: [MemoryEntryItem] {
        if searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return appStore.workspaceMemory
        }
        let q = searchQuery.lowercased()
        return appStore.workspaceMemory.filter {
            $0.key.lowercased().contains(q) || $0.value.lowercased().contains(q) || $0.type.lowercased().contains(q)
        }
    }

    private func entryCard(_ entry: MemoryEntryItem) -> some View {
        HStack(alignment: .top, spacing: 12) {
            typeBadge(entry.type)

            VStack(alignment: .leading, spacing: 3) {
                Text(entry.key)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.primary)

                Text(entry.value)
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
            }

            Spacer()

            Button(action: {
                Task {
                    await appStore.deleteMemory(type: entry.type, key: entry.key)
                }
            }) {
                Image(systemName: "trash")
                    .font(.system(size: 11))
                    .foregroundStyle(.tertiary)
                    .padding(5)
            }
            .buttonStyle(.plain)
            .help("删除此记忆条目")
        }
        .padding(12)
        .background(Color(nsColor: .controlBackgroundColor).opacity(0.6))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(Color.primary.opacity(0.06), lineWidth: 1)
        )
    }

    private func typeBadge(_ type: String) -> some View {
        let color: Color
        switch type {
        case "user": color = .blue
        case "project": color = .orange
        case "lesson": color = .green
        case "rule": color = .purple
        default: color = .secondary
        }
        return Text(type)
            .font(.system(size: 10, weight: .bold))
            .foregroundStyle(color)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(color.opacity(0.12))
            .clipShape(Capsule())
    }

    // MARK: - Add Entry Sheet
    private var addEntrySheet: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("新增知识库记忆条目")
                .font(.system(size: 15, weight: .semibold))

            VStack(alignment: .leading, spacing: 4) {
                Text("记忆类型 (Type):")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(.secondary)
                Picker("", selection: $newType) {
                    Text("user (用户偏好)").tag("user")
                    Text("project (项目上下文)").tag("project")
                    Text("lesson (经验教训)").tag("lesson")
                    Text("rule (工程规范)").tag("rule")
                }
                .pickerStyle(.menu)
            }

            VStack(alignment: .leading, spacing: 4) {
                Text("标识键 (Key):")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(.secondary)
                TextField("如: reply-style, dev-habit", text: $newKey)
                    .textFieldStyle(.roundedBorder)
                    .font(.system(size: 12))
            }

            VStack(alignment: .leading, spacing: 4) {
                Text("内容 (Value):")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(.secondary)
                TextField("描述具体的上下文或经验...", text: $newValue)
                    .textFieldStyle(.roundedBorder)
                    .font(.system(size: 12))
            }

            HStack {
                Button("取消") {
                    showAddEntrySheet = false
                    newKey = ""
                    newValue = ""
                }
                .buttonStyle(.plain)

                Spacer()

                Button("添加条目") {
                    let k = newKey.trimmingCharacters(in: .whitespacesAndNewlines)
                    let v = newValue.trimmingCharacters(in: .whitespacesAndNewlines)
                    if !k.isEmpty && !v.isEmpty {
                        Task {
                            await appStore.writeMemory(type: newType, key: k, value: v)
                        }
                    }
                    showAddEntrySheet = false
                    newKey = ""
                    newValue = ""
                }
                .buttonStyle(.borderedProminent)
                .disabled(newKey.isEmpty || newValue.isEmpty)
            }
            .padding(.top, 6)
        }
        .padding(20)
        .frame(width: 380)
    }
}
