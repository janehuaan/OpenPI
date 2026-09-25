import SwiftUI
import OpenPIProtocol

@main
public struct OpenPIDesktopApp: App {
    @State private var appStore = AppStore()

    public init() {}

    public var body: some Scene {
        WindowGroup {
            NavigationSplitView {
                SidebarView(appStore: appStore)
                    .frame(minWidth: 220, idealWidth: 260, maxWidth: 340)
            } detail: {
                MainContentView(appStore: appStore)
            }
            .navigationSplitViewStyle(.balanced)
            .sheet(isPresented: $appStore.showSettingsModal) {
                SettingsSurfaceView(appStore: appStore)
            }
            .task {
                await appStore.connect()
            }
        }
        .windowStyle(.titleBar)
        .windowToolbarStyle(.unified)
        .defaultSize(width: 1080, height: 720)
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("新建会话") {
                    Task {
                        _ = await appStore.createSession()
                    }
                }
                .keyboardShortcut("n", modifiers: .command)
            }

            CommandGroup(replacing: .appSettings) {
                Button("偏好设置...") {
                    appStore.showSettingsModal = true
                }
                .keyboardShortcut(",", modifiers: .command)
            }

            CommandMenu("视图") {
                Button("对话主面板") {
                    appStore.selectedTab = .chat
                }
                .keyboardShortcut("1", modifiers: .command)

                Button("版本管理 (Git)") {
                    appStore.selectedTab = .git
                }
                .keyboardShortcut("2", modifiers: .command)

                Button("长期记忆") {
                    appStore.selectedTab = .memory
                }
                .keyboardShortcut("3", modifiers: .command)

                Button("定时任务") {
                    appStore.selectedTab = .tasks
                }
                .keyboardShortcut("4", modifiers: .command)
            }
        }

        #if os(macOS)
        MenuBarExtra("OpenPI", systemImage: "cpu") {
            Text("OpenPI 状态: \(appStore.connectionState.title)")
                .font(.system(size: 11))
            Divider()
            Button("刷新状态") {
                Task {
                    await appStore.refreshSessions()
                }
            }
            Divider()
            Button("退出") {
                NSApplication.shared.terminate(nil)
            }
        }
        #endif
    }
}
