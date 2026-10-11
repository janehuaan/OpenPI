# OpenPI P0 接线改造方案（Wiring Plan）

> **文档性质**：设计文档 / 施工前方案（不涉及代码改动）。
> **目标**：把「已写完但没接线」的 4 个模块接通，让 OpenPI 真正具备
> **事件驱动 → 决策门控 → 主动服务 → 受控执行** 的完整闭环。
> **约束**：尽量不触碰 Execution Core（`openpi-engine` / `openpi-tools` 零污染）；
> 改动集中在 `openpi-daemon` + `openpi-safety` + `openpi-storage` + 少量前端。
> **配套规范**：`docs/OPENPI_PERSONAL_AGENT_OS_SPEC_v1.1.md`。

---

## 0. 背景与现状事实（已逐行核实）

本次盘点确认：OpenPI 的执行底座、记忆衰减模型、记忆注入、目标状态机、定时调度是**真接线**的；
但「个人助理」最关键的四个字——**事件驱动、后台自治、决策门控、统一网关**——都停留在
「代码已写、未接线」状态。以下为逐条证据（均来自本仓库代码）：

| 事实 | 证据位置 |
|---|---|
| 事件总线无生产者、无消费者 | `EventBus::publish` 仅 `crates/openpi-daemon/src/event_bus.rs:71` 单测调用；全仓无 `notify` 依赖；无 `event_bus.subscribe()` 消费者 |
| 决策引擎未接线 | `DecisionEngine::evaluate` 仅 `crates/openpi-daemon/src/decision.rs:105` 与 `:116` 单测调用 |
| 晨报仅拉取、内容写死 | `crates/openpi-daemon/src/app_ops.rs:565` 只有 `get_today_briefing` IPC 调用它；无 cron；问候语硬编码 `"Darling"`；Action Cards 多为写死默认项（`proactive.rs:42-104`） |
| 网关是桩 | `crates/openpi-daemon/src/gateway.rs:100-104` 内为 `tokio::time::sleep(10ms)`；真实执行走 `supervisor.send_rpc → engine`，**绕过网关** |
| AgentIdentity 未接线 | `crates/openpi-state/src/identity.rs` 定义完备，但全仓无 `AgentIdentity::default()` 调用（engine 用的是自己的 `config.rs` persona） |
| **事件投递存在 session 过滤陷阱** | `crates/openpi-daemon/src/ipc.rs:147-154`：一旦客户端订阅过具体会话，`session_id` 不匹配的事件被丢弃；`"*"` 通配只认「订阅端 == '*'」，而桌面端从不订阅 `"*"` |

> ⚠️ **关键前置坑**：`crates/openpi-daemon/src/task_runner.rs:45` 用 `"task-scheduler"` 发事件，
> 但按现过滤逻辑，用户一旦打开过任何会话，这些事件就会被丢弃。
> **P0 必须先修这个过滤**，否则新接线的主动事件同样送不到 UI。

### 0.1 现有事件链路（参考基线）

```
engine.agent_loop ──send((session_id, Value))──► Supervisor.event_tx (broadcast)
    │
    ├─► ipc.rs handle_connection::event_task  ── 按 subscribed_sessions 过滤 ──► 客户端 socket
    │                                                                              │
    │                                                    daemon_client.rs 解析 ServerMessage::Event
    │                                                                              │
    └─────────────────────────────────────────────► lib.rs:52 emit("openpi:conversation-event")
                                                                                   │
                                                              web App.tsx:647 / :784 消费
```

- `Supervisor.event_tx: broadcast::Sender<(String, Value)>`（`supervisor.rs:67`，pub）
- `Supervisor::subscribe_events()`（`supervisor.rs:311` 附近）
- 前端契约：`{ instanceId, event }`，已处理 `instanceId === "task-scheduler"`（`App.tsx:647`）
  与 `instanceId === "*"`（`App.tsx:784`，广播）

---

## 1. 前置修复（P0-0）：打通事件投递的「广播通道」

**问题**：`ipc.rs:143-170` 的 `event_task` 过滤逻辑把系统级/广播事件误杀。
当客户端订阅集非空时，`session_id` 为 `"*"` / `"task-scheduler"` / `"proactive"` 的事件都会被丢弃。

