# openpi-next

# OpenPI

OpenPI —— 一个高性能、全栈重构的桌面 AI 助手（Rust + Tauri + React）。

## 架构

核心架构已从旧版的 Electron + Node.js Daemon 迁移至原生的 **Tauri (Rust)**，大幅降低内存占用，提升运行效率与安全性。

```
apps/desktop              Tauri 壳 (WebView + Rust Backend) —— 原生窗口与系统集成
crates/openpi-daemon      核心守护进程，负责会话监督、进程管理、Socket 通信
crates/openpi-scheduler   Rust 原生的定时任务引擎 (cron/DAG)
crates/openpi-memory      向量检索与会话记忆模块 (Rust)
crates/openpi-state       全局状态管理
crates/openpi-storage     SQLite 数据库持久化层
crates/openpi-proto       全局共享的跨进程通信协议类型定义
swift/                    系统原生的监控与插件扩展（macOS/iOS）
extensions/               AI 扩展能力集合 (Sentinel等)
```

## 核心特性

- **轻量级原生体验**: 基于 Tauri 构建，相较于传统 Electron 体积更小，内存开销更低。
- **全异步 Rust 后端**: 采用 Tokio 构建高性能底层 Daemon，负责所有高并发任务及长连接 WebSocket 通信。
- **内存安全与高效**: 本地记忆、事件总线、文件调度均在 Rust 层实现，无需繁重的 Node.js runtime。
- **极简前端 UI**: React 19 + Vite 构建的现代化响应式布局，体验流畅。
- **原生系统级集成**: 包括 Swift 编写的内存监控、系统信息收集组件。

## 开发

环境要求：
- Node.js 20+
- Rust 1.80+ (cargo)
- macOS (Xcode Command Line Tools)

```bash
# 1. 安装前端依赖
yarn install

# 2. 本地开发 (自动启动 Vite 前端与 Cargo Tauri 后端)
cd apps/desktop
yarn dev

# 3. 构建前端产物
yarn build:web
```

## 打包 (Release)

使用提供的脚本构建生产版本的 `.app`：

```bash
# 构建并打包生成 macOS 应用程序 (OpenPI.app)
./scripts/package-tauri-app.sh
```

构建完成的产物会位于 `dist/OpenPI.app`。
