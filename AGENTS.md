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

## 已完成的两轮修复

- **daemon 覆写自己**：`cp target/debug/openpi-daemon /Applications/OpenPI.app/.../bin/openpi-daemon && kill <自己 pid>`
  会作废运行中 Mach-O 的映射页，进程**静默冻结**（不崩溃），UI 却因为信任内存里的 `runningTools`
  标志把这一轮谎报成"执行中"两小时。修法：`App.tsx` 活性看门狗 + `gate.rs` 自我保护规则 +
  `scripts/package-tauri-app.sh` 原子替换 + `scripts/install-daemon.sh`。**别再用 `cp` 原地覆盖运行中的二进制。**
- **agent 变慢**：单轮几十个工具结果可以突破 48k 上下文预算（实测 25k–42k token）；记忆抽取和标题摘要
  每轮各一次 LLM 往返。现在裁剪会对半砍最大的工具结果，后台任务每 3 轮采样一次。`yarn cost` 可量
  `calls/turn` / `span/turn`。

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
