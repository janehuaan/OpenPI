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
use hyper::{Method, Request, Response, StatusCode};
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
    let listener = TcpListener::bind(&cfg.bind).await?;
    eprintln!(
        "[openpi-gateway] listening http://{}  | command-code={}  cline={}",
        cfg.bind, cfg.cc_base, cfg.cline_base
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
    })
}

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
    let resp = match (req.method(), req.uri().path()) {
        (&Method::GET, "/health") => json_resp(json!({
            "status": "ok",
            "upstreams": { "command-code": cfg.cc_base, "cline": cfg.cline_base }
        })),
        (&Method::GET, "/v1/models") => models_resp(&cfg).await,
        (&Method::POST, "/v1/chat/completions") => chat(req, cfg).await,
        _ => err_resp(StatusCode::NOT_FOUND, "not found"),
    };
    Ok(resp)
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
    let prompt = usage.get("inputTokens").and_then(Value::as_i64).unwrap_or(0);
    let completion = usage.get("outputTokens").and_then(Value::as_i64).unwrap_or(0);
    let total = usage.get("totalTokens").and_then(Value::as_i64).unwrap_or(prompt + completion);
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
        "usage": { "prompt_tokens": prompt, "completion_tokens": completion, "total_tokens": total }
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
        let p = u.get("inputTokens").and_then(Value::as_i64).unwrap_or(0);
        let c = u.get("outputTokens").and_then(Value::as_i64).unwrap_or(0);
        let t = u.get("totalTokens").and_then(Value::as_i64).unwrap_or(p + c);
        obj["usage"] = json!({ "prompt_tokens": p, "completion_tokens": c, "total_tokens": t });
    }
    Bytes::from(format!("data: {obj}\n\n"))
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

/// command-code 当前账户**实测可用**模型（30 个中 16 个）。
/// 剔除：google/gemini-* 全系(需 Pro+)、meta/muse-spark-1.1~1.3(需 Pro/GOAT)、
/// xai/grok-4.6~4.7(需 GOAT)、minimax/*-free(已下架)、openai/gpt-5.6(不在计划)。
fn cc_model_ids() -> Vec<String> {
    const IDS: &[&str] = &[
        "deepseek/deepseek-v4-flash",
        "deepseek/deepseek-v4-flash-fast",
        "deepseek/deepseek-v4-flash-vision-exp",
        "deepseek/deepseek-v4-pro",
        "deepseek/deepseek-v4.1-flash",
        "deepseek/deepseek-v4.1-flash-fast",
        "meta/muse-spark-1.2-contributor",
        "meta/muse-spark-1.3-contributor",
        "moonshotai/Kimi-K2.5",
        "moonshotai/Kimi-K2.6",
        "moonshotai/Kimi-K2.7-Code",
        "moonshotai/Kimi-K2.7-Code-Highspeed",
        "moonshotai/Kimi-K3",
        "xai/grok-4.5",
        "z-ai/glm-5.3-flash",
        "z-ai/glm-5.3-flashx",
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
