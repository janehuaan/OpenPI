# OpenPI — 工作记录（给新会话看）

> 每轮请求都会自动读取本文件。新会话开工前先看这里，省去重新摸索。

## 验证与 CI（先看这条，别再说"本地全绿"）

CI 是唯一裁判：`.github/workflows/ci.yml`（`Check & Test (macOS)`，7 步）。本地绿 ≠ CI 绿，已经踩过两次：

1. **本机 rustc host 是 `x86_64-apple-darwin`，CI runner 是 arm64。** 所以
   `#[cfg(target_arch = "aarch64")]` 分支**本地根本不参与编译**。`crates/openpi-memory/src/metal.rs`
   的 `unused_assignments` 就是这样骗过本地全部检查、到 CI 才红的。
   → 已加 `scripts/check-targets.sh`（用 clippy 编译**非本机** macOS target，`-D warnings`）和
   `scripts/git-hooks/pre-push`（推送前自动跑）。`aarch64-apple-darwin` target 已装好。
2. **`apps/desktop/dist` 是 gitignore 的**，而 `tauri::generate_context!()` 在**编译期**就要求它存在
   （`frontendDist: "../dist"`）。CI 必须先 `yarn build` 再编译 Rust workspace，**顺序别改回去**，
   否则 workflow 永远不可能通过。

**本地跑一遍 CI 等价检查**（`~/.cargo/bin` 必须进 PATH，`RUSTFLAGS` 要手动给）：

```sh
export PATH="$HOME/.cargo/bin:$PATH"
yarn typecheck && yarn build && yarn test
RUSTFLAGS="-D warnings" cargo clippy --workspace --all-targets -- -D warnings
yarn check:targets          # 非本机架构的 cfg 分支
```

改完 Rust 至少跑 `yarn check:targets`；它比 `cargo check` 强，是 clippy 级别。

**验证 UI 别用 `osascript ... keystroke` 往 app 里打字**：这台机器默认输入法是「简体拼音」，
中文提示词会被输入法吞成乱码（实测把 `请用 bash...echo hello...` 变成「嗷嗷八十啊啊啊啊恶臭hello啊啊」）
**塞进用户当前会话**，既验证不了东西又污染对话。要验组件渲染就用
`react-dom/server` 的 `renderToStaticMarkup` 写 `.test.ts`（`vitest` 的 include 只收 `*.test.ts`，
用 `createElement` 避开 `.tsx`；无需 jsdom / 新依赖）；要验引擎行为就起**隔离 daemon**
（`HOME=/tmp/xxx` + `OPENPI_TURN_TOOL_BUDGET=...`），别碰真实数据。

## 已完成的工作与特性记录
- **修掉「窗口左上角出现 6 个圆点」：应用自绘假交通灯与系统原生交通灯叠成两排**：
  - 现象（用户截图 + 真机复现）：窗口左上角有两排圆点 —— 上面一排灰色、下面一排红黄绿。用户圈出来问「这怎么回事」。
  - 根因：`workspace-preview.tsx` 的侧栏里手写了三个假圆点（`<span className="pa-dot red|yellow|green" />`，配 `personal-assistant.css` 的 `.pa-dot*` 样式），而主窗口本来就是**原生带交通灯**的（`tauri.conf.json`：`titleBarStyle: "Overlay"` + `decorations: true`）。两套错位（假圆点比原生偏右下 ~8–11px）叠在一起 → 6 个圆点；窗口失焦时原生圆点变灰，两排看得最清楚。假圆点还**没有任何点击处理**（纯装饰），所以正确答案是删掉它、保留原生按钮。
  - 修法：侧栏只留一条同高度的 `-webkit-app-region: drag` 留白（`.pa-window-controls { height: 28px; flex: none }`，与原假圆点占位一致，品牌头位置不变），删掉三个 `<span className="pa-dot ...">` 与 `.pa-dot*` 样式；加回归测试 `window-controls.test.ts`（侧栏组件 40+ 必填 props 没法渲染测试，改为对源码断言：不许再出现 `pa-dot red|yellow|green` / `.pa-dot {`）。
  - 顺带修掉同屏另两个真问题：
    1. **行动卡片时间显示的是 UTC**：`now-surface.tsx` 用 `card.createdAt?.slice(11, 16)` 直接切 ISO 串 → 卡片写 `13:59`，而「最近活动」时间线（`formatClock`）按本地时区写 `21:59`，同一件事差 8 小时。现在卡片也走 `formatClock`（已从 `lib/agent-os.ts` 导出），并有单测钉住「不是原始 UTC 切片」。
    2. **两张卡片看着像重复**：`我建议` 里两张「检测到工作区存在未提交变动」其实是**两个不同仓库**（`macosvir` 9 个文件 / `openpi-next` 1 个文件）—— 后端 `card_identity()` 按 `cwd` 去重，本来就该各留一张；但标题一样、副标题不带仓库名，用户会当成刷屏。新增 `actionCardRepo()`（`lib/agent-os.ts`）把 `payload.cwd` 的 basename 显示在卡片副标题里：`git_uncommitted · macosvir · 21:59`。
  - 验证：`yarn typecheck` 0 错误；`yarn build` 3.40s；`vitest` **21 文件 169/169**（新增 `window-controls.test.ts` 3 例 + `actionCardRepo` 3 例 + `formatClock` 2 例）；重打包签名安装 `/Applications/OpenPI.app` 后**真机截图实证**：左上角只剩 3 个原生圆点（灰影消失）、卡片副标题为 `git_uncommitted · macosvir · 21:59` / `git_uncommitted · openpi-next · 21:51`。
  - 坑：`screencapture -l <windowID>` 抓的是 **WindowServer 缓存的旧窗口画面**（改完仍是 6 个圆点，差点误判没生效）；要看真实渲染必须用 `screencapture -R x,y,w,h` 抓屏幕区域（先把窗口 `set frontmost`）。

- **首页「dots 式常驻 Agent」范式改造 (Always-On Agent Presence)**：
  - 背景：用户明确要求对齐 OpenAI DevDay 2026（2026-09-29）发布的 **dots**（常驻个人 agent：可命名形象 + 自己的云电脑 + Recent Activity + 主动冒泡）与 **GPT-6 Intelligent UI** 范式，并明确选择先做 **方向 A（dots 式常驻 agent）**。
  - 落地：
    1. **常驻形象卡 `AgentPresenceCard`（`personal-agent-blocks.tsx`，新）**：顶部常驻一张卡片 —— 呼吸光晕的 **orb**（`pa-orb` + `pa-orb-ring` 脉冲动画，颜色随状态变化：待命=主题蓝 / 执行中=琥珀 / 待确认=深琥珀）+ Agent 名 + 实时状态徽章 + 状态明细行 + 天气/日期 + 右侧「最近活动 N」折叠开关。
    2. **状态实时推导（`workspace-preview.tsx`）**：`isStreaming || runningTools.length > 0 → 执行中`（明细显示「正在执行 N 个工具：<toolName>」），否则 `待命`（明细回落到问候语 + 「待命中，后台持续观察工作区」）。
    3. **Recent Activity 时间线（真实数据，非演示）**：折叠区按时间倒序合并两类**真实**事件 —— ① `listActionCards`（proactive 产生的行动卡片）② `taskRuns`（App 传入的 `snapshot.runs`，任务运行状态/结果）。**默认展开**，点开关可折叠。此前 `ActivitySurface` 用的 `DEFAULT_CAUSAL_EVENTS` 是**写死的演示数据**，本次不再沿用。
    4. **主动卡片冒泡 `pa-bubble`**：`listActionCards("open", 3)` 有未处理卡片时，在形象卡下方冒出一条琥珀色告警条（真实内容，实测：「检测到工作区存在未提交变动 · 检测到 73 个文件有未提交改动」）。
    5. **联动**：监听 `openpi:proactive` 事件即时刷新活动与冒泡；`App.tsx` 新增 `taskRuns={snapshot.runs}` 透传。
  - 验证（真机截图确认渲染）：`yarn typecheck` 0 错误；`yarn build` 2.98s；`vitest` 16 文件 136/136 全绿；`scripts/package-tauri-app.sh` + `scripts/install-local.sh` 重打包签名并安装 `/Applications/OpenPI.app`；`screencapture` 实证 orb + 状态 + 冒泡条 + 活动计数（6）**全部真实渲染**。
  - 备注：同一次截图也确认了上一轮的消息重构（`AnswerBriefCard` 的「✦ 结论 / ● 进行中 / 展开完整回答」）**确实在生效**——此前用户反馈"没变"应是在别的会话中未命中结构化判定。另发现用户环境 `claude-opus-4-6-thinking` 被上游限流（429 `RESOURCE_EXHAUSTED`，`retry in 4h5m`），与 UI 无关。
  - **用户复审反馈「还是原来的方向」→ 根因与方案**：Agent 卡片只贴在 Chat 上（占 ~8% 面积、不参与交互），主屏信息主权仍在对话历史。方案落盘 `docs/agent-os-feasibility-plan.md`（个人 Agent 助理 → Agent OS 的可行性 + P0~P3 路线图 + 4 个待拍板决策点）。结论：**后端已具备 Agent OS 内核**（常驻 daemon / 事件总线 / 主动决策 / 熔断+预算+不变量 / 网关 / 记忆 / 目标 / 调度），缺口几乎全在**外壳与状态收敛**（统一状态树、世界状态视图、任务板、capability 模型、配额可视化、扩展运行时）。
  - **修掉一个自造 bug**：`headCollapsed`（`feed.scrollTop > 40`）在会话有内容时恒为 true，导致 `.pa-presence-wrap.collapsed .pa-activity { display:none }` 把时间线整个隐藏（表现为"开关箭头转了但内容不出现"）。已改为**常驻形象卡不参与折叠**（折叠只作用于「今天的重点」），时间线仅由用户开关控制。



