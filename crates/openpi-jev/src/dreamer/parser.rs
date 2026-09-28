use regex::Regex;
use super::tree::DiscoveryTree;
use super::types::{DiscoveryNode, FailureClass, TaskContext};

/// 会话日志与转录解析器：将历史执行序列解析为结构化的 DiscoveryTree
pub struct SessionTreeParser {
    syntax_error_pattern: Regex,
    oom_pattern: Regex,
    import_pattern: Regex,
    hard_failure_pattern: Regex,
    test_ok_pattern: Regex,
    build_ok_pattern: Regex,
    git_ok_pattern: Regex,
    warning_pattern: Regex,
    git_diff_stat_regex: Regex,
    quick_fix_pattern: Regex,
    refactor_pattern: Regex,
    exploration_pattern: Regex,
}

impl Default for SessionTreeParser {
    fn default() -> Self {
        Self::new()
    }
}

impl SessionTreeParser {
    pub fn new() -> Self {
        Self {
            syntax_error_pattern: Regex::new(r"(?i)(SyntaxError|cannot find symbol|mismatched types|E\d{4}|cannot find module|undefined reference)").unwrap(),
            oom_pattern: Regex::new(r"(?i)(OutOfMemory|CUDA out of memory|Killed|signal:\s*9)").unwrap(),
            import_pattern: Regex::new(r"(?i)(ModuleNotFoundError|ImportError|No such file or directory)").unwrap(),
            hard_failure_pattern: Regex::new(r"(?i)(Segmentation fault|core dumped|fatal: not a git repository|command not found|Permission denied|panic: )").unwrap(),
            test_ok_pattern: Regex::new(r"(?i)(test result:\s*ok|\b\d+\s+passed\b|all checks passed|BUILD SUCCESS|\bPASS\b)").unwrap(),
            build_ok_pattern: Regex::new(r"(?i)(Finished `?(dev|release|test)`? profile|✓ built in|webpack compiled successfully|Build succeeded|TSC completed with 0 errors)").unwrap(),
            git_ok_pattern: Regex::new(r"(?i)(\[\S+\s+[a-f0-9]{7,}\]|nothing to commit, working tree clean|\d+ files? changed,\s*\d+ insertions?)").unwrap(),
            warning_pattern: Regex::new(r"(?i)(warning:|\bWARN\b|\bWARNING\b)").unwrap(),
            git_diff_stat_regex: Regex::new(r"(\d+)\s+insertions?\(\+\)(?:,\s*(\d+)\s+deletions?\(-\))?").unwrap(),
            quick_fix_pattern: Regex::new(r"(?i)(fix|bug|报错|修复|异常|error|crash|fail|patch|排查)").unwrap(),
            refactor_pattern: Regex::new(r"(?i)(refactor|重构|迁移|rewrite|migrate|architecture|重新设计)").unwrap(),
            exploration_pattern: Regex::new(r"(?i)(search|explore|find|read|调研|查看|分析|benchmark|对比)").unwrap(),
        }
    }

    /// 分析命令输出，自动分类错误级别（Dream-RSI 核心：区分实现级报错与算法级失败）
    pub fn classify_failure(&self, output: &str, is_error: bool) -> FailureClass {
        if !is_error {
            return FailureClass::Ok;
        }

        if self.hard_failure_pattern.is_match(output) {
            return FailureClass::HardAlgorithmic {
                reason: "Fatal runtime panic, crash or missing environment command".into(),
            };
        }

        if self.syntax_error_pattern.is_match(output) {
            return FailureClass::RepairableImplementation {
                reason: "Syntax or type compilation error".into(),
                error_sample: output.chars().take(100).collect(),
            };
        }

        if self.oom_pattern.is_match(output) {
            return FailureClass::RepairableImplementation {
                reason: "Out of memory / resource exhaustion (reducible batch)".into(),
                error_sample: output.chars().take(100).collect(),
            };
        }

        if self.import_pattern.is_match(output) {
            return FailureClass::RepairableImplementation {
                reason: "Missing dependency or path error".into(),
                error_sample: output.chars().take(100).collect(),
            };
        }

        // 默认可自愈的常规运行时错误
        FailureClass::RepairableImplementation {
            reason: "General execution failure".into(),
            error_sample: output.chars().take(100).collect(),
        }
    }

