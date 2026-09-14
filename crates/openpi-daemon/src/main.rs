use std::path::PathBuf;
use tracing::info;
use openpi_daemon::{run_ipc_server, Supervisor};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();

    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    let socket_path = std::env::var("OPENPI_SOCKET_PATH")
        .unwrap_or_else(|_| format!("{}/.openpi/openpi.sock", home));

    let pi_cli_path = std::env::var("OPENPI_PI_CLI_PATH").unwrap_or_else(|_| {
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
    info!("Pi CLI: {}", pi_cli_path);

    let supervisor = Supervisor::new();
    run_ipc_server(&socket_path, supervisor, pi_cli_path).await?;

    Ok(())
}
