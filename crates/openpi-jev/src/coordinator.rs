use std::sync::Arc;
use tokio::sync::RwLock;
use crate::engine::onnx::LocalVerdictEngine;
use crate::pillars::{
    LeakHunter, LoopBreaker, OutputCompressor, SafetyGate, SemanticRouter, StopDecider,
};
use crate::types::{CompressedOutput, GateVerdict, LeakScanResult, LoopAnalysis, RouteDecision, StopVerdict};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EngineStatus {
    WarmingUp,
    Ready,
    Degraded,
}

pub struct JevCoordinator {
    engine: Arc<RwLock<Option<Arc<LocalVerdictEngine>>>>,
    status: Arc<RwLock<EngineStatus>>,
    router: SemanticRouter,
    gate: SafetyGate,
    compressor: OutputCompressor,
    loop_breaker: Arc<RwLock<LoopBreaker>>,
    leak_hunter: LeakHunter,
    stop_decider: StopDecider,
}

impl Default for JevCoordinator {
    fn default() -> Self {
        Self::new()
    }
}

impl JevCoordinator {
    pub fn new() -> Self {
        Self {
            engine: Arc::new(RwLock::new(None)),
            status: Arc::new(RwLock::new(EngineStatus::Ready)),
            router: SemanticRouter::new(),
            gate: SafetyGate::new(),
            compressor: OutputCompressor::default(),
            loop_breaker: Arc::new(RwLock::new(LoopBreaker::default())),
            leak_hunter: LeakHunter::new(),
            stop_decider: StopDecider::new(),
        }
    }

    /// Background asynchronous warmup (Zero-lag cold start)
    /// Only warm up local neural model if explicitly requested via OPENPI_WARMUP_LOCAL_MODEL=1
    pub fn spawn_async_warmup(&self) {
        let should_warmup = std::env::var("OPENPI_WARMUP_LOCAL_MODEL")
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false);

        if !should_warmup {
            tracing::info!("💡 [JevCoordinator] 本地深度学习模型处于按需待命模式 (0 内存开销，按需懒加载)");
            return;
        }

        let engine_holder = self.engine.clone();
        let status_holder = self.status.clone();

        tokio::spawn(async move {
            tracing::info!("⏳ [JevCoordinator] 开始在后台异步预热 ModernBERT 引擎...");
            let start = std::time::Instant::now();

            match tokio::task::spawn_blocking(LocalVerdictEngine::try_load_default).await {
                Ok(Ok(engine)) => {
                    let mut lock = engine_holder.write().await;
                    *lock = Some(Arc::new(engine));
                    let mut s = status_holder.write().await;
                    *s = EngineStatus::Ready;
                    tracing::info!("✅ [JevCoordinator] Jev 神经引擎后台预热完毕！耗时: {:?}", start.elapsed());
                }
                Ok(Err(err)) => {
                    let mut s = status_holder.write().await;
                    *s = EngineStatus::Degraded;
                    tracing::warn!("⚠️ [JevCoordinator] 未找到本地模型或加载失败，自动回退到极速规则预筛模式: {:?}", err);
                }
                Err(panic_err) => {
                    let mut s = status_holder.write().await;
                    *s = EngineStatus::Degraded;
                    tracing::error!("❌ [JevCoordinator] 异步预热任务异常: {:?}", panic_err);
                }
            }
        });
    }

    /// Lazy-loads the local neural engine on demand if needed
    pub async fn ensure_engine(&self) -> anyhow::Result<Arc<LocalVerdictEngine>> {
        {
            let lock = self.engine.read().await;
            if let Some(ref engine) = *lock {
                return Ok(engine.clone());
            }
        }

        let mut lock = self.engine.write().await;
        if let Some(ref engine) = *lock {
            return Ok(engine.clone());
        }

        let engine = tokio::task::spawn_blocking(LocalVerdictEngine::try_load_default)
            .await
            .map_err(|e| anyhow::anyhow!("Task spawn failed: {:?}", e))??;

        let arc_engine = Arc::new(engine);
        *lock = Some(arc_engine.clone());
        tracing::info!("✅ [JevCoordinator] 本地神经引擎按需加载成功！");
        Ok(arc_engine)
    }

    pub async fn is_engine_loaded(&self) -> bool {
        self.engine.read().await.is_some()
    }

    pub async fn status(&self) -> EngineStatus {
        *self.status.read().await
    }

    // Pillar 1: Router
    pub fn route_prompt(&self, prompt: &str, has_workspace: bool) -> RouteDecision {
        self.router.route(prompt, has_workspace)
    }

    // Pillar 2: Pre-Execution Gate
    pub fn pre_check_command(&self, cmd: &str) -> GateVerdict {
        self.gate.inspect_command(cmd)
    }

    // Pillar 3 & 5: Compress & Leak Scan
    pub fn process_command_output(&self, raw_output: &str) -> (CompressedOutput, LeakScanResult) {
        // Step 1: Scan & Mask credentials
        let leak_res = self.leak_hunter.scan_and_sanitize(raw_output);
        // Step 2: Compress output
        let comp_res = self.compressor.compress(&leak_res.sanitized_text);
        (comp_res, leak_res)
    }

    // Pillar 4: Loop Breaker
    pub async fn record_command_result(&self, cmd: &str, is_success: bool, output: &str) -> Option<LoopAnalysis> {
        let mut breaker = self.loop_breaker.write().await;
        Some(breaker.record_execution(cmd, output, !is_success))
    }

    // Pillar 6: Stop Decider
    pub fn evaluate_task_completion(&self, goal: &str, cmd: &str, output: &str, successes: usize) -> StopVerdict {
        self.stop_decider.evaluate_progress(goal, cmd, output, successes)
    }
}
