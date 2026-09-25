import SwiftUI

public struct ChatTimelineView: View {
    @Bindable var viewModel: ChatViewModel

    public init(viewModel: ChatViewModel) {
        self.viewModel = viewModel
    }

    public var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 16) {
                    if viewModel.messages.isEmpty {
                        EmptyStateView(cwd: viewModel.cwd)
                            .padding(.top, 60)
                    } else {
                        ForEach(viewModel.messages) { message in
                            MessageRow(message: message)
                                .id(message.id)
                        }
                    }
                }
                .padding(.horizontal, 24)
                .padding(.vertical, 18)
            }
            .onChange(of: viewModel.messages.last?.content) {
                if let lastId = viewModel.messages.last?.id {
                    proxy.scrollTo(lastId, anchor: .bottom)
                }
            }
            .onChange(of: viewModel.messages.last?.thinking) {
                if let lastId = viewModel.messages.last?.id {
                    proxy.scrollTo(lastId, anchor: .bottom)
                }
            }
        }
    }
}

public struct MessageRow: View {
    public let message: ChatMessage

    public var body: some View {
        if message.role == "user" {
            HStack {
                Spacer(minLength: 40)
                Text(message.content)
                    .font(.system(size: 13.5))
                    .foregroundStyle(.white)
                    .textSelection(.enabled)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(Color.accentColor)
                    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
        } else {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "sparkles")
                    .font(.system(size: 13))
                    .foregroundStyle(Color.accentColor)
                    .padding(6)
                    .background(Color.accentColor.opacity(0.12))
                    .clipShape(Circle())

                VStack(alignment: .leading, spacing: 10) {
                    // Thinking process
                    if let thinking = message.thinking, !thinking.isEmpty {
                        ThinkingView(text: thinking, isStreaming: message.isStreaming)
                    }

                    // Tool executions
                    if !message.toolCalls.isEmpty {
                        VStack(alignment: .leading, spacing: 6) {
                            ForEach(message.toolCalls) { tool in
                                ToolCallView(tool: tool)
                            }
                        }
                    }

                    // Message Content
                    if !message.content.isEmpty {
                        MarkdownView(message.content)
                    } else if message.isStreaming && (message.thinking == nil || message.thinking!.isEmpty) {
                        HStack(spacing: 4) {
                            ProgressView()
                                .controlSize(.mini)
                            Text("准备回答中...")
                                .font(.system(size: 12))
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                Spacer(minLength: 20)
            }
        }
    }
}

public struct EmptyStateView: View {
    public let cwd: String

    public var body: some View {
        VStack(spacing: 14) {
            Image(systemName: "cube.transparent")
                .font(.system(size: 44))
                .foregroundStyle(Color.accentColor.opacity(0.8))

            Text("欢迎使用 OpenPI Swift")
                .font(.system(size: 18, weight: .bold))

            Text("基于 Swift 6 与 SwiftUI 原生打造，轻盈灵动，随时为您提供强大的 AI 编码与工程协助。")
                .font(.system(size: 13))
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 420)

            HStack(spacing: 6) {
                Image(systemName: "folder")
                    .font(.system(size: 11))
                Text("当前工作区: \(cwd)")
                    .font(.system(size: 11, design: .monospaced))
            }
            .foregroundStyle(.tertiary)
            .padding(.top, 4)
        }
    }
}
