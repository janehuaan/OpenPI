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

    // 事件生产者：把真实系统信号（文件 / Git / 心跳）灌入事件总线
    let bus = supervisor.event_bus.clone();
    let supervisor_for_events = supervisor.clone();
    tokio::spawn(async move {
        openpi_daemon::producers::spawn_all(bus, supervisor_for_events);
    });

    // 主动服务循环：消费事件 → 决策 → 卡片 / 晨报 / 经网关执行
    let supervisor_for_proactive = supervisor.clone();
    let storage_for_proactive = storage.clone();
    tokio::spawn(async move {
        openpi_daemon::run_proactive_loop(supervisor_for_proactive, storage_for_proactive).await;
    });

    // 统一执行网关的真实分发器：把「个人层主动执行」穿透到执行核心。
    // 只读、受超时约束；返回真实 token 消耗供预算 Meter 核销。
    let dispatcher_supervisor = supervisor.clone();
    let dispatcher: openpi_daemon::gateway::Dispatcher =
        std::sync::Arc::new(move |req: openpi_daemon::gateway::PersonalExecutionRequest| {
            let sup = dispatcher_supervisor.clone();
            Box::pin(async move {
                let cwd = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
                let timeout_secs = (req.constraint.timeout_ms / 1000).max(10);
                let text = sup
                    .run_ephemeral_subagent(&req.context, "proactive-agent", &cwd, timeout_secs)
                    .await
                    .map_err(|e| e.to_string())?;
                Ok((text.len() / 4) as u64)
            })
        });
    supervisor.gateway.set_dispatcher(dispatcher);

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
