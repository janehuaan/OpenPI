import SwiftUI
import OpenPIProtocol

public struct GitSurfaceView: View {
    @Bindable var appStore: AppStore
    @State private var selectedFile: GitFileChangeItem?
    @State private var currentDiff: String = ""
    @State private var commitMessage: String = ""
    @State private var showNewBranchSheet: Bool = false
    @State private var newBranchName: String = ""
    @State private var actionMessage: String?
    @State private var isActionSuccess: Bool = true

    public init(appStore: AppStore) {
        self.appStore = appStore
    }

    public var body: some View {
        VStack(spacing: 0) {
            // 1. Surface Top Header
            headerBar

            Divider()

            // 2. Main Content Split View
            if !appStore.fullGitStatus.isRepo {
                notRepoView
            } else {
                GeometryReader { geo in
                    HStack(spacing: 0) {
                        // Left Files & Commit Pane
                        VStack(spacing: 0) {
                            fileChangeList
                            Divider()
                            commitPanel
                        }
                        .frame(width: max(280, min(360, geo.size.width * 0.35)))

                        Divider()

                        // Right Diff Viewer Pane
                        diffViewerPane
                    }
                }
            }
        }
        .onAppear {
            appStore.refreshFullGitStatus()
            if selectedFile == nil, let first = appStore.fullGitStatus.files.first {
                selectFile(first)
            }
        }
        .sheet(isPresented: $showNewBranchSheet) {
            newBranchSheet
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
                Image(systemName: "point.topleft.down.curvedto.point.bottomright.up")
                    .font(.system(size: 14))
                    .foregroundStyle(.blue)

                Text("版本管理中心")
                    .font(.system(size: 14, weight: .semibold))
            }

            Spacer()

            if appStore.fullGitStatus.isRepo {
                // Branch Selector Menu
                Menu {
                    ForEach(appStore.gitBranchesList, id: \.self) { branch in
                        Button(action: {
                            appStore.gitCheckout(branch: branch)
                        }) {
                            HStack {
                                Text(branch)
                                if branch == appStore.fullGitStatus.branch {
                                    Image(systemName: "checkmark")
                                }
                            }
                        }
                    }
                    Divider()
                    Button(action: { showNewBranchSheet = true }) {
                        Label("创建新分支...", systemImage: "plus")
                    }
                } label: {
                    HStack(spacing: 5) {
                        Image(systemName: "arrow.triangle.branch")
                            .font(.system(size: 11))
                        Text(appStore.fullGitStatus.branch)
                            .font(.system(size: 12, weight: .medium))
                        Image(systemName: "chevron.up.chevron.down")
                            .font(.system(size: 9))
                            .foregroundStyle(.tertiary)
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(Color.primary.opacity(0.06))
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                }
                .menuStyle(.borderlessButton)
                .fixedSize()

                // Sync (Pull & Push) Button
                Button(action: {
                    let res = appStore.gitSync()
                    actionMessage = res.message
                    isActionSuccess = res.success
                }) {
                    HStack(spacing: 4) {
                        Image(systemName: "arrow.triangle.2.circlepath")
                            .font(.system(size: 11))
                        Text("同步")
                            .font(.system(size: 12))
                    }
                    .padding(.horizontal, 9)
                    .padding(.vertical, 4)
                    .background(Color.primary.opacity(0.06))
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                }
                .buttonStyle(.plain)
                .help("拉取并推送最新变更 (git pull --rebase && git push)")

                // Refresh Button
                Button(action: {
                    appStore.refreshFullGitStatus()
                    if let f = selectedFile {
                        selectFile(f)
                    }
                }) {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 11))
                        .padding(5)
                        .background(Color.primary.opacity(0.06))
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                }
                .buttonStyle(.plain)
                .help("刷新 Git 状态")
            }
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 10)
        .background(Color(nsColor: .windowBackgroundColor))
    }

    // MARK: - Left Pane: File Changes List
    private var fileChangeList: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                let staged = appStore.fullGitStatus.files.filter { $0.staged }
                let unstaged = appStore.fullGitStatus.files.filter { !$0.staged && $0.status != "untracked" }
                let untracked = appStore.fullGitStatus.files.filter { $0.status == "untracked" }

                if appStore.fullGitStatus.files.isEmpty {
                    VStack(spacing: 8) {
                        Image(systemName: "checkmark.circle")
                            .font(.system(size: 28))
                            .foregroundStyle(.green)
                        Text("工作区干净，无未提交的变更")
                            .font(.system(size: 12))
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.top, 40)
                }

                // Staged Section
                if !staged.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text("暂存区变更 (\(staged.count))")
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(.secondary)
                            Spacer()
                            Button("全部取消") {
                                appStore.gitUnstage(path: "", all: true)
                            }
                            .font(.system(size: 10.5))
                            .buttonStyle(.plain)
                            .foregroundStyle(.blue)
                        }
                        .padding(.horizontal, 14)

                        ForEach(staged) { item in
                            fileRow(item)
                        }
                    }
                }

                // Unstaged Section
                if !unstaged.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text("未暂存修改 (\(unstaged.count))")
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(.secondary)
                            Spacer()
                            Button("全部暂存") {
                                appStore.gitStage(path: "", all: true)
                            }
                            .font(.system(size: 10.5))
                            .buttonStyle(.plain)
                            .foregroundStyle(.blue)
                        }
                        .padding(.horizontal, 14)

                        ForEach(unstaged) { item in
                            fileRow(item)
                        }
                    }
                }

                // Untracked Section
                if !untracked.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text("未跟踪文件 (\(untracked.count))")
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(.secondary)
                            Spacer()
                        }
                        .padding(.horizontal, 14)

                        ForEach(untracked) { item in
                            fileRow(item)
                        }
                    }
                }
            }
            .padding(.vertical, 10)
        }
    }

    private func fileRow(_ item: GitFileChangeItem) -> some View {
        let isSelected = selectedFile?.id == item.id
        return HStack(spacing: 6) {
            statusBadge(item.status)

            Text(item.path)
                .font(.system(size: 12, design: .monospaced))
                .lineLimit(1)
                .foregroundStyle(isSelected ? Color.primary : .secondary)

            Spacer()

            if item.staged {
                Button(action: {
                    appStore.gitUnstage(path: item.path)
                }) {
                    Image(systemName: "minus")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(.secondary)
                        .padding(4)
                }
                .buttonStyle(.plain)
                .help("取消暂存")
            } else {
                Button(action: {
                    appStore.gitStage(path: item.path)
                }) {
                    Image(systemName: "plus")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(.secondary)
                        .padding(4)
                }
                .buttonStyle(.plain)
                .help("暂存变更")

                if item.status != "untracked" {
                    Button(action: {
                        appStore.gitDiscard(path: item.path)
                    }) {
                        Image(systemName: "arrow.uturn.backward")
                            .font(.system(size: 10))
                            .foregroundStyle(.secondary)
                            .padding(4)
                    }
                    .buttonStyle(.plain)
                    .help("放弃当前修改")
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 5)
        .background(isSelected ? Color.primary.opacity(0.08) : Color.clear)
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .padding(.horizontal, 6)
        .contentShape(Rectangle())
        .onTapGesture {
            selectFile(item)
        }
    }

    private func statusBadge(_ status: String) -> some View {
        let text: String
        let color: Color
        switch status {
        case "added": text = "A"; color = .green
        case "modified": text = "M"; color = .orange
        case "deleted": text = "D"; color = .red
        case "untracked": text = "?"; color = .purple
        case "conflicted": text = "C"; color = .red
        default: text = "M"; color = .orange
        }
        return Text(text)
            .font(.system(size: 9.5, weight: .bold, design: .monospaced))
            .foregroundStyle(color)
            .frame(width: 16, height: 16)
            .background(color.opacity(0.12))
            .clipShape(RoundedRectangle(cornerRadius: 3))
    }

    // MARK: - Bottom Commit Panel
    private var commitPanel: some View {
        VStack(spacing: 8) {
            if let msg = actionMessage {
                HStack(spacing: 4) {
                    Image(systemName: isActionSuccess ? "checkmark.circle" : "exclamationmark.triangle")
                        .font(.system(size: 11))
                    Text(msg)
                        .font(.system(size: 11))
                        .lineLimit(1)
                    Spacer()
                    Button(action: { actionMessage = nil }) {
                        Image(systemName: "xmark")
                            .font(.system(size: 9))
                    }
                    .buttonStyle(.plain)
                }
                .foregroundStyle(isActionSuccess ? Color.green : Color.red)
                .padding(.horizontal, 4)
            }

            TextEditor(text: $commitMessage)
                .font(.system(size: 12))
                .frame(height: 58)
                .scrollContentBackground(.hidden)
                .padding(6)
                .background(Color.primary.opacity(0.04))
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(Color.primary.opacity(0.08), lineWidth: 1)
                )

            HStack(spacing: 8) {
                Button(action: {
                    let res = appStore.gitCommit(message: commitMessage)
                    actionMessage = res.message
                    isActionSuccess = res.success
                    if res.success {
                        commitMessage = ""
                    }
                }) {
                    Text("提交变更 (Commit)")
                        .font(.system(size: 12, weight: .medium))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                        .background(canCommit ? Color.blue : Color.secondary.opacity(0.2))
                        .foregroundStyle(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                }
                .buttonStyle(.plain)
                .disabled(!canCommit)
            }
        }
        .padding(12)
        .background(Color(nsColor: .controlBackgroundColor).opacity(0.5))
    }

    private var canCommit: Bool {
        !commitMessage.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    // MARK: - Right Pane: Diff Viewer
    private var diffViewerPane: some View {
        VStack(spacing: 0) {
            if let item = selectedFile {
                HStack {
                    HStack(spacing: 6) {
                        Image(systemName: "doc.text")
                            .font(.system(size: 12))
                            .foregroundStyle(.secondary)
                        Text(item.path)
                            .font(.system(size: 12, weight: .semibold, design: .monospaced))
                    }

                    Spacer()

                    Text(item.staged ? "已暂存" : "未暂存")
                        .font(.system(size: 10, weight: .medium))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(item.staged ? Color.green.opacity(0.12) : Color.orange.opacity(0.12))
                        .foregroundStyle(item.staged ? Color.green : Color.orange)
                        .clipShape(Capsule())
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .background(Color.primary.opacity(0.02))

                Divider()

                ScrollView([.horizontal, .vertical]) {
                    LazyVStack(alignment: .leading, spacing: 1) {
                        if currentDiff.isEmpty {
                            Text("（无差异内容）")
                                .font(.system(size: 12, design: .monospaced))
                                .foregroundStyle(.tertiary)
                                .padding(16)
                        } else {
                            let lines = currentDiff.components(separatedBy: "\n")
                            ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                                diffLineView(line)
                            }
                        }
                    }
                    .padding(12)
                }
            } else {
                VStack(spacing: 12) {
                    Image(systemName: "doc.text.magnifyingglass")
                        .font(.system(size: 36))
                        .foregroundStyle(.tertiary)
                    Text("从左侧选择一个文件查看 Git Diff 变更")
                        .font(.system(size: 13))
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }

    private func diffLineView(_ line: String) -> some View {
        let isAdd = line.hasPrefix("+") && !line.hasPrefix("+++")
        let isDel = line.hasPrefix("-") && !line.hasPrefix("---")
        let isHunk = line.hasPrefix("@@")

        let bg: Color = isAdd ? Color.green.opacity(0.12) : (isDel ? Color.red.opacity(0.12) : (isHunk ? Color.blue.opacity(0.08) : Color.clear))
        let fg: Color = isAdd ? Color.green : (isDel ? Color.red : (isHunk ? Color.blue : Color.primary))

        return HStack(spacing: 0) {
            Text(line.isEmpty ? " " : line)
                .font(.system(size: 11.5, design: .monospaced))
                .foregroundStyle(fg)
                .padding(.horizontal, 6)
                .padding(.vertical, 1.5)
            Spacer(minLength: 0)
        }
        .background(bg)
        .clipShape(RoundedRectangle(cornerRadius: 2))
    }

    private func selectFile(_ item: GitFileChangeItem) {
        selectedFile = item
        currentDiff = appStore.gitDiff(path: item.path, staged: item.staged)
    }

    private var notRepoView: some View {
        VStack(spacing: 16) {
            Image(systemName: "folder.badge.questionmark")
                .font(.system(size: 40))
                .foregroundStyle(.secondary)

            Text("当前工作区未检测到 Git 仓库")
                .font(.system(size: 15, weight: .semibold))

            Text("路径: \(appStore.currentWorkspace)")
                .font(.system(size: 12, design: .monospaced))
                .foregroundStyle(.tertiary)

            Button(action: {
                _ = appStore.runCommand(["init"])
                appStore.refreshFullGitStatus()
            }) {
                Text("在此初始化 Git 仓库 (git init)")
                    .font(.system(size: 13, weight: .medium))
                    .padding(.horizontal, 14)
                    .padding(.vertical, 6)
                    .background(Color.blue)
                    .foregroundStyle(.white)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
            }
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var newBranchSheet: some View {
        VStack(spacing: 16) {
            Text("创建新分支")
                .font(.system(size: 15, weight: .semibold))

            TextField("分支名称 (例如: feat/new-feature)", text: $newBranchName)
                .textFieldStyle(.roundedBorder)
                .font(.system(size: 13))

            HStack {
                Button("取消") {
                    showNewBranchSheet = false
                    newBranchName = ""
                }
                .buttonStyle(.plain)

                Spacer()

                Button("创建并切换") {
                    let trimmed = newBranchName.trimmingCharacters(in: .whitespacesAndNewlines)
                    if !trimmed.isEmpty {
                        appStore.gitCreateBranch(branch: trimmed)
                    }
                    showNewBranchSheet = false
                    newBranchName = ""
                }
                .buttonStyle(.borderedProminent)
                .disabled(newBranchName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(20)
        .frame(width: 360)
    }
}
