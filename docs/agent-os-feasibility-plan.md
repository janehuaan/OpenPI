# OpenPI Agent OS 可行性方案 (Feasibility Plan)

> 输入：用户明确要求「打造一个个人 Agent 助理，并规划 Agent OS 的可行性」，并指出当前改造"还是原来的方向"。
> 关系：本文件是 `OPENPI_PERSONAL_AGENT_OS_SPEC_v1.1.md`（架构规范）的**落地可行性 + 路线图**补充，不重复其分层定义。

---

## 0. 目标重述（把话说准）

| 项 | 是什么 | 不是什么 |
|---|---|---|
| 个人 Agent 助理 | 懂我、长记忆、**主动办事**、有自律边界的常驻代理 | 更聪明的聊天机器人 |
| Agent OS | 以**世界状态 / 任务 / 事件流**为主屏的操作系统式外壳，Chat 只是其中一种"下达指令的仪器" | 把 Chat 界面换皮 |

**验收判据（一句话）**：打开应用，第一眼看到的应该是「Agent 现在知道什么、在做什么、为什么、接下来要做什么」，而**不是**一段对话记录和一个输入框。

---

## 1. 差距诊断：为什么"改了但没完全改"

以实际截图（2026-10-11 21:09 版）为证据：

| 观察到的界面事实 | 它属于哪个范式 | 判定 |
|---|---|---|
| 主视口 = 消息气泡流（用户气泡右对齐 + 助手卡片 + 「展开完整回答」） | Chat | ❌ 主导了整个屏幕 |
| 底部常驻大输入框「有什么可以帮你的吗？」 | Chat | ❌ 暗示"这里是聊天窗口" |
| 左栏 = 「项目工程(5) / 最近会话」列表 | IDE / Chat | ❌ 不是 OS 的"应用/任务"组织方式 |
| 顶部 Agent 形象卡（orb + 状态 + 最近活动 + 冒泡） | Agent OS | ✅ 但只占 ~8% 面积，**不参与交互** |

**结论**：我做的是「在 Chat 上贴了一张 Agent 卡片」，而不是「把 Chat 降级为 Agent OS 的一个面板」。主屏的**信息主权**仍在对话历史上，所以观感依旧是"原来的方向"。

---

## 2. 技术可行性（后端）—— 已具备 vs 缺口

### 2.1 已经具备（可复用，无需重写）

| 能力 | 落点 | 状态 |
|---|---|---|
| 常驻守护进程（关窗也在跑、崩溃自拉起） | `crates/openpi-daemon` + `daemon_client.rs::spawn_supervisor` | ✅ |
| 事件总线 + 生产者（文件/Git/心跳/会话闲置） | `event_bus.rs` / `event_producers.rs` | ✅ |
| 主动决策（去抖 → 熔断门禁 → 决策矩阵 → 落库/广播） | `proactive_loop.rs` / `decision.rs` | ✅ |
| 行动卡片（稳定 ID、可 dismiss、可一键执行） | `action_cards` 表 + `list/dismiss_action_card` | ✅ |
| 统一执行网关（权限 + 预算预扣 + 超时 + 熔断） | `gateway.rs` + `Dispatcher` 注入 | ✅ |
| 熔断器 / 分层预算 / 十大不变量看门狗 | `openpi-safety` | ✅ |
| 7 维记忆 + 半衰期衰减 + 1500 token 切片 | `openpi-memory` | ✅ |
| 长程目标状态机（7 态、进度、跨会话） | `openpi-state::goal` | ✅ |
| 调度器（定时任务 → 运行记录 PID/exit/结果） | `openpi-scheduler` + `snapshot.runs` | ✅ |
| 多 agent 实例 + 局域网遥控 + 云同步 | `supervisor` / `lan.rs` / `cloud_sync` | ✅ |

**判定：Agent OS 的"内核"已经存在，缺口几乎全在"外壳（Shell）"和"状态收敛"。**

### 2.2 缺口（Agent OS 必需但目前没有）

| 缺口 | 说明 | 难度 |
|---|---|---|
| **统一状态树（单一真源）** | 前端目前由 `snapshot` + `gitStatus` + `runs` + `goals` + `actionCards` 各自拼装，没有一棵"OS 状态树"。多面板读同一事实会漂移 | 中 |
| **世界状态视图** | 没有「Agent 现在知道什么」的结构化呈现（活跃目标、上下文、感知到的环境变化） | 中 |
| **任务板（Task Board）** | 有 `tasks` / `runs` 数据，但没有「目标 → 任务 → 运行 → 进程」的可干预视图（暂停/中止/重跑） | 中 |
| **能力/权限模型（per-agent capability）** | 现在只有全局 permission 开关，没有"这个 agent 被授予了哪些能力、何时授予" | 高 |
| **资源配额可视化** | 有分层预算，但没有 per-task 的 CPU/内存/时长配额呈现与超限解释 | 中 |
| **统一可观测性** | 没有 trace/日志的统一入口（现在散在 run 的 stdout/stderr 文件里） | 中 |
| **扩展运行时** | `extensions-tab` 只有壳 | 高 |

