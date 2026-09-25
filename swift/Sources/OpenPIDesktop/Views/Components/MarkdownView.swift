import SwiftUI
import AppKit

public struct MarkdownView: View {
    public let text: String

    public init(_ text: String) {
        self.text = text
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            let blocks = parseBlocks(text)
            ForEach(blocks.indices, id: \.self) { idx in
                switch blocks[idx] {
                case .code(let lang, let code):
                    CodeBlockView(language: lang, code: code)
                case .text(let content):
                    if let attr = try? AttributedString(markdown: content, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)) {
                        Text(attr)
                            .font(.system(size: 14))
                            .textSelection(.enabled)
                    } else {
                        Text(content)
                            .font(.system(size: 14))
                            .textSelection(.enabled)
                    }
                }
            }
        }
    }

    private enum Block {
        case text(String)
        case code(language: String, code: String)
    }

    private func parseBlocks(_ markdown: String) -> [Block] {
        var result: [Block] = []
        let lines = markdown.components(separatedBy: "\n")
        var inCode = false
        var currentLang = ""
        var currentCode: [String] = []
        var currentText: [String] = []

        for line in lines {
            if line.hasPrefix("```") {
                if inCode {
                    // end code block
                    result.append(.code(language: currentLang, code: currentCode.joined(separator: "\n")))
                    currentCode.removeAll()
                    currentLang = ""
                    inCode = false
                } else {
                    // flush text
                    if !currentText.isEmpty {
                        result.append(.text(currentText.joined(separator: "\n")))
                        currentText.removeAll()
                    }
                    currentLang = String(line.dropFirst(3)).trimmingCharacters(in: .whitespaces)
                    inCode = true
                }
            } else {
                if inCode {
                    currentCode.append(line)
                } else {
                    currentText.append(line)
                }
            }
        }

        if inCode && !currentCode.isEmpty {
            result.append(.code(language: currentLang, code: currentCode.joined(separator: "\n")))
        } else if !currentText.isEmpty {
            result.append(.text(currentText.joined(separator: "\n")))
        }

        return result
    }
}

public struct CodeBlockView: View {
    public let language: String
    public let code: String
    @State private var copied: Bool = false

    public var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header bar
            HStack {
                Text(language.isEmpty ? "code" : language)
                    .font(.system(size: 11, weight: .semibold, design: .monospaced))
                    .foregroundStyle(.secondary)
                Spacer()
                Button(action: {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(code, forType: .string)
                    copied = true
                    Task {
                        try? await Task.sleep(nanoseconds: 1_500_000_000)
                        copied = false
                    }
                }) {
                    HStack(spacing: 4) {
                        Image(systemName: copied ? "checkmark" : "doc.on.doc")
                            .font(.system(size: 11))
                        Text(copied ? "已复制" : "复制")
                            .font(.system(size: 11))
                    }
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(Color.primary.opacity(0.08))
                    .cornerRadius(4)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(Color(nsColor: .windowBackgroundColor).opacity(0.5))

            Divider()

            // Code content
            ScrollView(.horizontal, showsIndicators: true) {
                Text(code)
                    .font(.system(size: 12.5, design: .monospaced))
                    .textSelection(.enabled)
                    .padding(12)
            }
        }
        .background(Color(nsColor: .textBackgroundColor).opacity(0.6))
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(Color.primary.opacity(0.1), lineWidth: 1)
        )
    }
}
