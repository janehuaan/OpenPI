# 记忆系统设计方案

## 概述

为 pi-coding-agent 实现一个**分层记忆系统**，使 Agent 能够在跨会话/跨分支的场景中积累知识、记住上下文、避免重复劳动。

## 设计原则

1. **Extension-first**：记忆系统作为 extension 实现，不修改 core
2. **分层架构**：短期记忆（session 内）+ 长期记忆（跨 session）+ 项目记忆（跨项目）
3. **自动集成**：自动参与 compaction，记忆不被摘要丢失
4. **可查询**：提供工具让 LLM 主动检索记忆
5. **轻量无依赖**：纯 TypeScript，不引入向量数据库或 embedding

## 架构

```
memory-extension/
├── index.ts          # 主入口：注册工具 + 事件监听
├── short-term.ts     # 短期记忆：session 内的关键信息快照
├── long-term.ts      # 长期记忆：跨 session 的项目经验
├── compaction-hook.ts # 参与 compaction，防止记忆丢失
└── queries.ts        # 记忆检索工具的实现
```

## 分层设计

### 1. 短期记忆 (Short-Term Memory)
- **作用域**：单个 session / branch 内
- **存储方式**：通过 `appendEntry` 存入 session，随 branch 分离
- **内容**：
  - 用户偏好设置（语言、风格、工具使用习惯）
  - 当前任务的进展和中间结论
  - 已探索的路径和失败尝试（避免重复）
  - 关键决策和理由
- **生命周期**：session 结束时自动清理（或保留在 branch 历史中）
- **触发**：LLM 通过 `memory_store` 工具主动写入，或 extension 自动捕获

### 2. 长期记忆 (Long-Term Memory)
- **作用域**：跨 session（同一项目内）
- **存储方式**：通过 `appendCustomMessageEntry` 写入 session，也可持久化到项目级 JSON 文件
- **内容**：
  - 项目结构和关键文件说明
  - 技术栈和约定
  - 常见问题和解决方案
  - 用户的工作习惯和反馈
- **生命周期**：手动清理或过期淘汰（超过 N 次 session 不活跃则归档）
- **容量限制**：最多保留 50 条记忆，按最近访问排序

### 3. 项目记忆 (Project Memory)
- **作用域**：项目级别，跨所有用户 session
- **存储方式**：项目根目录 `.pi/memory.json` 文件
- **内容**：
  - 项目概述和技术栈
  - 代码风格和命名约定
  - 目录结构和关键模块说明
  - 已知陷阱和最佳实践
- **生命周期**：手动更新，不会自动过期
- **触发**：首次 session 时自动扫描项目结构生成

## 工具设计

### `memory_store` — 存储记忆
```typescript
// 参数
{
  category: "preference" | "knowledge" | "lesson" | "progress",
  key: string,           // 唯一标识符
  value: string,         // 记忆内容
  scope: "session" | "project",  // 短期 or 长期
  ttl_sessions?: number  // 长期记忆的存活 session 数（可选）
}
```

### `memory_query` — 检索记忆
```typescript
// 参数
{
  query: string,         // 关键词搜索
  category?: string,     // 按类别过滤
  scope?: "session" | "project"  // 搜索范围
}
```

### `memory_list` — 列出记忆
```typescript
// 参数
{
  category?: string,     // 按类别过滤
  scope?: "session" | "project",
  limit?: number         // 返回数量上限
}
```

### `memory_clear` — 清理记忆
```typescript
// 参数
{
  key?: string,          // 清除指定记忆
  category?: string,     // 清除某类记忆
  scope?: "session" | "project"
}
```

## Compaction 集成

关键设计点：记忆条目必须在 compaction 时不被丢弃。

```typescript
// 监听 session_before_compact 事件
pi.on("session_before_compact", async (event, ctx) => {
  // 将记忆摘要注入到准备阶段
  const memories = getActiveMemories(ctx);
  if (memories.length > 0) {
    event.preparation.messagesToSummarize.unshift({
      role: "system",
      content: [{ type: "text", text: `[MEMORY]\n${memories.join("\n")}` }]
    });
  }
  return undefined; // 不阻止 compaction
});
```

## 项目记忆初始化

首次进入项目时，自动扫描并生成初始记忆：

```typescript
pi.on("session_start", async (_event, ctx) => {
  const projectRoot = ctx.cwd;
  const memoryFile = path.join(projectRoot, ".pi", "memory.json");

  if (!fs.existsSync(memoryFile)) {
    // 扫描项目结构
    const structure = await scanProjectStructure(ctx);
    const techStack = await detectTechStack(ctx);

    // 自动生成初始记忆
    storeProjectMemory(memoryFile, {
      overview: generateOverview(structure, techStack),
      detectedAt: new Date().toISOString(),
      memories: []
    });
  }
});
```

## 数据流

```
用户/LLM → memory_store → appendEntry → sessionManager
                              ↓
                         持久化到 .pi/memory.json (项目级)
                              ↓
LLM → memory_query → 读取 session entries + .pi/memory.json → 返回匹配结果
                              ↓
                      参与 compaction（记忆摘要注入）
```

## 文件结构

```
packages/coding-agent/examples/extensions/memory/
├── index.ts              # 主入口，注册所有工具 + 事件
├── types.ts              # 类型定义
├── store.ts              # 记忆存储逻辑（增删查）
├── project-scan.ts       # 项目扫描和初始记忆生成
├── compaction-hook.ts    # compaction 集成
└── README.md             # 使用说明
```

## 与现有 extension 的关系

| 现有 | 新增记忆系统 |
|------|------------|
| `todo.ts` — 任务追踪 | `memory_store` — 通用知识存储 |
| `tasks.ts` — 结构化任务 | 记忆系统可作为任务的补充（记录"怎么做"而非"做什么"） |
| `structured-output.ts` — 最终输出 | 记忆系统记录输出模式和用户偏好 |
| `plan-mode/` — 只读探索 | 记忆系统记录探索中发现的结构信息 |

## 实施计划

1. **Phase 1**：基础存储 + 短期记忆（session 内）
   - `memory_store` / `memory_query` 工具
   - 基于 session entry 的状态持久化
   - 基本 CRUD 操作

2. **Phase 2**：长期记忆 + 项目记忆
   - `.pi/memory.json` 文件持久化
   - 项目扫描和自动初始化
   - 记忆淘汰策略

3. **Phase 3**：Compaction 集成
   - `session_before_compact` 钩子
   - 记忆摘要注入
   - 防止记忆丢失

## 注意事项

- 不使用 `any` 类型
- 使用 `StringEnum` 保证 Google API 兼容
- 状态通过 `appendEntry` 持久化，不依赖内存
- 遵循 Tab 缩进和 120 行宽限制
- 所有工具都有 `promptSnippet` 和 `promptGuidelines`
