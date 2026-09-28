use std::sync::{Arc, RwLock as StdRwLock};
use tokio::sync::RwLock;
use crate::engine::onnx::LocalVerdictEngine;
use crate::pillars::{
    LeakHunter, LoopBreaker, OutputCompressor, SafetyGate, SemanticRouter, StopDecider,
};
use crate::types::{
    BlockRecord, CompressedOutput, DreamRecord, GateVerdict, JevTelemetry, LeakScanResult,
    LoopAnalysis, RouteDecision, StopVerdict,
};
use crate::dreamer::{DiscoveryTree, DreamerEngine, ParetoMetrics, SessionTreeParser};

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
    dreamer: Arc<DreamerEngine>,
    parser: Arc<SessionTreeParser>,
    optimal_beta: Arc<RwLock<f64>>,
    contextual_betas: Arc<RwLock<std::collections::HashMap<String, f64>>>,
    tree_cache: Arc<RwLock<std::collections::HashMap<std::path::PathBuf, (std::time::SystemTime, DiscoveryTree)>>>,
    last_dream_metrics: Arc<RwLock<Option<ParetoMetrics>>>,
    telemetry: Arc<StdRwLock<JevTelemetry>>,
    telemetry_path: std::path::PathBuf,
}

impl Default for JevCoordinator {
    fn default() -> Self {
        Self::new()
    }
}

impl JevCoordinator {
    pub fn new() -> Self {
        let telemetry_path = std::env::var("OPENPI_DIR")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|_| {
                std::env::var("HOME")
                    .map(|h| std::path::PathBuf::from(h).join(".openpi"))
                    .unwrap_or_else(|_| std::path::PathBuf::from(".openpi"))
            })
            .join("jev_telemetry.json");

        let initial_telemetry = Self::load_telemetry(&telemetry_path);