**改造点**：`crates/openpi-daemon/src/ipc.rs` → `handle_connection` 内 `event_task`（第 147-154 行）。

```rust
// 现：只有「订阅端 s == "*"」才放行，且 session_id == "*" 的广播会被误杀
// 改：显式定义三个永远放行的系统通道
let is_system = session_id == "*"
    || session_id == "task-scheduler"
    || session_id == "proactive";
if !is_system {
    let subs = subs_clone.lock().await;
    if !subs.is_empty()
        && !subs.contains(&session_id)
        && !subs.iter().any(|s| s == "*" || session_id.contains(s) || s.contains(&session_id))
    {
        continue;
    }
}
```

**理由**：`daemon_client.rs:304` 断连时已用 `("*", ...)` 广播，前端 `App.tsx:784` 也已处理
`instanceId === "*"` —— 说明「`*` = 广播」本就是既定契约，只是 daemon 侧过滤写错了方向。

**验收**：新增单测 `crates/openpi-daemon/tests/ipc_event_filter_test.rs`，
断言 `session_id == "*"` 与 `"task-scheduler"` 在任意订阅集下都放行。

---

## 2. P0-1：给 EventBus 接「生产者」

**目标**：把 `file_changed / git_uncommitted / timer_expired / session_idle / feedback`
真正发出来，让总线有真实事件源。

### 2.1 新增依赖

`crates/openpi-daemon/Cargo.toml`：加 `notify = "6"`（跨平台文件监听，macOS 走 FSEvents）。

### 2.2 新增模块 `crates/openpi-daemon/src/event_producers.rs`

四个生产者，全部只 `publish`、不含业务逻辑：

| 生产者 | 实现 | 关键防抖 |
|---|---|---|
| **FileWatcher** | `notify::recommended_watcher` 监听「活跃会话 cwd」，`RecursiveMode::NonRecursive` 只盯根目录 + `src/**` | **去抖 1.5s 合并**（对应不变量 6）；忽略 `target/ node_modules/ .git/ dist/` |
| **GitPoller** | 每 30s 对活跃 cwd 跑 `git status --porcelain`（`std::process::Command`，与现有 git 用法一致） | 状态哈希不变则不 publish |
| **Heartbeat** | `tokio::time::interval(60s)` → `timer_expired` | 固定节拍 |
| **SessionIdle** | 复用 `ipc.rs:47` 已有的 5s idle watchdog 判定，向总线发 `session_idle` | 只在「有会话但全部 idle」时发一次 |

```rust
// event_producers.rs 骨架
pub fn spawn_all(bus: Arc<EventBus>, active_cwds: Arc<Mutex<HashSet<PathBuf>>>) {
    spawn_file_watcher(bus.clone(), active_cwds.clone());
    spawn_git_poller(bus.clone(), active_cwds);
    spawn_heartbeat(bus.clone());
}

fn publish(bus: &EventBus, ty: &str, source: &str, importance: f32, payload: Value) {
    bus.publish(AgentEvent {
        id: format!("evt-{}", uuid::Uuid::new_v4()),
        event_type: ty.into(),
        timestamp: now_ms(),
        source: source.into(),
        payload,
        importance,
    });
}
```

### 2.3 挂载点

`crates/openpi-daemon/src/main.rs`（在 `Supervisor::new()` 之后）：

```rust
let bus = supervisor.event_bus.clone();
tokio::spawn(async move {
    openpi_daemon::event_producers::spawn_all(bus, active_cwds).await
});
```

> 「活跃 cwd 集合」由 `supervisor.list_sessions()` 每 30s 刷新一次即可，避免监听无用目录。

**验收**：单测用 `tempfile` 建目录、改文件 → 断言 `bus.subscribe()` 在 2s 内收到 `file_changed`；
`git status` 变动 → 收到 `git_uncommitted`。

---

## 3. P0-2：给 EventBus 接「消费者」（决策闭环）

**目标**：`subscribe() → DecisionEngine::evaluate → 落库/发卡片`，让 ActionScore 真正生效。

### 3.1 新增模块 `crates/openpi-daemon/src/proactive_loop.rs`