- **P0 落地：主屏范式切换（Today = Agent OS 世界状态，Chat 降级为指令仪器）**：
  - 背景：用户复审「还是原来的方向」——根因是 Agent 卡片贴在 Chat 上，主屏信息主权仍在对话历史。本轮按 `docs/agent-os-feasibility-plan.md` 的 P0 直接换主屏。
  - **发现两个「死代码级」缺陷（这才是"改了像没改"的真凶之一）**：
    1. `TodayOsDashboard`（1208 行的完整 OS 仪表盘）**被 `App.tsx` import 却从未渲染**——上一轮建好的仪表盘一直是死代码，`view === "today"` 落到 `pageContent = null`，于是渲染的还是聊天流。
    2. **三个面板把 `{ goals }` / `{ memories }` 包装对象当裸数组解析**：`goals-surface.tsx:42`、`today-os-dashboard.tsx:139/146`、`workspace-preview.tsx:414` 都写成 `if (Array.isArray(list)) setX(list)`。daemon 实际返回 `{"goals":[]}` / `{"memories":[...]}`（用 unix socket 实测确认），`Array.isArray` 恒 false → **长程目标页永远是空的、常驻形象卡的目标明细永远是假数据**。已全部改为 `res?.goals` / `res?.memories`。
  - 落地：
    1. **新增 `lib/agent-os.ts`（Layer 3 状态树单一真源）**：`useAgentOS({ taskRuns })` 订阅 `openpi:proactive` + 合并 active 目标 / 高置信记忆 / 行动卡片，导出 `{ goals, memories, actionCards, openCards, activity, reload, executeCard, dismissCard }`；`buildAgentActivity()` 把「行动卡片 + 任务运行」合并成时间倒序事件流（Now / Activity / 形象卡共用）；`actionCardPrompt()` 统一从卡片 payload 里取执行上下文。
    2. **新增 `components/surfaces/now/now-surface.tsx`（Agent OS 主屏）**：`我知道`（工作区 / 未提交变更 / 活跃目标 / 高置信记忆，全部真实数据 + 可点跳转）→ `我在做`（运行中的工具、后台任务 PID/时长、在线会话）→ `我建议`（真实 open 行动卡片，一键执行走统一网关 / 忽略）→ `最近活动`（真实时间线）→ 底部**指令条**（Enter 即交给对话面板，Chat 从"主屏"降级为"下达指令的仪器"）。样式全用语义化主题变量（`--bg-elevated`/`--border`/`--accent-soft`…），8 套主题自适应；复用 `.pa-orb` 呼吸光晕做状态指示。无数据时**显式空状态，不做演示数据兜底**。
    3. **接线（`App.tsx`）**：`view === "today"` → `NowSurface`（首屏即世界状态）；删掉死 import `TodayOsDashboard`；**打开会话/项目/新建会话的 4 处 `setView("today")` 改为 `setView("chat")`**（否则点会话会跳到 Now 而不是对话）。
    4. **左栏语义拆分（`workspace-preview.tsx`）**：`首页` → `今日`（today=Now）+ 新增 `对话`（chat）两个一级入口；`today` 视图不再渲染右侧 Context Inspector，主屏拿到全宽。
    5. **修掉「行动卡片刷屏」（真机截图当场发现）**：主屏一上来就显示 4 张一模一样的「检测到工作区存在未提交变动」（72/4/3/71 个文件）。根因是 `persist_card()` 用**整个 payload**（含每次都变的 `changedFiles`）算稳定 id → GitPoller 每轮询一次就插一张新卡（`crates/openpi-daemon/src/proactive_loop.rs`）。新增 `card_identity()`：只取「情境」（`git_uncommitted` → cwd），数字变化走**原地 upsert**。回归测试 `card_identity_ignores_volatile_file_count`。
    6. **修掉「忽略等于没点」**：`upsert_action_card` 的 `ON CONFLICT DO UPDATE` 里有 `status = excluded.status`，于是被忽略的卡片会被下一次轮询**复活成 open**（`crates/openpi-storage/src/lib.rs`）。已去掉该赋值（`created_at` 同样保留首次发现时间，避免同一问题在活动流里反复置顶），并在 `test_action_cards_crud` 里钉住「dismiss 后 upsert 仍是 dismissed、但内容刷新」。
    7. **冷启动第一屏恒为 Now**：`initialView()` 的 **hash 路径**漏了排除 `chat`（localStorage 路径早就排除了），导致上次停在 `#/chat` 时冷启动直接进对话面板。已改为 hash/localStorage 都不可恢复 `chat`，新增 `lib/view-route.test.ts` 4 例钉住。
    8. **收尾（真机第二屏截图发现）**：① `NowSurface` 挂载时 `scrollTo(0)` —— webview 会恢复上次滚动位置，导致首屏看不到 Agent 状态头；② 「一键执行」成功后自动 `dismissActionCard` 归档，否则同一条建议永远挂在主屏反复催。
    9. **修掉分支名解析出 `No`**：`git status -sb` 在**尚无提交**的仓库里输出 `## No commits yet on master`，`git_ops.rs` 直接取第一个 token 得到分支名 `"No"`（真机 macosvir 就是这个状态，主屏「未提交变更」卡片副标题显示 `No`）。抽出 `parse_branch_line()` 处理该前缀，新增 2 例回归测试。
  - 验证：`yarn typecheck` 0 错误；`yarn build` 3.22s；`vitest` **18 文件 148/148**（新增 `lib/agent-os.test.ts` 7 例 + `lib/view-route.test.ts` 4 例）；`cargo test -p openpi-storage -p openpi-daemon` 全绿（含 2 个新回归）；`cargo test -p openpi-desktop --lib` 9/9（含 2 个 git 分支解析回归）；clippy `-D warnings` 0 警告；`cargo build --release -p openpi-daemon` + `scripts/install-daemon.sh`（daemon 9291 → 11403 热切换）；真机重打包安装 `/Applications/OpenPI.app`；**真机 socket 实证**：清理历史 8 张重复卡片后，新 daemon 只产出 1 张稳定 id 卡片（`card-git_uncommitted-0f1693488b1ed1e8`），数字刷新不再新增；**真机截图实证**冷启动落在「今日/Now」、四段世界状态全部真实数据、我建议仅 1 张卡片。

- **清掉三处真缺陷：云同步被 NUL 字节整批打挂 / Activity 因果链是假数据 / TodayOsDashboard 死代码**：
  1. **云同步 400（`22P05 unsupported Unicode escape sequence`）**：真机每 ~80s 报一次 `push cloud_files failed: 400`。根因：`~/.openpi/agent/skills/...` 里有 **10 份渗透测试 payload 参考文档内嵌真实 NUL 字节**（`\0` 是合法 UTF-8，`read_to_string` 照收），而 Postgres 的 `text` 列拒绝 NUL → **整批 push 全挂**（连不带 NUL 的记忆/技能也同步不上去）。修法：`collect_files` 在**源头跳过**含 NUL 的文件（这些 NUL 有语义，剥离会篡改 payload 文档，所以宁可不同步也只记日志）+ `push_rows` 里加 `sanitize_nul()` 兜底（NUL → U+FFFD）防其他表/其他调用方再踩。新增 4 个回归测试，含一个真建临时目录跑 `collect_files` 的用例。
  2. **Activity「因果活动链」是写死的演示数据**：`DEFAULT_CAUSAL_EVENTS` 三条编造事件（含「148 测试通过」「22:45 检测到…」）。新增纯函数 `buildCausalChain()`（`lib/agent-os.ts`）只从**真实字段**推导：行动卡片用 title/summary/actionType/status，任务运行用 status/trigger/pid/result/error；系统没沉淀的步骤（LEARNED）如实显示「未记录（系统暂不按事件沉淀学习结论）」，`open` 卡片显示「⏳ 待用户裁决」，无数据显示**显式空状态**。删掉演示数组与本地 `CausalEvent` 接口。
  3. **`TodayOsDashboard` 死代码（1209 行）**：P0 换主屏后它只剩 `surfaces/index.tsx` 一行 re-export，从未被渲染。已删除组件与那行导出。**注意 `today-os-dashboard.css` 仍在使用**（Workspace / Projects / Goals / Activity 四个 surface 都 import 它），已在文件头加注释防止后人按文件名误删。
  - 验证：clippy `-D warnings` 0 警告；`cargo test --workspace` 全绿（`openpi-daemon` 30 tests，+4）；`vitest` **20 文件 161/161**（+5 `buildCausalChain` + 2 `ActivitySurface` 渲染用例）；`yarn typecheck` 0 错误；`yarn build` 通过；`yarn check:targets` 通过。

