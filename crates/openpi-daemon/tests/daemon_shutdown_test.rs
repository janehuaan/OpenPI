//! Regression test for the deploy path: a shutdown must not depend on the client
//! staying connected.
//!
//! `scripts/install-daemon.sh` sends `shutdown` and hangs up immediately. The
//! read loop then ends and runs `requests.abort_all()`, which used to cancel the
//! spawned shutdown handler before it reached `process::exit` — so the daemon
//! (and the old binary) kept running while the script printed
//! "asked the running daemon to restart". A deploy that silently does nothing is
//! worse than one that fails loudly, so this drives the real binary end to end.

use std::process::Stdio;
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use tokio::net::UnixStream;

#[tokio::test]
async fn shutdown_survives_the_client_hanging_up_immediately() {
    // Keep the directory name short: the socket lives inside it and macOS caps a
    // unix socket path at SUN_LEN (104 bytes), which a full temp-dir + uuid name
    // blows past.
    let tmp = std::env::temp_dir().join(format!("opi{}", uuid::Uuid::new_v4().simple()));
    std::fs::create_dir_all(&tmp).unwrap();
    let sock = tmp.join("s.sock");

    let mut child = tokio::process::Command::new(env!("CARGO_BIN_EXE_openpi-daemon"))
        .env("OPENPI_DIR", &tmp)
        .env("OPENPI_SOCKET_PATH", &sock)
        .env("OPENPI_DB_PATH", tmp.join("openpi.db"))
        .env("RUST_LOG", "error")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        // Inherited so a startup failure explains itself instead of surfacing as
        // a bare timeout.
        .stderr(Stdio::inherit())
        .kill_on_drop(true)
        .spawn()
        .expect("spawn openpi-daemon");

    for _ in 0..100 {
        if sock.exists() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    if !sock.exists() {
        match child.try_wait() {
            Ok(Some(status)) => panic!("daemon exited early with {status} before listening"),
            Ok(None) => panic!("daemon is running but never created its socket"),
            Err(e) => panic!("could not check the daemon: {e}"),
        }
    }

    // Exactly what scripts/install-daemon.sh does: send, then hang up without
    // reading the reply.
    {
        let mut stream = UnixStream::connect(&sock).await.expect("connect to socket");
        stream
            .write_all(b"{\"type\":\"shutdown\",\"id\":\"deploy\"}\n")
            .await
            .unwrap();
        stream.flush().await.unwrap();
    }

    match tokio::time::timeout(Duration::from_secs(10), child.wait()).await {
        Ok(status) => {
            let status = status.expect("wait for the daemon");
            assert!(status.success(), "daemon exited with {status}");
        }
        Err(_) => {
            let _ = child.kill().await;
            panic!("daemon ignored the shutdown request and kept running");
        }
    }
}
