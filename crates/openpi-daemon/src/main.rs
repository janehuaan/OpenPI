use tracing::info;
use openpi_daemon::{run_ipc_server, Supervisor};
use openpi_scheduler::Scheduler;
use openpi_storage::Storage;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    if std::env::var("RUST_LOG").is_err() {
        std::env::set_var("RUST_LOG", "info");
    }
    tracing_subscriber::fmt::init();

    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    let socket_path = std::env::var("OPENPI_SOCKET_PATH")
        .unwrap_or_else(|_| format!("{}/.openpi/openpi.sock", home));

    let db_path = std::env::var("OPENPI_DB_PATH")
        .unwrap_or_else(|_| format!("{}/.openpi/openpi.db", home));

    let engine_mode = "native-rust";

    let pi_cli_path = std::env::var("OPENPI_PI_CLI_PATH").unwrap_or_default();

    info!("Starting OpenPI Daemon (Rust Native)");
    info!("Engine Mode: {}", engine_mode);
    info!("Socket: {}", socket_path);
    info!("Database: {}", db_path);

    let storage = Storage::open(&db_path)?;
    let scheduler = Scheduler::new(storage.clone());
    let supervisor = Supervisor::new();
    let cloud = openpi_daemon::CloudSync::new(storage.clone());

    // Spawn cloud sync background loop (no-op until the renderer pushes a token)
    let cloud_for_loop = cloud.clone();
    tokio::spawn(async move {
        openpi_daemon::run_cloud_sync_loop(cloud_for_loop).await;
    });

    // LAN link for the paired phone (off unless lanEnabled; never fatal)
    let supervisor_for_lan = supervisor.clone();
    let storage_for_lan = storage.clone();
    tokio::spawn(async move {
        openpi_daemon::lan::serve(supervisor_for_lan, storage_for_lan).await;
    });

    // Spawn scheduler background loop
    let scheduler_clone = scheduler.clone();
    let supervisor_for_sched = supervisor.clone();
    let storage_clone = storage.clone();
    let pi_cli_clone = pi_cli_path.clone();
    tokio::spawn(async move {
        openpi_daemon::run_scheduler_loop(
            scheduler_clone,
            supervisor_for_sched,
            storage_clone,
            pi_cli_clone,
        ).await;
    });

    let supervisor_clone = supervisor.clone();
    tokio::spawn(async move {
        if let Ok(()) = tokio::signal::ctrl_c().await {
            info!("Received termination signal (Ctrl-C), cleanly reaping all managed session subprocesses...");
            supervisor_clone.shutdown_all().await;
            std::process::exit(0);
        }
    });

    // Reconcile and consolidate long-term memories at daemon startup
    tokio::spawn(async {
        if let Err(e) = openpi_engine::memory_worker::reconcile_all_session_memories() {
            tracing::warn!("Failed to reconcile session memories at startup: {:?}", e);
        }
    });

    run_ipc_server(&socket_path, supervisor, storage, scheduler, pi_cli_path, cloud).await?;

    Ok(())
}
