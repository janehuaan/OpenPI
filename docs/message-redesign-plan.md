# OpenPI 消息显示与首页信息架构重构方案

> **文档性质**：设计文档（施工前方案，不含代码改动）。
> **范围**：消息渲染范式重构 + 首页信息架构重排（两者一起做）。
> **触发**：首页呈现「OS 仪表盘 + 裸聊天气泡」的混搭，与「个人助理」定位割裂。

---

## 0. 问题诊断（带代码证据）

| # | 问题 | 证据 |
|---|---|---|
| 1 | **消息只有两条渲染路径，结构化那条几乎不触发** | `workspace-preview.tsx:2289-2313`：`parseAgentOutcome(text)` 命中 → `AgentOutcomeCard`；否则 → 裸 `MarkdownText` 气泡 |
| 2 | **`parseAgentOutcome` 触发条件过窄** | `personal-agent-blocks.tsx:463-465`：必须出现「做了什么 / 交付成果 / 执行结果 / 变更记录」小标题才 `isStructured`。**分析 / 建议 / 问答型回复全部回退成裸文本** |
| 3 | **recap 卡与正文重复** | `recap-card.tsx` 从同一条正文再抽一次"本轮复盘"，于是「一句话总结：…」在正文与复盘卡里各出现一次 |
| 4 | **首页两套范式硬拼** | 上半屏 `.pa-greeting-bar` + `.pa-focus-container`（OS 仪表盘），下半屏 `.reference-feed`（聊天记录），无过渡、无主次 |
| 5 | **长文本无层级、无操作面** | 默认展示全量 Markdown，没有"结论先行 / 要点 / 折叠正文"的渐进披露 |

---

## 1. 设计目标与原则

**一句话**：消息不是"一段文本"，而是"助理交付给你的一件事 + 一组可操作项"。

1. **结论先行**：任何回复先给一句结论 + 状态徽章。
2. **渐进披露**：要点默认展开，证据与原始正文默认折叠。
3. **按类型渲染**：闲聊、分析、任务交付、决策、报错各自有合适的形态。
4. **不丢信息**：原始正文永远可展开查看（不删内容）。
5. **态势与对话分层**：首页顶部是"态势头"，下面是"结构化对话"，滚动时态势头收窄。

---

## 2. Part A：消息范式重构

### 2.1 新渲染决策树

替换 `workspace-preview.tsx:2289-2313` 的分支：

```
text
 ├─ parseAgentOutcome(text) 命中  → AgentOutcomeCard（任务交付，已有）
 ├─ parseAnswerBrief(text)  命中  → AnswerBriefCard（新增：分析 / 建议 / 问答）
 └─ 否则（短文本 / 闲聊）          → MarkdownText（轻气泡，保持现状）
```

### 2.2 新增 `parseAnswerBrief(rawText)`（`personal-agent-blocks.tsx`）

纯函数，返回 `{ tldr, points[], suggestions[], body } | null`：

- **TL;DR**：优先匹配「一句话总结 / 结论 / 总之 / 简而言之 / 核心是」句式；否则取首段首句（≤ 80 字）。
- **要点**：抽取所有 bullet 行（`-` / `*` / `1.`），最多 6 条，去掉行内 markdown。
- **建议**：末尾「建议 / 下一步 / 你可以 / 推荐」句式 → 转 chips。
- **body**：剩余原文（用于折叠展开）。
- **返回 null 的条件**：既无 TL;DR 又无要点（即真正的短对话），保持轻气泡。

### 2.3 新增 `AnswerBriefCard` 组件

```
┌─ 💡 结论 ────────────────────────────────┐
│ <TL;DR>                                   │
├─ 要点 ───────────────────────────────────┤
│ • ...（最多 6 条）                         │
├─ 建议 ───────────────────────────────────┤
│ [chip] [chip] [chip]                      │
├─ ▸ 展开完整回答 ─────────────────────────┤
│   <折叠：MarkdownText 全文>                │
└──────────────────────────────────────────┘
```

- 复用现有 `.reference-assistant-card` 外壳与主题变量（`--bg-elevated` / `--border` / `--accent-soft` 等），保证 8 套主题自适应。
- 状态徽章：`完成 / 进行中 / 待确认 / 受阻`（由文本关键词 + message 状态推断）。

### 2.4 修 recap 重复

- 给 `ClaudeCodeRecapCard` 增加 `suppressRecap?: boolean`。
- 当正文已走 `AgentOutcomeCard` / `AnswerBriefCard`（即已结构化）时传 `true` → **只保留"下一步建议" chips，不再复述正文**。

---

## 3. Part B：首页信息架构重排

### 3.1 现状
`.pa-greeting-bar` + `.pa-focus-container` 固定占位，随 feed 一起滚动，与对话内容争夺注意力。

### 3.2 目标 IA

```
┌─ 态势头（sticky）─────────────────────────────┐
│ 晚上好，简华安 · 今日重点：OpenPI 架构改造 72%  │
│ 2 项待办 ▾                         26°C 新加坡 │
└──────────────────────────────────────────────┘
   （滚动前 = 完整 hero + 今天的重点三卡；滚动后收窄成上面一行，可点击展开）

┌─ 结构化对话 ─────────────────────────────────┐
│  <AnswerBriefCard> / <AgentOutcomeCard> ...   │
└──────────────────────────────────────────────┘

┌─ 输入框 ─────────────────────────────────────┐
```

### 3.3 行为
- **空状态**（无消息）：完整 hero + 今天的重点三卡 + 引导（保持现状）。
- **有消息**：滚动超过阈值后，`.pa-greeting-bar` + `.pa-focus-container` 收窄为一行 sticky 态势条（问候 + 今日主线摘要 + 待办数），点击可展开回完整态。
- 实现方式：给 `.reference-feed` 的滚动位置加一个 `collapsed` 状态（已有 `handleFeedScroll` 钩子，可复用）。

---

## 4. 改动面清单

| 文件 | 改动 |
|---|---|
| `apps/desktop/web/components/surfaces/workspace/personal-agent-blocks.tsx` | 新增 `parseAnswerBrief` + `AnswerBriefCard` |
| `apps/desktop/web/components/surfaces/workspace/workspace-preview.tsx` | 渲染决策树加一层；recap 传 `suppressRecap`；态势头 collapse 状态 |
| `apps/desktop/web/components/recap-card.tsx` | 新增 `suppressRecap` prop |
| `apps/desktop/web/styles/personal-assistant.css` | `AnswerBriefCard` 样式；态势头 sticky/collapse 样式 |

**不动**：daemon / engine / storage（纯前端呈现层）。

---

## 5. 验收标准

1. 截图里那条「方案 C…」分析型回复 → 渲染为 `AnswerBriefCard`（结论 + 要点 + 建议 + 折叠正文），不再是裸文本。
2. 正文末尾的「一句话总结」不再在复盘卡里重复。
3. 短对话（如"好的"）仍是轻气泡，不强行套卡片。
4. 首页滚动时态势头收窄，不遮挡内容；点击可展开。
5. 8 套主题下配色自适应（无硬编码色值）。
6. `yarn typecheck` / `yarn build` / `yarn test` 全绿。

---

## 6. 风险与回退

- **解析误伤**：`parseAnswerBrief` 判定过宽会把短对话也卡片化 → 用"既无 TL;DR 又无要点则返回 null"兜底，并加单测覆盖。
- **sticky 抖动**：collapse 阈值需去抖（复用 `handleFeedScroll` 已有节流）。
- **回退**：所有改动集中在 4 个前端文件，可整体 revert，不影响后端。
