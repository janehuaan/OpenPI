pub mod types;
pub mod engine;
pub mod pillars;
pub mod coordinator;
pub mod dreamer;

pub use coordinator::{EngineStatus, JevCoordinator};
pub use types::*;
pub use engine::LocalVerdictEngine;
pub use dreamer::{DiscoveryTree, DreamerEngine, ParetoEvaluator, ReplaySimulator};

pub fn init() {
    tracing::info!("openpi-jev library initialized");
}