```rust
pub async fn run_proactive_loop(supervisor: Supervisor, storage: Storage) {
    let mut rx = supervisor.event_bus.subscribe();
    let mut debounce: HashMap<String, Instant> = HashMap::new(); // 事件类型去抖

    loop {
        let Ok(ev) = rx.recv().await else { continue };

        // 不变量 6：同类事件 5s 内只处理一次
        if !pass_debounce(&mut debounce, &ev.event_type, 5) { continue; }

        // 不变量 10：熔断 Open 时直接降级为 Ignore
        if !supervisor.gateway.circuit_breaker.is_autonomous_action_allowed() { continue; }

        match DecisionEngine::evaluate(&ev) {
            DecisionAction::Ignore { .. } => {}
            DecisionAction::Remember { category, content } => {
                storage.upsert_personal_memory(&to_record(category, content, &ev))?;
            }
            DecisionAction::CardSuggestion { title, description, action_type, payload } => {
                let card = persist_card(&storage, title, description, action_type, payload)?;
                emit_broadcast(&supervisor, "proactive",
                    json!({ "type": "action_card", "card": card }));
            }
            DecisionAction::ExecuteProactive { task_name, objective } => {
                // 高分只读任务：交给网关做「只读」执行（见 P0-4）
                spawn_via_gateway(supervisor.clone(), storage.clone(), task_name, objective);
            }
            DecisionAction::AskUser { question, choices } => {
                emit_broadcast(&supervisor, "proactive",
                    json!({ "type": "ask_user", "question": question, "choices": choices }));
            }
        }
    }
}
```

### 3.2 卡片持久化

`crates/openpi-storage` 新增轻表（不改动现有表结构）：

```sql
CREATE TABLE IF NOT EXISTS action_cards (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  action_type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'open',  -- open | dismissed | acted
  created_at TEXT NOT NULL
);
```

配套方法：`upsert_action_card / list_action_cards(status, limit) / dismiss_action_card(id)`。
新增 IPC：`list_action_cards` / `dismiss_action_card`（照抄 `list_personal_goals` 写法，
`app_ops.rs:535`）。
并同步加进 `apps/desktop/src-tauri/src/ipc_handlers.rs:1721` 的转发白名单。

### 3.3 挂载点

`main.rs` 再 spawn 一个 `run_proactive_loop`。

**验收**：
- 注入一条 `importance = 0.5` 的 `git_uncommitted` → 断言产出 `CardSuggestion` 且落库 1 张卡；
- 注入 `importance = 0.1` → `Ignore`，不落库；
- 熔断 Open 时 → 不产卡。

---

## 4. P0-3：把晨报变成「真正的定时任务」

**目标**：`ProactiveEngine` 由调度器/节拍自动触发，问候语个性化，Action Cards 来自真实观察。

### 4.1 拆分「确定性聚合」与「可选 LLM 合成」

`proactive.rs::generate_briefing` 改为接收**真实上下文**，去掉写死内容：

```rust
pub struct BriefingInput {
    pub nickname: Option<String>,          // 从用户画像记忆（category = profile）取
    pub active_goals: Vec<PersonalGoalRecord>,
    pub key_memories: Vec<PersonalMemoryRecord>,
    pub uncommitted_dirs: Vec<String>,     // 来自 GitPoller 最近事件
    pub open_cards: Vec<ActionCard>,       // 上一步未处理的卡片
}

pub fn generate_briefing(input: &BriefingInput) -> TodayBriefing
```

- 问候语：`nickname.unwrap_or("你")`（读 `personal_memories` 里 `profile` 昵称条目）；
- Action Cards：`active_goals` 逐条生成 + `uncommitted_dirs` 生成「审查未提交变更」+
  `open_cards` 续接；**删除写死的 `card-health-check / card-rule-alignment`**。

### 4.2 定时触发（二选一，推荐 A）

**方案 A（推荐，纯确定性、零 LLM 成本）**：在 `proactive_loop.rs` 里加一个每日节拍：

```rust
// 每天 08:00 本地时间（用一个 last_briefing_date 去重）
if local_hour() == 8 && last_date != today {
    let briefing = ProactiveEngine::generate_briefing(&collect_input(&storage));
    persist_briefing(&storage, &briefing);
    emit_broadcast(&supervisor, "proactive",
        json!({ "type": "today_briefing", "briefing": briefing }));
}
```

