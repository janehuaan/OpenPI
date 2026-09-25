pub mod types;
pub mod engine;
pub mod pillars;
pub mod coordinator;

pub use coordinator::{EngineStatus, JevCoordinator};
pub use types::*;
pub use engine::LocalVerdictEngine;

pub fn init() {
    tracing::info!("openpi-jev library initialized");
}
