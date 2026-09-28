pub mod types;
pub mod tree;
pub mod simulator;
pub mod scheduler;
pub mod evaluator;
pub mod parser;

pub use types::*;
pub use tree::DiscoveryTree;
pub use simulator::ReplaySimulator;
pub use scheduler::DynamicPortfolioScheduler;
pub use evaluator::{ParetoEvaluator, ParetoMetrics};
pub use parser::SessionTreeParser;

/// 顶层做梦引擎：协调模拟器、调度器与评估器完成离线自我演化闭环
pub struct DreamerEngine {
    pub max_parallelism: usize,
    pub evaluator: ParetoEvaluator,
}

impl Default for DreamerEngine {
    fn default() -> Self {
        Self {
            max_parallelism: 4,
            evaluator: ParetoEvaluator::default(),
        }
    }
}

impl DreamerEngine {
    pub fn new(max_parallelism: usize) -> Self {
        Self {
            max_parallelism,
            evaluator: ParetoEvaluator::default(),
        }
    }

    /// 在给定的历史发现树上进行离线做梦回放，评估指定 beta 超参数策略的表现
    ///
    /// 纯内存执行，0 Token 开销，0 沙箱执行耗时！
    pub fn dream_and_evaluate(&self, tree: &DiscoveryTree, beta: f64) -> ParetoMetrics {
        let mut sim = ReplaySimulator::new(tree.clone(), self.max_parallelism);
        let mut scheduler = DynamicPortfolioScheduler::new(beta, self.max_parallelism);

        while !sim.is_exhausted() {
            let batch = scheduler.select_batch(&sim);
            if batch.is_empty() {
                break; // 触发提前止损结题
            }

            if sim.probe_batch(&batch).is_err() {
                break;
            }
        }

        self.evaluator.evaluate(&sim)
    }

    /// 黄金分割连续参数寻优（Golden Section Search）：
    /// 在 [0.0, 1.0] 连续区间上寻找使 Pareto 奖励最大的连续 Beta*。
    /// 纯内存执行，通常 12~15 次迭代即可达到 0.001 级精度（耗时 < 1ms）。
    pub fn find_optimal_beta_golden_section(
        &self,
        tree: &DiscoveryTree,
        tol: f64,
        max_iter: usize,
    ) -> (f64, ParetoMetrics) {
        let inv_phi = 0.618033988749895; // (sqrt(5) - 1) / 2
        let inv_phi2 = 0.381966011250105; // 1 - inv_phi

        let mut a = 0.0;
        let mut b = 1.0;

        let mut c = a + inv_phi2 * (b - a);
        let mut d = a + inv_phi * (b - a);

        let mut metrics_c = self.dream_and_evaluate(tree, c);
        let mut metrics_d = self.dream_and_evaluate(tree, d);

        // 跟踪搜索过程中遭遇到的全局最高奖励
        let mut best_beta = c;
        let mut best_metrics = metrics_c.clone();
        if metrics_d.pareto_reward > best_metrics.pareto_reward {
            best_beta = d;
            best_metrics = metrics_d.clone();
        }

        // 包含边界点 0.0 和 1.0 的显式核算，保证全局收敛
        let m_0 = self.dream_and_evaluate(tree, 0.0);
        if m_0.pareto_reward > best_metrics.pareto_reward {
            best_beta = 0.0;
            best_metrics = m_0;
        }
        let m_1 = self.dream_and_evaluate(tree, 1.0);
        if m_1.pareto_reward > best_metrics.pareto_reward {
            best_beta = 1.0;
            best_metrics = m_1;
        }

        for _ in 0..max_iter {
            if (b - a) < tol {
                break;
            }

            if metrics_c.pareto_reward > metrics_d.pareto_reward {
                b = d;
                d = c;
                metrics_d = metrics_c;
                c = a + inv_phi2 * (b - a);
                metrics_c = self.dream_and_evaluate(tree, c);
            } else {
                a = c;
                c = d;
                metrics_c = metrics_d;
                d = a + inv_phi * (b - a);
                metrics_d = self.dream_and_evaluate(tree, d);
            }

            if metrics_c.pareto_reward > best_metrics.pareto_reward {
                best_beta = c;
                best_metrics = metrics_c.clone();
            }
            if metrics_d.pareto_reward > best_metrics.pareto_reward {
                best_beta = d;
                best_metrics = metrics_d.clone();
            }
        }

        (best_beta, best_metrics)
    }