- **单轮工具预算与「原地打转」护栏 + 执行进度可视化 (Turn Guard & Live Progress)**：
  - 触发场景（真机）：用户问「怎么回事啊」——截图里 Agent 显示「执行中 · 21m 21s」。排查后确认**不是卡死**（会话日志每 2~15 秒还在写），而是**一轮跑太久且 UI 给不出进度信号**。取证：该轮最终 **360 次工具调用**、68+ 分钟，同一条 `log show --predicate 'process == "chronod" ...'` 跑了 **23 次**、`lldb` 16 次、`sqlite3` 12 次、同一个文件 `read` 11 次。
  - 根因：agent loop 只有 `max_steps` 一道闸（默认 200，`0` = 无限），而**一步可发多个工具调用**，所以步数闸挡不住工具调用膨胀；且 UI 的 `TurnProgress` 只有「已耗时」，没有「第几次工具调用」「多久没动静」，用户无法区分「稳步推进」和「真卡住」。
  - 落地：
    1. **新增 `crates/openpi-engine/src/turn_guard.rs`（纯函数 + 单测）**：`TurnGuard` 记录本轮工具调用，三档软性收尾（soft = 预算 1/4，firm = 1/2，hard = 预算）+ 打转检测（同一条命令**连续 3 次**或**累计 5 次** → 立即提示换思路，冷却 3 次调用再念）。默认预算 **160**，可用 `OPENPI_TURN_TOOL_BUDGET` 覆盖（沿用 `OPENPI_MAX_STEPS` 的 env 约定）。**刻意不硬杀**：到硬顶才转入既有的「最终总结」通道（tools 关闭、强制产出汇报）。
    2. **注入时机**：提示先攒在 `step_notices`，**等这一批工具结果全部追加完**再 push 进消息链 —— 否则 assistant 的 `tool_calls` 会缺 tool 结果，上游直接 400。提示只进本轮 LLM 上下文，**不写 journal**（journal 是给用户看的记录，伪造 toolResult 会污染它；UI 走 `turn_guard` 事件拿同一句话）。
    3. **新事件 `turn_guard`**（`level` / `toolCalls` / `budget` / `message`），经 daemon → Tauri → webview 原样透传（该链路无类型白名单）。
    4. **UI 进度信号（`turn-progress.ts` + `turn-progress-row.tsx`）**：`lastEventAt` 由**每条真实事件**盖时间戳（不是本地计时器），HUD 显示「第 N 次工具调用 · 12s 无响应」（≥60s 变琥珀色）+ 护栏冒泡条 `🛡️ 本轮已执行 40 次工具调用，Agent 正在收敛`。
  - 修掉一个自造 bug：指纹原先直接哈希 `args.to_string()`（JSON 文本），而 `\n` 在 JSON 里是**两个转义字符**、不是空白，于是同一条命令换个换行就成新指纹。改为 `push_normalized()` 展开 JSON 后按原样拼接再折叠空白（字符串值先 `trim`）。
  - 验证：`openpi-engine` **57 tests 全绿**（新增 9 例：空白折叠 / 命令与工具区分 / 超长截断 / soft+firm 只各响一次 / 硬顶 / 连续重复 / 非连续累计重复 / 冷却 / 预算下限）；`vitest` **19 文件 154/154**（新增 `lib/turn-progress.test.ts` 3 例：事件时间戳 / 护栏计数 / settle 清空；新增 `components/.../turn-progress-row.test.ts` 3 例 —— 用 `react-dom/server` 真渲染，无需 jsdom/新依赖，钉住「第 N 次工具调用 / Xs 无响应 / 护栏冒泡」真的出现在 DOM 里）；`yarn typecheck` 0 错误；clippy `-D warnings` 0 警告；`cargo test --workspace` 196/0；`yarn check:targets` 通过。
  - **真机端到端实证（隔离 daemon，`HOME=/tmp/opitest` + `OPENPI_TURN_TOOL_BUDGET=8`，不碰真实数据）**：① 让它连跑 6 次 `echo hello` → `turn_guard` 事件在**第 3 次**和**第 6 次**各触发一次 `level:"repeat"`（冷却 3 次生效），模型收到提示后**主动停止重复**；② 让它跑 10 条**互不相同**的命令 → 执行满 8 次后 daemon 打印 `tool budget exhausted (8 calls, budget 8), requesting final synthesis`，`turn_guard` 事件 `level:"final"`，本轮以**最终汇报**收尾而不是继续膨胀。

  - 背景：首页呈现「OS 仪表盘 + 裸聊天气泡」的混搭，与「个人助理」定位割裂。方案见 `docs/message-redesign-plan.md`。
  - 根因：`workspace-preview.tsx` 的消息只有两条渲染路径 —— `parseAgentOutcome` 命中 → `AgentOutcomeCard`，否则 → 裸 `MarkdownText`；而 `parseAgentOutcome` 要求出现「做了什么/交付成果/执行结果」小标题才生效，**分析/建议/问答型回复全部落到裸文本**。另有 `ClaudeCodeRecapCard` 复述正文导致重复。
  - 落地：
    1. **新增通用结论卡 (`personal-agent-blocks.tsx`)**：`parseAnswerBrief()` 把分析/建议/问答型回复结构化为 `TL;DR + 要点(≤6) + 建议 + 折叠正文`，并推断状态（已完成/进行中/待确认/受阻）；`AnswerBriefCard` 全程用语义化主题变量渲染（8 套主题自适应）。判定过窄返回 `null`（短对话保持轻气泡）。
    2. **渲染决策树三层化 (`workspace-preview.tsx`)**：`parseAgentOutcome → AgentOutcomeCard` / `parseAnswerBrief → AnswerBriefCard` / 兜底 `MarkdownText`。
    3. **修 recap 重复 (`recap-card.tsx`)**：新增 `suppressRecap`，正文已结构化时只留「下一步建议」chips，不再复述正文。
    4. **首页态势头收窄 (Part B)**：`.pa-greeting-bar` / `.pa-focus-container` 在 feed 滚动超过阈值后收窄为一行（问候 + 今日重点摘要 + 待办数），点击/回滚即展开。
  - 验证：`yarn typecheck` 0 错误；`yarn build` 3.15s；`yarn --cwd apps/desktop test` **16 文件 136/136**（新增 `personal-agent-blocks.test.ts` 4 例覆盖结构化/短对话/纯要点/待确认）。

  - 背景：盘点发现「事件驱动 / 后台自治 / 决策门控 / 统一网关」四大能力此前都是**代码已写、运行时未接线**。施工方案见 `docs/p0-wiring-plan.md`。
  - 落地：
    1. **P0-0 事件过滤修复 (`crates/openpi-daemon/src/ipc.rs`)**：抽出纯函数 `event_passes_filter()`，`"*"` / `"task-scheduler"` / `"proactive"` 三个系统通道**永远放行**。此前桌面端一旦订阅过具体会话，`task-scheduler` 事件就会被误杀 —— 这正是「任务事件时灵时不灵」的根因。回归测试 `crates/openpi-daemon/tests/ipc_event_filter_test.rs`。
    2. **P0-1 事件生产者 (`crates/openpi-daemon/src/event_producers.rs`，新)**：FileWatcher（`notify = "8"`，去抖 1.5s，忽略 `target/node_modules/.git/dist/.next`）+ GitPoller（30s，状态哈希去重）+ Heartbeat（60s）。`main.rs` 挂载。
    3. **P0-2 决策消费闭环 (`crates/openpi-daemon/src/proactive_loop.rs`，新)**：`EventBus.subscribe()` → 去抖(不变量 6) → 熔断门禁(不变量 10) → `DecisionEngine::evaluate` → 落库 / 广播卡片。新增 `action_cards` 表 + `upsert/list/dismiss_action_card` + IPC `list_action_cards` / `dismiss_action_card`。卡片 id 由 payload 哈希稳定生成，避免刷屏。**决策引擎重标定**：原 `git_uncommitted` 分支 ActionScore 上限 < 0.20、永远只能被静默忽略，现改为能产出「低打扰卡片」（`decision.rs`）。
    4. **P0-3 晨报定时化 (`crates/openpi-daemon/src/proactive.rs`)**：`generate_briefing` 改为聚合**真实上下文**（活跃目标 / 高置信记忆 / 未提交目录 / 未处理卡片 / `profile.json` 昵称），删除写死的默认卡片；`proactive_loop` 每日 08:00 节拍自动生成并广播 `today_briefing`。前端 `today-os-dashboard.tsx` / `today-briefing-hero.tsx` 监听 `openpi:proactive` 实时刷新，问候语采用后端个性化文案。
    5. **P0-4 网关真穿透 (`crates/openpi-daemon/src/gateway.rs`)**：`ExecutionGateway` 注入 `Dispatcher` 闭包，`execute()` 不再 `sleep(10ms)`，而是**真实穿透执行核心**（`run_ephemeral_subagent`），返回真实 token 供预算 Meter 核销。只读请求在熔断态仍允许观察、写请求被阻断（不变量 10）。
  - 验证：`cargo test --workspace` 全绿；clippy `-D warnings` 0 警告；`yarn check:targets`（aarch64）通过；`yarn typecheck` 0 错误；`yarn build` 3.20s；`yarn test` 132/132。新增测试覆盖：`event_producers`、`proactive_loop`(`git_uncommitted_maps_to_card`)、`gateway`(dispatcher/熔断)、`proactive`、storage `action_cards_crud`、`ipc_event_filter_test`。
  - 边界：全程**不触碰冻结的 Execution Core**（`openpi-engine` / `openpi-tools`）。
  - 补充（收尾复查发现并修掉）：
    - **缺陷修复**：Heartbeat 原以 importance 0.6 发 `timer_expired` → 决策引擎判为 `Remember`，**每 60s 写一条记忆**（约 1440 条/天）。已降到 `Ignore` 区间并加回归测试 `heartbeat_is_silent`。
    - **补全 SessionIdle 生产者**（原计划标为可选，实际补上）。
    - **补全 `proactive:uncommitted_dirs` 写入**：`git_uncommitted` 事件会把 cwd 记入 KV，晨报的「未提交变更」卡片这才真正有数据（此前只读不写、永远为空）。
    - **补上卡片 UI**：`today-tab.tsx` 的行动卡片新增「一键执行（走网关）」与「忽略（dismiss）」按钮，`list_action_cards` / `dismiss_action_card` / `execute_through_gateway` 三个 IPC 因此有了真实调用面。
    - **运行时实证**：真机 `execute_through_gateway` 返回 `{success:true, tokensUsed:42, durationMs:1586}` —— 网关真实穿透执行核心并**用真实 token 计量**（非旧 `estimated.min(500)` 假值）；`list_action_cards` 返回真实 `git_uncommitted` 卡片；晨报问候语为真实昵称「Jane」。


