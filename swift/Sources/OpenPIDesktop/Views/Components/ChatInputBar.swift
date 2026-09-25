import SwiftUI
import OpenPIProtocol
import AppKit

public struct ChatInputBar: View {
    @Bindable var viewModel: ChatViewModel
    @Bindable var appStore: AppStore
    @FocusState private var isFocused: Bool

    public init(viewModel: ChatViewModel, appStore: AppStore) {
        self.viewModel = viewModel
        self.appStore = appStore
    }

    public var body: some View {
        VStack(spacing: 0) {
            // Main Input Container Card
            VStack(spacing: 6) {
                // Multiline Text Editor with Placeholder
                ZStack(alignment: .topLeading) {
                    if viewModel.inputText.isEmpty {
                        Text("输入研发任务，智能体将自主编码、全维巡检并自愈直到完全通过 (Enter 发送)...")
                            .font(.system(size: 13))
                            .foregroundStyle(.tertiary)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 8)
                            .allowsHitTesting(false)
                    }

                    TextEditor(text: $viewModel.inputText)
                        .focused($isFocused)
                        .font(.system(size: 13.5))
                        .frame(minHeight: 48, maxHeight: 140)
                        .scrollContentBackground(.hidden)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 4)
                        .onKeyPress(.return) {
                            if NSEvent.modifierFlags.contains(.shift) {
                                return .ignored
                            } else {
                                submitMessage()
                                return .handled
                            }
                        }
                }

                // Bottom Controls Toolbar
                HStack(spacing: 8) {
                    // 1. Attachment Button (Paperclip)
                    Button(action: selectAttachment) {
                        Image(systemName: "paperclip")
                            .font(.system(size: 13))
                            .foregroundStyle(.secondary)
                            .padding(4)
                    }
                    .buttonStyle(.plain)
                    .help("添加附件或文档")

                    // 2. Model Selector Capsule
                    Menu {
                        ForEach(appStore.models) { model in
                            Button(action: {
                                appStore.selectedModel = model.ref
                            }) {
                                HStack {
                                    Text(model.modelId)
                                    if appStore.selectedModel == model.ref {
                                        Image(systemName: "checkmark")
                                    }
                                }
                            }
                        }
                    } label: {
                        HStack(spacing: 4) {
                            Text(modelDisplayName)
                                .font(.system(size: 11.5, weight: .medium))
                                .foregroundStyle(.secondary)
                        }
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3.5)
                        .background(Color.primary.opacity(0.05))
                        .clipShape(Capsule())
                    }
                    .menuStyle(.borderlessButton)
                    .fixedSize()

                    // 3. Thinking Level Capsule
                    Menu {
                        ForEach(ThinkingLevelOption.allCases) { opt in
                            Button(action: {
                                appStore.selectedThinkingLevel = opt
                            }) {
                                HStack {
                                    Text(opt.rawValue)
                                    if appStore.selectedThinkingLevel == opt {
                                        Image(systemName: "checkmark")
                                    }
                                }
                            }
                        }
                    } label: {
                        HStack(spacing: 3) {
                            Text(appStore.selectedThinkingLevel.rawValue)
                                .font(.system(size: 11, weight: .regular))
                                .foregroundStyle(.secondary)
                            Image(systemName: "chevron.up.chevron.down")
                                .font(.system(size: 8))
                                .foregroundStyle(.tertiary)
                        }
                        .padding(.horizontal, 7)
                        .padding(.vertical, 3.5)
                        .background(Color.primary.opacity(0.05))
                        .clipShape(Capsule())
                    }
                    .menuStyle(.borderlessButton)
                    .fixedSize()

                    Spacer()

                    // 4. Git Status Indicator
                    HStack(spacing: 4) {
                        Image(systemName: "info.circle")
                            .font(.system(size: 10))
                        Text(appStore.gitState.hasGit ? (appStore.gitState.branch ?? "main") : "未检测到 Git 仓库")
                            .font(.system(size: 10.5))
                    }
                    .foregroundStyle(.tertiary)
                    .padding(.trailing, 4)

                    // 5. Token Usage Indicator
                    HStack(spacing: 4) {
                        Image(systemName: "circle.circle")
                            .font(.system(size: 10))
                        Text(viewModel.totalTokens > 0 ? viewModel.formattedTokens : appStore.tokenStats.formattedText)
                            .font(.system(size: 10.5, design: .monospaced))
                    }
                    .foregroundStyle(.tertiary)
                    .padding(.trailing, 6)

                    // 6. Action Button (Send or Stop)
                    if viewModel.isGenerating {
                        Button(action: {
                            Task {
                                await viewModel.cancelGeneration(ipc: appStore.ipcClient)
                            }
                        }) {
                            ZStack {
                                RoundedRectangle(cornerRadius: 8)
                                    .fill(Color.red)
                                    .frame(width: 28, height: 28)
                                Image(systemName: "stop.fill")
                                    .font(.system(size: 12))
                                    .foregroundStyle(.white)
                            }
                        }
                        .buttonStyle(.plain)
                        .help("终止当前生成")
                    } else {
                        Button(action: submitMessage) {
                            ZStack {
                                Circle()
                                    .fill(canSubmit ? Color.orange : Color.secondary.opacity(0.2))
                                    .frame(width: 28, height: 28)
                                Image(systemName: "arrow.up")
                                    .font(.system(size: 13, weight: .bold))
                                    .foregroundStyle(canSubmit ? Color.white : Color.secondary.opacity(0.5))
                            }
                        }
                        .buttonStyle(.plain)
                        .disabled(!canSubmit)
                        .help("发送 (Enter)")
                    }
                }
                .padding(.horizontal, 8)
                .padding(.bottom, 6)
            }
            .padding(4)
            .background(Color(nsColor: .controlBackgroundColor).opacity(0.85))
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(isFocused ? Color.orange.opacity(0.5) : Color.primary.opacity(0.08), lineWidth: 1)
            )
            .shadow(color: Color.black.opacity(0.03), radius: 6, x: 0, y: 2)
            .padding(.horizontal, 16)
            .padding(.bottom, 12)
            .padding(.top, 4)
        }
    }

    private var canSubmit: Bool {
        !viewModel.inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var modelDisplayName: String {
        let name = appStore.selectedModel.components(separatedBy: "/").last ?? appStore.selectedModel
        if name.count > 18 {
            return String(name.prefix(15)) + "..."
        }
        return name
    }

    private func selectAttachment() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = true
        panel.prompt = "添加附件"
        panel.begin { response in
            guard response == .OK else { return }
            for url in panel.urls {
                let path = url.path
                let fileName = url.lastPathComponent
                if let content = try? String(contentsOf: url, encoding: .utf8), content.count < 30000 {
                    let ext = url.pathExtension
                    viewModel.inputText += "\n\n`@\(fileName)`:\n```\(ext)\n\(content)\n```\n"
                } else {
                    viewModel.inputText += " [引用文件: \(path)] "
                }
            }
        }
    }

    private func submitMessage() {
        guard canSubmit else { return }
        let text = viewModel.inputText
        Task {
            await viewModel.sendUserMessage(text: text, ipc: appStore.ipcClient)
        }
    }
}
