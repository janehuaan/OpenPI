import SwiftUI
import OpenPIProtocol

public struct SettingsSurfaceView: View {
    @Bindable var appStore: AppStore
    @State private var selectedTab: SettingsTab = .models

    // Jev Settings State
    @State private var jevProvider: JevProviderType = .heuristic
    @State private var jevEndpoint: String = ""
    @State private var jevApiKey: String = ""
    @State private var jevModel: String = ""
    @State private var jevSavedFeedback: Bool = false

    // Jev Playground State
    @State private var playgroundMode: String = "Choice"
    @State private var playgroundContext: String = "rm -rf ~/.openpi/agent/sessions"
    @State private var playgroundChoices: String = "inline_agile, subagent_delegate, chat_question"
    @State private var playgroundQuestion: String = "这是一条具有高风险破坏性的危险指令吗？"
    @State private var playgroundCriterion: String = "指令对系统数据完整性与安全性的风险等级"

    public enum SettingsTab: String, CaseIterable, Identifiable {
        case models = "模型与提供商"
        case jev = "Jev 决策引擎"
        case general = "通用偏好"
        case skills = "技能与扩展"
        case about = "关于 OpenPI"

        public var id: String { rawValue }

        public var icon: String {
            switch self {
            case .models: return "cpu"
            case .jev: return "bolt.shield.fill"
            case .general: return "gearshape"
            case .skills: return "square.stack.3d.up"
            case .about: return "info.circle"
            }
        }
    }

    public init(appStore: AppStore) {
        self.appStore = appStore
    }