**方案 B（复用现有调度器）**：seed 一个固定 id 的
`TaskRecord { id: "system-morning-brief", schedule: {"kind":"cron","expression":"0 8 * * *"} }`，
由 `run_scheduler_loop` → `execute_task_run` 跑。
优点：复用 `task_runner`；缺点：会起一个 in-memory 会话并消耗一次 LLM 往返。

> 建议：A 做「确定性晨报」；B 可选做「LLM 精炼版」。

### 4.3 前端

`apps/desktop/web/components/surfaces/panels/memory/today-tab.tsx` 与
`TodayBriefingHero` 改为：监听 `openpi:conversation-event` 里
`instanceId === "proactive"` 的 `today_briefing` / `action_card` 事件 → 实时刷新；
同时保留 `get_today_briefing` 作为首屏兜底。

**验收**：手动把系统时间设到 08:00（或注入 `timer_expired`）→ 断言收到 `today_briefing` 广播
且问候语含昵称；前端 HUD 出现新卡片。

---

## 5. P0-4：让 Gateway 真正穿透执行核心

**目标**：`ExecutionGateway::execute` 不再是 `sleep(10ms)`；**个人智能层发起的执行**
（主动任务、子 Agent、目标推进）必须过网关，让熔断器/预算/不变量观测**真实**执行。

### 5.1 明确边界（关键设计决策）

| 执行来源 | 是否过网关 | 理由 |
|---|---|---|
| 用户直接输入 prompt | ❌ 不过 | 用户本人动作，属 Execution Core 的 70% 配额 |
| **主动任务 / 目标推进 / 子 Agent** | ✅ 必须过 | 属 Personal Intelligence Layer，须受权限/预算/熔断约束 |

> 这样既落实「不变量 7」，又不会把交互式对话拖进预算门禁。

### 5.2 让网关能真正分发

`gateway.rs` 目前无法调用 supervisor（反向依赖）。用**注入执行闭包**解耦：

```rust
pub type Dispatcher =
    Arc<dyn Fn(PersonalExecutionRequest) -> BoxFuture<'static, Result<u64, String>> + Send + Sync>;

pub struct ExecutionGateway {
    pub circuit_breaker: Arc<CircuitBreaker>,
    pub budget_manager: Arc<ResourceBudgetManager>,
    dispatcher: RwLock<Option<Dispatcher>>,   // 由 daemon 在启动后注入
}
```

`execute()` 里把 `tokio::time::sleep(10ms)` 换成
`(self.dispatcher.read().unwrap().clone().unwrap())(request)`，
返回**真实 token 消耗**（由引擎 turn 结束事件统计），`meter()` 用它核销。

### 5.3 注入实现（daemon 侧，不碰 engine）

`main.rs` / `supervisor.rs`：

```rust
let disp: Dispatcher = Arc::new(move |req| {
    let sup = supervisor.clone();
    Box::pin(async move {
        // 复用现有 run_ephemeral_subagent 的执行方式：
        // 建会话 → send_rpc(prompt) → 等 agent_settled
        sup.run_personal_task(&req).await  // 新增：把 run_ephemeral_subagent 泛化
    })
});
supervisor.gateway.set_dispatcher(disp);
```

### 5.4 收敛调用点

把 `proactive_loop` 的 `ExecuteProactive`、以及任何「个人层主动发起」的入口，
从直接 `supervisor.send_rpc` 改为 `gateway.execute(...)`。
`ExecutionConstraint` 由请求携带（默认值已符合 spec：60s / 512MB / 15 tools）。

**验收**：
- 注入一个会失败的 dispatcher → 连续 5 次后 `circuit_breaker.state() == Open`
  （现有阈值：3 次进 Degraded、5 次 Open，与 `circuit_breaker.rs` 测试一致）；
- 熔断 Open 时 `gateway.execute()` 返回 `Err("Circuit breaker blocked action")`；
- 预算耗尽时返回 `Err("Budget reservation failed")`；
- 集成：跑一次主动任务，断言 `budget_manager.report().execution_used > 0`（不再是 0）。

---

## 6. 实施顺序与依赖图

```
P0-0 事件过滤修复 ──┬─► P0-1 生产者 ──┐
                    │                 ├─► P0-2 消费者(决策闭环) ──┬─► P0-3 晨报定时
                    └─────────────────┘                          │
                                                                  └─► P0-4 网关穿透
                                                                      (依赖 P0-2 的 ExecuteProactive)
```

