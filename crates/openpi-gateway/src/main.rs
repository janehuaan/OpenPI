//! OpenPI Gateway — 把上游 coding-agent 的私有协议，桥接成标准 OpenAI 接口。
//!
//! 支持两个上游，按模型名前缀自动路由：
//!   * `cline-pass/*`  → Cline 订阅池 (`https://api.cline.bot/api/v1/chat/completions`)
//!   * 其它 (deepseek/* …) → command-code (`/alpha/generate` 私有事件流)
//!
//! 环境变量：
//!   OPENPI_GATEWAY_ADDR   监听地址        (默认 127.0.0.1:8788)
//!   COMMANDCODE_AUTH      command-code 凭据 (默认 $HOME/.commandcode/auth.json)
//!   COMMANDCODE_BASE      command-code 网关  (默认 https://api.commandcode.ai)
//!   CLINE_PROVIDERS       cline 凭据文件    (默认 $HOME/.cline/data/settings/providers.json)
//!   CLINE_BASE            cline 网关        (默认 https://api.cline.bot/api/v1)
//!
//! 零新增重依赖：tokio + hyper + reqwest + futures-util + serde_json。

use std::convert::Infallible;
use std::sync::Arc;

use bytes::Bytes;
use futures_util::{stream, StreamExt};
use http_body::Frame;
use http_body_util::{combinators::BoxBody, BodyExt, Full, StreamBody};
use hyper::body::Incoming;
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{header, Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use serde_json::{json, Map, Value};
use tokio::net::TcpListener;
use tokio::sync::Mutex;

type Body = BoxBody<Bytes, std::io::Error>;

const UPSTREAM_UA: &str = "command-code/1.74.1";
const UPSTREAM_VER: &str = "1.74.1";
const CLINE_UA: &str = "Bun/1.4.2";
const CLINE_VER: &str = "3.0.68";

type ModelsCache = Arc<Mutex<Option<(i64, Vec<String>)>>>;

#[derive(Clone)]
struct Cfg {
    // command-code
    cc_key: String,
    cc_base: String,
    // cline
    cline_base: String,
    cline: Arc<Mutex<ClineAuth>>,
    // cline 模型列表缓存: (过期毫秒, ids)
    models_cache: ModelsCache,
    // misc
    http: reqwest::Client,
    bind: String,
    /// 入站鉴权 key（必填）。空/缺失直接拒绝启动，避免裸奔网关直通付费订阅。
    inbound_key: String,
}

struct ClineAuth {
    access_token: String, // 形如 "workos:<jwt>"
    refresh_token: String,
    expires_at: i64, // ms
}

// ─────────────────────────────── 入口 ───────────────────────────────

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cfg = Arc::new(load_cfg()?);
    // 安全硬锁：默认只允许绑定回环地址。外网绑定必须显式 OPENPI_GATEWAY_ALLOW_PUBLIC=1，
    // 避免哪天改 env 时把「无公网防护的付费代理」直接暴露出去。
    // 注意 `TcpListener::bind(":8788")` 会解析成 0.0.0.0（所有网卡），
    // 所以空 host 一律按非回环处理，宁可拒绝启动也不能裸奔。
    let is_loopback = is_loopback_bind(&cfg.bind);
    if !is_loopback && std::env::var("OPENPI_GATEWAY_ALLOW_PUBLIC").as_deref() != Ok("1") {
        anyhow::bail!(
            "拒绝绑定非回环地址 {}：如确需对外，请显式设置 OPENPI_GATEWAY_ALLOW_PUBLIC=1 并自行加反向代理鉴权",
            cfg.bind
        );
    }
    let listener = TcpListener::bind(&cfg.bind).await?;
    eprintln!(
        "[openpi-gateway] listening http://{}  | command-code={}  cline={}  | 入站鉴权: ON{}",
        cfg.bind,
        cfg.cc_base,
        cfg.cline_base,
        if is_loopback { " (仅本机)" } else { " (已放行公网!)" }
    );
    // 预热 cline 模型表，使路由表在首个请求前就绪（失败自动回退内置表）
    {
        let warm = cfg.clone();
        tokio::spawn(async move {
            let n = cline_model_ids(&warm).await.len();
            eprintln!("[openpi-gateway] cline 模型表就绪: {n} 个");
        });
    }
    loop {
        let (stream, peer) = listener.accept().await?;
        let cfg = cfg.clone();
        tokio::spawn(async move {
            let svc = service_fn(move |req| {
                let cfg = cfg.clone();
                async move { handle(req, cfg).await }
            });
            if let Err(e) = http1::Builder::new()
                .serve_connection(TokioIo::new(stream), svc)
                .await
            {
                eprintln!("[conn {peer}] {e}");
            }
        });
    }
}

fn load_cfg() -> anyhow::Result<Cfg> {
    let home = std::env::var("HOME").unwrap_or_default();
    let cc_auth = env_or("COMMANDCODE_AUTH", &format!("{home}/.commandcode/auth.json"));
    let raw = std::fs::read_to_string(&cc_auth)
        .map_err(|e| anyhow::anyhow!("读取 command-code 凭据失败 {cc_auth}: {e}"))?;
    let ccv: Value = serde_json::from_str(&raw)?;
    let cc_key = ccv
        .get("apiKey")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow::anyhow!("auth.json 缺少 apiKey"))?
        .to_string();

    let cline_path = env_or(
        "CLINE_PROVIDERS",
        &format!("{home}/.cline/data/settings/providers.json"),
    );
    let cline = load_cline_auth(&cline_path)?;

    Ok(Cfg {
        cc_key,
        cc_base: env_or("COMMANDCODE_BASE", "https://api.commandcode.ai"),
        cline_base: env_or("CLINE_BASE", "https://api.cline.bot/api/v1"),
        cline: Arc::new(Mutex::new(cline)),
        models_cache: Arc::new(Mutex::new(None)),
        http: reqwest::Client::new(),
        bind: env_or("OPENPI_GATEWAY_ADDR", "127.0.0.1:8788"),
        inbound_key: load_inbound_key()?,
    })
}

