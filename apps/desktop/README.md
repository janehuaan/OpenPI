# @openpi/desktop

OpenPI 桌面客户端，基于 **Tauri (Rust)** 与 **React 19** 构建。

## 架构

- **src-tauri/**: Tauri 2.x 原生 Rust 入口，负责 macOS 原生窗口、托盘管理、IPC 路由与守护进程桥接。
- **web/**: React 19 + TypeScript + Vite 构建的现代化响应式前端，在原生 Webview 中流畅运行。

## 开发与构建

```bash
# 本地前端开发服务 (Vite)
yarn dev

# 编译前端静态资源
yarn build

# 运行单元测试
yarn test
```