- **P0-0 必须先做**（否则后续事件送不到 UI）；
- P0-1 与 P0-4 可并行；P0-2 依赖 P0-0 + P0-1；P0-3 依赖 P0-2；
  P0-4 的 `ExecuteProactive` 分支依赖 P0-2。

## 7. 工作量与风险

| 项 | 改动面 | 新增依赖 | 风险 |
|---|---|---|---|
| P0-0 | `ipc.rs` 1 处 + 测试 | 无 | 低 |
| P0-1 | 新文件 `event_producers.rs` + `main.rs` | `notify` | 中（文件监听风暴 → 已用去抖兜） |
| P0-2 | 新文件 `proactive_loop.rs` + storage 表 + 2 IPC + 前端 | 无 | 中（存储 schema 迁移） |
| P0-3 | `proactive.rs` 重构 + 前端 | 无 | 低 |
| P0-4 | `gateway.rs` + `supervisor.rs` + 调用点 | 无 | 中（闭包注入的循环依赖需小心） |

## 8. 交付前必跑（对齐 AGENTS.md）

```sh
export PATH="$HOME/.cargo/bin:$PATH"
cargo test --workspace
RUSTFLAGS="-D warnings" cargo clippy --workspace --all-targets -- -D warnings
yarn check:targets           # aarch64 跨架构（CI 用 arm64，本地是 x86_64）
yarn typecheck && yarn build && yarn test
bash scripts/package-tauri-app.sh && bash scripts/install-local.sh
```

> 提醒：`apps/desktop/dist` 是 gitignore 的，而 `tauri::generate_context!()` 编译期要求它存在，
> 所以顺序必须是 **先 `yarn build` 再编译 Rust workspace**。

## 9. 关键文件与函数索引（改造锚点）

| 用途 | 位置 |
|---|---|
| 事件总线定义 | `crates/openpi-daemon/src/event_bus.rs`（`EventBus::publish` / `subscribe`） |
| 决策引擎 | `crates/openpi-daemon/src/decision.rs`（`DecisionEngine::evaluate`） |
| 晨报引擎 | `crates/openpi-daemon/src/proactive.rs`（`ProactiveEngine::generate_briefing`） |
| 统一网关 | `crates/openpi-daemon/src/gateway.rs`（`ExecutionGateway::execute`，第 100-104 行为桩） |
| 事件投递过滤 | `crates/openpi-daemon/src/ipc.rs`（`handle_connection::event_task`，第 147-154 行） |
| 会话编排 | `crates/openpi-daemon/src/supervisor.rs`（`event_tx`、`subscribe_events`、`send_rpc`、`run_ephemeral_subagent`） |
| 调度循环 | `crates/openpi-daemon/src/task_runner.rs`（`run_scheduler_loop`、`execute_task_run`） |
| 调度器 | `crates/openpi-scheduler/src/lib.rs`（`Scheduler::trigger_task`、`compute_next_run`） |
| 应用 IPC 分发 | `crates/openpi-daemon/src/app_ops.rs`（`handle_app_op`，第 9 行） |
| 存储层 | `crates/openpi-storage/src/lib.rs`（`personal_memories` / `personal_goals` / `TaskRecord`） |
| 守护进程入口 | `crates/openpi-daemon/src/main.rs`（各 `tokio::spawn` 挂载点） |
| Tauri 事件桥 | `apps/desktop/src-tauri/src/daemon_client.rs:281`、`lib.rs:52`（`openpi:conversation-event`） |
| IPC 转发白名单 | `apps/desktop/src-tauri/src/ipc_handlers.rs:1721` |
| 前端事件消费 | `apps/desktop/web/App.tsx:647`（`task-scheduler`）、`:784`（`*`） |

## 10. 结论

四项接线里：
- **P0-0（事件过滤）是隐藏前提**；
- **P0-1 + P0-2 是「让主动式真正活起来」的最小闭环**；
- **P0-3 把它变成每天自动发生的产品体验**；
- **P0-4 把「安全防线」从摆设变成真实护栏**。

全部改动都能限制在 `openpi-daemon` / `openpi-safety` / `openpi-storage` + 前端，
**不触碰冻结的 Execution Core（`openpi-engine` / `openpi-tools`）**。