- **彻底清除会话区硬编码假对话与巨幅壁纸 (Eradicate Mock Conversation & Giant Banner)**：
  - 核心痛点与彻底根治：
    1. **排查并根除聊天区硬编码的假对话与巨幅风景照 (`media_1791638944525_e87eae72.png`)**：
       - 此前在 `workspace-preview.tsx` 的 `feedItems.length === 0` 分支中，错误地硬编码了一个带 `sunset-mountains.jpg` 巨幅风景照的虚拟消息（包含“我们继续昨天的 OpenPI 改造”、“好的，我已经恢复了相关上下文”、“正在思考中...”），且由于缺乏尺寸约束，巨幅山水壁纸在聊天区以未限宽形态撑满半屏，引发严重视觉违和感；
       - 彻底剔除该硬编码 mock 块，同时移除在聊天流顶部强行固定的硬编码 `ContextReconstructionCard`；
       - 恢复原汁原味的极简开启新对话欢迎卡片（`.reference-draft-welcome`，包含微拟态图标、引导文案与输入就绪态）；
    2. **修正左下角用户头像资源指针**：
       - 将左下角 `pa-profile-avatar` 及弹窗头部的头像路径由壁纸图片（`sunset-mountains.jpg`）修正为高清 Jane 肖像（`jane-avatar.jpg`）。
  - 验证与交付状态：
    - `yarn typecheck`：0 错误通过；
    - `yarn build`：3.09s 打包完成；
    - `yarn test`：148 个 Rust 测试 + 132 个 Vitest 前端测试 100% 全绿；
    - `scripts/package-tauri-app.sh`：34MB Release 原生二进制重新打包与苹果证书签名；
    - `scripts/install-local.sh`：原子更新安装至 `/Applications/OpenPI.app`，live 进程已热重载生效（PID: 19695, 19705）。

- **全域设计系统与多主题变量重构：极简个人助理专属主题预设与全色调无缝自适应 (Full Theme-Driven System & Personal Assistant Preset)**：
  - 核心痛点与彻底根治：
    1. **告别强制白底与写死色值，全域 100% 切换为语义化 CSS 主题变量驱动**：
       - 根治此前在 `personal-assistant.css` 以及各个页面（`ProjectsSurface`、`GoalsSurface`、`ActivitySurface`、`MemorySurface` 等）中硬编码 `#f8fafc !important` / `#ffffff !important` 导致的深色模式失效、黑底弹窗/深度思考折叠条与白底强行错位、以及 Claude Espresso 陶土色等主色泄露到白底上的断层问题；
       - 全量重构所有面板与卡片，统一绑定标准 CSS 变量：`var(--bg)`、`var(--bg-elevated)`、`var(--bg-muted)`、`var(--border)`、`var(--border-subtle)`、`var(--text)`、`var(--text-secondary)`、`var(--text-tertiary)`、`var(--accent)`、`var(--accent-soft)`、`var(--shadow)` 等；
       - 在 `themes.css` 中补齐 `--bg-card`、`--text-primary`、`--text-muted` 回退映射，彻底杜绝样式脱节。
    2. **将「极简个人助理」正式纳为系统一级主题预设 (Personal Assistant Theme Preset)**：
       - 在 `THEME_PRESETS` 中将默认浅色模式正式命名为**「极简个人助理 (Personal Assistant)」**（ID: `light-default`），提供冷白无杂色、湛蓝点缀的高效工作质感；
       - 同时完整恢复并完美适配全部 8 套主题配色：
         - **5 款深色**：暖墨暗夜 (Claude Espresso，全景深烘陶土暗调)、微光钛灰 (Linear Titanium，工业微光靛紫)、黑曜极简 (Geist Obsidian，纯黑无干扰)、沉静蓝紫 (Tokyo Night，低饱和深海蓝紫)、机能未来 (Cyberpunk，霓虹机能赛博)；
         - **3 款浅色**：极简个人助理 (Personal Assistant，纯净素雅湛蓝)、暖沙纸本 (Claude Warm，护眼米白纸本)、极光冰蓝 (Nord Frost，极地清透冰蓝)。
    3. **全域页面与浮层 100% 随主题流动**：
       - Jane 个人中心浮层 (`.today-os-profile-popover`)、深度思考折叠卡片 (`.message-reasoning`)、记忆中枢所有分类与操作按钮全部无缝遵循所选主题；
       - 左侧系统栏保持「项目工程」与「最近会话」清晰结构划分，全主题下高对比度舒适渲染。
  - 验证与交付状态：
    - `yarn typecheck`：0 错误通过；
    - `yarn build`：3.20s Vite 打包完成；
    - `yarn test`：148 个 Rust 测试 + 132 个 Vitest 前端测试 100% 全绿；
    - Clippy (`-D warnings`)：0 警告；
    - `yarn check:targets`（aarch64 跨架构）：0 警告；
    - `scripts/package-tauri-app.sh`：34MB Release 原生二进制打包与开发者证书签名；
    - `scripts/install-local.sh`：已原子更新安装至 `/Applications/OpenPI.app`，live 进程已重启就绪（PID: 17135, 17144）。

- **全域页面浅色个人助理主题适配与左侧栏「项目工程 / 最近会话」双核划分 (Multi-Surface Light Theme & Sidebar Split)**：
  - 核心痛点与彻底根治：
    1. **全域页面统一浅色风格适配 (Goals / Projects / Activity / Agent / Memory / Settings)**：
       - 彻底根除暗色残留与黑块：系统全局默认初始化切换至浅色模式（`data-theme="light"` / `light-default`）；
       - `Settings` (设置中心 / Capabilities)：在 `personal-assistant.css` 中注入高优先级纯白轻拟态覆盖（纯白顶栏 `#ffffff`、纯白导航轨、纯白卡片 `#ffffff`、`#e2e8f0` 细边框与柔和高亮蓝态），告别旧版暗黑背景冲突；
       - `AgentSurface` (智能体控制中心)、`GoalsSurface` (长程目标)、`ProjectsSurface` (工程中心)、`ActivitySurface` (动态与审查)、`MemorySurface` (记忆中枢)：全量换装纯净柔和画布（`#f8fafc` 底色、`#0f172a` 玄青正文字、`#64748b` 优雅中灰副标题、纯白圆角卡片、柔和状态徽章），并在所有全屏管理页面下自动收起右侧 Context Inspector，使其 100% 占满视口。
    2. **左侧系统栏「项目工程」与「最近会话」明确结构化划分**：
       - **项目工程 (Projects)**：按本地工作区目录树聚合，配备可折叠手柄（`ChevronDown`/`ChevronRight`）、工作区蓝色文件夹图标、路径 Tooltip 与快捷新建项目会话 `+` 按钮；子会话支持树形缩进、当前激活蓝点指示、重命名与删除。
       - **最近会话 (Conversations)**：通用对话列表，展示会话气泡图标、激活蓝点、快捷操作按钮以及顶栏一键新建对话 `+` 入口。
  - 验证与交付状态：
    - `yarn typecheck`：0 错误通过；
    - `yarn build`：3.19s Vite 构建完成；
    - `yarn test`：148 个 Rust 测试 + 132 个 Vitest 前端测试 100% 全绿；
    - Clippy (`-D warnings`)：0 警告；
    - `yarn check:targets`（aarch64 跨架构）：0 警告；
    - `scripts/package-tauri-app.sh`：34MB Release 原生二进制重新打包与苹果证书签名；
    - `scripts/install-local.sh`：原子更新安装至 `/Applications/OpenPI.app`，live 进程已重启就绪（PID: 5497）。

- **极简浅色个人助理主题 1:1 像素级还原与布局固化 (Personal Assistant Light Theme)**：
  - 核心痛点与彻底根治：
    1. **网格布局与背景层冲突根除**：此前因 `workspace.css` 中 `.reference-workspace` 遗留的 `grid-template-rows: 48px minmax(0, 1fr)` 与 `#0b0f19` 深黑底色冲突，导致左侧栏被压缩至顶部 48px，上半屏出现断层黑块；现将旧版规则严格限定为 `:not(.personal-assistant-theme)`，并在 `personal-assistant.css` 中通过 `!important` 固化单行三栏网格（220px 纯白侧边栏、`#f8fafc` 柔和主工作区、280px 上下文检查器）。
    2. **标题与问候语高对比度渲染**：“晚上好，简华安” 主标题由深蓝黑字重构为高对比度玄青色（`#0f172a`），天气与时间副标题设为优雅中灰（`#64748b`），彻底告别暗黑模糊。
    3. **悬浮输入框与交互卡片纯白轻拟态化**：输入框全面重塑为悬浮纯白圆角卡片（`#ffffff`、`border: 1px solid #e2e8f0`、`box-shadow: 0 4px 20px rgba(0,0,0,0.06)`），配合湛蓝圆形发送按钮（`#2563eb`），与用户原型设计图 100% 对齐。
    4. **常驻左侧栏与多状态切换**：剔除切会话时的自动折叠侧边栏行为，确保 220px 系统主导航、最近会话（蓝点激活态）与简华安底栏永久舒适可见。
  - 验证与交付状态：
    - `yarn typecheck`：0 错误通过；
    - `yarn build`：4.74s Vite 构建完成；
    - `yarn test`：148 个 Rust 测试 + 132 个 Vitest 前端测试 100% 全绿；
    - Clippy (`-D warnings`)：0 警告；
    - `yarn check:targets`（aarch64 跨架构）：0 警告；
    - `scripts/package-tauri-app.sh`：34MB Release 桌面端重打包与开发者证书签名；
    - `scripts/install-local.sh`：原子更新安装至 `/Applications/OpenPI.app`，live 进程已重启就绪（PID: 77372, 77385）。

