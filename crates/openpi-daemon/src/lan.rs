//! LAN WebSocket link.
//!
//! Lets a paired phone on the same network watch a session live and drive it, so
//! the phone is not limited to whatever the 60s cloud sync has caught up with.
//! The phone's Rust side connects here (the WebView cannot: it would be a cleartext
//! ws:// from an https origin) and re-emits these events to its UI.
//!
//! Off unless `lanEnabled` is set in app_settings.json; even then a connection must
//! pair with a short-lived code first, because a prompt runs code on this machine.

use std::collections::HashSet;
use std::time::Duration;

use anyhow::{anyhow, Result};
use futures_util::{SinkExt, StreamExt};
use openpi_storage::Storage;
use serde_json::{json, Value};
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::tungstenite::Message;
use tracing::{info, warn};

use crate::supervisor::{openpi_dir, Supervisor};

const DEFAULT_PORT: u16 = 8765;
const PAIR_TTL_SECS: i64 = 300;
/// Events are flushed on this cadence; a token stream arrives far faster than the
/// UI needs, and batching keeps one frame per tick instead of one per token.
const BATCH_MS: u64 = 200;
const KV_CODE: &str = "lan:pairing";
const KV_DEVICES: &str = "lan:devices";

fn settings() -> (bool, u16) {
	let path = openpi_dir().join("agent").join("app_settings.json");
	let value: Value = std::fs::read_to_string(path)
		.ok()
		.and_then(|content| serde_json::from_str(&content).ok())
		.unwrap_or_else(|| json!({}));
	let enabled = value.get("lanEnabled").and_then(|v| v.as_bool()).unwrap_or(false);
	let port = value.get("lanPort").and_then(|v| v.as_u64()).unwrap_or(DEFAULT_PORT as u64) as u16;
	(enabled, port)
}

/// Turns the link on in app_settings.json. Takes effect on the next daemon start,
/// which is also when the pairing screen shows up.
pub fn enable_in_settings() -> Result<()> {
	let path = openpi_dir().join("agent").join("app_settings.json");
	let mut value: Value = std::fs::read_to_string(&path)
		.ok()
		.and_then(|content| serde_json::from_str(&content).ok())
		.unwrap_or_else(|| json!({}));
	if let Some(object) = value.as_object_mut() {
		object.insert("lanEnabled".to_string(), json!(true));
		object.entry("lanPort".to_string()).or_insert_with(|| json!(DEFAULT_PORT));
	}
	if let Some(parent) = path.parent() {
		let _ = std::fs::create_dir_all(parent);
	}
	std::fs::write(&path, serde_json::to_string_pretty(&value)?)?;
	Ok(())
}

/// Issues a fresh pairing code (valid for five minutes) and returns it.
pub fn begin_pairing(storage: &Storage) -> Result<Value> {
	let code = format!("{:06}", rand_below(1_000_000));
	let expires = chrono::Utc::now().timestamp() + PAIR_TTL_SECS;
	let payload = json!({ "code": code, "expires": expires });
	storage.set_kv(KV_CODE, &payload.to_string())?;
	Ok(json!({ "code": code, "expiresInSec": PAIR_TTL_SECS }))
}

/// Drops every paired device and any pending code.
pub fn revoke_devices(storage: &Storage) -> Result<()> {
	storage.set_kv(KV_DEVICES, "[]")?;
	storage.set_kv(KV_CODE, "")?;
	Ok(())
}

pub fn pairing_status(storage: &Storage) -> Value {
	let (enabled, port) = settings();
	let devices: Vec<String> = devices(storage);
	let code = storage
		.get_kv(KV_CODE)
		.ok()
		.flatten()
		.filter(|s| !s.is_empty())
		.and_then(|s| serde_json::from_str::<Value>(&s).ok())
		.and_then(|v| v.get("code").and_then(|c| c.as_str()).map(|c| c.to_string()));
	json!({ "enabled": enabled, "port": port, "pairedDevices": devices.len(), "code": code })
}

fn devices(storage: &Storage) -> Vec<String> {
	storage
		.get_kv(KV_DEVICES)
		.ok()
		.flatten()
		.and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok())
		.unwrap_or_default()
}

fn rand_below(max: u32) -> u32 {
	// No extra dependency for this: nanoseconds make a fine short-lived code seed.
	use std::time::{SystemTime, UNIX_EPOCH};
	let nanos = SystemTime::now()
		.duration_since(UNIX_EPOCH)
		.map(|d| d.subsec_nanos())
		.unwrap_or(0);
	nanos % max.max(1)
}

/// Serves the LAN link until the process ends. Disabled by default; a bind failure
/// is logged and ignored so it can never keep the daemon from starting.
pub async fn serve(supervisor: Supervisor, storage: Storage) {
	let (enabled, port) = settings();
	if !enabled {
		info!("LAN link disabled (set lanEnabled in app_settings.json to enable)");
		return;
	}
	let listener = match TcpListener::bind(("0.0.0.0", port)).await {
		Ok(listener) => listener,
		Err(e) => {
			warn!("LAN link could not bind 0.0.0.0:{}: {}", port, e);
			return;
		}
	};
	info!("LAN link listening on 0.0.0.0:{}", port);

	loop {
		let Ok((stream, peer)) = listener.accept().await else {
			continue;
		};
		let supervisor = supervisor.clone();
		let storage = storage.clone();
		tokio::spawn(async move {
			if let Err(e) = handle_client(stream, supervisor, storage).await {
				warn!("LAN client {} closed: {}", peer, e);
			}
		});
	}
}