/// 入站 key 来源优先级：OPENPI_GATEWAY_KEY 环境变量 > $HOME/.openpi/gateway-key（600）。
/// 都没有则拒绝启动——宁可起不来，也不允许无鉴权直通付费上游。
fn load_inbound_key() -> anyhow::Result<String> {
    let home = std::env::var("HOME").unwrap_or_default();
    let path = env_or("OPENPI_GATEWAY_KEY_FILE", &format!("{home}/.openpi/gateway-key"));
    let key = match std::env::var("OPENPI_GATEWAY_KEY") {
        Ok(k) if !k.trim().is_empty() => k.trim().to_string(),
        _ => {
            let key = std::fs::read_to_string(&path)
                .map_err(|_| {
                    anyhow::anyhow!(
                        "缺少入站鉴权 key：设置 OPENPI_GATEWAY_KEY 或创建 {path}（内容为随机串，建议 32+ 字节）"
                    )
                })?
                .trim()
                .to_string();
            tighten_key_file_perms(&path);
            key
        }
    };
    if key.len() < 16 {
        anyhow::bail!("入站鉴权 key 过短（{} 字节，至少 16），拒绝启动", key.len());
    }
    Ok(key)
}

/// key 文件必须是仅属主可读（600）。宽松时直接收紧（而非拒绝启动）并提示——
/// 修权限是无损操作，让用户手工修反而容易忘。
#[cfg(unix)]
fn tighten_key_file_perms(path: &str) {
    use std::os::unix::fs::PermissionsExt;
    // 读都成功了，metadata 失败不太可能；不因它阻塞启动
    if let Ok(meta) = std::fs::metadata(path) {
        let mode = meta.permissions().mode();
        if mode & 0o077 != 0 {
            eprintln!(
                "[openpi-gateway] key 文件 {path} 权限过宽（{:o}），已自动收紧为 600",
                mode & 0o777
            );
            let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
        }
    }
}

#[cfg(not(unix))]
fn tighten_key_file_perms(_path: &str) {}

fn load_cline_auth(path: &str) -> anyhow::Result<ClineAuth> {
    let raw = std::fs::read_to_string(path)
        .map_err(|e| anyhow::anyhow!("读取 cline 凭据失败 {path}: {e}"))?;
    let v: Value = serde_json::from_str(&raw)?;
    let a = v
        .pointer("/providers/cline-pass/settings/auth")
        .ok_or_else(|| anyhow::anyhow!("providers.json 缺少 cline-pass.auth"))?;
    Ok(ClineAuth {
        access_token: a.get("accessToken").and_then(Value::as_str).unwrap_or("").to_string(),
        refresh_token: a.get("refreshToken").and_then(Value::as_str).unwrap_or("").to_string(),
        expires_at: a.get("expiresAt").and_then(Value::as_i64).unwrap_or(0),
    })
}

fn env_or(k: &str, d: &str) -> String {
    std::env::var(k).unwrap_or_else(|_| d.to_string())
}

// ─────────────────────────────── 路由 ───────────────────────────────

enum Upstream {
    CommandCode,
    Cline,
}

/// 路由：优先**精确命中** cline 已知模型（解决 openai/*, moonshotai/* 等与
/// command-code 的重名前缀），否则按 cline 专属前缀，再否则 command-code。
async fn route(model: &str, cfg: &Cfg) -> Upstream {
    {
        let c = cfg.models_cache.lock().await;
        if let Some((_, ids)) = c.as_ref() {
            if ids.iter().any(|m| m == model) {
                return Upstream::Cline;
            }
        }
    }
    const CLINE_PREFIXES: &[&str] = &[
        "cline-pass/",
        "cline-free/",
        "cline-cloud/",
        "anthropic/",
        "spacexai/",
        "stealth/",
    ];
    if CLINE_PREFIXES.iter().any(|p| model.starts_with(p)) {
        Upstream::Cline
    } else {
        Upstream::CommandCode
    }
}

async fn handle(req: Request<Incoming>, cfg: Arc<Cfg>) -> Result<Response<Body>, Infallible> {
    let path = req.uri().path().to_string();
    let method = req.method().clone();
    let resp = match (&method, path.as_str()) {
        // 探活端点：不含凭据/配额信息，保持免鉴权供 launchd/监控使用。
        (&Method::GET, "/health") => json_resp(json!({
            "status": "ok",
            "upstreams": { "command-code": cfg.cc_base, "cline": cfg.cline_base }
        })),
        // 其余一律鉴权（fail-closed）。
        _ => {
            if let Some(bad) = check_inbound(&req, &cfg) {
                bad
            } else {
                match (&method, path.as_str()) {
                    (&Method::GET, "/v1/models") => models_resp(&cfg).await,
                    (&Method::POST, "/v1/chat/completions") => chat(req, cfg).await,
                    _ => err_resp(StatusCode::NOT_FOUND, "not found"),
                }
            }
        }
    };
    Ok(resp)
}

/// 是否绑定在回环地址上。空 host（如 `":8788"`、`"8788"`）会被系统解析成
/// 0.0.0.0（所有网卡），因此按**非回环**处理；无法解析的主机名同样拒绝，
/// 不能因为「看不懂」就放行。
fn is_loopback_bind(bind: &str) -> bool {
    // 剥掉端口。IPv6 可能是 `[::1]:8788`（冒号分割会切碎地址），先找 `]`。
    let host = match bind.rfind(']') {
        Some(i) => &bind[..=i],
        None => match bind.rfind(':') {
            Some(i) => &bind[..i],
            None => bind,
        },
    };
    let host = host.trim_start_matches('[').trim_end_matches(']');
    if host.is_empty() {
        return false;
    }
    if host.eq_ignore_ascii_case("localhost") {
        return true;
    }
    match host.parse::<std::net::IpAddr>() {
        Ok(ip) => ip.is_loopback(),
        Err(_) => false, // 未知主机名：不假设安全
    }
}

/// 校验入站 Authorization 头，返回 Some(错误响应) 表示拒绝。
/// 抽成 header 切片 → (授权/拒绝) 的纯函数，便于单测（Incoming 无法在测试中构造）。
fn check_inbound(req: &Request<Incoming>, cfg: &Cfg) -> Option<Response<Body>> {
    authorize_header(
        req.headers().get(hyper::header::AUTHORIZATION).and_then(|v| v.to_str().ok()),
        &cfg.inbound_key,
    )
    .err()
    .map(|m| unauthorized(&m))
}

/// 常量时间比较，避免通过响应时间推断 key。
fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    let mut diff = (a.len() ^ b.len()) as u8;
    for i in 0..a.len().max(b.len()) {
        let x = *a.get(i).unwrap_or(&0);
        let y = *b.get(i).unwrap_or(&0);
        diff |= x ^ y;
    }
    diff == 0
}

