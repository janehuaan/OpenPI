use std::path::PathBuf;
use tracing::info;
use openpi_daemon::{run_ipc_server, Supervisor};
use openpi_scheduler::Scheduler;
use openpi_storage::Storage;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();

    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    let socket_path = std::env::var("OPENPI_SOCKET_PATH")
        .unwrap_or_else(|_| format!("{}/.openpi/openpi.sock", home));

    let db_path = std::env::var("OPENPI_DB_PATH")
        .unwrap_or_else(|_| format!("{}/.openpi/openpi.db", home));

    let pi_cli_path = std::env::var("OPENPI_PI_CLI_PATH").unwrap_or_else(|_| {
        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                let packaged_cli = dir.join("node_modules/@earendil-works/pi-coding-agent/dist/cli.js");
                if packaged_cli.exists() {
                    return packaged_cli.to_string_lossy().to_string();
                }
            }
        }
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let default_cli = manifest_dir
            .parent()
            .and_then(|p| p.parent())
            .map(|root| root.join("node_modules/@earendil-works/pi-coding-agent/dist/cli.js"))
            .unwrap_or_else(|| PathBuf::from("node_modules/@earendil-works/pi-coding-agent/dist/cli.js"));
        default_cli.to_string_lossy().to_string()
    });

    info!("Starting OpenPI Daemon (Rust)");
    info!("Socket: {}", socket_path);
    info!("Database: {}", db_path);
    info!("Pi CLI: {}", pi_cli_path);

    let storage = Storage::open(&db_path)?;
    let scheduler = Scheduler::new(storage.clone());
    let supervisor = Supervisor::new();

    run_ipc_server(&socket_path, supervisor, storage, scheduler, pi_cli_path).await?;

    Ok(())
}