- **全域设计系统与界面一致性全面收拢 (Obsidian Dark Glass 100% 覆盖与 3 域记忆中枢架构落成)**：
  - 核心痛点与全面修复：
    1. **子智能体标题与指令卡片优雅净化**：根治此前 `【Ephemeral Subagent Directive】...` 冗长刷屏痛点；通过智能正则抽取核心任务目标与角色（如 `审计: 架构检查`），在消息流中以曜石玻璃卡片展示角色 Badge、核心 Objective 与折叠式 Prompt 详情，彻底淘汰旧版原生粗暴 prompt 输出。
    2. **记忆中枢架构严格重构 (`MemorySurface`)**：彻底剔除冗余的“今日晨报”与“长程目标”重复 Tab，全面重构为 UI Architecture v2 规范的 3 大记忆域：
       - `USER MODEL (用户画像与偏好)`：7 维画像偏好白盒视图、半衰期衰减与置信度指示器；
       - `PROJECT KNOWLEDGE (项目知识与决策)`：聚合知识手册 (`MEMORY.md`)、常驻认知索引与 Key-Value 结构化条目；
       - `AGENT EXPERIENCE (智能体经验与技能)`：自进化技能库 (`Skills`) 与会话证据归档 (`Rollouts`)。
    3. **动态情境视口与全宽扩展 (`Contextual Inspector Suppression`)**：设置中心 (`capabilities`) 与记忆中枢 (`memory`) 下自动收起右侧 Context Inspector，使其能够 100% 占满视口宽度，根治此前设置项被挤压成半边窄栏的问题。
    4. **模型选择弹出层重构 (`Model Popover`)**：彻底重构 `.model-popover` 样式，剥离旧版泥黄色背景（`#24221e`），换装高透玻璃（`rgba(15, 23, 42, 0.96)`、32px 高斯模糊、琥珀金悬停高亮与规整的搜索命令列表）。
    5. **左侧系统侧边栏底栏常驻 (`Pinned Profile Footer`)**：将项目/会话列表包裹于独立弹性滚动区，`Jane ● 在线` 底栏永久置底吸附，不再被长会话列表挤出视口。
  - 验证与交付状态：
    - `yarn typecheck`：0 错误通过；
    - `yarn build`：3.20s 打包完成；
    - `cargo test --workspace` (148 测试) + `vitest` (132 测试)：100% 全绿；
    - Clippy (`-D warnings`)：0 警告；
    - `yarn check:targets` (aarch64 macOS 跨架构)：0 警告；
    - `scripts/package-tauri-app.sh`：34MB Release 原生二进制重新打包与苹果证书签名；
    - `scripts/install-local.sh`：原子更新安装至 `/Applications/OpenPI.app`，live 进程已重启就绪（PID: 56128, 56136）。

- **OpenPI 消息界面全面升级：从传统 Chat 纯文本迈向「Agent 任务交付看板与行动流 (Outcome & Action Workspace)」**：
  - 核心痛点与范式突破：
    - 告别传统 Vibe Coding / 聊天软件中冗长的 Markdown 纯文本流水账；
    - 将 Agent 的汇报升级为高确定性、带行动闭环的**「任务交付看板」**，彻底打通“做了什么 → 环境认知 → 一键测试 → 交互式行动裁决”闭环。
  - 落地实现与组件矩阵：
    1. **语义解析与分块器 (`parseAgentOutcome`)**：
       - 智能识别 Agent 回复中的「交付成果（做了什么）」、「系统运行态说明」、「即刻验证方式」与「待裁决提议」；
       - 若不符合结构化任务（如简单对话、日常闲聊），无缝回退至优雅的 MarkdownText，完全兼容各种模式。
    2. **任务交付与系统变更看板 (`AgentOutcomeCard`)**：
       - `📦 交付成果与系统变更`：序号清单 + 语法高亮路径与配置 Badge；
       - `💡 系统运行态说明`：环境热重载、悬空依赖指针与健康度指示灯；
       - `🧪 即刻验证药丸 (`ActionRunPills`)`：从文本中智能抽取测试指令（如“用 radare2 分析二进制”），一键点击即可填入指令框并执行；
       - `⚡ 智能体提议待裁决 (`InteractiveProposalCard`)`：当 Agent 提出建议（如“要不要存为 skill”），自动生成操作按钮（`立即存为全局 Skill` / `仅记入当前项目` / `忽略`），用户点击即响应，告别打字。
  - 验证与交付：
    - `yarn typecheck`：0 错误；
    - `yarn build`：3.04s 打包通过；
    - `yarn test`：132 个前端单元测试 100% 全绿；
    - Release Bundle：34MB 重签名构建完成；
    - 本地已原子热更新安装至 `/Applications/OpenPI.app`，live 进程已重启就绪（PID: 12289, 12297）。

- **OpenPI Personal Agent OS — UI Architecture v2 全面重构落成 (从「AI 工作台」升级为「Personal Agent OS 工作空间」)**：
  - 核心愿景与范式升级：
    - 彻底告别旧版“User → Chat → Task → Agent → Execution → Result”单向问答逻辑，全面落地“World → Observe → Understand → Decide → Goal → Execute → Result → Experience → Learn”九步闭环。
    - UI 核心回答：“Agent 现在知道什么、正在做什么、为什么这么做、接下来准备做什么？”
  - 架构与界面全面重构：
    1. **全新左侧导航体系 (6 大核心域 + Jane 状态底栏)**：
       - 一级域：`◉ Today` (今日), `Goals` (目标), `Activity` (动态), `Projects` (项目), `Memory` (记忆), `Agent` (智能体)；
       - 会话标题智能净化：重写 `instanceTitle` 算法，从 `Ephemeral Subagent Directive` 中智能抽取核心目标 `Objective` 与角色 `Role`，过滤冗余 prompt 模板与 URL，彻底根治此前 `【Ephemeral Subage...` 刷屏痛点；
       - 项目卡片化与工作区上下文：直观展示目标关联、会话数量与本地工程入口。
    2. **中间工作空间多态化 (Conversation / Workspace)**：
       - **Conversation 状态**：引入上下文重构卡片 (`ContextReconstructionCard`)，用户每次进入无需重复交代昨天进度，系统自动恢复 `CURRENT GOAL`、已完成里程碑与下一步计划；
       - **Working 状态**：自动展开 Agent 活动流卡片 (`AgentWorkingActivityCard`)，将底层执行日志升华为 `Understanding → Intent → Decision → Live Activity`；
       - **Decision 状态**：引入双选/多选决策卡片 (`AgentDecisionPromptCard`)，直观对比方案 A 与方案 B 的资源/可靠性得失，用户一键确认；
       - **Execution 状态**：引入抽象化工作流卡片 (`AgentExecutionOverviewCard`)，清晰展示 `Analyze → Design → Implement → Review` 四段式流水线，并按需折叠工具调用与详细输出；
       - **消息风格升级**：采用高品质曜石暗色玻璃微拟态 (`Obsidian Glass`) 质感，淘汰刺眼砖红与粗糙色块。
    3. **右侧动态情境检查器 (`Contextual Inspector`)**：
       - 不再是死板固定的右侧栏，根据当前状态（对话、目标、活动、智能体）动态展示上下文洞察：当前目标详情、项目路径、熔断器与 30%/70% 分层预算仪表、因果归因与置信度；
       - 简单问答时可一键折叠，专注沉浸输入。
    4. **六大核心域专属界面全覆盖**：
       - 新增 `AgentSurface` 独立控制中枢，总览智能体状态、活动承诺、十大不变量看门狗与资源硬约束。
       - `ActivitySurface` 升级为 6 步因果时间线：`Observed → Understood → Decision → Action → Result → Learned`。
       - `GoalsSurface` 强化长程状态对象属性（WHY、CURRENT STATE、AGENT DECISION、NEXT ACTION、COMMITMENTS）。
  - 验证与交付状态：
    - `yarn typecheck`：0 错误通过；
    - `yarn build`：5.66s 打包完成；
    - `yarn test`：Rust Workspace (148 测试) + Vitest (15 文件 132 测试) 100% 全绿通过；
    - `RUSTFLAGS="-D warnings" cargo clippy --workspace --all-targets -- -D warnings`：0 警告通过；
    - `yarn check:targets`：aarch64 macOS 跨架构检查 0 警告通过；
    - `scripts/package-tauri-app.sh`：生成 34MB release 包并带真实开发者证书签名；
    - `scripts/install-local.sh`：原子更新安装至 `/Applications/OpenPI.app`，live 进程已热重载运行中（桌面端 PID: 9178，守护进程 PID: 9185）。

  - 核心痛点与解决：
    - 此前仅 `Today` 页面换装了 OS Dashboard，而进入 `Goals`、`Projects`、`Activity` 或 `Chat` 会话时跳回旧版简陋布局，体验割裂。
    - 现将整个桌面端全面升级为**一致的 Personal Agent OS 架构**：统一 OS 顶栏（`OpenPI Personal Agent OS` + `⌘K` 检索 + 状态铃铛 + 账号头像）、统一 230px 左侧系统导航（`今日`、`目标`、`活动`、`项目`、`记忆` 5 大一级应用 + 近期工程 + 最近会话 + `Janehuaan ● 在线` 底栏）、统一 290px 右侧 Personal Agent OS HUD（包含 Agent Healthy 状态、主线推进卡片、输入输出 Meter 仪表、缓存率、费用预估与 30%/70% 预算）。
  - 打造三大专有一级 OS 界面：
    1. **目标推进中枢 (`GoalsSurface`)**：原生支持状态过滤（全部/进行中/已完成/阻塞）、进度微调（-10%/+10% 步进器）、关键衡量指标清单、一键分发推进指令至 Agent 会话流、以及新建目标模态弹窗。
    2. **工程与工作区中心 (`ProjectsSurface`)**：按实际项目工作区路径聚合、实时展示各工程下活跃会话数与状态、提供“进入工程工作区”、“新建 Code 会话”与“打开本地工程”快捷入口。
    3. **活动与审计流水线 (`ActivitySurface`)**：无缝聚合代码变更审查（Git 状态/文件增删改）与智能体自主运行审计（Task Runs / 熔断器 / 决策事件流），双核自由切换。
  - 核心数据端到端动态响应：
    - `TodayOsDashboard` 统计卡片与动态链路不再死板硬编码，完全绑定 SQLite 真实目标数据（`activeGoalsCount`, `completedGoalsCount`, `blockedGoalsCount`）与实时 Agent 实例流（`streamingCount`）；
    - AI Pipeline 5 大阶段实时感知后台 Agent 运行态；
    - 所有页面流转（`onNavigate`、`onSelectConversation`、`onSendPrompt`）无缝衔接。
  - 验证与交付状态：
    - `yarn typecheck`：0 错误通过；
    - `yarn build`：3.08s 打包完成；
    - `yarn test`：Workspace 单元测试（148 个 Rust 测试）与 Vitest（132 个前端测试）100% 全绿通过；
    - `RUSTFLAGS="-D warnings" cargo clippy --workspace --all-targets -- -D warnings`：0 警告通过；
    - `yarn check:targets`：aarch64 macOS 跨架构检查 0 警告通过；
    - `scripts/package-tauri-app.sh`：生成 34MB release 包并带真实证书签名；
    - `scripts/install-local.sh`：原子更新安装至 `/Applications/OpenPI.app`，live 进程已热重载生效（PID: 95301, 95310）。