/// 入站鉴权核心：Ok = 放行，Err(msg) = 拒绝原因。
fn authorize_header(header: Option<&str>, key: &str) -> Result<(), String> {
    let Some(s) = header else {
        return Err("缺少 Authorization 头".into());
    };
    let Some(tok) = s.strip_prefix("Bearer ").or_else(|| s.strip_prefix("bearer ")) else {
        return Err("Authorization 必须为 Bearer <key>".into());
    };
    if ct_eq(tok.trim().as_bytes(), key.as_bytes()) {
        Ok(())
    } else {
        Err("入站 key 无效".into())
    }
}

fn unauthorized(msg: &str) -> Response<Body> {
    let mut r = err_resp(StatusCode::UNAUTHORIZED, msg);
    r.headers_mut().insert(header::WWW_AUTHENTICATE, "Bearer".parse().unwrap());
    r
}

async fn chat(req: Request<Incoming>, cfg: Arc<Cfg>) -> Response<Body> {
    let raw = match req.into_body().collect().await {
        Ok(b) => b.to_bytes(),
        Err(e) => return err_resp(StatusCode::BAD_REQUEST, &format!("读取请求体失败: {e}")),
    };
    let reqv: Value = match serde_json::from_slice(&raw) {
        Ok(v) => v,
        Err(e) => return err_resp(StatusCode::BAD_REQUEST, &format!("非法 JSON: {e}")),
    };
    let model = reqv.get("model").and_then(Value::as_str).unwrap_or("").to_string();
    let stream = reqv.get("stream").and_then(Value::as_bool).unwrap_or(false);
    match route(&model, &cfg).await {
        Upstream::Cline => chat_cline(reqv, stream, cfg).await,
        Upstream::CommandCode => chat_commandcode(reqv, model, stream, cfg).await,
    }
}

// ═════════════════════════ 上游 A: cline-pass ═════════════════════════

async fn cline_token(cfg: &Cfg) -> anyhow::Result<String> {
    let mut g = cfg.cline.lock().await;
    let now = chrono::Utc::now().timestamp_millis();
    if !g.access_token.is_empty() && g.expires_at - now > 60_000 {
        return Ok(ensure_workos(&g.access_token));
    }
    let resp = cfg
        .http
        .post(format!("{}/auth/refresh", cfg.cline_base))
        .header("content-type", "application/json")
        .header("user-agent", CLINE_UA)
        .json(&json!({ "granttype": "refresh_token", "refreshtoken": g.refresh_token }))
        .send()
        .await
        .map_err(|e| anyhow::anyhow!("cline refresh 网络错误: {e}"))?;
    let v: Value = resp.json().await.map_err(|e| anyhow::anyhow!("cline refresh 解析失败: {e}"))?;
    let d = v.get("data").cloned().unwrap_or(v);
    let at = d
        .get("accessToken")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow::anyhow!("cline refresh 无 accessToken: {}", d))?;
    g.access_token = ensure_workos(at);
    if let Some(rt) = d.get("refreshToken").and_then(Value::as_str) {
        if !rt.trim().is_empty() {
            g.refresh_token = rt.to_string();
        }
    }
    g.expires_at = d.get("expiresAt").and_then(Value::as_i64).unwrap_or(now + 3_600_000);
    Ok(g.access_token.clone())
}

fn ensure_workos(t: &str) -> String {
    let t = t.trim();
    if t.starts_with("workos:") {
        t.to_string()
    } else {
        format!("workos:{t}")
    }
}

async fn chat_cline(reqv: Value, stream: bool, cfg: Arc<Cfg>) -> Response<Body> {
    let token = match cline_token(&cfg).await {
        Ok(t) => t,
        Err(e) => return err_resp(StatusCode::BAD_GATEWAY, &format!("cline 取 token 失败: {e}")),
    };
    // 补默认 max_tokens（推理模型额度太小会返回空内容 → 上游 500）
    let mut body = reqv;
    let has_mt = body.get("max_tokens").is_some() || body.get("max_completion_tokens").is_some();
    if !has_mt {
        body["max_tokens"] = json!(4096);
    }
    let sent = cfg
        .http
        .post(format!("{}/chat/completions", cfg.cline_base))
        .header("authorization", format!("Bearer {token}"))
        .header("content-type", "application/json")
        .header("user-agent", CLINE_UA)
        .header("x-client-type", "cline-cli")
        .header("x-client-version", CLINE_VER)
        .header("x-platform", "cli")
        .header("x-is-multiroot", "false")
        .header("x-title", "Cline")
        .json(&body)
        .send()
        .await;
    let upstream = match sent {
        Ok(r) => r,
        Err(e) => return err_resp(StatusCode::BAD_GATEWAY, &format!("cline 上游不可达: {e}")),
    };
    let status = upstream.status();
    if !status.is_success() {
        let b = upstream.text().await.unwrap_or_default();
        return err_resp(
            StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::BAD_GATEWAY),
            &b,
        );
    }
    if stream {
        cline_stream(upstream)
    } else {
        cline_nonstream(upstream).await
    }
}

/// 非流式：上游 `{"data": {openai...}}` → 解包为 openai，`reasoning` → `reasoning_content`。
async fn cline_nonstream(upstream: reqwest::Response) -> Response<Body> {
    let v: Value = match upstream.json().await {
        Ok(v) => v,
        Err(e) => return err_resp(StatusCode::BAD_GATEWAY, &format!("cline 响应解析失败: {e}")),
    };
    let mut data = v.get("data").cloned().unwrap_or(v);
    if let Some(msg) = data.pointer_mut("/choices/0/message").and_then(Value::as_object_mut) {
        normalize_message(msg);
    }
    json_resp(data)
}

fn normalize_message(msg: &mut Map<String, Value>) {
    if let Some(r) = msg.remove("reasoning") {
        msg.insert("reasoning_content".into(), r);
    }
    if let Some(rd) = msg.get("reasoning_details").cloned() {
        if let Some(arr) = rd.as_array() {
            let txt: String = arr.iter().filter_map(|d| d.get("text").and_then(Value::as_str)).collect();
            if !txt.is_empty() && !msg.contains_key("reasoning_content") {
                msg.insert("reasoning_content".into(), json!(txt));
            }
        }
        msg.remove("reasoning_details");
    }
}

