# openpi-gateway

把上游 coding-agent 的**私有协议**桥接成标准 **OpenAI Chat Completions**，让任意本地客户端
(Cursor / Continue / LiteLLM / openai-sdk …) 直接调用。按模型名前缀自动路由：

| 模型前缀 | 上游 | 入口 | 状态 |
|---|---|---|---|
| `cline-pass/*` | Cline 订阅池 | `https://api.cline.bot/api/v1/chat/completions` | ✅ |
| 其它 (`deepseek/*`…) | command-code | `https://api.commandcode.ai/alpha/generate` (私有事件流) | ✅ |

## 运行

```bash
cargo run -p openpi-gateway     # 默认监听 127.0.0.1:8788
```

环境变量：

| 变量 | 默认 | 说明 |
|---|---|---|
| `OPENPI_GATEWAY_ADDR` | `127.0.0.1:8788` | 监听地址 |
| `COMMANDCODE_AUTH` | `$HOME/.commandcode/auth.json` | command-code 凭据(`apiKey`) |
| `COMMANDCODE_BASE` | `https://api.commandcode.ai` | command-code 网关 |
| `CLINE_PROVIDERS` | `$HOME/.cline/data/settings/providers.json` | cline 凭据(`providers.cline-pass.auth`) |
| `CLINE_BASE` | `https://api.cline.bot/api/v1` | cline 网关 |

## 调用

```bash
# cline 订阅池
curl http://127.0.0.1:8788/v1/chat/completions -H 'content-type: application/json' \
  -d '{"model":"cline-pass/glm-5.3-flash","stream":true,"messages":[{"role":"user","content":"你好"}]}'

# command-code
curl http://127.0.0.1:8788/v1/chat/completions -H 'content-type: application/json' \
  -d '{"model":"deepseek/deepseek-v4.1-flash","messages":[{"role":"user","content":"你好"}]}'
```

- `GET /health` / `GET /v1/models` / `POST /v1/chat/completions`
- 支持 `stream=true/false`；透出 `reasoning_content` 与 `usage`
- cline 推理模型 `max_tokens` 太小会「空内容 500」，未指定时默认补 `4096`

## 两个上游的认证要点（关键！）

**command-code**：`Authorization: Bearer <apiKey>` + `User-Agent: command-code/1.74.1`
+ `x-command-code-version`。响应是**换行分隔 JSON 事件流**(非 `data:` 前缀)。

**cline-pass**：OAuth(WorkOS)。刷新 `POST /api/v1/auth/refresh`（body `granttype`+`refreshtoken`），
返回**纯 JWT**，发送时**必须加回 `workos:` 前缀**：`Authorization: Bearer workos:<jwt>`。
（token 由网关内存缓存，剩余 <60s 自动刷新。）

## 设计

零新增重依赖：`tokio + hyper + reqwest + futures-util + serde_json`（均已在 workspace 锁内）。
流式翻译用 `futures-util::stream::unfold` 手写，无额外 channel/stream 依赖。

> ⚠️ 复用订阅凭据绕过官方客户端可能违反上游 ToS，有封号风险，请自行评估。