- **OpenPI Personal Agent OS 总体改造方案与生产级规范 (v1.1) 全阶段落成与全屏 OS Dashboard 1:1 像素级还原**：
  - 核心思想：
    1. **严格冻结 Execution Core（openpi-engine 与 openpi-tools 零修改零污染）**：WHY/WHAT/WHEN（个人智能层）与 HOW（代码执行底座）彻底解耦，穿透统一网关。
    2. **确定性安全防线与十大系统不变量**：以四大安全护栏（Event, Decision, Learning, Resource）与十大不变量为底线，确保长期稳定不失控。
  - 核心完成组件矩阵：
    1. **Failure Model & 熔断器机制 (`crates/openpi-safety/src/circuit_breaker.rs`)**：
       - `CircuitBreaker` 状态机（`Healthy`, `Degraded`, `Open`, `Recovery`），自动 30s 冷却与轻量探针探测恢复（Canary Probing，探针失败立即重新击穿）；
       - `ExecutionConstraint` 执行硬预算约束包：硬顶超时 (`timeoutMs <= 60s`)、内存阈值 (`memoryLimitMb <= 512MB`)、重试上限 (`retryBudget <= 2`)、单轮工具限额 (`toolCallLimit <= 15`)、子 Agent 递归上限 (`recursiveAgentDepth <= 2`)、全局急停强停通道 (`globalKillSwitch`)。
    2. **分层资源预算管理器 (`crates/openpi-safety/src/budget.rs`)**：
       - 30% Personal Agent 配额（Observation, Memory, Decision, Proactive）与 70% Execution Core 配额（AgentLoop, SubagentTools, Workflow）；
       - 严谨资源闭环：`Reserve`（执行前预扣）$\to$ `Execute` $\to$ `Meter`（遥测结算扣减）$\to$ `Release`（未消耗释放）$\to$ `Report`（入账审计）；
       - 预算使用率 $\ge 85\%$ 时触发告急预警并作为 Decision Engine 的输入，强制降级行动。
    3. **离散可测决策矩阵 (`crates/openpi-safety/src/decision.rs`)**：
       - 彻底弃用浮点数连续乘积，全量采用 0~3 标度离散等级与有限确定性规则集；
       - 8 种有限动作输出（`IGNORE`, `REMEMBER`, `SUGGEST`, `ASK`, `PREPARE`, `EXECUTE`, `RESUME`, `MONITOR`）；
       - 5 条确定性规则 100% 单元测试覆盖。
    4. **学习防污染与归因回滚层 (`crates/openpi-safety/src/attribution.rs`)**：
       - 归因分流：区分用户意图（`PreferenceChange` $\to$ 偏好候选；`RequirementChange` $\to$ 仅当前项目；`BugOrError` $\to$ 经验教训）；
       - 版本化偏好模型 `UserPreferenceRecord` 与溯源链 `EvidenceRef`；
       - 原子化回滚控制器：`rollback_preference(id)` API 确保“学错了随时回滚”。
    5. **十大系统不变量看门狗 (`crates/openpi-safety/src/invariants.rs`)**：
       - 运行时断言套件，涵盖超时 $\le 500$ms 响应、只读权限门禁、溯源链约束、回滚能力、预算封顶、事件去抖、穿透网关、衍生事件递归深度 $\le 1$、熔断降级只观察不行动等。
    6. **统一执行网关 (`crates/openpi-daemon/src/gateway.rs`)**：
       - 作为 Personal Agent 与底层 Execution Core 之间的唯一安全受控通道，自动校验权限、预扣预算、注入超时并监控熔断。
    7. **全屏 OS Dashboard UI 1:1 像素级深度还原 (`apps/desktop/web/components/surfaces/today/today-os-dashboard.tsx`)**：
       - **根因修复**：排查并彻底清除了旧资产 `sunset-mountains.jpg`（曾因把带假字的原型截图直接当背景而导致文字重影模糊），换装纯净 4K 暮光雪山湖畔壁纸与超清 Jane 肖像头像；
       - **双栏主线卡片**：Hero Banner 内部目标卡片 1:1 还原为左侧任务元信息+渐变发光进度条、右侧阶段推进+醒目橙色大按钮与圆形指示箭头；
       - **侧边栏检索与全域流转**：左侧一级导航增加顶部 `🔍 搜索...` 快捷过滤框；会话页次级导航栏新增 `今日 OS` 一键返回通道；
       - **HUD 仪表盘**：补全输入/输出 Meter 进度条、缓存命中与预估费用仪表盘，集成 v1.1 熔断器与分层预算告警；
       - **CI 与二进制**：Typecheck 0 错误、Vite 打包 3.05s、Vitest 132/132 全绿、Clippy 0 警告、aarch64 跨架构通过、应用重新打包并重签名至 `/Applications/OpenPI.app`，live 进程已热重载生效。
  - 验证与交付状态：
    - `docs/OPENPI_PERSONAL_AGENT_OS_SPEC_v1.1.md`：官方 1.1 架构设计与生产级规范落盘；
    - `openpi-daemon` & `src-tauri`：`Supervisor` 挂载 `ExecutionGateway`、`EventBus`、`PreferenceManager`，打通 `get_safety_status`、`evaluate_decision`、`rollback_preference`、`classify_user_reaction`、`execute_through_gateway` 5 大 IPC 接口；
    - `TodayOsDashboard`：HUD 实时响应熔断器 4 态徽章（Healthy/Degraded/Open/Recovery）、30%/70% 分层资源用量与警戒线、偏好原子回滚交互闭环；
    - `cargo test --workspace`：全量套件全部通过（openpi-safety 15/15, openpi-daemon 13/13, openpi-storage 5/5, openpi-memory 13/13, openpi-state 5/5, openpi-engine 48/48, openpi-gateway 16/16, openpi-security 13/13, openpi-jev 17/17 等，共 148 个测试）；
    - `yarn typecheck`：0 错误通过；
    - `yarn build`：3.16s 打包完成；
    - `vitest`：15 个文件 132/132 测试用例全绿通过；
    - `RUSTFLAGS="-D warnings" cargo clippy --workspace --all-targets -- -D warnings`：0 警告 0 错误通过；
    - `yarn check:targets`：aarch64 macOS 跨架构检查 0 警告通过；
    - 独立二进制通过 `scripts/install-daemon.sh` 平滑更新并重签名 bundle，live 进程已启动服务：`openpi-daemon` (PID: 81201)。

- **OpenPI Personal Agent OS 全量进化落地（Phase 1 ~ Phase 4 + UI 交互闭环全面达成）**：
  - 核心愿景：将 OpenPI 从被动式 Coding Agent 彻底升级为“懂用户、长记忆、主动办事且具备自我节制的 Personal Agent OS”（对标并超越 Muse / Cue / Today 交互范式）。
  - 架构铁律：**严格冻结 Execution Core（openpi-engine 核心底层零污染），WHY/WHAT/WHEN（长程规划与主动意图）与 HOW（代码执行）严格解耦**。
  - 全阶段完成成果矩阵：
    1. **Phase 1: 多维记忆中枢与动态半衰期衰减 (`crates/openpi-storage`, `crates/openpi-memory`)**：
       - SQLite 新增 `personal_memories` 表，支持 7 维分类（`Profile`, `Preference`, `Project`, `Decision`, `Experience`, `Feedback`, `Temporary`），记录置信度、重要性、访问计数与自然过期时间；
       - `lifecycle.rs`：艾宾浩斯动态半衰期衰减模型（Profile 60天，Decision 45天保鲜，Temporary 1天），重复访问自适应增强抗衰减能力；
       - `context_builder.rs`：动态上下文切片器，遵循 **1500 tokens 硬顶预算**（防 Prompt 污染与费用膨胀），格式化注入 `[OpenPI Personal Memory Context]`。
    2. **Phase 2: 长程目标状态机与双重人格权限模型 (`crates/openpi-state`)**：
       - `goal.rs`：新增 `PersonalGoalRecord` 与 `GoalManager` 状态机（`Draft`, `Active`, `Blocked`, `Waiting`, `Completed`, `Cancelled`, `Archived`），支持跨会话长期推进、自动进度约束（达 1.0 自动结项）；
       - `identity.rs`：确立 Agent 行为准则，细化读写权限门禁（`Permission`：允许分析/生成卡片，严禁未经确认的高危自作主张）。
    3. **Phase 3: 事件驱动与 ActionScore 理性决策池 (`crates/openpi-daemon/src/event_bus.rs`, `decision.rs`)**：
       - `AgentEvent` 事件总线：解耦时间触发、代码变更、会话闲置、用户反馈；
       - 智能决策算法：`ActionScore = Importance * Urgency * Confidence * Permission - InterruptionCost`。分级输出动作：低分静默忽略、中低分记入经验、中高分生成低打扰交互卡片、高分自主生成晨报或向用户请示，彻底避免主动式 AI 盲目自作主张或噪音骚扰。
    4. **Phase 4: 主动服务与 Today 晨报引擎 (`crates/openpi-daemon/src/proactive.rs`, `app_ops.rs`)**：
       - `ProactiveEngine::generate_briefing`：每日自动聚合时段问候、主线目标推进度（Daily Focus）、建议行动卡片（Action Cards）与高置信准则，提供一键式 `get_today_briefing` IPC 接口。
    5. **Phase 5 & 6: 桌面端深度融合与沉浸式 UI 闭环 (`apps/desktop/web`)**：
       - **主界面空状态破冰 (`TodayBriefingHero`)**：将原本冷冰冰的“空输入框发呆”升级为暖心问候、主线目标进度条、可点击即执行的 Action Cards 与动态快捷起步；
       - **记忆中枢三核升级 (`MemorySurface`)**：扩展出 `今日晨报 (Today)`、`长程目标 (Goals)`、`7维画像 (Personal)` 三个专属操作台，支持实时进度调节、目标状态机流转与个性化记忆白盒管理；
       - **IPC 与强类型**：`desktopApi.getTodayBriefing` / `listPersonalGoals` / `upsertPersonalGoal` / `updatePersonalGoalProgress` / `deletePersonalGoal` / `listPersonalMemories` / `upsertPersonalMemory` / `deletePersonalMemory` 全链路强类型通畅。
  - 验证矩阵：
    - `yarn typecheck`：通过（0 错误）
    - `yarn build`：通过（Vite 3.15s 打包完成）
    - `cargo test --workspace`：全部通过（storage 5/5, memory 13/13, state 5/5, engine 48/48, daemon 12/12, tools 9/9, security 13/13）
    - Vitest：通过（15 文件，132/132 测试用例全绿）
    - Clippy：`RUSTFLAGS="-D warnings" cargo clippy --workspace --all-targets -- -D warnings` 零警告通过
    - 跨架构检查：`yarn check:targets`（aarch64-apple-darwin）零警告通过
    - 守护进程已平滑更新热重载：PID 33725 正式服务新二进制。