/// 流式：翻译上游 SSE，`delta.reasoning` → `reasoning_content`，补 `[DONE]`。
fn cline_stream(upstream: reqwest::Response) -> Response<Body> {
    let st = stream::unfold(
        (upstream.bytes_stream(), String::new(), false, false),
        move |(mut up, mut buf, mut eof, done)| async move {
            loop {
                if let Some(pos) = buf.find('\n') {
                    let line: String = buf.drain(..=pos).collect();
                    let lt = line.trim();
                    if lt == "data: [DONE]" {
                        return Some((
                            Ok(Frame::data(Bytes::from_static(b"data: [DONE]\n\n"))),
                            (up, buf, eof, true),
                        ));
                    }
                    if let Some(out) = cline_translate(lt) {
                        return Some((Ok(Frame::data(out)), (up, buf, eof, done)));
                    }
                    continue;
                }
                if eof {
                    let rest = std::mem::take(&mut buf);
                    if !rest.trim().is_empty() {
                        if let Some(out) = cline_translate(rest.trim()) {
                            return Some((Ok(Frame::data(out)), (up, buf, eof, done)));
                        }
                    }
                    if !done {
                        return Some((
                            Ok(Frame::data(Bytes::from_static(b"data: [DONE]\n\n"))),
                            (up, buf, eof, true),
                        ));
                    }
                    return None;
                }
                match up.next().await {
                    Some(Ok(c)) => buf.push_str(&String::from_utf8_lossy(&c)),
                    Some(Err(_)) => eof = true,
                    None => eof = true,
                }
            }
        },
    );
    Response::builder()
        .status(StatusCode::OK)
        .header("content-type", "text/event-stream")
        .header("cache-control", "no-cache")
        .header("connection", "keep-alive")
        .body(BodyExt::boxed(StreamBody::new(st)))
        .unwrap()
}

fn cline_translate(line: &str) -> Option<Bytes> {
    let payload = line.strip_prefix("data:")?.trim();
    if payload.is_empty() {
        return None;
    }
    if payload == "[DONE]" {
        return Some(Bytes::from_static(b"data: [DONE]\n\n"));
    }
    let mut v: Value = serde_json::from_str(payload).ok()?;
    if let Some(delta) = v.pointer_mut("/choices/0/delta").and_then(Value::as_object_mut) {
        if let Some(r) = delta.remove("reasoning") {
            delta.insert("reasoning_content".into(), r);
        }
        delta.remove("reasoning_details");
    }
    Some(Bytes::from(format!("data: {v}\n\n")))
}

// ═════════════════════════ 上游 B: command-code ═════════════════════════

async fn chat_commandcode(reqv: Value, model: String, stream: bool, cfg: Arc<Cfg>) -> Response<Body> {
    // 上游只认裸模型 ID（如 z-ai/glm-5.3-flash），必须剥掉 command-code/ 前缀，否则 403。
    let upstream_model = model.strip_prefix("command-code/").unwrap_or(&model).to_string();
    let sent = cfg
        .http
        .post(format!("{}/alpha/generate", cfg.cc_base))
        .header("authorization", format!("Bearer {}", cfg.cc_key))
        .header("content-type", "application/json")
        .header("accept", "application/json")
        .header("user-agent", UPSTREAM_UA)
        .header("x-command-code-version", UPSTREAM_VER)
        .header("x-session-id", session_id())
        .json(&build_cc_upstream(&upstream_model, &reqv))
        .send()
        .await;
    let upstream = match sent {
        Ok(r) => r,
        Err(e) => return err_resp(StatusCode::BAD_GATEWAY, &format!("上游不可达: {e}")),
    };
    let status = upstream.status();
    if !status.is_success() {
        let b = upstream.text().await.unwrap_or_default();
        return err_resp(
            StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::BAD_GATEWAY),
            &b,
        );
    }
    if stream {
        cc_stream(upstream, model)
    } else {
        cc_nonstream(upstream, model).await
    }
}

fn build_cc_upstream(model: &str, reqv: &Value) -> Value {
    let (mut system, mut messages) = (Vec::new(), Vec::new());
    if let Some(arr) = reqv.get("messages").and_then(Value::as_array) {
        for m in arr {
            let role = m.get("role").and_then(Value::as_str).unwrap_or("user");
            match role {
                "system" | "developer" => {
                    system.push(json!({ "type": "text", "text": content_text(m.get("content")) }));
                }
                // command-code 上游是 Anthropic schema：role 只接受 user/assistant，
                // 工具结果必须走 tool-result 块并回传 toolCallId/toolName，否则 400。
                "tool" => {
                    messages.push(json!({
                        "role": "user",
                        "content": [{
                            // 上游是 snake_case 联合类型：tool_result + tool_use_id，
                            // 且 content 必须是 string（传 array 会被拒）。
                            "type": "tool_result",
                            "tool_use_id": m.get("tool_call_id").and_then(Value::as_str).unwrap_or(""),
                            "content": content_text(m.get("content")),
                        }]
                    }));
                }
                "assistant" => {
                    let mut blocks: Vec<Value> = Vec::new();
                    let text = content_text(m.get("content"));
                    if !text.is_empty() {
                        blocks.push(json!({ "type": "text", "text": text }));
                    }
                    if let Some(tcs) = m.get("tool_calls").and_then(Value::as_array) {
                        for tc in tcs {
                            let f = tc.get("function");
                            let input = f
                                .and_then(|f| f.get("arguments"))
                                .and_then(Value::as_str)
                                .and_then(|s| serde_json::from_str::<Value>(s).ok())
                                .unwrap_or_else(|| json!({}));
                            blocks.push(json!({
                                "type": "tool_use",
                                "id": tc.get("id").and_then(Value::as_str).unwrap_or(""),
                                "name": f.and_then(|f| f.get("name")).and_then(Value::as_str).unwrap_or(""),
                                "input": input,
                            }));
                        }
                    }
                    messages.push(json!({ "role": "assistant", "content": blocks }));
                }
                _ => {
                    messages.push(json!({ "role": role, "content": cc_blocks(m.get("content")) }));
                }
            }
        }
    }
    json!({
        "config": {
            "workingDir": std::env::current_dir().map(|p| p.to_string_lossy().into_owned()).unwrap_or_else(|_| "/".into()),
            "date": chrono::Local::now().format("%Y-%m-%d").to_string(),
            "environment": std::env::consts::OS,
            "structure": [], "isGitRepo": false, "currentBranch": "", "mainBranch": "",
            "gitStatus": "", "recentCommits": []
        },
        "memory": "none", "taste": Value::Null, "skills": Value::Null,
        "permissionMode": "default",
        "threadId": uuid::Uuid::new_v4().to_string(),
        "mode": "agent", "promptCache": "off",
        "params": { "model": model, "messages": messages, "tools": [], "system": system }
    })
}

