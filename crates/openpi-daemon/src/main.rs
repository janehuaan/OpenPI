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

    let engine_mode = if Supervisor::use_native_engine() {
        "native-rust"
    } else {
        "node-fallback"
    };

    let pi_cli_path = std::env::var("OPENPI_PI_CLI_PATH").unwrap_or_default();

    info!("Starting OpenPI Daemon (Rust Native)");
    info!("Engine Mode: {}", engine_mode);
    info!("Socket: {}", socket_path);
    info!("Database: {}", db_path);

    let storage = Storage::open(&db_path)?;
    let scheduler = Scheduler::new(storage.clone());
    let supervisor = Supervisor::new();

    let supervisor_clone = supervisor.clone();
    tokio::spawn(async move {
        if let Ok(()) = tokio::signal::ctrl_c().await {
            info!("Received termination signal (Ctrl-C), cleanly reaping all managed session subprocesses...");
            supervisor_clone.shutdown_all().await;
            std::process::exit(0);
        }
    });

    run_ipc_server(&socket_path, supervisor, storage, scheduler, pi_cli_path).await?;

    Ok(())
}