- **第三方模型独立评审机制 (Actor-Critic 双盲质检 & 极速非阻塞架构)**：
  - 核心痛点：主模型盲目自信与确认偏误需把关，但同步阻塞审查会导致主回复延迟（等待十几秒至30秒），严重阻塞用户任务执行。
  - 优化架构：
    1. **非阻塞异步管道 (`execution_mode: "async" | "blocking"`)**：默认采用 `async` 后台并发质检。主回复在生成完成后**立即提交 Journal 并向用户端展示**，`agent_settled` 立即解锁输入框；评审任务通过 `tokio::spawn` 在后台并发运行。若质检通过，UI 徽章平滑点亮 `✅ 质检通过`；若质检驳回，自动将缺陷建议写入 Journal 并弹出提示卡片，绝不阻断用户当前工作流。同时保留 `blocking` 严格门禁供特定需要强管控的场景选择。
    2. **10倍提速与智能旁路 (Smart Diff & Fast Review)**：
       - **空变更 5ms 旁路**：`git diff --name-only HEAD` 检测到无实际文件改动时，直接跳过 LLM 往返并 5ms 极速放行。
       - **排除构建锁与噪音**：diff 显式排除 `*.lock`, `dist`, `target`, `node_modules`, `.next`，上限从 24k 字符收紧至 8k 字符。
       - **轻量提示词与硬限生成**：Reviewer 模型请求体强制注入 `max_tokens: 256` 与超精炼 Prompt，大幅缩短生成延迟（从十余秒降至 0.8s~1.5s）；超时上限从 35s 缩紧至 12s。
    3. **桌面端与配置全打通**：`ReviewerConfig` 增加 `execution_mode`（支持 `executionMode` alias），设置中心“模型”选项卡新增紫晶质感执行模式分段选择器（`⚡ 后台并发异步质检` vs `🛑 严格门禁同步阻断`）；`TurnProgressEvent` 与 HUD 状态栏完美适配异步状态。
  - 验证矩阵：单元测试全绿、`yarn typecheck`、`yarn build`、Vitest 132/132 全绿、Clippy 零警告、`yarn check:targets` aarch64 跨架构全绿，守护进程已通过 `install-daemon.sh` 平滑更新为新二进制（PID 74562）。

- **gateway 入站鉴权的三个坑（WIP，未提交时审出的）**：
  1. 绑定锁曾用 `split(':').next()` 取 host 且把**空 host 当回环**——`TcpListener::bind(":8788")` 实际监听
     0.0.0.0，等于不开 `OPENPI_GATEWAY_ALLOW_PUBLIC` 也能裸奔公网。现在统一走 `is_loopback_bind()`：
     解析成 `IpAddr` 判定，空 host/解析不了的主机名一律按非回环拒绝（宁可起不来）。
  2. `~/.openpi/gateway-key` 权限过宽时**自动收紧为 600**（不拒绝启动），日志里说明。
  3. key 比较用 `ct_eq` 常数时间（已有）。
  运维断层提醒：**引擎侧 models.json 里指向 gateway 的 provider，`api_key` 必须填这把入站 key**，
  否则鉴权上线后全部 401。现在有 `scripts/sync-gateway-key.sh`（key 缺失自动生成、收紧 600、
  按 baseUrl 端口匹配 provider 同步 apiKey、改前备份；`--dry-run` 可预览）串这俩了。
  另外：llm_client 的 400 回滚重试现在**只在错误体提到 cache_control 时触发**（`is_cache_rejection`），
  无关 400 直接失败，不白烧一次上游往返。
  gateway 的 `cc_openai_usage` 折叠缓存 token 时会用上游自报的 `totalTokens` 做**自检**：
  折叠后超出上游总账说明 `inputTokens` 已含缓存（OpenAI 语义），此时不折叠并打日志提醒人工对账——
  上游语义若变了不会静默双计。

## 已完成的修复记录

- **daemon 覆写自己**：`cp target/debug/openpi-daemon /Applications/OpenPI.app/.../bin/openpi-daemon && kill <自己 pid>`
  会作废运行中 Mach-O 的映射页，进程**静默冻结**（不崩溃），UI 却因为信任内存里的 `runningTools`
  标志把这一轮谎报成"执行中"两小时。修法：`App.tsx` 活性看门狗 + `gate.rs` 自我保护规则 +
  `scripts/package-tauri-app.sh` 原子替换 + `scripts/install-daemon.sh`。**别再用 `cp` 原地覆盖运行中的二进制。**
- **agent 变慢**：单轮几十个工具结果可以突破 48k 上下文预算（实测 25k–42k token）；记忆抽取和标题摘要
  每轮各一次 LLM 往返。现在裁剪会对半砍最大的工具结果，后台任务每 3 轮采样一次。`yarn cost` 可量
  `calls/turn` / `span/turn`。
- **预算漏算了 arguments 和 reasoning**：`total_chars()` 只看 `content`，而 `write` 调用的文件正文在
  `tool_calls[].function.arguments` 里、思考内容在 `reasoning_content` 里 —— 两者都**对预算隐形**。
  实测 `db2133cc` 有 443,203 字符的 arguments（比 content 还多）、单轮 98,143 字符的 reasoning。
  现在 `message_chars()` 三者都算，裁剪按"谁大砍谁"处理：arguments 折叠超长字符串值（保 JSON 结构、
  保留 `path` 等小字段），reasoning 折叠成标记（字段仍在，符合需要回传的 provider），工具结果继续对半砍。
  实测 `db2133cc` 852,334 → 40,435 字符。
- **`install-daemon.sh` 是假重启**：脚本发完 `shutdown` 就关 socket，而请求是 spawn 出去的 —— 客户端一断连，
  读循环立刻结束并跑 `requests.abort_all()`，把还没走到 `process::exit` 的 handler **abort 掉**。daemon
  继续跑（还是旧二进制），脚本却打印"已请求重启"。现在 `Shutdown` 在 `ipc.rs` 的读循环里**内联处理**
  （不再能被 abort），ack 会等 writer 取走再退；脚本改成**先 health 拿 pid、再轮询进程表**确认真的退出，
  失败 `exit 1` 并说明原因；替换 bundle 内 daemon 后**重新签名**（否则 bundle seal 是破的）。
  回归测试 `crates/openpi-daemon/tests/daemon_shutdown_test.rs` 起真二进制、发完就挂断，钉住这个行为
  （先确认它在旧代码上会红，再确认修复后变绿）。
  另外：**退出 app 不会杀掉 daemon**（它会被孤儿化，所以换二进制只能靠 `install-daemon.sh`）。
- **daemon 死了没人管**：`lib.rs` 只在启动时 `ensure_connected()` 一次，而 UI 高频走的 `get_snapshot` 用的是
  `request_passive` —— 它**故意不启动 daemon**。所以 daemon 一旦消失就再也不会回来：部署换完二进制后 app 会
  一直空转（实测 30s 不动），期间定时任务和云同步也是停的。现在 `DaemonClient::spawn_supervisor()` 每 2s 检查
  一次，断了就拉起来；`stop_daemon` 先清 `desired_running`，所以**手动停止不会被它撤销**（这条规则有单测钉住）。
