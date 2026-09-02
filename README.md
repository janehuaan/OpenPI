# openpi-next

OpenPI 重建版 —— 一个只依赖上游 pi 的 npm 包的桌面 AI 助手。

## 架构

```
apps/desktop              Electron 壳(main/preload/renderer)—— 纯 IPC 转发 + 原生能力
packages/shared           desktop ↔ daemon 的线协议类型(唯一共享层)
packages/daemon           会话监督 + app 级 API + IPC server
packages/scheduler        定时任务引擎
extensions/               pi 官方扩展机制实现的能力(memory/session-state/tools)
spike/                    Phase 0 路线验证
```

- **上游只锁版本,零 patch**:`@earendil-works/pi-{ai,agent-core,coding-agent}@0.84.4` 是 npm 依赖,
  不再是 fork 内源码。升级只需改版本号。
- **三进程隔离**:renderer ↔ main ↔ daemon ↔ `pi --mode rpc` 子进程。改 daemon 或扩展不用重装 .app。
- **每个会话一个 pi 子进程**,载荷 JSONL 帧,扩展经 `PI_CODING_AGENT_DIR` 隔离加载。
- **一条长连接 + 请求 id 多路复用**,取代旧的"短连接 request-response + 长连接 rpc_stream"两套并存。

## 开发

```bash
npm install --ignore-scripts          # 首次
node packages/daemon/src/cli.ts serve # 前台跑 daemon
node packages/daemon/src/cli.ts health
node packages/daemon/src/cli.ts create /path --mode code --model agnes-cn/agnes-2.5-flash
node packages/daemon/src/cli.ts rpc <sessionId> '{"type":"get_state","id":"1"}'
node packages/daemon/src/cli.ts watch <sessionId>
node packages/daemon/src/cli.ts shutdown
```

## 约定的环境变量

| 变量 | 作用 |
|---|---|
| `PI_CODING_AGENT_DIR` | 传给每个 pi 子进程,指向 `~/.openpi/agent`。**必须隔离**,否则加载用户全局扩展 |
| `OPENPI_DIR` | daemon 数据目录(默认 `~/.openpi`) |
| `OPENPI_SOCKET` | socket 路径(默认 `~/.openpi/daemon.sock`) |
| `OPENPI_PI_RPC_ENTRY` | 覆盖 pi RPC entry 路径(测试/开发用) |

## 凭证(决策 B)

首次启动 daemon 自动从用户已有的 `~/.pi/agent/` 导入 `models.json`/`auth.json`/`models-store.json`,
写入 `~/.openpi/agent/`。导入是一次性的(写 `.bootstrapped` 标记),之后两边互不影响;
`import-credentials` 命令可强制重导。

## 供应链纪律

照抄上游(根 `.npmrc` 的 `save-exact=true`、`min-release-age=2`):
直接依赖必须精确版本,锁文件是唯一真源。