    public var body: some View {
        VStack(spacing: 0) {
            // Modal Top Header
            HStack {
                HStack(spacing: 8) {
                    Image(systemName: "wrench.and.screwdriver.fill")
                        .font(.system(size: 14))
                        .foregroundStyle(Color.accentColor)
                    Text("偏好设置 (Settings)")
                        .font(.system(size: 14, weight: .semibold))
                }

                Spacer()

                Button(action: { appStore.showSettingsModal = false }) {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 16))
                        .foregroundStyle(.tertiary)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 12)
            .background(Color(nsColor: .windowBackgroundColor))

            Divider()

            // Sidebar + Content
            HStack(spacing: 0) {
                // Left Tabs Sidebar
                VStack(spacing: 4) {
                    ForEach(SettingsTab.allCases) { tab in
                        Button(action: { selectedTab = tab }) {
                            HStack(spacing: 8) {
                                Image(systemName: tab.icon)
                                    .font(.system(size: 12))
                                    .frame(width: 16)
                                Text(tab.rawValue)
                                    .font(.system(size: 12, weight: selectedTab == tab ? .semibold : .regular))
                                Spacer()
                            }
                            .padding(.horizontal, 12)
                            .padding(.vertical, 7)
                            .background(selectedTab == tab ? Color.accentColor.opacity(0.12) : Color.clear)
                            .foregroundStyle(selectedTab == tab ? Color.accentColor : Color.primary)
                            .clipShape(RoundedRectangle(cornerRadius: 6))
                        }
                        .buttonStyle(.plain)
                    }
                    Spacer()
                }
                .padding(12)
                .frame(width: 175)
                .background(Color(nsColor: .controlBackgroundColor).opacity(0.4))

                Divider()

                // Right Tab Content
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        switch selectedTab {
                        case .models:
                            modelsTabContent
                        case .jev:
                            jevTabContent
                        case .general:
                            generalTabContent
                        case .skills:
                            skillsTabContent
                        case .about:
                            aboutTabContent
                        }
                    }
                    .padding(20)
                }
            }
        }
        .frame(width: 740, height: 530)
        .onAppear {
            appStore.refreshSkills()
            syncJevStateFromStore()
        }
    }

    private func syncJevStateFromStore() {
        jevProvider = appStore.jevConfig.provider
        jevEndpoint = appStore.jevConfig.endpoint
        jevApiKey = appStore.jevConfig.apiKey
        jevModel = appStore.jevConfig.modelName
    }

    // MARK: - Jev (System 1) Tab Content
    private var jevTabContent: some View {
        VStack(alignment: .leading, spacing: 16) {
            // Header
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 8) {
                        Text("Jev 决策引擎 (System 1)")
                            .font(.system(size: 16, weight: .bold))

                        Text("TypeSafe AI 原生架构")
                            .font(.system(size: 10, weight: .medium))
                            .foregroundStyle(.blue)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Color.blue.opacity(0.12))
                            .clipShape(Capsule())

                        Text("毫秒级零幻觉")
                            .font(.system(size: 10, weight: .medium))
                            .foregroundStyle(.green)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Color.green.opacity(0.12))
                            .clipShape(Capsule())
                    }

                    Text("专为无幻觉、毫秒级结构化裁决与校准概率打造，赋能看门狗审查与调度仲裁。")
                        .font(.system(size: 11.5))
                        .foregroundStyle(.secondary)
                }

                Spacer()
            }

            Divider()

            // Configuration Section Card
            VStack(alignment: .leading, spacing: 12) {
                Text("运行提供商与接口配置")
                    .font(.system(size: 13, weight: .semibold))

                // Provider Picker
                Picker("决策引擎后端", selection: $jevProvider) {
                    ForEach(JevProviderType.allCases) { prov in
                        Text(prov.displayName).tag(prov)
                    }
                }
                .pickerStyle(.menu)
                .onChange(of: jevProvider) { _, newProv in
                    jevEndpoint = newProv.defaultEndpoint
                    jevModel = newProv.defaultModel
                }

                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("API 端点 (Base URL)")
                            .font(.system(size: 11))
                            .foregroundStyle(.secondary)
                        TextField("http://...", text: $jevEndpoint)
                            .textFieldStyle(.roundedBorder)
                            .font(.system(size: 12, design: .monospaced))
                    }

                    VStack(alignment: .leading, spacing: 4) {
                        Text("模型代号 (Model)")
                            .font(.system(size: 11))
                            .foregroundStyle(.secondary)
                        TextField("jev-1", text: $jevModel)
                            .textFieldStyle(.roundedBorder)
                            .font(.system(size: 12, design: .monospaced))
                    }
                }

                if jevProvider != .heuristic && jevProvider != .local {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("API Key 密钥 (Bearer Token)")
                            .font(.system(size: 11))
                            .foregroundStyle(.secondary)
                        SecureField("sk-...", text: $jevApiKey)
                            .textFieldStyle(.roundedBorder)
                            .font(.system(size: 12, design: .monospaced))
                    }
                }

                HStack {
                    Spacer()

                    if jevSavedFeedback {
                        HStack(spacing: 4) {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundStyle(.green)
                            Text("已成功保存生效")
                                .font(.system(size: 11.5))
                                .foregroundStyle(.green)
                        }
                        .transition(.opacity)
                    }

                    Button("保存 Jev 配置") {
                        saveJevConfig()
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
                }
            }
            .padding(14)
            .background(Color.primary.opacity(0.03))
            .clipShape(RoundedRectangle(cornerRadius: 10))

            // Interactive Playground Section Card
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Label("⚡️ 交互式决策试炼场 (Playground)", systemImage: "sparkles")
                        .font(.system(size: 13, weight: .semibold))
                    Spacer()
                    Picker("", selection: $playgroundMode) {
                        Text("Choice (离散选择)").tag("Choice")
                        Text("Noul (布尔判定)").tag("Noul")
                        Text("Score (维度打分)").tag("Score")
                    }
                    .pickerStyle(.segmented)
                    .frame(width: 270)
                }

                // Context Input
                VStack(alignment: .leading, spacing: 4) {
                    Text("Context 上下文状态 (Input State)")
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                    TextField("输入需要进行评估的上下文内容...", text: $playgroundContext)
                        .textFieldStyle(.roundedBorder)
                        .font(.system(size: 12, design: .monospaced))
                }

                // Dynamic Mode Inputs
                if playgroundMode == "Choice" {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("候选选项 (逗号分隔)")
                            .font(.system(size: 11))
                            .foregroundStyle(.secondary)
                        TextField("选项1, 选项2, 选项3...", text: $playgroundChoices)
                            .textFieldStyle(.roundedBorder)
                            .font(.system(size: 12))
                    }
                } else if playgroundMode == "Noul" {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("布尔判定命题 (Hypothesis / Question)")
                            .font(.system(size: 11))
                            .foregroundStyle(.secondary)
                        TextField("例如：这是一条高危指令吗？", text: $playgroundQuestion)
                            .textFieldStyle(.roundedBorder)
                            .font(.system(size: 12))
                    }
                } else {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("评分评判标准 (Criterion)")
                            .font(.system(size: 11))
                            .foregroundStyle(.secondary)
                        TextField("例如：指令的不可逆破坏风险...", text: $playgroundCriterion)
                            .textFieldStyle(.roundedBorder)
                            .font(.system(size: 12))
                    }
                }

                HStack {
                    Spacer()
                    Button(action: runPlaygroundDecision) {
                        HStack(spacing: 6) {
                            if appStore.isJevTesting {
                                ProgressView()
                                    .controlSize(.mini)
                            } else {
                                Image(systemName: "bolt.fill")
                                    .foregroundStyle(.yellow)
                            }
                            Text(appStore.isJevTesting ? "推理中..." : "运行 Jev 极速推理")
                                .font(.system(size: 12, weight: .medium))
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
                    .disabled(appStore.isJevTesting)
                }

                // Decision Result Display
                if playgroundMode == "Choice", let res = appStore.lastJevChoiceResult {
                    decisionResultCard(
                        title: "Choice 裁决结果: \(res.selected)",
                        confidence: res.confidence,
                        latencyMs: res.latencyMs,
                        provider: res.provider
                    ) {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("各选项校准概率分布 (Softmax Probabilities):")
                                .font(.system(size: 11))
                                .foregroundStyle(.secondary)

                            ForEach(Array(res.probabilities.keys.sorted()), id: \.self) { key in
                                let p = res.probabilities[key] ?? 0.0
                                HStack(spacing: 8) {
                                    Text(key)
                                        .font(.system(size: 11, weight: key == res.selected ? .bold : .regular))
                                        .frame(width: 130, alignment: .leading)
                                        .lineLimit(1)

                                    ProgressView(value: p, total: 1.0)
                                        .tint(key == res.selected ? .green : .blue)

                                    Text("\(Int(p * 100))%")
                                        .font(.system(size: 11, weight: .medium, design: .monospaced))
                                        .frame(width: 40, alignment: .trailing)
                                }
                            }
                        }
                    }
                } else if playgroundMode == "Noul", let res = appStore.lastJevNoulResult {
                    decisionResultCard(
                        title: res.verdict ? "Noul 裁决: TRUE (命中)" : "Noul 裁决: FALSE (否决)",
                        confidence: res.confidence,
                        latencyMs: res.latencyMs,
                        provider: res.provider
                    ) {
                        HStack {
                            Text("置信度强度:")
                                .font(.system(size: 11))
                                .foregroundStyle(.secondary)
                            ProgressView(value: res.confidence, total: 1.0)
                                .tint(res.verdict ? .red : .green)
                            Text("\(Int(res.confidence * 100))%")
                                .font(.system(size: 11, weight: .bold, design: .monospaced))
                        }
                    }
                } else if playgroundMode == "Score", let res = appStore.lastJevScoreResult {
                    decisionResultCard(
                        title: "Score 评分: \(String(format: "%.2f", res.score))",
                        confidence: res.score,
                        latencyMs: res.latencyMs,
                        provider: res.provider
                    ) {
                        VStack(alignment: .leading, spacing: 4) {
                            ProgressView(value: res.score, total: 1.0)
                                .tint(res.score > 0.7 ? .orange : .blue)
                            if let r = res.reasoning {
                                Text(r)
                                    .font(.system(size: 10.5))
                                    .foregroundStyle(.tertiary)
                            }
                        }
                    }
                }
            }
            .padding(14)
            .background(Color.primary.opacity(0.03))
            .clipShape(RoundedRectangle(cornerRadius: 10))
        }
    }

    private func decisionResultCard<Content: View>(
        title: String,
        confidence: Double,
        latencyMs: Double,
        provider: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(title)
                    .font(.system(size: 12.5, weight: .bold))

                Spacer()

                HStack(spacing: 4) {
                    Image(systemName: "bolt.fill")
                        .font(.system(size: 9))
                    Text("\(String(format: "%.1f", latencyMs)) ms")
                        .font(.system(size: 10.5, weight: .bold, design: .monospaced))
                }
                .foregroundStyle(.yellow)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(Color.yellow.opacity(0.12))
                .clipShape(Capsule())

                Text(provider)
                    .font(.system(size: 9.5))
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(Color.primary.opacity(0.06))
                    .clipShape(Capsule())
            }

            Divider()

            content()
        }
        .padding(10)
        .background(Color(nsColor: .controlBackgroundColor))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(Color.primary.opacity(0.08), lineWidth: 1)
        )
    }

    private func saveJevConfig() {
        var cfg = appStore.jevConfig
        cfg.provider = jevProvider
        cfg.endpoint = jevEndpoint.isEmpty ? jevProvider.defaultEndpoint : jevEndpoint
        cfg.apiKey = jevApiKey
        cfg.modelName = jevModel.isEmpty ? jevProvider.defaultModel : jevModel
        Task {
            await appStore.saveJevConfig(cfg)
            jevSavedFeedback = true
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            jevSavedFeedback = false
        }
    }

    private func runPlaygroundDecision() {
        Task {
            if playgroundMode == "Choice" {
                let list = playgroundChoices.components(separatedBy: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
                _ = await appStore.jevDecide(context: playgroundContext, choices: list)
            } else if playgroundMode == "Noul" {
                _ = await appStore.jevNoul(context: playgroundContext, question: playgroundQuestion)
            } else {
                _ = await appStore.jevScore(context: playgroundContext, criterion: playgroundCriterion)
            }
        }
    }

    // MARK: - Models Tab
    private var modelsTabContent: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("模型与提供商管理")
                .font(.system(size: 16, weight: .bold))

            VStack(alignment: .leading, spacing: 10) {
                Text("主力推理模型")
                    .font(.system(size: 13, weight: .semibold))

                ForEach(appStore.models) { model in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(model.modelId)
                                .font(.system(size: 13, weight: .medium))
                            Text("提供商: \(model.provider)")
                                .font(.system(size: 11))
                                .foregroundStyle(.secondary)
                        }

                        Spacer()

                        if appStore.selectedModel == model.ref {
                            Text("当前选定")
                                .font(.system(size: 11, weight: .medium))
                                .foregroundStyle(.green)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 3)
                                .background(Color.green.opacity(0.12))
                                .clipShape(Capsule())
                        } else {
                            Button("设为默认") {
                                appStore.selectedModel = model.ref
                            }
                            .buttonStyle(.bordered)
                            .controlSize(.small)
                        }
                    }
                    .padding(10)
                    .background(Color.primary.opacity(0.03))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }
            }
        }
    }

    // MARK: - General Tab
    private var generalTabContent: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("通用偏好设置")
                .font(.system(size: 16, weight: .bold))

            VStack(alignment: .leading, spacing: 12) {
                Toggle("深色模式外观", isOn: $appStore.isDarkMode)
                    .toggleStyle(.switch)

                Divider()

                HStack {
                    Text("默认工作区目录")
                        .font(.system(size: 13))
                    Spacer()
                    Text(appStore.currentWorkspace)
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                Divider()

                HStack {
                    Text("开发者身份昵称")
                        .font(.system(size: 13))
                    Spacer()
                    TextField("昵称", text: $appStore.nickname)
                        .frame(width: 120)
                        .textFieldStyle(.roundedBorder)
                }
            }
            .padding(14)
            .background(Color.primary.opacity(0.03))
            .clipShape(RoundedRectangle(cornerRadius: 8))
        }
    }

    // MARK: - Skills Tab
    private var skillsTabContent: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("已安装扩展与 Skills (\(appStore.installedSkills.count))")
                    .font(.system(size: 16, weight: .bold))
                Spacer()
                Button(action: { appStore.refreshSkills() }) {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 12))
                }
                .buttonStyle(.plain)
            }

            if appStore.installedSkills.isEmpty {
                VStack(spacing: 8) {
                    Image(systemName: "square.stack.3d.up.slash")
                        .font(.system(size: 28))
                        .foregroundStyle(.tertiary)
                    Text("未在 ~/.openpi/agent/skills 中检测到安装的 Skill")
                        .font(.system(size: 12))
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 30)
            } else {
                ForEach(appStore.installedSkills) { skill in
                    HStack(spacing: 12) {
                        Image(systemName: "puzzlepiece.extension.fill")
                            .font(.system(size: 16))
                            .foregroundStyle(.orange)

                        VStack(alignment: .leading, spacing: 2) {
                            Text(skill.name)
                                .font(.system(size: 13, weight: .medium))
                            Text(skill.description)
                                .font(.system(size: 11))
                                .foregroundStyle(.secondary)
                                .lineLimit(2)
                        }

                        Spacer()

                        Button("在访达中显示") {
                            let url = URL(fileURLWithPath: skill.path)
                            NSWorkspace.shared.activateFileViewerSelecting([url])
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                    }
                    .padding(10)
                    .background(Color.primary.opacity(0.03))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }
            }
        }
    }

    // MARK: - About Tab
    private var aboutTabContent: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 12) {
                Image(systemName: "cpu.fill")
                    .font(.system(size: 32))
                    .foregroundStyle(.blue)

                VStack(alignment: .leading, spacing: 2) {
                    Text("OpenPI Native Desktop")
                        .font(.system(size: 18, weight: .bold))
                    Text("Version 0.2.0 (Swift 6 & SwiftUI Native)")
                        .font(.system(size: 12))
                        .foregroundStyle(.secondary)
                }
            }

            Divider()

            VStack(alignment: .leading, spacing: 8) {
                infoRow(label: "渲染架构", value: "Apple SwiftUI 6 / Metal 加速 (无 Chromium/Electron)")
                infoRow(label: "应用体积", value: "5.8 MB (相比 Electron 缩减 97%)")
                infoRow(label: "后端守护", value: "Swift / Rust openpi-daemon (Unix Domain Socket)")
                infoRow(label: "决策引擎", value: "Jev (System 1 离散裁决与概率校准)")
                infoRow(label: "通信套接字", value: "~/.openpi/openpi.sock")
                infoRow(label: "Python 依赖", value: "0 依赖 (纯原生编译)")
            }
            .font(.system(size: 12))
        }
    }

    private func infoRow(label: String, value: String) -> some View {
        HStack(alignment: .top) {
            Text(label + ":")
                .frame(width: 90, alignment: .leading)
                .foregroundStyle(.secondary)
            Text(value)
                .foregroundStyle(.primary)
                .lineLimit(2)
        }
    }
}
