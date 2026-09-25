import SwiftUI
import OpenPIProtocol

public struct TasksSurfaceView: View {
    @Bindable var appStore: AppStore
    @State private var showCreateSheet: Bool = false
    @State private var newTitle: String = ""
    @State private var newPrompt: String = ""
    @State private var newSchedule: String = "每天 09:00"

    public init(appStore: AppStore) {
        self.appStore = appStore
    }

    public var body: some View {
        VStack(spacing: 0) {
            // Header
            headerBar

            Divider()

            // Task List
            ScrollView {
                LazyVStack(spacing: 12) {
                    if appStore.tasksList.isEmpty {
                        emptyView
                    } else {
                        ForEach(appStore.tasksList) { task in
                            taskCard(task)
                        }
                    }
                }
                .padding(20)
            }
        }
        .onAppear {
            Task {
                await appStore.refreshTasks()
            }
        }
        .sheet(isPresented: $showCreateSheet) {
            createTaskSheet
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
                Image(systemName: "checklist")
                    .font(.system(size: 14))
                    .foregroundStyle(.green)

                Text("定时与自主任务编排")
                    .font(.system(size: 14, weight: .semibold))

                Text("\(appStore.tasksList.count) 个任务")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(Color.primary.opacity(0.06))
                    .clipShape(Capsule())
            }

            Spacer()

            Button(action: { showCreateSheet = true }) {
                HStack(spacing: 4) {
                    Image(systemName: "plus")
                        .font(.system(size: 11, weight: .semibold))
                    Text("新建任务")
                        .font(.system(size: 12))
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(Color.green)
                .foregroundStyle(.white)
                .clipShape(RoundedRectangle(cornerRadius: 6))
            }
            .buttonStyle(.plain)

            Button(action: {
                Task {
                    await appStore.refreshTasks()
                }
            }) {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 11))
                    .padding(5)
                    .background(Color.primary.opacity(0.06))
                    .clipShape(RoundedRectangle(cornerRadius: 6))
            }
            .buttonStyle(.plain)
            .help("刷新任务列表")
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 10)
        .background(Color(nsColor: .windowBackgroundColor))
    }

    // MARK: - Task Card
    private func taskCard(_ task: ScheduledTaskItem) -> some View {
        HStack(alignment: .top, spacing: 14) {
            ZStack {
                Circle()
                    .fill(task.status == "active" ? Color.green.opacity(0.12) : Color.secondary.opacity(0.12))
                    .frame(width: 34, height: 34)
                Image(systemName: task.status == "active" ? "clock.fill" : "pause.fill")
                    .font(.system(size: 14))
                    .foregroundStyle(task.status == "active" ? Color.green : Color.secondary)
            }

            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    Text(task.title)
                        .font(.system(size: 14, weight: .semibold))

                    statusBadge(task.status)

                    Spacer()

                    // Actions
                    HStack(spacing: 6) {
                        Button(action: {
                            Task {
                                await appStore.runTask(taskId: task.id)
                            }
                        }) {
                            HStack(spacing: 3) {
                                Image(systemName: "play.fill")
                                    .font(.system(size: 9))
                                Text("运行")
                                    .font(.system(size: 11))
                            }
                            .padding(.horizontal, 7)
                            .padding(.vertical, 3.5)
                            .background(Color.primary.opacity(0.06))
                            .clipShape(RoundedRectangle(cornerRadius: 4))
                        }
                        .buttonStyle(.plain)
                        .help("立即执行任务")

                        Button(action: {
                            Task {
                                await appStore.toggleTaskPause(taskId: task.id)
                            }
                        }) {
                            Image(systemName: task.status == "active" ? "pause" : "play")
                                .font(.system(size: 10))
                                .padding(5)
                                .background(Color.primary.opacity(0.06))
                                .clipShape(RoundedRectangle(cornerRadius: 4))
                        }
                        .buttonStyle(.plain)
                        .help(task.status == "active" ? "暂停任务" : "恢复任务")

                        Button(action: {
                            Task {
                                await appStore.deleteTask(taskId: task.id)
                            }
                        }) {
                            Image(systemName: "trash")
                                .font(.system(size: 10))
                                .foregroundStyle(.red.opacity(0.8))
                                .padding(5)
                                .background(Color.primary.opacity(0.06))
                                .clipShape(RoundedRectangle(cornerRadius: 4))
                        }
                        .buttonStyle(.plain)
                        .help("删除任务")
                    }
                }

                Text(task.prompt)
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
                    .lineLimit(2)

                HStack(spacing: 12) {
                    HStack(spacing: 4) {
                        Image(systemName: "calendar.badge.clock")
                            .font(.system(size: 10))
                        Text(task.schedule)
                            .font(.system(size: 11, design: .monospaced))
                    }
                    .foregroundStyle(.tertiary)

                    if let cwd = task.cwd {
                        HStack(spacing: 4) {
                            Image(systemName: "folder")
                                .font(.system(size: 10))
                            Text(URL(fileURLWithPath: cwd).lastPathComponent)
                                .font(.system(size: 11))
                        }
                        .foregroundStyle(.tertiary)
                    }
                }
            }
        }
        .padding(14)
        .background(Color(nsColor: .controlBackgroundColor).opacity(0.6))
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(Color.primary.opacity(0.06), lineWidth: 1)
        )
    }

    private func statusBadge(_ status: String) -> some View {
        let isActive = status == "active"
        return HStack(spacing: 4) {
            Circle()
                .fill(isActive ? Color.green : Color.secondary)
                .frame(width: 5, height: 5)
            Text(isActive ? "活跃中" : "已暂停")
                .font(.system(size: 9.5, weight: .medium))
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 2)
        .background(isActive ? Color.green.opacity(0.1) : Color.secondary.opacity(0.1))
        .foregroundStyle(isActive ? Color.green : Color.secondary)
        .clipShape(Capsule())
    }

    private var emptyView: some View {
        VStack(spacing: 10) {
            Image(systemName: "clock.badge.checkmark")
                .font(.system(size: 38))
                .foregroundStyle(.tertiary)
            Text("暂无正在执行的自动化定时任务")
                .font(.system(size: 13))
                .foregroundStyle(.secondary)
            Button("创建第一个自动化任务") {
                showCreateSheet = true
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.small)
            .padding(.top, 4)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 60)
    }

    // MARK: - Create Task Sheet
    private var createTaskSheet: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("新建定时调度任务")
                .font(.system(size: 15, weight: .semibold))

            VStack(alignment: .leading, spacing: 4) {
                Text("任务标题:")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(.secondary)
                TextField("如: 每日依赖巡检与构建", text: $newTitle)
                    .textFieldStyle(.roundedBorder)
                    .font(.system(size: 12))
            }

            VStack(alignment: .leading, spacing: 4) {
                Text("执行 Prompt 目标:")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(.secondary)
                TextField("描述智能体要自主执行的操作...", text: $newPrompt)
                    .textFieldStyle(.roundedBorder)
                    .font(.system(size: 12))
            }

            VStack(alignment: .leading, spacing: 4) {
                Text("调度频率 (Cron / 预设):")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(.secondary)
                Picker("", selection: $newSchedule) {
                    Text("每天 09:00 (0 9 * * *)").tag("0 9 * * *")
                    Text("每 10 分钟 (*/10 * * * *)").tag("*/10 * * * *")
                    Text("每小时整点 (0 * * * *)").tag("0 * * * *")
                    Text("每周一 02:00 (0 2 * * 1)").tag("0 2 * * 1")
                }
                .pickerStyle(.menu)
            }

            HStack {
                Button("取消") {
                    showCreateSheet = false
                    newTitle = ""
                    newPrompt = ""
                }
                .buttonStyle(.plain)

                Spacer()

                Button("创建任务") {
                    let t = newTitle.trimmingCharacters(in: .whitespacesAndNewlines)
                    let p = newPrompt.trimmingCharacters(in: .whitespacesAndNewlines)
                    if !t.isEmpty && !p.isEmpty {
                        Task {
                            await appStore.createTask(title: t, prompt: p, schedule: newSchedule)
                        }
                    }
                    showCreateSheet = false
                    newTitle = ""
                    newPrompt = ""
                }
                .buttonStyle(.borderedProminent)
                .disabled(newTitle.isEmpty || newPrompt.isEmpty)
            }
            .padding(.top, 6)
        }
        .padding(20)
        .frame(width: 380)
    }
}
