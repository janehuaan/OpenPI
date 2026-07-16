# Pi Agent Harness 二次开发方案

## 背景

在 pi 现有 7 个内置工具（read, write, edit, bash, grep, find, ls）基础上，补充实际开发场景中高频缺失的能力。所有新功能均以 **extension** 形式实现，不修改 core。

---

## 功能清单

### 1. Web Fetch 工具（web_fetch）

**问题**：Agent 无法访问互联网获取信息，遇到需要查文档、查 API、搜报错的场景只能靠猜测或让用户手动提供内容。

**方案**：实现一个 `web_fetch` 工具 extension，支持：
- 抓取任意 URL 的页面文本内容
- 可选：提取正文（去除导航/广告等噪音）
- 可选：URL 合法性校验（只允许 http/https）
- 可选：超时控制、最大响应体限制
- 可选：User-Agent 设置

**技术要点**：
- 使用 Node 18+ 原生 `fetch()`，不引入额外依赖
- 通过 `pi.registerTool()` 注册
- 通过 `tool_call` 事件钩子可被 permission-gate 拦截
- 参数 schema：`{ url: string, max_bytes?: number, timeout_seconds?: number }`

**文件位置**：`packages/coding-agent/examples/extensions/web-fetch.ts`

---

### 2. 任务追踪工具（tasks）

**问题**：Agent 处理复杂任务时缺乏结构化任务管理能力。现有的 `todo.ts` 示例过于简单，只有增删改查，没有优先级、分类、状态流转。

**方案**：实现一个增强版 `tasks` 工具 extension，支持：
- 创建任务：标题、描述、优先级（high/medium/low）、标签
- 完成任务：标记完成、添加完成备注
- 查询任务：按状态/优先级/标签筛选
- 更新任务：修改优先级、标签、描述
- 删除任务
- 任务统计摘要

**技术要点**：
- 状态通过 `pi.appendEntry()` 持久化到 session，确保 fork/branch 正确
- 通过 `session_start` / `session_tree` 事件恢复状态
- 提供 `/tasks` 命令查看当前任务列表
- 参数 schema 使用 `StringEnum` 保证 Google API 兼容
- 可选：支持 `tasks` 工具的 `promptGuidelines` 引导 LLM 主动使用

**文件位置**：`packages/coding-agent/examples/extensions/tasks.ts`

---

### 3. 权限审批系统（permission-gate 增强版）

**问题**：现有的 `permission-gate.ts` 仅覆盖 rm/sudo/chmod 三种危险模式，且只有简单的 yes/no 确认。缺少：
- 可配置的审批策略（always-ask / ask-once / whitelist / denylist）
- 危险操作分级（高危直接拒绝、中危需要确认、低危静默）
- 审批记录审计
- 对 write/edit 工具的路径保护（已有 protected-paths 但可整合）

**方案**：实现一个综合性的 `security-gate` extension，整合并增强现有 permission-gate 和 protected-paths 的功能：

**安全等级定义**：
| 级别 | 操作示例 | 策略 |
|------|---------|------|
| CRITICAL | `rm -rf /`, `sudo`, 格式化磁盘 | 无条件拒绝 |
| HIGH | `rm -rf` (项目内), 修改 .env/.git, 大文件写入 | 每次确认 |
| MEDIUM | 编辑未知文件, 执行未知名脚本 | 首次确认后缓存 |
| LOW | read, grep, find, ls | 静默通过 |

**功能**：
- 通过 `tool_call` 事件拦截 bash/write/edit 操作
- 可配置的规则列表（通过 `pi.registerFlag` 或环境变量）
- 审批日志通过 `pi.appendEntry()` 持久化
- 支持 `--security-gate-mode` CLI flag：`strict` / `confirm` / `permissive`

**技术要点**：
- 复用 `permission-gate` 的正则匹配逻辑，扩展更多模式
- 整合 `protected-paths` 的路径保护逻辑
- 整合 `dirty-repo-guard` 的 git 变更检测
- 使用 `pi.appendEntry("security-audit", {...})` 记录审批日志

**文件位置**：`packages/coding-agent/examples/extensions/security-gate.ts`

---

### 4. 代码搜索工具（code_search）

**问题**：现有 `grep` 只能正则匹配文本，`find` 只能找文件。Agent 在大型代码库中定位特定功能实现时效率很低——需要理解代码语义而不仅是文本匹配。

**方案**：实现一个 `code_search` 工具 extension，支持：
- 基于关键词的代码符号搜索（函数名、类名、变量名）
- 支持限定语言/文件类型过滤
- 支持限定目录范围
- 返回匹配的代码片段（含上下文行）

**技术要点**：
- 底层使用 `rg`（ripgrep）的 `--type` 和 `--glob` 能力
- 通过 `pi.registerTool()` 注册为 LLM 可调用的工具
- 参数 schema：`{ query: string, language?: string, path?: string, max_results?: number }`
- 如果系统无 `rg`，降级使用 `grep -rn`
- 结果截断防止输出过大

**备选方案**：如果 rg 不可用或用户需要语义搜索，可以后续集成 `tree-sitter` 做 AST 级别的符号搜索（作为独立 extension）。

**文件位置**：`packages/coding-agent/examples/extensions/code-search.ts`

---

## 实现顺序

1. ~~**Web Fetch**（最简单，纯工具实现，无状态管理）~~ ✅
2. ~~**Tasks**（中等复杂度，涉及状态持久化和 UI 渲染）~~ ✅
3. ~~**Security Gate**（中等复杂度，整合多个现有 extension 的逻辑）~~ ✅
4. ~~**Code Search**（较复杂，涉及 rg 调用和结果格式化）~~ ✅

## 已完成

四个 extension 已全部写入 `packages/coding-agent/examples/extensions/` 目录：

| 文件 | 工具/功能 | 行数 |
|------|----------|------|
| `web-fetch.ts` | `web_fetch` 工具 | ~134 |
| `tasks.ts` | `tasks` 工具 + `/tasks` 命令 | ~436 |
| `security-gate.ts` | 安全门控 + `/audit` 命令 | ~418 |
| `code-search.ts` | `code_search` 工具 | ~219 |

## 待验证

- `npm run check` 通过（当前环境无 node_modules，需在完整开发环境验证）
- `./test.sh` 通过（如需新增测试）

---

## 通用约束

- 所有代码遵循 `AGENTS.md`：无 `any`、无 inline import、erasable syntax only
- 字符串参数使用 `StringEnum`（Google API 兼容）
- 状态持久化通过 `pi.appendEntry()` + `session_start` 重建
- 格式：Tab 缩进 3 空格，行宽 120
- 不修改任何 core 文件
- 每个 extension 附简短 README 说明用法

---

## 不做的事

- **MCP 支持**：需要引入外部协议和 HTTP 服务，超出 extension 范畴，建议作为独立项目
- **沙箱/容器化**：已有 `gondolin` 和 `sandbox` 示例 extension，无需重复建设
- **Subagent 框架**：已有 `subagent/` 示例 extension
- **RAG/向量数据库**：需要外部存储依赖，不适合 extension 形态
- **构建/测试自动化**：可通过 bash 工具 + 现有 extension 组合实现