fn cc_stream(upstream: reqwest::Response, model: String) -> Response<Body> {
    let id = format!("chatcmpl-{}", uuid::Uuid::new_v4().simple());
    let created = chrono::Utc::now().timestamp();
    let st = stream::unfold(
        (upstream.bytes_stream(), String::new(), false, false, false),
        move |(mut up, mut buf, mut eof, mut role, done)| {
            let id = id.clone();
            let model = model.clone();
            async move {
                loop {
                    if let Some(pos) = buf.find('\n') {
                        let line: String = buf.drain(..=pos).collect();
                        if let Some(out) = cc_translate(line.trim(), &id, &model, created, &mut role) {
                            return Some((Ok(Frame::data(out)), (up, buf, eof, role, done)));
                        }
                        continue;
                    }
                    if eof {
                        let rest = std::mem::take(&mut buf);
                        if !rest.trim().is_empty() {
                            if let Some(out) = cc_translate(rest.trim(), &id, &model, created, &mut role) {
                                return Some((Ok(Frame::data(out)), (up, buf, eof, role, done)));
                            }
                        }
                        if !done {
                            return Some((
                                Ok(Frame::data(Bytes::from_static(b"data: [DONE]\n\n"))),
                                (up, buf, eof, role, true),
                            ));
                        }
                        return None;
                    }
                    match up.next().await {
                        Some(Ok(c)) => buf.push_str(&String::from_utf8_lossy(&c)),
                        Some(Err(_)) => eof = true,
                        None => eof = true,
                    }
                }
            }
        },
    );
    Response::builder()
        .status(StatusCode::OK)
        .header("content-type", "text/event-stream")
        .header("cache-control", "no-cache")
        .header("connection", "keep-alive")
        .body(BodyExt::boxed(StreamBody::new(st)))
        .unwrap()
}

fn cc_translate(line: &str, id: &str, model: &str, created: i64, role: &mut bool) -> Option<Bytes> {
    if line.is_empty() {
        return None;
    }
    let v: Value = serde_json::from_str(line).ok()?;
    match v.get("type").and_then(Value::as_str)? {
        "text-start" => {
            if *role {
                return None;
            }
            *role = true;
            Some(sse_chunk(id, model, created, json!({ "role": "assistant", "content": "" }), Value::Null, None))
        }
        "text-delta" => {
            let t = v.get("text").and_then(Value::as_str).unwrap_or("");
            (!t.is_empty()).then(|| sse_chunk(id, model, created, json!({ "content": t }), Value::Null, None))
        }
        "reasoning-delta" => {
            let t = v.get("text").and_then(Value::as_str).unwrap_or("");
            (!t.is_empty()).then(|| sse_chunk(id, model, created, json!({ "reasoning_content": t }), Value::Null, None))
        }
        "finish" => {
            let reason = normalize_reason(v.get("finishReason").and_then(Value::as_str));
            Some(sse_chunk(id, model, created, json!({}), json!(reason), v.get("totalUsage").cloned()))
        }
        _ => None,
    }
}

async fn cc_nonstream(upstream: reqwest::Response, model: String) -> Response<Body> {
    let mut up = upstream.bytes_stream();
    let (mut buf, mut content, mut reasoning) = (String::new(), String::new(), String::new());
    let mut finish = "stop".to_string();
    let mut usage = Value::Null;
    while let Some(chunk) = up.next().await {
        match chunk {
            Ok(c) => buf.push_str(&String::from_utf8_lossy(&c)),
            Err(_) => break,
        }
        while let Some(pos) = buf.find('\n') {
            let line: String = buf.drain(..=pos).collect();
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            if let Ok(v) = serde_json::from_str::<Value>(line) {
                match v.get("type").and_then(Value::as_str).unwrap_or("") {
                    "text-delta" => if let Some(t) = v.get("text").and_then(Value::as_str) { content.push_str(t) },
                    "reasoning-delta" => if let Some(t) = v.get("text").and_then(Value::as_str) { reasoning.push_str(t) },
                    "finish" => {
                        finish = normalize_reason(v.get("finishReason").and_then(Value::as_str)).to_string();
                        usage = v.get("totalUsage").cloned().unwrap_or(Value::Null);
                    }
                    _ => {}
                }
            }
        }
    }
    let usage_obj = cc_openai_usage(&usage);
    let mut msg = json!({ "role": "assistant", "content": content });
    if !reasoning.is_empty() {
        msg["reasoning_content"] = json!(reasoning);
    }
    json_resp(json!({
        "id": format!("chatcmpl-{}", uuid::Uuid::new_v4().simple()),
        "object": "chat.completion",
        "created": chrono::Utc::now().timestamp(),
        "model": model,
        "choices": [{ "index": 0, "message": msg, "finish_reason": finish }],
        "usage": usage_obj
    }))
}

// ─────────────────────────────── 工具 ───────────────────────────────

fn content_text(c: Option<&Value>) -> String {
    match c {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(a)) => a
            .iter()
            .filter_map(|p| p.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join(""),
        _ => String::new(),
    }
}

// OpenAI content parts → Anthropic blocks（保留 image_url，避免图片被静默丢弃）。
fn cc_blocks(c: Option<&Value>) -> Vec<Value> {
    match c {
        Some(Value::String(s)) => vec![json!({ "type": "text", "text": s })],
        Some(Value::Array(a)) => a
            .iter()
            .filter_map(|p| match p.get("type").and_then(Value::as_str) {
                Some("text") | None => {
                    p.get("text").and_then(Value::as_str).map(|t| json!({ "type": "text", "text": t }))
                }
                Some("image_url") => {
                    let u = p.pointer("/image_url/url")?.as_str()?;
                    Some(match u.split_once(";base64,") {
                        Some((head, b64)) => {
                            let mt = head.strip_prefix("data:").unwrap_or("image/png").trim_end_matches(";base64");
                            json!({ "type": "image", "source": { "type": "base64", "media_type": mt, "data": b64 } })
                        }
                        None => json!({ "type": "image", "source": { "type": "url", "url": u } }),
                    })
                }
                _ => None,
            })
            .collect(),
        _ => Vec::new(),
    }
}

fn sse_chunk(id: &str, model: &str, created: i64, delta: Value, finish: Value, usage: Option<Value>) -> Bytes {
    let mut obj = json!({
        "id": id, "object": "chat.completion.chunk", "created": created, "model": model,
        "choices": [{ "index": 0, "delta": delta, "finish_reason": finish }]
    });
    if let Some(u) = usage {
        obj["usage"] = cc_openai_usage(&u);
    }
    Bytes::from(format!("data: {obj}\n\n"))
}