    /// 超参数做梦网格与连续混合搜索：
    /// 结合离散候选与黄金分割连续寻优，严格获取 Pareto 最优解
    pub fn sweep_best_beta(&self, tree: &DiscoveryTree, candidate_betas: &[f64]) -> (f64, ParetoMetrics) {
        // 先运行黄金分割连续寻优获得高精度基准
        let (mut best_beta, mut best_metrics) = self.find_optimal_beta_golden_section(tree, 0.02, 15);

        // 如果用户提供了指定的离散 candidate_betas，也一同纳入比对
        for &beta in candidate_betas {
            let metrics = self.dream_and_evaluate(tree, beta);
            if metrics.pareto_reward > best_metrics.pareto_reward {
                best_metrics = metrics;
                best_beta = beta;
            }
        }

        (best_beta, best_metrics)
    }

    /// 情境化分层做梦（Contextual Beta Optimization）：
    /// 按照 TaskContext 对树进行分组，为每个情境独立计算最优 Beta*
    pub fn sweep_contextual_betas(
        &self,
        trees: &[DiscoveryTree],
    ) -> std::collections::HashMap<TaskContext, (f64, ParetoMetrics)> {
        use std::collections::HashMap;
        let mut groups: HashMap<TaskContext, Vec<&DiscoveryTree>> = HashMap::new();
        for tree in trees {
            groups.entry(tree.context).or_default().push(tree);
        }

        let mut results = HashMap::new();
        for (context, group_trees) in groups {
            if group_trees.is_empty() {
                continue;
            }
            let (best_beta, best_metrics) = self.optimize_beta_for_trees(&group_trees);
            results.insert(context, (best_beta, best_metrics));
        }

        results
    }