- **幽灵执行 / 工具无限转圈（数千秒假死）**：
  在 agent 执行 `install-daemon.sh`、crash 或 daemon 意外断连重启时，engine 随 daemon 退出而中断，未发出 `toolResult` 或 `agent_settled`。前端此前有四处漏洞导致 UI 陷入自相矛盾的死循环、永久计时（如 3885s）：
  1. `daemon_client.rs`：socket EOF 断连时未通知 `event_tx`，现断连时立即广播 `stream_closed` (`instanceId: "*"`)。
  2. `App.tsx` 看门狗假死守卫：原代码 `if (!lastActivity || now - lastActivity <= QUIET_MS) return;` 导致 `!lastActivity`（冷启动或活动戳被清）时永远不向 daemon 对账，且之前只看 `streamingInstances` 忽略了孤立的 `runningTools`。现改为静默或无记录时主动对账，有 `runningTools` 同样启动看门狗。
  3. 轮询状态自闭环覆写：`isActivelyStreaming` 过去完全信任前端乐观的 `streamingInstances`，即使 daemon 返回 `status: "stopped"` 也会被本地强行写回 `isStreaming: true`。现以服务端权威为唯一准绳，`isServerStopped` 时强制阻断流标记、清空 `streamingInstances` 和 `runningTools`。`ipc_handlers.rs` 的 `get_conversation` 也补上了 `state.isStreaming: running`。
  4. `action-chain.tsx` 孤儿 toolCall：进程中断导致的无返回工具，在停止态下统一渲染 `<span className="trajectory-badge error">interrupted</span>`，头部带 `error`，输入框彻底解锁可直接键入。
- **模型过度思考与退化死循环 (Reasoning Loop & Repetition Breaker)**：
  - 核心痛点：用户反馈模型执行时莫名过度思考甚至持续 6m 28s、消耗 262.6k tokens；排查发现是 DeepSeek 等推理模型陷入自回归退化重复陷阱（如无休止连续输出 `OK.\nLet me write.\nGo.\nLet me write.` 循环数百次）。
  - 根因分析：
    1. 动态采样参数坍缩：`llm_client.rs` 原先对所有请求无差别回退至 `temperature: 0.2, top_p: None`。DeepSeek / 推理模型要求 `temperature: 0.5 ~ 0.7`（官方推荐 0.6，`top_p: 0.95`）；低温 0.2 导致推理概率分布向局部极小值坍缩，极易诱发周期性重复。且 `top_p` 字段未向网络请求体序列化。
    2. 无流式推理死循环熔断：`stream_chat_completion` 对 reasoning 仅做被动拼接，无周期性检测，单次可无止境空耗几十分钟。
    3. 无思考时长/预算硬顶：单次推理缺少时间（如 75s）与字符规模（如 40k chars）硬上限。
  - 修复实现：
    1. **参数自适应与协议补充**：`protocol.rs` 增加 `pub top_p: Option<f32>`；`llm_client.rs` 增加 `is_reasoning_model`，对推理模型默认赋 `temperature: 0.6, top_p: 0.95`，对非推理模型保持 0.2。
    2. **自回归退化重复检测算法**：在 `llm_client.rs` 新增 `detect_reasoning_repetition`，结合多行周期检测（$k \in 2..=8$ 行重复 3 次或单行重复 4 次）与滑动窗口子串检测（$w \in 10..=120$ 字符连续 3 次），在 100 token 内秒级拦截死循环。
    3. **思考尾部净化与硬顶熔断**：`clean_repetitive_reasoning_tail` 自动截断无限重复的垃圾周期，保留首轮并附带 `[OpenPI Guard: Terminated repetitive thinking loop]`；增加 75s 时长与 40,000 字符硬顶，熔断后平滑通知前端结束并在 `agent_loop` 注入矫正引导继续执行；系统提示词同步补充果断推理原则（Decisive Reasoning）。

## 移动端 M1：局域网实时 + 手机发指令（功能已完成，待真机验收）

**目标**：手机在同一 WiFi 下**实时**看到 Mac 上 agent 的运行过程，并能从手机发指令/停止。
**完整方案**：`~/.commandcode/plans/mobile-lan-and-oauth.md`（协议契约、验收标准、OAuth 也在里面）

### 已完成（都编译通过，daemon 侧还实测过）

- **daemon 侧** `crates/openpi-daemon/src/lan.rs`（新）：局域网 WS 服务，监听 `0.0.0.0:8765`
  - 配对：6 位码、**5 分钟一次性**；成功后发**设备 token**（KV `lan:devices`），重连带 token **免码**
  - 请求：`lan_ping` / `lan_watch` / `lan_prompt` / `lan_abort` → 转发现有 `supervisor.send_rpc`
  - 事件：订阅现有 `subscribe_events()`，**按 200ms 合批**推给已订阅会话；**每条 event 自带 sessionId**
  - 发指令前校验会话存在（`supervisor::find_session_file(&sid).exists()`），否则回 `unknown session`
  - **默认关闭**：`~/.openpi/agent/app_settings.json` 的 `lanEnabled` / `lanPort`；绑定失败只记日志
- **daemon op** `crates/openpi-daemon/src/app_ops.rs`：`lan_status` / `lan_begin_pairing`（顺手打开 lanEnabled）/ `lan_revoke_devices`
- **Tauri 转发** `apps/desktop/src-tauri/src/ipc_handlers.rs`：原来只转发 `cloud_*`，已补 `lan_*`
- **手机侧 Rust** `openpi-mobile/src-tauri/src/lan.rs`（新）：命令 `lan_configure` / `lan_status` / `lan_watch` /
  `lan_send_prompt` / `lan_abort` / `lan_forget`；断线指数退避重连（1→30s）、重连后自动重新订阅；
  事件 `emit("openpi:lan-event")`、状态 `emit("openpi:lan-status")`
- 顺带修掉一个真 bug：**改同步口令时不重新加密已上传会话**（`cloud_sync.rs::set_passphrase` 现在清空会话水位线，
  实测重推了 2249 条）。这条 bug 会让所有设备用新口令报"口令不正确"
- **手机端界面**（`openpi-mobile`，非 git 仓）：`src/lib/lan.ts`（命令封装 + `openpi:lan-event` 实时 reducer）、
  `App.tsx`（头部连接状态 chip、设置面板抽屉、会话页输入框 + 发送/停止、事件增量并进消息流）、`styles/mobile.css`；
  配置/设备令牌存 `localStorage`（`openpi-mobile:lan`），冷启动自动重连
- **桌面端界面**：`apps/desktop/web/components/surfaces/panels/settings/tabs/lan-tab.tsx`（设置 → 局域网遥控）+
  `desktopApi.lanStatus/lanBeginPairing/lanSetEnabled/lanRevokeDevices`；新增 daemon op `lan_set_enabled`（总开关可关）
- **修掉第二个真 bug**：`lan_prompt` 转发给 `send_rpc` 时用的键名错了（见下"关键坑"），手机发指令会**静默变成空消息**
- **APK**：`~/openpi-mobile/OpenPI-mobile-debug.apk`（debug，universal）

### 未完成（下一步）

1. **真机端到端验收**（功能都就绪，就差上真机跑一遍计划 2.4 的三条）：
   手机发"跑一下 `ls`" → Mac 逐字输出（不是等 60s 同步）；点停止 → Mac 真正中断且手机收到 `agent_settled`。
   局域网跑在真机上时，**桌面端要先把 `lanEnabled` 打开并重启 daemon**（见下"关键坑"）
2. M2：Google / GitHub 第三方登录（方案见计划文件第 3 节；需先在 Supabase 配好 provider）

### 关键坑（别再踩）

- **WebView 不能直接连 `ws://`**：页面 origin 是 `https://tauri.localhost`，明文 ws 会被混合内容策略拦掉。
  所以握手必须放在**手机端 Rust**，再 `emit` 给界面（桌面端 daemon ↔ Tauri ↔ webview 的同一套路）
- **发指令的键名有两层，别混**：手机→LAN 的 WS 帧用 `text`（`lan.rs` 读 `request["text"]`），
  但 LAN→daemon 的 prompt 命令必须用 **`message`**（`supervisor::send_rpc` 读 `command["message"]`）。
  `openpi-proto` 里的 `{"type":"prompt","text":"hello"}` 只是测试示例、**不是契约**，照它写会把消息丢成空串。
  现在 `lan.rs::prompt_command()` 统一映射，并有单测钉住（`prompt_command_uses_message_key`）
- **手机端解密走 Rust**（`decrypt_transcript`）：浏览器 WASM 的 Argon2 与桌面不一致，且并发会把 App 卡死；
  现在有**派生密钥缓存**（否则每条消息重跑一次 19MiB Argon2，列表会卡在"加载中…"）
- **别用 sed 批量改 Rust**：本项目里 sed 已经弄坏过文件（`.to_string()).into())`），用 edit 工具
- **总开关/端口存 `app_settings.json`，daemon 启动时才读一次**：桌面端点开关或改端口后必须**重启 daemon** 才生效
  （`lan_set_enabled` / `lan_begin_pairing` 都只是写文件）。手机侧断线会自动重连，不用改代码

### 怎么验证

- 真机调试：`adb shell input tap/text` + `adb exec-out screencap -p`（我能自己看画面，不用你描述）
- LAN 自测：用 python `websockets` 客户端连 `ws://127.0.0.1:8765`（配对码可用 `lan_begin_pairing` op 拿），
  跑在**数据库副本 + 独立 socket** 上（`OPENPI_DB_PATH` / `OPENPI_SOCKET_PATH`），别动真实数据
- 改完必跑：`cargo check -p openpi-daemon` / 手机端 `cd openpi-mobile/src-tauri && cargo check`
- **打包 APK**：工具链不在默认 PATH，要显式给（`tauri` 找 `rustup` 依赖 `~/.cargo/bin`）：
  ```sh
  export JAVA_HOME=~/.toolchain/jdk-17.0.20.1+1/Contents/Home
  export ANDROID_HOME=~/.toolchain/android-sdk
  export NDK_HOME=~/.toolchain/android-sdk/ndk/26.1.10909125
  export PATH=~/.cargo/bin:$JAVA_HOME/bin:$PATH
  cd ~/openpi-mobile && npx tauri android build --apk --debug
  ```
  产物在 `src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`，再拷成 `OpenPI-mobile-debug.apk`
