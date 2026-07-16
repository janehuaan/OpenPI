# 记忆系统设计方案 v2（借鉴业界成熟方案）

## 业界成熟方案调研

### Claude Code 的 memdir 系统（最接近 pi 的参考模型）

Claude Code 的记忆系统有以下几个关键设计点：

1. **纯文件存储，零外部依赖** — 不用向量数据库，不用 embedding，纯 Markdown 文件
2. **索引 + 主题文件模式** — `MEMORY.md` 是 200 行的索引文件，指向具体的 `user_*.md`、`feedback_*.md` 等主题文件
3. **四种记忆类型**：
   - **User** — 用户角色、偏好、沟通风格（慢衰减）
   - **Feedback** — 用户纠正、验证过的方法、要避免的事（慢衰减）
   - **Project** — 截止日期、决策、进行中的工作（快衰减）
   - **Reference** — 外部系统指针（Linear、Slack 等）
4. **预压缩冲刷（Pre-compaction Flush）** — 压缩前给模型一次机会保存值得记住的东西
5. **冻结快照（Frozen Snapshot）** — session 开始时加载并冻结，mid-session 写入不影响当前 prompt
6. **背景提取（Background Extractor）** — session 结束后异步从 transcript 中提取事实
7. **自动维护（AutoDream）** — 24h + 5 sessions 后合并重复、淘汰过时
8. **排除清单** — 能从 git/codebase 推导出的信息不存为记忆

### Mem0 / Letta 的核心思路

- **Mem0**：被动提取 + 语义搜索，框架无关的 pluggable 层
- **Letta**：Agent 自编辑三层记忆（Core/Recall/Archival）

## 面向 pi 的设计决策

### 不做的事（排除）

| 方案 | 为什么不选 |
|------|-----------|
| 向量数据库 / embedding | pi 的定位是 terminal agent，不应引入外部基础设施 |
| 知识图谱 | 冷启动问题严重，对于 coding agent 过度工程化 |
| Agent 自编辑三层记忆 | 让 LLM 自己决定存什么会增加 token 消耗，且质量不可控 |
| 实时 prompt 重建 | 破坏 prompt cache，性能代价太高 |

### 要做的事（借鉴 Claude Code）

| 设计点 | 说明 |
|--------|------|
| **纯文件存储** | 记忆存在项目级 `.pi/memory/` 目录下，JSONL 格式，人类可读 |
| **索引 + 主题文件** | `MEMORY.md` 索引文件 + `type-key.md` 主题文件 |
| **四种记忆类型** | user / feedback / project / lesson（替换 Claude 的 reference，更适合 coding agent） |
| **预压缩冲刷** | 监听 `session_before_compact`，压缩前给 LLM 一次保存机会 |
| **冻结快照** | session 开始时加载索引，mid-session 写入不影响当前 prompt |
| **背景提取** | session 结束时异步提取重要事实 |
| **容量限制** | 索引文件 200 行上限，单条记忆自动淘汰 |
| **排除清单** | 能从代码/git 推导的信息不存为记忆 |

## 数据模型

### 索引文件 `.pi/memory/MEMORY.md`

```markdown
# Memory Index

## User
- [role] Senior TypeScript developer, prefers functional style
- [preference] Always use `const` over `let`

## Feedback
- [correction] Don't suggest `any` types in this project
- [validated] `StringEnum` is required for Google API compatibility

## Project
- [deadline] API migration due 2026-08-01
- [decision] Using bun instead of node for runtime

## Lesson
- [mistake] Don't run `npm test` without API keys unset
- [pattern] Use `ctx.exec()` not `ctx.exec` for shell commands
```

### 主题文件 `.pi/memory/user-role.md`

```markdown
# User Role
Senior TypeScript developer at earendil-works.
Prefers functional programming style.
Uses bun as primary runtime.

Last updated: 2026-07-16
Age: 0 days
```

## 工具设计

### `memory` 工具（单一工具，多种操作）

借鉴 Claude Code 的简洁性，用一个工具处理所有操作：

```typescript
// 存储记忆
memory({ action: "save", type: "lesson", key: "npm-check", value: "Always run npm run check before committing" })

// 查询记忆
memory({ action: "query", type: "lesson", keyword: "npm" })

// 列出所有
memory({ action: "list", type?: "user" })

// 删除
memory({ action: "delete", key: "npm-check" })
```

### `/memory` 命令

供用户手动管理记忆。

## Compaction 集成

```typescript
// 预压缩冲刷：在压缩前给 LLM 一次保存机会
pi.on("session_before_compact", async (event, ctx) => {
  const memories = loadMemoryIndex(ctx);
  if (memories.length > 0) {
    // 将记忆摘要注入准备阶段，确保它们不被摘要丢失
    event.preparation.messagesToSummarize.unshift({
      role: "system",
      content: [{ type: "text", text: `[MEMORY]\n${formatMemories(memories)}` }]
    });
  }
  return undefined;
});

// 压缩后提取：session 结束时从 transcript 中提取新记忆
pi.on("session_compact", async (_event, ctx) => {
  // 异步提取，不阻塞
  scheduleMemoryExtraction(ctx);
});
```

## 文件结构

```
packages/coding-agent/examples/extensions/memory/
├── index.ts              # 主入口：注册 memory 工具 + /memory 命令 + 事件监听
├── memory-store.ts       # 记忆存储/读取/删除逻辑（读写 .pi/memory/）
├── memory-types.ts       # 四种记忆类型的定义和验证
├── compaction-hook.ts    # 预压缩冲刷 + 压缩后提取
├── memory.md             # 索引文件管理
└── README.md             # 使用说明
```

## 与 Claude Code 的差异

| 维度 | Claude Code | pi 记忆系统 |
|------|------------|------------|
| 存储位置 | `~/.claude/projects/<repo>/memory/` | 项目级 `.pi/memory/` |
| 团队共享 | 有 team memory | 初期不做，可扩展 |
| 背景提取 | 独立 sub-agent | 简化版：session 结束时提取 |
| 自动维护 | AutoDream 服务 | 索引超 200 行时自动淘汰 |
| Prompt 注入防御 | 扫描危险模式 | 暂不实现 |
| 冻结快照 | 是 | 是 |
| 排除清单 | 是 | 是（提示 LLM 什么不该存）|

## 实施计划

### Phase 1：基础存储 + 查询
- 四种记忆类型定义
- 索引文件管理（MEMORY.md）
- 主题文件 CRUD
- `memory` 工具

### Phase 2：Compaction 集成
- 预压缩冲刷
- 压缩后提取
- 容量限制和淘汰

### Phase 3：优化
- 背景提取（session 结束后的异步提取）
- 记忆老化（ freshness warning）
- 排除清单提示