    /// 细粒度多维客观指标评分：
    /// - 单测通过：0.95 ~ 1.0
    /// - 构建/编译成功：0.85
    /// - Git 提交/状态干净：0.80
    /// - 常规工具执行成功：0.60
    /// - 产生轻微告警惩罚：-0.05
    /// - 空输出：0.40
    /// - 可自愈实现错误（保留探索价值）：0.20
    /// - 致命硬性算法/环境失败：0.0
    pub fn estimate_score(&self, output: &str, is_error: bool) -> f64 {
        if is_error {
            let fail = self.classify_failure(output, is_error);
            match fail {
                FailureClass::RepairableImplementation { .. } => 0.20,
                FailureClass::HardAlgorithmic { .. } => 0.0,
                FailureClass::EnvironmentFailure { .. } => 0.05,
                FailureClass::Ok => 0.50,
            }
        } else {
            let has_warning = self.warning_pattern.is_match(output);
            let penalty: f64 = if has_warning { 0.05 } else { 0.0 };

            if self.test_ok_pattern.is_match(output) {
                f64::max(1.0 - penalty, 0.85)
            } else if self.build_ok_pattern.is_match(output) {
                f64::max(0.85 - penalty, 0.70)
            } else if self.git_ok_pattern.is_match(output) {
                f64::max(0.80 - penalty, 0.65)
            } else if output.trim().is_empty() {
                0.40
            } else {
                f64::max(0.60 - penalty, 0.40)
            }
        }
    }

    /// 提取或估算代码改动行数（MDL 最小描述长度评估）
    pub fn estimate_churn(&self, cmd: &str, output: &str) -> usize {
        // 1. 如果输出包含类似 "3 files changed, 25 insertions(+), 10 deletions(-)"
        if let Some(caps) = self.git_diff_stat_regex.captures(output) {
            let ins: usize = caps.get(1).and_then(|m| m.as_str().parse().ok()).unwrap_or(0);
            let del: usize = caps.get(2).and_then(|m| m.as_str().parse().ok()).unwrap_or(0);
            return ins + del;
        }

        // 2. 如果是 write 或 edit 工具操作
        let cmd_lower = cmd.to_lowercase();
        if cmd_lower.contains("write") || cmd_lower.contains("edit") {
            let lines = output.lines().count();
            return lines.clamp(5, 500);
        }

        // 3. 统计 diff 补丁标记行
        let mut patch_lines = 0;
        for line in output.lines().take(200) {
            if (line.starts_with('+') && !line.starts_with("+++"))
                || (line.starts_with('-') && !line.starts_with("---"))
            {
                patch_lines += 1;
            }
        }
        if patch_lines > 0 {
            return patch_lines;
        }

        0
    }

    /// 自动推断会话的任务情境分类
    pub fn infer_task_context(&self, user_prompts: &[String]) -> TaskContext {
        let text = user_prompts.join(" ");
        if self.refactor_pattern.is_match(&text) {
            TaskContext::Refactor
        } else if self.quick_fix_pattern.is_match(&text) {
            TaskContext::QuickFix
        } else if self.exploration_pattern.is_match(&text) {
            TaskContext::Exploration
        } else {
            TaskContext::General
        }
    }

    /// 从简单的执行历史记录构建发现树（多世界分支架构）
    pub fn build_from_records(&self, root_id: &str, records: &[(String, String, bool)]) -> DiscoveryTree {
        let mut tree = DiscoveryTree::new(root_id);
        let mut last_stable_parent = root_id.to_string();
        let mut current_branch = 0;

        for (idx, (cmd, output, is_error)) in records.iter().enumerate() {
            let node_id = format!("{}_step_{}", root_id, idx + 1);
            let bounded = if output.len() > 65536 {
                let head: String = output.chars().take(32768).collect();
                let tail: String = output.chars().rev().take(32768).collect::<Vec<_>>().into_iter().rev().collect();
                format!("{}\n... [Output truncated] ...\n{}", head, tail)
            } else {
                output.clone()
            };
            let fail_class = self.classify_failure(&bounded, *is_error);
            let score = self.estimate_score(&bounded, *is_error);
            let churn = self.estimate_churn(cmd, &bounded);

            let node = DiscoveryNode::new(
                node_id.clone(),
                Some(last_stable_parent.clone()),
                current_branch,
                idx + 1,
                cmd.clone(),
                bounded.chars().take(80).collect::<String>(),
                score,
                fail_class.clone(),
                100,
            ).with_churn(churn);

            let _ = tree.add_node(node);

            if fail_class.is_ok() && score >= 0.4 {
                // 里程碑成功，推进主干节点
                last_stable_parent = node_id;
            } else {
                // 执行失败或报错：保持 last_stable_parent 并在新分支上尝试重试/修复，形成兄弟分支
                current_branch += 1;
            }
        }

        tree
    }

