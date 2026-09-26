use openpi_daemon::{run_ipc_server, Supervisor};
use openpi_scheduler::Scheduler;
use openpi_storage::Storage;
use serde_json::{json, Value};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;

// A child inherits the first process's stdout so its reader finishes *after* the
// replacement is running. The fake RPC endpoint also leaves prompt outstanding
// until abort, matching the real single-connection deadlock scenario.
const FAKE_RPC: &str = r#"
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
const marker = path.join(process.env.OPENPI_DIR, 'first-spawn');
if (!fs.existsSync(marker)) {
  fs.writeFileSync(marker, '1');
  spawn(process.execPath, ['-e', 'setTimeout(() => {}, 1200)'], {
    stdio: ['ignore', process.stdout, 'ignore']
  }).unref();
}
const send = (id, data) => process.stdout.write(JSON.stringify({ type: 'response', id, success: true, data }) + '\n');
let promptId;
readline.createInterface({ input: process.stdin }).on('line', line => {
  const cmd = JSON.parse(line);
  if (cmd.type === 'prompt') {
    promptId = cmd.id;
    process.stdout.write(JSON.stringify({ type: 'prompt_started' }) + '\n');
  } else if (cmd.type === 'abort') {
    send(cmd.id, 'aborted');
    if (promptId) send(promptId, 'prompt finished');
  } else if (cmd.type === 'wait') {
    setTimeout(() => send(cmd.id, 'still alive'), 1500);
  } else {
    send(cmd.id, 'pong');
  }
});
"#;

async fn response(reader: &mut BufReader<tokio::net::unix::OwnedReadHalf>, id: &str) -> Value {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let mut line = String::new();
            assert!(reader.read_line(&mut line).await.unwrap() > 0, "socket closed");
            let msg: Value = serde_json::from_str(&line).unwrap();
            if msg["id"] == id {
                return msg;
            }
        }
    })
    .await
    .expect("response timed out")
}

async fn send(writer: &mut tokio::net::unix::OwnedWriteHalf, request: Value) {
    writer.write_all(format!("{request}\n").as_bytes()).await.unwrap();
}

#[tokio::test]
async fn abort_and_old_stdout_do_not_block_or_reset_new_process() {
    let dir = std::env::temp_dir().join(format!("openpi-daemon-concurrency-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let script = dir.join("rpc.cjs");
    std::fs::write(&script, FAKE_RPC).unwrap();
    std::env::set_var("OPENPI_DIR", &dir);
    std::env::set_var("OPENPI_PI_RPC_ENTRY", &script);

    let socket = std::env::current_dir().unwrap().join(format!("op-{}.sock", &uuid::Uuid::new_v4().to_string()[..8]));
    let socket_str = socket.to_string_lossy().to_string();
    let storage = Storage::in_memory().unwrap();
    let scheduler = Scheduler::new(storage.clone());
    let supervisor = Supervisor::new();
    let server = tokio::spawn({
        let supervisor = supervisor.clone();
        async move {
            run_ipc_server(&socket_str, supervisor, storage, scheduler, "unused".into()).await
        }
    });
    for _ in 0..500 {
        if socket.exists() { break; }
        if server.is_finished() { panic!("IPC server exited: {:?}", server.await); }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert!(socket.exists(), "IPC server did not bind");
    let stream = UnixStream::connect(&socket).await.unwrap();
    let (reader, mut writer) = stream.into_split();
    let mut reader = BufReader::new(reader);
    send(&mut writer, json!({"id":"create","type":"create_session","cwd":dir,"inMemory":true})).await;
    let created = response(&mut reader, "create").await;
    assert_eq!(created["ok"], true, "{created}");
    let sid = created["data"]["sessionId"].as_str().unwrap();

    send(&mut writer, json!({"id":"prompt","type":"rpc","sessionId":sid,"command":{"type":"prompt"}})).await;
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let mut line = String::new();
            reader.read_line(&mut line).await.unwrap();
            let msg: Value = serde_json::from_str(&line).unwrap();
            if msg["event"]["type"] == "prompt_started" { break; }
        }
    }).await.expect("prompt did not start");
    send(&mut writer, json!({"id":"abort","type":"rpc","sessionId":sid,"command":{"type":"abort"}})).await;
    let abort = tokio::time::timeout(Duration::from_secs(2), response(&mut reader, "abort")).await.expect("abort blocked behind prompt");
    assert_eq!(abort["data"], "aborted");

    send(&mut writer, json!({"id":"stop","type":"stop_session","sessionId":sid})).await;
    assert_eq!(response(&mut reader, "stop").await["ok"], true);
    send(&mut writer, json!({"id":"wait","type":"rpc","sessionId":sid,"command":{"type":"wait"}})).await;
    assert_eq!(response(&mut reader, "wait").await["data"], "still alive", "old stdout cleared the new process's pending RPC");
    assert_eq!(supervisor.get_session(sid).await.unwrap().running, true);
    send(&mut writer, json!({"id":"ping","type":"rpc","sessionId":sid,"command":{"type":"ping"}})).await;
    assert_eq!(response(&mut reader, "ping").await["data"], "pong");
    supervisor.stop_session(sid).await.unwrap();
    server.abort();
    std::fs::remove_file(socket).unwrap();
    std::fs::remove_dir_all(dir).unwrap();
}