async fn handle_client(stream: TcpStream, supervisor: Supervisor, storage: Storage) -> Result<()> {
	let ws = tokio_tungstenite::accept_async(stream)
		.await
		.map_err(|e| anyhow!("handshake: {e}"))?;
	let (mut sink, mut source) = ws.split();

	// ---- pair (required, within 5s) ----
	let first = tokio::time::timeout(Duration::from_secs(5), source.next()).await;
	let frame = match first {
		Ok(Some(Ok(Message::Text(text)))) => serde_json::from_str::<Value>(&text).unwrap_or_else(|_| json!({})),
		_ => return Err(anyhow!("no pairing frame")),
	};
	let Some(token) = authorize(&storage, &frame) else {
		let _ = sink
			.send(Message::Text(json!({ "type": "error", "error": "bad_code" }).to_string().into()))
			.await;
		return Err(anyhow!("pairing rejected"));
	};
	sink.send(Message::Text(json!({ "type": "paired", "token": token }).to_string().into()))
		.await?;

	// ---- requests + live events ----
	let mut events = supervisor.subscribe_events();
	let mut watched: HashSet<String> = HashSet::new();
	let mut batch: Vec<Value> = Vec::new();
	let mut ticker = tokio::time::interval(Duration::from_millis(BATCH_MS));

	loop {
		tokio::select! {
			incoming = source.next() => {
				let Some(Ok(message)) = incoming else { return Ok(()) };
				let Message::Text(text) = message else { continue };
				let request: Value = match serde_json::from_str(&text) { Ok(v) => v, Err(_) => continue };
				let id = request.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
				let kind = request.get("type").and_then(|v| v.as_str()).unwrap_or("");

				let reply = match kind {
					"lan_ping" => Ok(json!({ "pong": true })),
					"lan_watch" => {
						let sid = request.get("sessionId").and_then(|v| v.as_str()).unwrap_or("").to_string();
						if sid.is_empty() {
							Err("sessionId required".to_string())
						} else {
							watched.insert(sid);
							Ok(json!({ "watching": true }))
						}
					}
					"lan_prompt" | "lan_abort" => {
						let sid = request.get("sessionId").and_then(|v| v.as_str()).unwrap_or("").to_string();
						if sid.is_empty() {
							Err("sessionId required".to_string())
						} else if crate::supervisor::find_session_file(&sid).exists() {
							let command = if kind == "lan_prompt" {
								json!({ "type": "prompt", "text": request.get("text").and_then(|v| v.as_str()).unwrap_or("") })
							} else {
								json!({ "type": "abort" })
							};
							match supervisor.send_rpc(&sid, &command).await {
								Ok(data) => Ok(data),
								Err(e) => Err(e.to_string()),
							}
						} else {
							// send_rpc would spin up a process for a made-up id and still
							// report success, which reads to the phone as "sent" when
							// nothing ever ran. A session the phone can see always has a
							// transcript, so that is the gate.
							Err(format!("unknown session: {sid}"))
						}
					}
					_ => Err(format!("unknown request: {}", kind)),
				};

				let frame = match reply {
					Ok(data) => json!({ "id": id, "ok": true, "data": data }),
					Err(error) => json!({ "id": id, "ok": false, "error": error }),
				};
				sink.send(Message::Text(frame.to_string().into())).await?;
			}

			event = events.recv() => {
				if let Ok((session_id, value)) = event {
					if watched.contains(&session_id) {
						// Each entry carries its own session so a batch can mix them.
						batch.push(json!({ "sessionId": session_id, "event": value }));
					}
				}
			}

			_ = ticker.tick() => {
				if !batch.is_empty() {
					let frame = json!({ "type": "lan_events", "events": batch });
					sink.send(Message::Text(frame.to_string().into())).await?;
					batch = Vec::new();
				}
			}
		}
	}
}

/// Accepts either a fresh pairing code or an already-issued device token.
fn authorize(storage: &Storage, frame: &Value) -> Option<String> {
	if let Some(token) = frame.get("token").and_then(|v| v.as_str()) {
		if devices(storage).iter().any(|known| known == token) {
			return Some(token.to_string());
		}
	}
	let code = frame.get("code").and_then(|v| v.as_str())?;
	let entry: Value = storage
		.get_kv(KV_CODE)
		.ok()
		.flatten()
		.and_then(|s| serde_json::from_str(&s).ok())?;
	let expected = entry.get("code").and_then(|v| v.as_str())?;
	let expires = entry.get("expires").and_then(|v| v.as_i64()).unwrap_or(0);
	if expected != code || chrono::Utc::now().timestamp() > expires {
		return None;
	}
	let token = uuid::Uuid::new_v4().to_string();
	let mut known = devices(storage);
	known.push(token.clone());
	let _ = storage.set_kv(KV_DEVICES, &serde_json::to_string(&known).unwrap_or_default());
	let _ = storage.set_kv(KV_CODE, ""); // the code is one-shot
	Some(token)
}