        Self {
            engine: Arc::new(RwLock::new(None)),
            status: Arc::new(RwLock::new(EngineStatus::Ready)),
            router: SemanticRouter::new(),
            gate: SafetyGate::new(),
            compressor: OutputCompressor::default(),
            loop_breaker: Arc::new(RwLock::new(LoopBreaker::default())),
            leak_hunter: LeakHunter::new(),
            stop_decider: StopDecider::new(),
            dreamer: Arc::new(DreamerEngine::new(4)),
            parser: Arc::new(SessionTreeParser::new()),
            optimal_beta: Arc::new(RwLock::new(0.2)),
            contextual_betas: Arc::new(RwLock::new(std::collections::HashMap::new())),
            tree_cache: Arc::new(RwLock::new(std::collections::HashMap::new())),
            last_dream_metrics: Arc::new(RwLock::new(None)),
            telemetry: Arc::new(StdRwLock::new(initial_telemetry)),
            telemetry_path,
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

    fn now_millis() -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0)
    }

    fn load_telemetry(path: &std::path::Path) -> JevTelemetry {
        if path.exists() {
            if let Ok(content) = std::fs::read_to_string(path) {
                if let Ok(data) = serde_json::from_str::<JevTelemetry>(&content) {
                    return data;
                }
            }
        }

        let mut initial = JevTelemetry::default();
        if let Some(parent) = path.parent() {
            let err_log = parent.join("daemon.err.log");
            if err_log.exists() {
                if let Ok(log_content) = std::fs::read_to_string(&err_log) {
                    for line in log_content.lines() {
                        if line.contains("[Jev LoopBreaker]") && line.contains("Circuit breaker tripped") {
                            initial.loop_breaks += 1;
                            initial.blocked_commands += 1;
                            let cmd = if let Some(start) = line.find('`') {
                                if let Some(end) = line[start + 1..].find('`') {
                                    line[start + 1..start + 1 + end].to_string()
                                } else {
                                    line.to_string()
                                }
                            } else {
                                "repetitive command".to_string()
                            };
                            initial.recent_blocks.push(BlockRecord {
                                timestamp: Self::now_millis(),
                                command: cmd,
                                action: "loop_break".to_string(),
                                reason: "连续重复执行相同指令无新进展，触发死循环熔断".to_string(),
                                risk: 0.95,
                            });
                        } else if line.contains("[Jev Compressor]") && line.contains("saved ~") {
                            if let Some(start) = line.find("saved ~") {
                                let rest = &line[start + 7..];
                                if let Some(end) = rest.find(" tokens") {
                                    if let Ok(num) = rest[..end].parse::<usize>() {
                                        initial.estimated_tokens_saved += num;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        initial
    }

    fn persist_telemetry(&self) {
        let path = self.telemetry_path.clone();
        let data = match self.telemetry.read() {
            Ok(guard) => guard.clone(),
            Err(_) => return,
        };
        if let Ok(rt) = tokio::runtime::Handle::try_current() {
            rt.spawn(async move {
                if let Some(parent) = path.parent() {
                    let _ = tokio::fs::create_dir_all(parent).await;
                }
                if let Ok(json_str) = serde_json::to_string_pretty(&data) {
                    let _ = tokio::fs::write(&path, json_str).await;
                }
            });
        } else {
            if let Some(parent) = path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            if let Ok(json_str) = serde_json::to_string_pretty(&data) {
                let _ = std::fs::write(&path, json_str);
            }
        }
    }

    pub fn get_telemetry(&self) -> JevTelemetry {
        self.telemetry.read().map(|g| g.clone()).unwrap_or_default()
    }

    pub fn record_external_event(&self, event_type: &str, cmd: &str, reason: &str, risk: f32) {
        if let Ok(mut t) = self.telemetry.write() {
            match event_type {
                "loop_break" => {
                    t.loop_breaks += 1;
                    t.blocked_commands += 1;
                    t.recent_blocks.insert(0, BlockRecord {
                        timestamp: Self::now_millis(),
                        command: cmd.to_string(),
                        action: "loop_break".to_string(),
                        reason: reason.to_string(),
                        risk,
                    });
                }
                "user_rejected" => {
                    t.blocked_commands += 1;
                    t.recent_blocks.insert(0, BlockRecord {
                        timestamp: Self::now_millis(),
                        command: cmd.to_string(),
                        action: "user_rejected".to_string(),
                        reason: reason.to_string(),
                        risk,
                    });
                }
                "user_approved" => {
                    t.user_confirmed_commands += 1;
                    t.recent_blocks.insert(0, BlockRecord {
                        timestamp: Self::now_millis(),
                        command: cmd.to_string(),
                        action: "user_approved".to_string(),
                        reason: reason.to_string(),
                        risk,
                    });
                }
                _ => {
                    t.recent_blocks.insert(0, BlockRecord {
                        timestamp: Self::now_millis(),
                        command: cmd.to_string(),
                        action: event_type.to_string(),
                        reason: reason.to_string(),
                        risk,
                    });
                }
            }
            if t.recent_blocks.len() > 100 {
                t.recent_blocks.truncate(100);
            }
        }
        self.persist_telemetry();
    }

    pub fn clear_block_records(&self) {
        if let Ok(mut t) = self.telemetry.write() {
            t.recent_blocks.clear();
        }
        self.persist_telemetry();
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
        let verdict = self.gate.inspect_command(cmd);
        match &verdict {
            GateVerdict::Deny { reason } => {
                if let Ok(mut t) = self.telemetry.write() {
                    t.blocked_commands += 1;
                    t.recent_blocks.insert(
                        0,
                        BlockRecord {
                            timestamp: Self::now_millis(),
                            command: cmd.to_string(),
                            action: "deny".to_string(),
                            reason: reason.clone(),
                            risk: 1.0,
                        },
                    );
                    if t.recent_blocks.len() > 100 {
                        t.recent_blocks.truncate(100);
                    }
                }
                self.persist_telemetry();
            }
            GateVerdict::RequireConfirmation { prompt: _, reasons, risk_score } => {
                if let Ok(mut t) = self.telemetry.write() {
                    t.user_confirmed_commands += 1;
                    t.recent_blocks.insert(
                        0,
                        BlockRecord {
                            timestamp: Self::now_millis(),
                            command: cmd.to_string(),
                            action: "require_confirmation".to_string(),
                            reason: reasons.join("; "),
                            risk: *risk_score,
                        },
                    );
                    if t.recent_blocks.len() > 100 {
                        t.recent_blocks.truncate(100);
                    }
                }
                self.persist_telemetry();
            }
            GateVerdict::ModifyCommand { safe_command, reason } => {
                if let Ok(mut t) = self.telemetry.write() {
                    t.auto_patched_commands += 1;
                    t.recent_blocks.insert(
                        0,
                        BlockRecord {
                            timestamp: Self::now_millis(),
                            command: format!("{} ➔ {}", cmd, safe_command),
                            action: "modify_command".to_string(),
                            reason: reason.clone(),
                            risk: 0.5,
                        },
                    );
                    if t.recent_blocks.len() > 100 {
                        t.recent_blocks.truncate(100);
                    }
                }
                self.persist_telemetry();
            }
            _ => {}
        }
        verdict
    }

    pub fn pre_check_file_path(&self, file_path: &str) -> GateVerdict {
        let verdict = self.gate.inspect_file_path(file_path);
        match &verdict {
            GateVerdict::Deny { reason } => {
                if let Ok(mut t) = self.telemetry.write() {
                    t.blocked_commands += 1;
                    t.recent_blocks.insert(
                        0,
                        BlockRecord {
                            timestamp: Self::now_millis(),
                            command: format!("write/edit ➔ {}", file_path),
                            action: "deny".to_string(),
                            reason: reason.clone(),
                            risk: 1.0,
                        },
                    );
                    if t.recent_blocks.len() > 100 {
                        t.recent_blocks.truncate(100);
                    }
                }
                self.persist_telemetry();
            }
            GateVerdict::RequireConfirmation { prompt: _, reasons, risk_score } => {
                if let Ok(mut t) = self.telemetry.write() {
                    t.user_confirmed_commands += 1;
                    t.recent_blocks.insert(
                        0,
                        BlockRecord {
                            timestamp: Self::now_millis(),
                            command: format!("write/edit ➔ {}", file_path),
                            action: "require_confirmation".to_string(),
                            reason: reasons.join("; "),
                            risk: *risk_score,
                        },
                    );
                    if t.recent_blocks.len() > 100 {
                        t.recent_blocks.truncate(100);
                    }
                }
                self.persist_telemetry();
            }
            _ => {}
        }
        verdict
    }

    // Pillar 3 & 5: Compress & Leak Scan
    pub fn process_command_output(&self, raw_output: &str) -> (CompressedOutput, LeakScanResult) {
        // Step 1: Scan & Mask credentials
        let leak_res = self.leak_hunter.scan_and_sanitize(raw_output);
        // Step 2: Compress output
        let comp_res = self.compressor.compress(&leak_res.sanitized_text);

        let mut changed = false;
        if leak_res.has_leaks || comp_res.was_compressed {
            if let Ok(mut t) = self.telemetry.write() {
                if leak_res.has_leaks {
                    t.secrets_redacted += leak_res.leak_count;
                    changed = true;
                }
                if comp_res.was_compressed {
                    t.estimated_tokens_saved += comp_res.estimated_tokens_saved;
                    changed = true;
                }
            }
        }
        if changed {
            self.persist_telemetry();
        }

        (comp_res, leak_res)
    }

    // Pillar 4: Loop Breaker
    pub async fn record_command_result(&self, cmd: &str, is_success: bool, output: &str) -> Option<LoopAnalysis> {
        let mut breaker = self.loop_breaker.write().await;
        let analysis = breaker.record_execution(cmd, output, !is_success);
        if analysis.should_break {
            if let Ok(mut t) = self.telemetry.write() {
                t.loop_breaks += 1;
                t.blocked_commands += 1;
                t.recent_blocks.insert(
                    0,
                    BlockRecord {
                        timestamp: Self::now_millis(),
                        command: cmd.to_string(),
                        action: "loop_break".to_string(),
                        reason: analysis.corrective_hint.clone().unwrap_or_else(|| "连续重复失败触发熔断".to_string()),
                        risk: 0.95,
                    },
                );
                if t.recent_blocks.len() > 100 {
                    t.recent_blocks.truncate(100);
                }
            }
            self.persist_telemetry();
        }
        Some(analysis)
    }

    // Pillar 6: Stop Decider
    pub fn evaluate_task_completion(&self, goal: &str, cmd: &str, output: &str, successes: usize) -> StopVerdict {
        self.stop_decider.evaluate_progress(goal, cmd, output, successes)
    }

    // Pillar 7: Dream-RSI (Recursive Self-Improvement through Evolving Worlds)
    pub async fn trigger_offline_dreaming(&self, sessions_dir: &std::path::Path) -> anyhow::Result<serde_json::Value> {
        let mut session_files = Vec::new();
        let mut scan_dirs = vec![sessions_dir.to_path_buf()];
        if let Some(parent) = sessions_dir.parent() {
            let agent_sessions = parent.join("agent").join("sessions");
            if agent_sessions.exists() {
                scan_dirs.push(agent_sessions);
            }
        }

        for dir in scan_dirs {
            let mut stack = vec![dir];
            while let Some(current) = stack.pop() {
                if let Ok(entries) = std::fs::read_dir(current) {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        if path.is_dir() {
                            stack.push(path);
                        } else if path.extension().and_then(|s| s.to_str()) == Some("jsonl") {
                            session_files.push(path);
                        }
                    }
                }
            }
        }

        if session_files.is_empty() {
            return Ok(serde_json::json!({
                "status": "skipped",
                "message": "No session jsonl files found in directory",
                "sessions_evaluated": 0,
            }));
        }

        // Sort sessions by modified time descending (freshest sessions first)
        session_files.sort_by(|a, b| {
            let mtime_a = std::fs::metadata(a).and_then(|m| m.modified()).unwrap_or(std::time::SystemTime::UNIX_EPOCH);
            let mtime_b = std::fs::metadata(b).and_then(|m| m.modified()).unwrap_or(std::time::SystemTime::UNIX_EPOCH);
            mtime_b.cmp(&mtime_a)
        });

        // LRU Cap: prioritize Top 15 most recent sessions so dreaming stays instantaneous
        if session_files.len() > 15 {
            session_files.truncate(15);
        }

        let mut total_nodes = 0;
        let mut total_churn = 0;
        let mut best_overall_beta = *self.optimal_beta.read().await;
        let mut highest_reward = f64::NEG_INFINITY;
        let mut last_best_metrics = None;
        let mut evaluated_sessions = 0;
        let mut parsed_trees = Vec::new();
        let mut cache_hits = 0;
        let mut cache_misses = 0;

        for session_path in &session_files {
            let mtime = std::fs::metadata(session_path)
                .and_then(|m| m.modified())
                .unwrap_or(std::time::SystemTime::UNIX_EPOCH);

            // 1. 尝试从增量会话缓存中命中，避免重复从磁盘读入和正则解析
            let cached_tree = {
                let cache = self.tree_cache.read().await;
                if let Some((cached_mtime, tree)) = cache.get(session_path) {
                    if *cached_mtime == mtime {
                        Some(tree.clone())
                    } else {
                        None
                    }
                } else {
                    None
                }
            };

            let tree = match cached_tree {
                Some(t) => {
                    cache_hits += 1;
                    t
                }
                None => {
                    if let Ok(t) = self.parser.parse_openpi_session_file(session_path) {
                        cache_misses += 1;
                        let mut cache = self.tree_cache.write().await;
                        cache.insert(session_path.clone(), (mtime, t.clone()));
                        t
                    } else {
                        continue;
                    }
                }
            };

            let count = tree.total_probes();
            if count > 0 {
                total_nodes += count;
                evaluated_sessions += 1;
                // 使用黄金分割连续寻优获得高精度全局最优 Beta*
                let (best_beta, metrics) = self.dreamer.find_optimal_beta_golden_section(&tree, 0.02, 15);
                total_churn += metrics.total_churn;
                if metrics.pareto_reward > highest_reward {
                    highest_reward = metrics.pareto_reward;
                    best_overall_beta = best_beta;
                    last_best_metrics = Some(metrics);
                }
                parsed_trees.push(tree);
            }
        }

        // 计算情境化分层 Beta*（按 TaskContext 聚类）
        let contextual_results = self.dreamer.sweep_contextual_betas(&parsed_trees);
        let mut contextual_betas_map = std::collections::HashMap::new();
        for (ctx, (beta, _)) in contextual_results {
            contextual_betas_map.insert(ctx.as_str().to_string(), beta);
        }

        *self.optimal_beta.write().await = best_overall_beta;
        *self.contextual_betas.write().await = contextual_betas_map.clone();
        *self.last_dream_metrics.write().await = last_best_metrics.clone();

        // 闭环反哺：自适应调节运行时各组件耐受策略
        self.adapt_runtime_policies(best_overall_beta).await;

        let dream_record = DreamRecord {
            timestamp: Self::now_millis(),
            sessions_evaluated: evaluated_sessions,
            total_nodes,
            optimal_beta: best_overall_beta,
            pareto_reward: if highest_reward.is_finite() { highest_reward } else { 0.0 },
            decision_rounds: last_best_metrics.as_ref().map(|m| m.decision_rounds).unwrap_or(0),
            parallelism_efficiency: last_best_metrics.as_ref().map(|m| m.parallelism_efficiency).unwrap_or(1.0),
            discovery_quality: last_best_metrics.as_ref().map(|m| m.discovery_quality).unwrap_or(0.0),
            total_churn,
            counterfactual_speedup: last_best_metrics.as_ref().map(|m| m.counterfactual_speedup).unwrap_or(1.0),
            contextual_betas: contextual_betas_map.clone(),
        };

        if let Ok(mut t) = self.telemetry.write() {
            t.recent_dreams.insert(0, dream_record);
            if t.recent_dreams.len() > 50 {
                t.recent_dreams.truncate(50);
            }
        }
        self.persist_telemetry();

        tracing::info!(
            "🌌 [JevCoordinator] 离线做梦回放完成！已评估 {} 个历史会话 (缓存命中: {}/{} 会话)，最优探索 Beta* = {:.4}, 情境分层: {:?}",
            evaluated_sessions,
            cache_hits,
            cache_hits + cache_misses,
            best_overall_beta,
            contextual_betas_map
        );

        Ok(serde_json::json!({
            "status": "success",
            "sessions_evaluated": evaluated_sessions,
            "cache_hits": cache_hits,
            "cache_misses": cache_misses,
            "total_nodes_replayed": total_nodes,
            "optimal_beta": best_overall_beta,
            "contextual_betas": contextual_betas_map,
            "latest_metrics": last_best_metrics,
        }))
    }

    pub async fn optimal_beta(&self) -> f64 {
        *self.optimal_beta.read().await
    }

    pub async fn contextual_beta(&self, context: &str) -> f64 {
        let lock = self.contextual_betas.read().await;
        if let Some(&b) = lock.get(context) {
            b
        } else {
            *self.optimal_beta.read().await
        }
    }

    /// 运行时闭环自适应策略同步：根据 Beta* 动态调节熔断器阈值与耐受度
    pub async fn adapt_runtime_policies(&self, beta: f64) {
        let mut breaker = self.loop_breaker.write().await;
        breaker.adapt_threshold(beta);
        tracing::info!(
            "🔄 [JevCoordinator] 运行时组件已自适应同步 Beta*={:.4}, LoopBreaker 熔断阈值更新为: {}",
            beta,
            breaker.current_threshold()
        );
    }

    pub async fn loop_breaker_threshold(&self) -> usize {
        let breaker = self.loop_breaker.read().await;
        breaker.current_threshold()
    }

    pub async fn dreamer_status(&self) -> serde_json::Value {
        let beta = *self.optimal_beta.read().await;
        let metrics = self.last_dream_metrics.read().await.clone();
        let contextual = self.contextual_betas.read().await.clone();
        let threshold = self.loop_breaker_threshold().await;
        serde_json::json!({
            "enabled": true,
            "optimal_beta": beta,
            "contextual_betas": contextual,
            "loop_breaker_threshold": threshold,
            "last_metrics": metrics,
        })
    }
}