/// Translates command-code's Anthropic-style `totalUsage` into the OpenAI
/// usage shape the engine understands.
///
/// Cache accounting used to be dropped here, which made the desktop usage panel
/// report a permanent 0% hit rate even when the upstream cached the prompt.
/// The upstream key names are not documented, so several plausible spellings
/// are accepted; the value is `0` when the upstream reports no cache at all.
fn cc_openai_usage(u: &Value) -> Value {
    let input = u.get("inputTokens").and_then(Value::as_i64).unwrap_or(0);
    let completion = u.get("outputTokens").and_then(Value::as_i64).unwrap_or(0);
    let cache_read = find_int(u, CACHE_READ_KEYS).unwrap_or(0);
    let cache_write = find_int(u, CACHE_WRITE_KEYS).unwrap_or(0);
    // The upstream speaks the Anthropic schema, where `input_tokens` excludes
    // the cached prefix. OpenAI's `prompt_tokens` includes it, so fold the
    // cached tokens back in and let the engine subtract them again.
    //
    // Self-check against the upstream's own total: if folding would push our
    // accounting past what the upstream says it billed, `inputTokens` already
    // includes the cache (OpenAI semantics) and folding would double-count.
    // In that case pass `inputTokens` through untouched and log loudly — the
    // assumption this function is built on has changed upstream.
    let upstream_total = u.get("totalTokens").and_then(Value::as_i64);
    let folded = input + cache_read + cache_write;
    let prompt = match upstream_total {
        Some(t) if t > 0 && folded + completion > t => {
            eprintln!(
                "[openpi-gateway] usage 自检不符：inputTokens={} + cache={}/{} 超出上游 totalTokens={}，\
                 按已含缓存处理（不再折叠）——上游语义可能变了，请人工对账",
                input, cache_read, cache_write, t
            );
            input
        }
        _ => folded,
    };
    let total = upstream_total.unwrap_or(prompt + completion);
    let mut usage = json!({
        "prompt_tokens": prompt,
        "completion_tokens": completion,
        "total_tokens": total
    });
    if cache_read > 0 || cache_write > 0 {
        usage["prompt_tokens_details"] = json!({
            "cached_tokens": cache_read,
            "cache_write_tokens": cache_write
        });
    }
    usage
}

const CACHE_READ_KEYS: [&str; 9] = [
    "cacheReadTokens",
    "cacheReadInputTokens",
    "cache_read_input_tokens",
    "cachedTokens",
    "cached_tokens",
    "cacheRead",
    "cache_read_tokens",
    "promptCacheReadTokens",
    "prompt_cache_read_tokens",
];

const CACHE_WRITE_KEYS: [&str; 9] = [
    "cacheCreationTokens",
    "cacheCreationInputTokens",
    "cache_creation_input_tokens",
    "cacheWriteTokens",
    "cache_write_tokens",
    "cachedCreationTokens",
    "cached_creation_tokens",
    "promptCacheWriteTokens",
    "prompt_cache_write_tokens",
];

/// First positive integer among `keys`, or a nested `prompt_tokens_details`.
fn find_int(u: &Value, keys: [&str; 9]) -> Option<i64> {
    for k in keys {
        if let Some(v) = u.get(k).and_then(Value::as_i64) {
            if v > 0 {
                return Some(v);
            }
        }
    }
    for k in keys {
        if let Some(v) = u.pointer(&format!("/prompt_tokens_details/{k}")).and_then(Value::as_i64) {
            if v > 0 {
                return Some(v);
            }
        }
    }
    None
}

fn normalize_reason(r: Option<&str>) -> &'static str {
    match r.unwrap_or("stop") {
        "length" => "length",
        "tool-calls" | "tool_calls" => "tool_calls",
        "content-filter" => "content_filter",
        _ => "stop",
    }
}

fn session_id() -> String {
    let ts = chrono::Utc::now().timestamp_millis();
    let r = uuid::Uuid::new_v4().simple().to_string();
    format!("{ts}_{}", &r[..5])
}

fn json_resp(v: Value) -> Response<Body> {
    Response::builder()
        .status(StatusCode::OK)
        .header("content-type", "application/json")
        .body(full(v.to_string()))
        .unwrap()
}

fn err_resp(code: StatusCode, msg: &str) -> Response<Body> {
    Response::builder()
        .status(code)
        .header("content-type", "application/json")
        .body(full(json!({ "error": { "message": msg, "type": "gateway_error" } }).to_string()))
        .unwrap()
}

fn full(b: impl Into<Bytes>) -> Body {
    Full::new(b.into()).map_err(|never| match never {}).boxed()
}

/// 合并两个上游的模型清单：command-code 静态(二进制权威表) + cline 动态(带缓存)。
async fn models_resp(cfg: &Cfg) -> Response<Body> {
    let mut ids: Vec<(String, &str)> = cc_model_ids()
        .into_iter()
        .map(|m| (m, "command-code"))
        .collect();
    for m in cline_model_ids(cfg).await {
        ids.push((m, "cline"));
    }
    json_resp(json!({
        "object": "list",
        "data": ids.iter().map(|(m, o)| json!({ "id": m, "object": "model", "created": 0, "owned_by": o })).collect::<Vec<_>>()
    }))
}