    /// 为多棵树的集合联合寻找最大化平均 ParetoReward 的最优 Beta*
    pub fn optimize_beta_for_trees(&self, trees: &[&DiscoveryTree]) -> (f64, ParetoMetrics) {
        if trees.is_empty() {
            return (0.5, ParetoMetrics {
                discovery_quality: 0.0,
                total_probes: 0,
                decision_rounds: 0,
                parallelism_efficiency: 0.0,
                total_churn: 0,
                counterfactual_speedup: 1.0,
                pareto_reward: 0.0,
            });
        }

        let eval_group = |beta: f64| -> (f64, ParetoMetrics) {
            let mut total_quality = 0.0;
            let mut total_probes = 0;
            let mut total_rounds = 0;
            let mut total_churn = 0;
            let mut total_speedup = 0.0;
            let mut total_reward = 0.0;

            for t in trees {
                let m = self.dream_and_evaluate(t, beta);
                total_quality += m.discovery_quality;
                total_probes += m.total_probes;
                total_rounds += m.decision_rounds;
                total_churn += m.total_churn;
                total_speedup += m.counterfactual_speedup;
                total_reward += m.pareto_reward;
            }

            let n = trees.len() as f64;
            let avg_metrics = ParetoMetrics {
                discovery_quality: total_quality / n,
                total_probes: (total_probes as f64 / n).round() as usize,
                decision_rounds: (total_rounds as f64 / n).round() as usize,
                parallelism_efficiency: if total_rounds == 0 { 0.0 } else { total_probes as f64 / total_rounds as f64 },
                total_churn: (total_churn as f64 / n).round() as usize,
                counterfactual_speedup: if n > 0.0 { total_speedup / n } else { 1.0 },
                pareto_reward: total_reward / n,
            };

            (avg_metrics.pareto_reward, avg_metrics)
        };

        // 黄金分割多树联合寻优
        let inv_phi = 0.618033988749895;
        let inv_phi2 = 0.381966011250105;

        let mut a = 0.0;
        let mut b = 1.0;

        let mut c = a + inv_phi2 * (b - a);
        let mut d = a + inv_phi * (b - a);

        let (r_c, mut m_c) = eval_group(c);
        let (r_d, mut m_d) = eval_group(d);

        let mut best_beta = if r_c >= r_d { c } else { d };
        let mut best_metrics = if r_c >= r_d { m_c.clone() } else { m_d.clone() };

        for _ in 0..12 {
            if (b - a) < 0.02 {
                break;
            }

            if r_c > r_d {
                b = d;
                d = c;
                m_d = m_c;
                c = a + inv_phi2 * (b - a);
                let (new_r_c, new_m_c) = eval_group(c);
                m_c = new_m_c;
                if new_r_c > best_metrics.pareto_reward {
                    best_beta = c;
                    best_metrics = m_c.clone();
                }
            } else {
                a = c;
                c = d;
                m_c = m_d;
                d = a + inv_phi * (b - a);
                let (new_r_d, new_m_d) = eval_group(d);
                m_d = new_m_d;
                if new_r_d > best_metrics.pareto_reward {
                    best_beta = d;
                    best_metrics = m_d.clone();
                }
            }
        }

        (best_beta, best_metrics)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dream_rsi_pipeline() {
        // 1. 构建模拟的探索树
        let mut tree = DiscoveryTree::new("root");

        // 分支 1：前 2 步成功，第 3 步达到高分
        let b1_s1 = DiscoveryNode::new(
            "b1_1", Some("root".into()), 1, 1, "cargo check", "Checked ok", 0.3, FailureClass::Ok, 50
        );
        let b1_s2 = DiscoveryNode::new(
            "b1_2", Some("b1_1".into()), 1, 2, "cargo build", "Build ok", 0.6, FailureClass::Ok, 120
        );
        let b1_s3 = DiscoveryNode::new(
            "b1_3", Some("b1_2".into()), 1, 3, "cargo test", "all 10 tests passed", 1.0, FailureClass::Ok, 200
        );

        // 分支 2：第 1 步遇到实现级小 Bug (语法错误)，第 2 步修复成功
        let b2_s1 = DiscoveryNode::new(
            "b2_1", Some("root".into()), 2, 1, "python run.py", "SyntaxError: invalid syntax", 0.0,
            FailureClass::RepairableImplementation {
                reason: "Syntax error".into(),
                error_sample: "SyntaxError".into()
            },
            40
        );
        let b2_s2 = DiscoveryNode::new(
            "b2_2", Some("b2_1".into()), 2, 2, "python fix.py", "test result: ok", 0.95, FailureClass::Ok, 90
        );

        tree.add_node(b1_s1).unwrap();
        tree.add_node(b1_s2).unwrap();
        tree.add_node(b1_s3).unwrap();
        tree.add_node(b2_s1).unwrap();
        tree.add_node(b2_s2).unwrap();

        assert_eq!(tree.total_probes(), 5);

        // 2. 离线做梦回放测试
        let engine = DreamerEngine::new(2); // 2 个并发 worker
        let metrics = engine.dream_and_evaluate(&tree, 0.6);

        println!("Dream-RSI 回放评测结果: {:?}", metrics);
        assert!(metrics.discovery_quality >= 0.95);
        assert!(metrics.decision_rounds > 0);
        assert!(metrics.parallelism_efficiency >= 1.0);

        // 3. 做梦网格搜索最佳 Beta
        let candidate_betas = vec![0.2, 0.5, 0.8];
        let (best_beta, best_metrics) = engine.sweep_best_beta(&tree, &candidate_betas);
        println!("最佳 Beta: {}, 收益: {}", best_beta, best_metrics.pareto_reward);
        assert!(best_metrics.pareto_reward > 0.0);
    }

    #[test]
    fn test_failure_classification() {
        let parser = SessionTreeParser::new();

        let syntax_fail = parser.classify_failure("error[E0308]: mismatched types", true);
        assert!(syntax_fail.is_repairable());

        let oom_fail = parser.classify_failure("CUDA out of memory. Tried to allocate...", true);
        assert!(oom_fail.is_repairable());

        let ok_eval = parser.classify_failure("test result: ok. 15 passed", false);
        assert!(ok_eval.is_ok());
    }

    #[test]
    fn test_golden_section_continuous_optimization() {
        let mut tree = DiscoveryTree::new("root_gs");
        let n1 = DiscoveryNode::new("n1", Some("root_gs".into()), 1, 1, "cargo check", "ok", 0.5, FailureClass::Ok, 50);
        let n2 = DiscoveryNode::new("n2", Some("n1".into()), 1, 2, "cargo test", "ok", 1.0, FailureClass::Ok, 80);
        tree.add_node(n1).unwrap();
        tree.add_node(n2).unwrap();

        let engine = DreamerEngine::new(2);
        let (beta_opt, metrics) = engine.find_optimal_beta_golden_section(&tree, 0.02, 15);

        println!("连续最优 Beta*: {:.4}, 对应奖励: {:.4}", beta_opt, metrics.pareto_reward);
        assert!((0.0..=1.0).contains(&beta_opt));
        assert!(metrics.pareto_reward > 0.0);
    }

    #[test]
    fn test_mdl_churn_penalty() {
        // 创建两棵树：一棵大改动（churn=500），一棵精准手术（churn=5）
        let mut tree_clean = DiscoveryTree::new("root_clean");
        let node_clean = DiscoveryNode::new("c1", Some("root_clean".into()), 1, 1, "edit file.rs", "ok", 1.0, FailureClass::Ok, 50)
            .with_churn(5);
        tree_clean.add_node(node_clean).unwrap();

        let mut tree_bloated = DiscoveryTree::new("root_bloated");
        let node_bloated = DiscoveryNode::new("b1", Some("root_bloated".into()), 1, 1, "edit file.rs", "ok", 1.0, FailureClass::Ok, 50)
            .with_churn(500);
        tree_bloated.add_node(node_bloated).unwrap();

        let engine = DreamerEngine::new(2);
        let m_clean = engine.dream_and_evaluate(&tree_clean, 0.5);
        let m_bloated = engine.dream_and_evaluate(&tree_bloated, 0.5);

        println!("精简改动奖励: {:.4}, 膨胀改动奖励: {:.4}", m_clean.pareto_reward, m_bloated.pareto_reward);
        // 精简代码方案获得的 Pareto 奖励必须严格高于大面积膨胀方案
        assert!(m_clean.pareto_reward > m_bloated.pareto_reward);
        assert_eq!(m_clean.total_churn, 5);
        assert_eq!(m_bloated.total_churn, 500);
    }

    #[test]
    fn test_contextual_beta_clustering() {
        let mut tree_fix = DiscoveryTree::new("fix_root").with_context(TaskContext::QuickFix);
        let n_fix = DiscoveryNode::new("f1", Some("fix_root".into()), 1, 1, "fix syntax", "ok", 0.95, FailureClass::Ok, 30);
        tree_fix.add_node(n_fix).unwrap();

        let mut tree_refactor = DiscoveryTree::new("refactor_root").with_context(TaskContext::Refactor);
        let n_refactor = DiscoveryNode::new("r1", Some("refactor_root".into()), 1, 1, "refactor arch", "ok", 0.90, FailureClass::Ok, 120);
        tree_refactor.add_node(n_refactor).unwrap();

        let engine = DreamerEngine::new(2);
        let trees = vec![tree_fix, tree_refactor];
        let contextual = engine.sweep_contextual_betas(&trees);

        assert!(contextual.contains_key(&TaskContext::QuickFix));
        assert!(contextual.contains_key(&TaskContext::Refactor));
    }
}
