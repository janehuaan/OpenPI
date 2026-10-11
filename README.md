# OpenPI

<div align="center">

**高性能、全栈重构的跨端原生 AI 研发助手**

[![macOS](https://img.shields.io/badge/Platform-macOS-black?logo=apple)](https://apple.com)
[![Rust](https://img.shields.io/badge/Rust-1.80%2B-orange?logo=rust)](https://www.rust-lang.org/)
[![Tauri](https://img.shields.io/badge/Tauri-v2-blue?logo=tauri)](https://tauri.app/)
[![React](https://img.shields.io/badge/React-19-61dafb?logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue?logo=typescript)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

*基于 Rust + Tauri + React 构建的原生轻量级智能体研发环境，拥有纯异步核心守护、自愈活性体系、多端局域网遥控与端到端加密同步能力。*

</div>

---

## 📖 架构概览

OpenPI 摒弃了传统重量级 Electron + Node.js 架构，全面迁移至 **Tauri v2 + 纯异步 Rust 守护体系**。整体架构分为桌面外壳、守护进程、智能体执行引擎、基础设施库及前端界面：

```
openpi-next/
├── apps/
│   ├── desktop/              # Tauri v2 桌面应用 (WebView + Rust Tauri 后端)
│   └── homepage/             # 官方主页与展示站点
├── crates/
│   ├── openpi-daemon/        # 核心后台守护进程：会话管理、局域网 WS、IPC Socket 服务
│   ├── openpi-engine/        # 智能体核心循环、工具调用、上下文预算裁剪与会话总结
│   ├── openpi-gateway/       # 本地 LLM 反向代理网关、入站鉴权与缓存 Token 对账
│   ├── openpi-tools/         # 受控终端执行 (Managed Bash)、代码检索、文件操作
│   ├── openpi-memory/        # 向量记忆与语义检索（支持 Apple Silicon Metal GPU 加速）
│   ├── openpi-scheduler/     # 原生定时任务引擎 (Cron / DAG 调度)
│   ├── openpi-storage/       # SQLite 数据库持久化层与 CAS 去重引擎
│   ├── openpi-state/         # 会话状态管理与检查点回滚机制
│   ├── openpi-security/      # 密钥派生、权限守卫与敏感信息保护
│   ├── openpi-jev/           # 事件总线与遥测日志引擎
│   └── openpi-proto/         # 跨进程 / 跨端共享的数据协议与类型契约
├── scripts/                  # 自动化打包、签名、安装与目标架构检查脚本
└── extensions/               # AI 扩展与外置能力集合
```

---

## ✨ 核心特性

### 1. 极致的原生性能与内存占用
- **零 Node.js 后台开销**：核心逻辑与文件调度完全移交 Rust，冷启动仅需百毫秒，运行时常驻内存极小。
- **Metal GPU 向量加速**：在 Apple Silicon 设备上利用 Metal 原生加速向量内积与余弦检索，语义召回极速响应。

### 2. 稳健自愈的高可用守护体系
- **进程级 Supervisor 活性监管**：桌面端自动拉起并守护后台 Daemon 进程，遭遇异常可在 2 秒内无缝自愈。
- **IPC 断连全局广播**：Socket 断开纳秒级通知前端流重置，配合看门狗与服务端权威状态同步，彻底根除工具幽灵执行与几千秒假死循环。
- **原子无损替换**：采用安全临时文件替换机制，避免直接覆盖运行中 Mach-O 映射导致进程挂起。

### 3. 动态上下文与预算管理引擎
- **结构化折叠**：自动拦截超大工具入参 (`arguments`) 与深度思考流 (`reasoning`)，在保留上下文核心意图的前提下降低 90% 冗余体积。
- **动态预算裁剪**：根据上下文窗口（48k/128k）自动对半剪裁超长工具输出，告别上游 LLM 400 Context Overflow。

### 4. 局域网多端遥控 (LAN Remote)
- **同网实时联动**：基于 WebSocket 的纯 Rust 局域网服务端，毫秒级流式合批推送桌面执行轨迹。
- **安全免码鉴权**：动态 6 位一次性配对码 + 设备安全令牌持久化，断线指数退避自动重连。
- **移动端伴侣**：配合 Android / iOS 原生应用，手机即可实时监视 Mac 上的 Agent 动作并随时下发指令或中断任务。

### 5. 端到端加密云漫游 (E2E Cloud Sync)
- **零知识加密**：基于 Argon2 派生密钥与 AES-GCM 高强度加密，所有会话与用户数据在离机前均已完成本地加密。
- **跨设备漫游**：自动接入 Supabase 云端同步，换机或多设备同时工作无缝漫游。

---

## 🛠️ 本地开发

### 环境要求
- **macOS** 13+ (推荐 macOS 14 / 15)
- **Node.js** 20+
- **Rust** 1.80+ (`rustc`, `cargo`, `clippy` 需已配置至 PATH)
- **Xcode Command Line Tools**

### 启动开发环境

```bash
# 1. 安装项目依赖
yarn install

# 2. 运行桌面端开发环境 (启动 Vite 前端与 Tauri 调试窗口)
cd apps/desktop
yarn dev
```

### 质量保证与 CI 等价验证

> ⚠️ **注意**：本地提交前请确保运行全套检查，尤其是跨架构编译检查：

```bash
# 1. 前端类型检查
yarn typecheck

# 2. 构建前端产物
yarn build

# 3. 运行全工作区单元测试 (Rust 单元测试 + 前端 Vitest)
yarn test

# 4. Rust Clippy 零警告静态检查
RUSTFLAGS="-D warnings" cargo clippy --workspace --all-targets -- -D warnings

# 5. 跨架构分支检查 (防止非本机架构 cfg 宏分支出错)
yarn check:targets
```

---

## 📦 打包与安装

项目内置了一体化发布、打包、重签名与就地安装流程：

### 1. 构建 macOS 发布包 (Release)
```bash
# 自动编译前端、Daemon 及 Tauri Bundle，并执行 codesign 签名与 Zip 归档
bash scripts/package-tauri-app.sh
```
产物将输出至：
- `target/release/bundle/macos/OpenPI.app`
- `target/release/bundle/OpenPI_<version>_<arch>.zip`

### 2. 一键安装到本地系统
```bash
# 停止旧进程、清空过期 Socket、原子替换至 /Applications/OpenPI.app 并就地重新签名
bash scripts/install-local.sh
```

### 3. 单独更新后台守护进程
```bash
# 编译最新 daemon 并热重载运行环境 (含 PID 确认)
bash scripts/install-daemon.sh target/release/openpi-daemon
```

---

## 📄 开源许可

本项目遵循 [MIT License](LICENSE) 协议。