/// command-code 当前账户实测放行可用模型（61 个）。
fn cc_model_ids() -> Vec<String> {
    const IDS: &[&str] = &[
        "MiniMaxAI/MiniMax-M2.5",
        "MiniMaxAI/MiniMax-M2.7",
        "MiniMaxAI/MiniMax-M3",
        "Qwen/Qwen3.6-Max-Preview",
        "Qwen/Qwen3.6-Plus",
        "Qwen/Qwen3.7-Flash",
        "Qwen/Qwen3.7-Max",
        "Qwen/Qwen3.7-Plus",
        "Qwen/Qwen3.8-27B",
        "Qwen/Qwen3.8-Flash",
        "Qwen/Qwen3.8-Max",
        "Qwen/Qwen3.8-Max-0902",
        "Qwen/Qwen3.8-Omni-Flash",
        "claude-sonnet-5-5",
        "deepseek/deepseek-v4-flash",
        "deepseek/deepseek-v4-flash-fast",
        "deepseek/deepseek-v4-flash-vision-exp",
        "deepseek/deepseek-v4-pro",
        "deepseek/deepseek-v4.1-flash",
        "deepseek/deepseek-v4.1-flash-fast",
        "google/gemini-3.7-flash",
        "google/gemini-3.8-flash",
        "gpt-5.6-luna",
        "gpt-5.6-sol",
        "gpt-6-luna",
        "inclusionai/ling-3.0-flash-sante:free",
        "inclusionai/ling-3.1-flash:free",
        "meituan/LongCat-2.0",
        "meta/muse-spark-1.2",
        "meta/muse-spark-1.2-contributor",
        "meta/muse-spark-1.3",
        "meta/muse-spark-1.3-contributor",
        "moonshotai/Kimi-K2.5",
        "moonshotai/Kimi-K2.6",
        "moonshotai/Kimi-K2.7-Code",
        "moonshotai/Kimi-K2.7-Code-Highspeed",
        "moonshotai/Kimi-K3",
        "nvidia/nemotron-3-ultra-550b-a55b",
        "poolside/laguna-s-2.1-free",
        "stepfun/Step-3.5-Flash",
        "stepfun/Step-3.7-Flash",
        "stepfun/Step-5-Preview",
        "tencent/hy3-paid",
        "tencent/hy4-preview",
        "thinkingmachines/inkling",
        "thinkingmachines/inkling-small",
        "xai/grok-4.5",
        "xai/grok-4.6",
        "xai/grok-4.7",
        "xiaomi/mimo-v2.5",
        "xiaomi/mimo-v2.5-pro",
        "xiaomi/mimo-v2.6-flash",
        "xiaomi/mimo-v2.6-pro",
        "xiaomi/mimo-v2.6-pro-ultraspeed",
        "z-ai/glm-5.3-flash",
        "z-ai/glm-5.3-flashx",
        "zai-org/GLM-5",
        "zai-org/GLM-5.1",
        "zai-org/GLM-5.2",
        "zai-org/GLM-5.2-Fast",
        "zai-org/GLM-5.3",
    ];
    IDS.iter().map(|s| s.to_string()).collect()
}

/// cline 模型清单：动态拉取 `recommended/free/clinePass/clineCloud` 四组，失败回退内置表。
async fn cline_model_ids(cfg: &Cfg) -> Vec<String> {
    const FALLBACK: &[&str] = &[
        "cline-pass/deepseek-v4.1-flash",
        "cline-pass/mimo-v2.6-flash",
        "cline-pass/mimo-v2.6-pro",
        "cline-pass/glm-5.3",
        "cline-pass/glm-5.3-flash",
        "cline-pass/deepseek-v4-pro",
        "cline-pass/qwen3.8-max",
        "cline-pass/qwen3.7-plus",
        "cline-pass/qwen3.7-max",
        "cline-pass/kimi-k3",
        "cline-pass/minimax-m3",
        "cline-pass/mimo-v2.5-pro",
        "cline-pass/mimo-v2.5",
        "cline-pass/muse-spark-1.3-contributor",
        "cline-free/mimo-v2.6-flash",
        "cline-free/muse-spark-1.3-contributor",
        "stealth/space-bunny-alpha",
    ];
    let fallback = || FALLBACK.iter().map(|s| s.to_string()).collect::<Vec<_>>();

    let now = chrono::Utc::now().timestamp_millis();
    {
        let c = cfg.models_cache.lock().await;
        if let Some((exp, ids)) = c.as_ref() {
            if *exp > now {
                return ids.clone();
            }
        }
    }
    let token = match cline_token(cfg).await {
        Ok(t) => t,
        Err(_) => return fallback(),
    };
    let resp = cfg
        .http
        .get(format!("{}/ai/cline/recommended-models", cfg.cline_base))
        .header("authorization", format!("Bearer {token}"))
        .header("user-agent", CLINE_UA)
        .header("x-client-type", "cline-cli")
        .header("x-client-version", CLINE_VER)
        .header("x-platform", "cli")
        .header("x-is-multiroot", "false")
        .header("x-title", "Cline")
        .send()
        .await;
    let v: Value = match resp {
        Ok(r) => match r.json().await {
            Ok(v) => v,
            Err(_) => return fallback(),
        },
        Err(_) => return fallback(),
    };
    let mut ids = Vec::new();
    for key in ["recommended", "free", "clinePass", "clineCloud"] {
        if let Some(arr) = v.get(key).and_then(Value::as_array) {
            for m in arr {
                if let Some(id) = m.get("id").and_then(Value::as_str) {
                    // 仅保留**当前账户实测可用**的池子：
                    // recommended(anthropic/openai/spacexai/moonshotai) 需 Cline Credits，
                    // cline-cloud/* 返回 403 not supported → 均不列出，避免误导。
                    if id.starts_with("cline-pass/")
                        || id.starts_with("cline-free/")
                        || id.starts_with("stealth/")
                    {
                        ids.push(id.to_string());
                    }
                }
            }
        }
    }
    if ids.is_empty() {
        return fallback();
    }
    *cfg.models_cache.lock().await = Some((now + 300_000, ids.clone()));
    ids
}

#[cfg(test)]
mod cc_proto_tests {
    use super::*;

    #[test]
    fn tool_result_maps_to_upstream_snake_case_block() {
        let req = json!({ "messages": [
            { "role": "user", "content": "hi" },
            { "role": "assistant", "content": null, "tool_calls": [{
                "id": "call_1", "type": "function",
                "function": { "name": "bash", "arguments": "{\"command\":\"ls\"}" } }] },
            { "role": "tool", "tool_call_id": "call_1", "name": "bash", "content": "ok" }
        ]});
        let out = build_cc_upstream("m", &req);
        let msgs = out["params"]["messages"].as_array().unwrap();
        assert_eq!(msgs[1]["role"], "assistant");
        assert_eq!(msgs[1]["content"][0]["type"], "tool_use");
        assert_eq!(msgs[1]["content"][0]["id"], "call_1");
        assert_eq!(msgs[1]["content"][0]["input"]["command"], "ls");
        assert_eq!(msgs[2]["role"], "user", "tool 角色必须改写为 user");
        assert_eq!(msgs[2]["content"][0]["type"], "tool_result");
        assert_eq!(msgs[2]["content"][0]["tool_use_id"], "call_1");
        assert_eq!(msgs[2]["content"][0]["content"], "ok");
    }

    #[test]
    fn system_goes_to_top_level_and_roles_are_valid() {
        let req = json!({ "messages": [
            { "role": "system", "content": "S" },
            { "role": "user", "content": "u" }
        ]});
        let out = build_cc_upstream("m", &req);
        assert_eq!(out["params"]["system"][0]["text"], "S");
        for m in out["params"]["messages"].as_array().unwrap() {
            assert!(matches!(m["role"].as_str().unwrap(), "user" | "assistant"));
        }
    }