---

## 3. 产品可行性（交互范式）

### 3.1 Agent OS 主屏应当是什么

```
┌──────────────────────────────────────────────────────────────────────────┐
│  ⬤ OpenPI   ● 在线 24/7        ⌘K 搜索        🔔 3      [Jane]            │  ← 系统顶栏
├──────────┬───────────────────────────────────────────────────────────────┤
│ ◉ Now    │  NOW · 世界状态                                                │
│ ▤ Tasks  │  ┌─────────────────────────────────────────────────────────┐  │
│ ≡ Activity│  │ 我知道：openpi-next 有 73 个文件未提交                  │  │
│ ◈ Memory │  │ 我在做：审查未提交变更（Run #4821 · 运行中 12s）        │  │
│ ▣ Projects│ │ 我建议：先审查 3 个高风险文件再提交                     │  │
│ ⌘ Chat   │  │                          [执行] [忽略] [看详情]        │  │
├──────────┤  └─────────────────────────────────────────────────────────┘  │
│ 后台进程  │  ▤ 任务板（目标 → 任务 → 运行）                                │
│ ● 3 运行  │  ┌───────────────┬──────────┬────────┬────────────────────┐  │
│ ◐ 1 待确认│  │ OpenPI 架构改造│ 72%      │ 运行中 │ ⏸ 中止  ↻ 重跑     │  │
│ ○ 0 受阻  │  │ macosvir 重构  │ 41%      │ 待确认 │ ✓ 批准             │  │
├──────────┤  └───────────────┴──────────┴────────┴────────────────────┘  │
│ 事件流    │  ≡ 事件流（真实数据，非演示）                                  │
│ 21:09 ⚡  │  21:09 感知 · 检测到 73 个文件未提交 → 决策 SUGGEST           │
│ 21:06 ✓   │  21:06 行动 · 运行 cargo test → 148 通过                      │
└──────────┴───────────────────────────────────────────────────────────────┘
```

**关键差异**：Chat 从"主屏"变成左栏的一个应用（`⌘ Chat`），点开是**浮层/抽屉**（或右栏），不再是主视口的默认内容。

### 3.2 为什么这个范式可行

1. **数据都已有**：上图的每一行都能由现有 IPC 组装（`snapshot.runs` / `list_action_cards` / `listPersonalGoals` / `gitStatus` / 事件订阅）。
2. **后端不用动**：属于纯前端信息架构重构 + 一个状态树收敛层。
3. **可增量落地**：P0 只改主屏与左栏，不动 Chat 组件本身（保留为面板）。

---

## 4. 架构提案：Agent OS Shell

```text
Layer 5  Shell（OS 外壳）
         顶栏(状态/搜索/通知/账号) · 左 Rail(应用) · 主视口 · 右 Inspector · 指令浮层(⌘K/Chat)
Layer 4  Surfaces（应用）
         Now(世界状态) · Tasks(任务板) · Activity(事件流) · Memory · Projects · Chat(降级)
Layer 3  OS State Tree（单一真源）
         useAgentOS() ← 订阅 daemon 事件 + 合并 snapshot/goals/runs/cards，输出一棵树
Layer 2  能力层：现有 daemon IPC（subscribe_events / list_* / execute_through_gateway / …）
Layer 1  Execution Core（openpi-engine / openpi-tools）—— 冻结，零修改
```

**铁律不变**：Layer 1 继续冻结；个人智能层对底层的调用仍只走 Execution Gateway。

---

## 5. 分阶段路线图

### P0 · 主屏范式切换（1 周）
- 新增 `NowSurface`（世界状态）：我知道 / 我在做 / 我建议 三段式 + 行动按钮。
- `Chat` 降级：默认不占主视口，改为右栏或 `⌘K` 浮层（保留全部现有能力）。
- 左 Rail 从「项目/会话」改为 OS 应用：`Now / Tasks / Activity / Memory / Projects / Chat`；项目与会话下沉到 Projects 应用内。
- 引入 `useAgentOS()` 状态树，先把 `snapshot/goals/runs/cards` 收敛，消除各面板自行拼装。
- **验收**：冷启动第一屏是 Now，不是对话记录。

### P1 · 任务板与事件流（2 周）
- `TasksSurface`：目标 → 任务 → 运行（PID/时长/结果），支持 暂停 / 中止 / 重跑 / 批准。
- `ActivitySurface` 换真实数据：**删除 `DEFAULT_CAUSAL_EVENTS` 演示常量**，改为订阅事件总线 + `runs`。
- 运行详情：stdout/stderr 统一入口。

