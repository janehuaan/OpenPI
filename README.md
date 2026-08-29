<p align="center">
  <img alt="OpenPI" src="packages/openpi-desktop/build/icon.png" width="96">
</p>
<h1 align="center">OpenPI 个人智能助手</h1>

<p align="center">本地优先的个人 AI Agent，桌面端开箱即用，无需命令行。</p>

---

## 特性

| 能力 | 说明 |
|------|------|
| **本地记忆** | bge-small-zh 嵌入模型（25 MB，本地运行），记忆全部存本地文件 |
| **语义检索** | 混合向量 + BM25 搜索，无需外部向量数据库，无 API key |
| **任务状态** | 结构化目标/步骤/检查点/错误持久化，崩溃重启后无缝续跑 |
| **上下文压缩** | 智能压缩生成结构化检查点，长任务不丢状态 |
| **可观测性** | 工具调用/任务进度/事件日志实时可见，桌面状态栏 + 运行视图 |
| **桌面应用** | Electron 打包，双击即用，无需 CLI |

## 架构

```
用户输入
    │
    ▼
┌───────────────────────────────┐
│  Agent Session                │
│  ├─ 上下文注入(检查点+任务)   │
│  ├─ 工具调用 → 事件日志       │
│  └─ 上下文压缩 → 检查点文件   │
└───────────────────────────────┘
    │
    ▼
┌───────────────────────────────┐
│  本地记忆检索                 │
│  ├─ 向量搜索 (bge-small-zh)   │
│  └─ BM25 关键词               │
└───────────────────────────────┘
```

所有数据存储在本地 `.pi/` 目录，无云端依赖。

## 快速开始

### 桌面版（推荐）

```bash
# 打包 macOS 应用
cd packages/openpi-desktop
npm run pack:mac

# 安装
open release/OpenPI-0.80.8.dmg
```

### 开发模式

```bash
npm install --ignore-scripts
npm run check        # lint + 类型检查
./pi-test.sh         # 从源码运行
```

## 性能

| 指标 | 数值 |
|------|------|
| 嵌入延迟 | ~25 ms（本地 bge-small-zh） |
| 检索延迟（1000条记忆） | ~30 ms |
| 存储（1000条记忆） | ~2 MB |
| 应用安装包 | 418 MB DMG |

## 技术栈

- **Agent 核心**：基于 [pi](https://github.com/earendil-works/pi) 构建
- **桌面端**：Electron + Vite + React
- **嵌入模型**：bge-small-zh（GGUF，本地 llama-server 运行）
- **检索**：本地哈希向量 + BM25 混合

## 许可

MIT

---

<p align="center"><sub>基于 <a href="https://github.com/earendil-works/pi">pi</a> 构建</sub></p>