    /// 直接从本地真实的 OpenPI 会话文件 (.openpi/sessions/*.jsonl) 构建发现树（多世界分支 DAG）
    pub fn parse_openpi_session_file(&self, path: &std::path::Path) -> anyhow::Result<DiscoveryTree> {
        use std::io::BufRead;

        let file = std::fs::File::open(path)?;
        let reader = std::io::BufReader::new(file);

        let root_id = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("session_root");

        let mut tree = DiscoveryTree::new(root_id);
        let mut step = 0;
        let mut last_stable_parent = root_id.to_string();
        let mut current_branch = 0;
        let mut user_prompts = Vec::new();

        for line_res in reader.lines() {
            let line = line_res?;
            if line.trim().is_empty() {
                continue;
            }

            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) {
                if val.get("type").and_then(|t| t.as_str()) == Some("message") {
                    let msg = val.get("message").unwrap_or(&serde_json::Value::Null);
                    let role = msg.get("role").and_then(|r| r.as_str()).unwrap_or("");

                    // 新的用户意图开启从会话基线派生的新探索分支
                    if role == "user" {
                        if let Some(content_str) = msg.get("content").and_then(|c| c.as_str()) {
                            user_prompts.push(content_str.to_string());
                        } else if let Some(content_arr) = msg.get("content").and_then(|c| c.as_array()) {
                            for item in content_arr {
                                if let Some(txt) = item.get("text").and_then(|t| t.as_str()) {
                                    user_prompts.push(txt.to_string());
                                }
                            }
                        }
                        last_stable_parent = root_id.to_string();
                        current_branch += 1;
                        continue;
                    }

                    if role == "toolResult" {
                        step += 1;
                        let tool_name = msg.get("toolName").and_then(|n| n.as_str()).unwrap_or("tool");
                        let is_error = msg.get("isError").and_then(|e| e.as_bool()).unwrap_or(false);

                        // 提取文本内容
                        let mut output_text = String::new();
                        if let Some(content_arr) = msg.get("content").and_then(|c| c.as_array()) {
                            for item in content_arr {
                                if let Some(txt) = item.get("text").and_then(|t| t.as_str()) {
                                    output_text.push_str(txt);
                                    output_text.push('\n');
                                }
                            }
                        } else if let Some(content_str) = msg.get("content").and_then(|c| c.as_str()) {
                            output_text.push_str(content_str);
                        }

                        // 保护机制：将文本限制在 64KB 内，防止超大日志（如二进制/Base64）引发正则回溯与卡顿
                        let bounded_text = if output_text.len() > 65536 {
                            let head: String = output_text.chars().take(32768).collect();
                            let tail: String = output_text.chars().rev().take(32768).collect::<Vec<_>>().into_iter().rev().collect();
                            format!("{}\n... [Output truncated for replay analysis] ...\n{}", head, tail)
                        } else {
                            output_text
                        };

                        let fail_class = self.classify_failure(&bounded_text, is_error);
                        let score = self.estimate_score(&bounded_text, is_error);
                        let churn = self.estimate_churn(&format!("tool:{}", tool_name), &bounded_text);
                        let node_id = format!("{}_step_{}", root_id, step);

                        let node = DiscoveryNode::new(
                            node_id.clone(),
                            Some(last_stable_parent.clone()),
                            current_branch,
                            step,
                            format!("tool:{}", tool_name),
                            bounded_text.chars().take(120).collect::<String>(),
                            score,
                            fail_class.clone(),
                            50,
                        ).with_churn(churn);

                        let _ = tree.add_node(node);

                        if fail_class.is_ok() && score >= 0.4 {
                            last_stable_parent = node_id;
                        } else {
                            // 步骤失败：保持上一个稳定父节点不变，后续重试动作成为兄弟分支
                            current_branch += 1;
                        }
                    }
                }
            }
        }

        tree.context = self.infer_task_context(&user_prompts);
        Ok(tree)
    }
}