### P2 · 能力与资源治理（2–3 周）
- per-agent capability 模型（授予/撤销/审计），落到不变量 2。
- per-task 资源配额可视化（超限可解释）。
- 扩展运行时（让 `extensions-tab` 真正可用）。

### P3 · 编排与终端（探索）
- 多 agent 编排（swarm）可视化。
- 手机 / LAN 作为 Agent OS 的"远程终端"（已有 LAN 基础）。

---

## 6. 风险与边界

| 风险 | 缓解 |
|---|---|
| OS 化是产品级重构，易半途 | P0 只碰外壳与状态树，不动 Execution Core，可随时回退 |
| 自主执行失控 | 已有熔断 + 预算 + 十大不变量；P2 补 capability 模型 |
| 常驻 LLM 成本 | 已有事件去抖 + 1500 token 切片 + 分层预算 |
| 信息过载 | Now 只放"我知道/我在做/我建议"三段，其余进 Tasks/Activity |

---

## 7. 待拍板决策点

1. **Chat 的归宿**：右栏常驻 / `⌘K` 浮层 / 保留一个 Chat 应用页？（推荐：右栏可折叠 + ⌘K 浮层）
2. **P0 范围**：是否接受"第一屏换成 Now、Chat 退居次位"这一次性切换？
3. **左栏语义**：应用（Now/Tasks/…）与项目/会话如何并存？（推荐：应用为主，Projects 内再分项目/会话）
4. **执行权限默认值**：Now 上的「执行」按钮默认走网关只读，还是允许写入？
---

## 8. P0 落地状态（2026-10-11 实施）

**已实施**（主屏范式切换，后端零改动）：

| 交付 | 落点 | 状态 |
|---|---|---|
| Layer 3 状态树 `useAgentOS()` | `apps/desktop/web/lib/agent-os.ts`（新） | ✅ |
| 事件流合并 `buildAgentActivity()`（单一真源） | 同上 | ✅ |
| Agent OS 主屏 `NowSurface`（我知道 / 我在做 / 我建议 / 最近活动 + 指令条） | `components/surfaces/now/now-surface.tsx`（新） | ✅ |
| `view === "today"` → Now（冷启动首屏即世界状态） | `App.tsx` | ✅ |
| Chat 降级：打开会话/项目/新建会话一律进 `chat` 面板 | `App.tsx`（4 处 `setView`） | ✅ |
| 左栏语义拆分：`今日`（Now）/ `对话`（Chat） | `workspace-preview.tsx` | ✅ |
| 首屏不渲染 Context Inspector，主屏全宽 | `workspace-preview.tsx` | ✅ |
| **修掉 `{goals}` / `{memories}` 被当裸数组解析的缺陷** | `goals-surface.tsx` / `today-os-dashboard.tsx` / `workspace-preview.tsx` | ✅ |
| **修掉行动卡片刷屏**（去重身份改为「情境」而非含数字的整个 payload） | `crates/openpi-daemon/src/proactive_loop.rs::card_identity` | ✅ |
| **修掉「忽略等于没点」**（upsert 不再覆盖 status，被 dismiss 的卡片不复活） | `crates/openpi-storage/src/lib.rs::upsert_action_card` | ✅ |
| **冷启动第一屏恒为 Now**（hash 路径也不恢复 `chat`） | `lib/view-route.ts::initialView` | ✅ |
| **执行后归档卡片**（避免同一条建议反复催）+ 落地页滚动归零 | `lib/agent-os.ts` / `now-surface.tsx` | ✅ |
| **修掉分支名被解析成 `No`**（无提交仓库的 `No commits yet on X`） | `apps/desktop/src-tauri/src/git_ops.rs::parse_branch_line` | ✅ |

**仍待拍板（第 7 节的 4 个决策点）**：
1. Chat 归宿：当前实现为「左栏 `对话` 一级入口 + Now 底部指令条」，**尚未**做 `⌘K` 浮层 / 右栏可折叠。
2. P0 范围：本次已执行「第一屏换成 Now、Chat 退居次位」。
3. 左栏语义：应用为主（今日/对话/目标/项目/记忆/活动/智能体），项目与会话下沉到侧栏滚动区。
4. Now 上「一键执行」当前走 `executeThroughGateway(..., isReadOnly: true)`（只读），写入需显式升级。

**P1 待办（已确认的缺口）**：
- `ActivitySurface` 仍在用写死的 `DEFAULT_CAUSAL_EVENTS` 演示常量 —— 必须删除，改订阅真实事件流 + `runs`（Now 已先行用真实数据，两者应共用 `buildAgentActivity()`）。
- `TasksSurface` 补「目标 → 任务 → 运行（PID/时长/结果）」的可干预视图（暂停/中止/重跑）。
- `TodayOsDashboard`（1208 行、硬编码 `#0b0f19` 深色）目前是**未被渲染的死代码**；要么按语义化变量重写成浅色可用，要么删除，避免与 `NowSurface` 重复。