    #[test]
    fn image_parts_are_preserved() {
        let b = cc_blocks(Some(&json!([
            { "type": "text", "text": "t" },
            { "type": "image_url", "image_url": { "url": "https://x/y.png" } },
            { "type": "image_url", "image_url": { "url": "data:image/webp;base64,AAA" } }
        ])));
        assert_eq!(b[0]["type"], "text");
        assert_eq!(b[1]["source"]["type"], "url");
        assert_eq!(b[2]["source"]["media_type"], "image/webp");
        assert_eq!(b[2]["source"]["data"], "AAA");
    }
}

#[cfg(test)]
mod inbound_auth_tests {
    use super::authorize_header;

    const KEY: &str = "unit-test-key-0123456789";

    #[test]
    fn missing_header_is_rejected() {
        assert!(authorize_header(None, KEY).is_err());
    }

    #[test]
    fn malformed_scheme_is_rejected() {
        for bad in ["Basic YWJjOjEyMw==", "unit-test-key-0123456789", KEY, "Token abc", "Bearer"] {
            assert!(authorize_header(Some(bad), KEY).is_err(), "必须拒绝: {bad}");
        }
    }

    #[test]
    fn wrong_token_is_rejected() {
        for bad in ["Bearer wrong-key-000000000", "Bearer ", "Bearer x", "Bearer unit-test-key-012345678"] {
            assert!(authorize_header(Some(bad), KEY).is_err(), "必须拒绝: {bad}");
        }
    }

    #[test]
    fn correct_key_passes_case_insensitive_scheme() {
        for good in ["Bearer unit-test-key-0123456789", "bearer unit-test-key-0123456789"] {
            assert!(authorize_header(Some(good), KEY).is_ok(), "应放行: {good}");
        }
    }

    #[test]
    fn trailing_whitespace_is_tolerated() {
        assert!(authorize_header(Some("Bearer  unit-test-key-0123456789 "), KEY).is_ok());
    }
}

#[cfg(test)]
mod cc_usage_tests {
    use super::cc_openai_usage;
    use serde_json::json;

    #[test]
    fn cache_fields_are_forwarded() {
        let u = cc_openai_usage(&json!({
            "inputTokens": 1200, "outputTokens": 40, "totalTokens": 5317,
            "cacheReadInputTokens": 4077, "cacheCreationInputTokens": 0
        }));
        assert_eq!(u["prompt_tokens"], 5277);
        assert_eq!(u["completion_tokens"], 40);
        assert_eq!(u["total_tokens"], 5317);
        assert_eq!(u["prompt_tokens_details"]["cached_tokens"], 4077);
    }

    #[test]
    fn camel_case_and_nested_spellings_are_accepted() {
        let camel = cc_openai_usage(&json!({ "inputTokens": 10, "outputTokens": 1, "cacheReadTokens": 900 }));
        assert_eq!(camel["prompt_tokens_details"]["cached_tokens"], 900);
        assert_eq!(camel["prompt_tokens"], 910);

        let nested = cc_openai_usage(&json!({
            "inputTokens": 10, "outputTokens": 1,
            "prompt_tokens_details": { "cached_tokens": 500, "cache_write_tokens": 64 }
        }));
        assert_eq!(nested["prompt_tokens_details"]["cached_tokens"], 500);
        assert_eq!(nested["prompt_tokens_details"]["cache_write_tokens"], 64);
    }

    #[test]
    fn no_cache_fields_keeps_the_old_payload() {
        let u = cc_openai_usage(&json!({ "inputTokens": 100, "outputTokens": 5, "totalTokens": 105 }));
        assert_eq!(u, json!({ "prompt_tokens": 100, "completion_tokens": 5, "total_tokens": 105 }));
        assert!(u.get("prompt_tokens_details").is_none());
    }

    #[test]
    fn zero_cache_counts_are_treated_as_absent() {
        let u = cc_openai_usage(&json!({ "inputTokens": 7, "outputTokens": 1, "cacheReadTokens": 0 }));
        assert_eq!(u["prompt_tokens"], 7);
        assert!(u.get("prompt_tokens_details").is_none());
    }
}

#[cfg(test)]
mod bind_guard_tests {
    use super::is_loopback_bind;

    #[test]
    fn plain_loopback_forms_are_recognized() {
        for good in ["127.0.0.1:8788", "localhost:8788", "127.0.0.54:8788", "[::1]:8788"] {
            assert!(is_loopback_bind(good), "应视为回环: {good}");
        }
    }

    #[test]
    fn wildcard_and_public_binds_are_not_loopback() {
        // The trap this test pins: `":8788"` parses as 0.0.0.0 (all interfaces),
        // so an empty host must count as NON-loopback.
        for bad in [":8788", "8788", "0.0.0.0:8788", "[::]:8788", "192.168.1.10:8788", "lan.local:8788"] {
            assert!(!is_loopback_bind(bad), "不得视为回环: {bad}");
        }
    }
}

#[cfg(test)]
mod cc_usage_fold_guard_tests {
    use super::cc_openai_usage;
    use serde_json::json;

    #[test]
    fn folding_is_skipped_when_upstream_already_includes_the_cache() {
        // OpenAI-style upstream: totalTokens = inputTokens(incl. cache) + output.
        // Folding on top of that would exceed the upstream's own accounting.
        let u = cc_openai_usage(&json!({
            "inputTokens": 1000, "outputTokens": 40, "totalTokens": 1040,
            "cached_tokens": 768
        }));
        assert_eq!(u["prompt_tokens"], 1000, "input already includes the cache");
        assert_eq!(u["total_tokens"], 1040);
        assert_eq!(u["prompt_tokens_details"]["cached_tokens"], 768);

        // Anthropic-style upstream (the documented assumption): the fold fits.
        let ok = cc_openai_usage(&json!({
            "inputTokens": 232, "outputTokens": 40, "totalTokens": 5317,
            "cacheReadInputTokens": 4077
        }));
        assert_eq!(ok["prompt_tokens"], 4309);
        assert_eq!(ok["total_tokens"], 5317);
    }

    #[test]
    fn no_total_tokens_falls_back_to_the_documented_assumption() {
        let u = cc_openai_usage(&json!({ "inputTokens": 10, "outputTokens": 1, "cacheReadTokens": 900 }));
        assert_eq!(u["prompt_tokens"], 910);
    }
}
