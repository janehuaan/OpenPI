# Phase 0 — 路线验证结果

对真实的 `@earendil-works/pi-coding-agent@0.84.4`(npm 安装,零 patch)验证。

## 结论:方案可行,零 patch 上游成立

| # | 验证项 | 结果 | 证据 |
|---|---|---|---|
| 1 | 扩展从 `settings.json` 加载 | ✅ | `spike/extensions/spike.ts` 被加载,`setStatus` 生效 |
| 2 | `registerTool` 注册自定义工具 | ✅ | `openpi_ping` 注册无报错 |
| 3 | **`on("context")` 注入进 provider payload** | ✅ | 模型原样回读注入的 marker:`"[openpi-next] injected-context-marker"` |
| 4 | **`appendEntry` → 上游 `get_entries` 往返** | ✅ | 读回 `{"type":"custom","customType":"openpi:checkpoint","data":{...}}` |
| 5 | `ctx.ui.setStatus` 推给 RPC 客户端 | ✅ | 以 `extension_ui_request` 出现在 stdout |
| 6 | 完整 agent 事件流 | ✅ | `agent_start`→`turn_start`→`message_*`→`turn_end`→`agent_end`→`agent_settled` |

**决策 2(b) 成立**:`get_session_todo` / `get_session_task_state` / `get_session_events` 都可以用
`pi.appendEntry(customType, data)` + 上游已有的 `get_entries` 实现,不需要自定义 RPC 命令。

**比方案假设更好的一点**:`get_status_segments` 也不需要自定义命令 —— 扩展调 `ctx.ui.setStatus(key, text)`,
RPC 客户端直接收到 `extension_ui_request { method: "setStatus", statusKey, statusText }`。
方案里"必须 patch 的 `registerStatusSegment` 66 行"可以整个删掉。

## 扩展的正确写法(与旧仓库不同)

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// 默认导出工厂函数。ExtensionFactory = (pi: ExtensionAPI) => void | Promise<void>
export default function myExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name, label, description, parameters,
    execute: async () => ({ content: [{ type: "text", text: "..." }], details: {} }),
  });
  pi.on("context", async (event) => ({ messages: [...event.messages, extra] }));
  pi.on("session_start", async (_event, ctx) => { /* ctx 是 handler 第二参,不是 init 参数 */ });
}
```

踩过的坑:
- `export const extension = { init, dispose }` **无效** → `Failed to load extension: does not export a valid factory function`
- 工具定义字段是 `parameters`,不是 `input`
- **`execute` 必须返回 `{ content, details }`** —— 返回 `{ output }` 能通过类型检查(签名宽松),
  但工具结果到模型那里是空的,模型会说"该工具调用没有返回任何输出内容"。这一条是后来接
  `ctx.ui.confirm` 回路时才发现的,spike 当时没验证工具结果真的到达模型
- `on("context")` 必须返回**完整**消息数组(`[...event.messages, extra]`),只返回新消息会丢掉历史

## 运行环境约束(新发现,影响 Phase 1 设计)

1. **必须用 `PI_CODING_AGENT_DIR` 隔离配置目录**。不隔离时子进程会加载用户全局 `~/.pi/agent/` 的扩展
   (实测加载了 `opencode-usage`、`plan-mode`)和模型默认值,行为不可控。

2. **`--provider X` 单独给不生效**,必须 `--model <provider>/<modelId>`。
   实测 `--provider agnes-cn` 仍回落到 anthropic 默认模型;`--model agnes-cn/agnes-2.5-flash` 才正确切换。

3. **隔离目录需要 `models.json`**(provider 定义 + 凭证)。空目录会生成空的 `auth.json`(`{}`),
   所有真实调用 401。Phase 1 的 daemon 必须决定凭证来源:
   - 让用户在桌面端里登录,写进 openpi 自己的 agent-dir(推荐,与旧的 `provider_login` RPC 对应)
   - 或从全局 `~/.pi/agent/models.json` 导入一次

## 复现命令

```bash
cd ~/openpi-next
node -e '
const { spawn } = require("child_process");
const p = spawn("npx", ["pi","--mode","rpc","--no-builtin-tools","--no-session",
                        "--model","agnes-cn/agnes-2.5-flash"], {
  env: { ...process.env, PI_CODING_AGENT_DIR: process.cwd() + "/spike/agent-dir" }
});
p.stdout.on("data", d => process.stdout.write(d));
setTimeout(() => p.stdin.write(JSON.stringify({
  type:"prompt", id:"1",
  message:"There is a marker string starting with [openpi-next] in your context. Reply with that exact marker and nothing else."
}) + "\n"), 2000);
setTimeout(() => p.kill(), 30000);
'
```
