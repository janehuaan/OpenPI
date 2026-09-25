import SwiftUI

public struct ToolCallView: View {
    public let tool: ToolCallItem
    @State private var isExpanded: Bool = false

    public init(tool: ToolCallItem) {
        self.tool = tool
    }

    private var isSubagent: Bool {
        tool.name.lowercased() == "subagent"
    }

    private var isTask: Bool {
        tool.name.lowercased() == "task"
    }

    private var iconName: String {
        let name = tool.name.lowercased()
        if isSubagent {
            return "person.crop.circle.badge.plus"
        } else if isTask {
            return "key.horizontal"
        } else if name.contains("bash") || name.contains("command") || name.contains("terminal") {
            return "terminal"
        } else if name.contains("read") || name.contains("write") || name.contains("file") || name.contains("edit") {
            return "doc.text"
        } else if name.contains("find") || name.contains("grep") || name.contains("search") {
            return "magnifyingglass"
        }
        return "wrench.and.screwdriver"
    }

    private var badgeColor: Color {
        if isSubagent {
            return .orange
        } else if isTask {
            return .brown
        }
        return .blue
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Button(action: {
                withAnimation(.easeInOut(duration: 0.15)) {
                    isExpanded.toggle()
                }
            }) {
                HStack(spacing: 8) {
                    Image(systemName: iconName)
                        .font(.system(size: 11))
                        .foregroundStyle(badgeColor)

                    Text(tool.name.uppercased())
                        .font(.system(size: 10.5, weight: .bold, design: .monospaced))
                        .foregroundStyle(badgeColor)

                    if let act = tool.liveActivity, !act.isEmpty {
                        Text(act)
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    } else if !tool.args.isEmpty {
                        Text(tool.args.replacingOccurrences(of: "\n", with: " "))
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }

                    Spacer()

                    if tool.status == "running" {
                        HStack(spacing: 3) {
                            ProgressView()
                                .controlSize(.mini)
                            Text("running")
                                .font(.system(size: 10, weight: .medium, design: .monospaced))
                                .foregroundStyle(.orange)
                        }
                        .padding(.horizontal, 5)
                        .padding(.vertical, 1.5)
                        .background(Color.orange.opacity(0.12))
                        .clipShape(Capsule())
                    } else if tool.status == "error" {
                        Image(systemName: "xmark")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(.red)
                    } else {
                        Image(systemName: "checkmark")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(.green)
                    }

                    Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                        .font(.system(size: 9))
                        .foregroundStyle(.tertiary)
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(Color.primary.opacity(0.03))
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .overlay(
                    RoundedRectangle(cornerRadius: 6)
                        .stroke(Color.primary.opacity(0.05), lineWidth: 1)
                )
            }
            .buttonStyle(.plain)

            if isExpanded {
                VStack(alignment: .leading, spacing: 6) {
                    if !tool.args.isEmpty {
                        Text("参数:")
                            .font(.system(size: 10.5, weight: .medium))
                            .foregroundStyle(.secondary)
                        Text(tool.args)
                            .font(.system(size: 11, design: .monospaced))
                            .padding(6)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color.primary.opacity(0.03))
                            .clipShape(RoundedRectangle(cornerRadius: 4))
                            .textSelection(.enabled)
                    }

                    if let output = tool.output, !output.isEmpty {
                        Text("输出:")
                            .font(.system(size: 10.5, weight: .medium))
                            .foregroundStyle(.secondary)
                        ScrollView(.vertical) {
                            Text(output)
                                .font(.system(size: 10.5, design: .monospaced))
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .textSelection(.enabled)
                        }
                        .frame(maxHeight: 180)
                        .padding(6)
                        .background(Color.primary.opacity(0.03))
                        .clipShape(RoundedRectangle(cornerRadius: 4))
                    }
                }
                .padding(8)
                .background(Color(nsColor: .controlBackgroundColor).opacity(0.6))
                .clipShape(RoundedRectangle(cornerRadius: 6))
            }
        }
    }
}
