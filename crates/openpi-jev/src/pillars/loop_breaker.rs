use crate::types::LoopAnalysis;

#[derive(Debug, Clone)]
struct ToolExecutionRecord {
    cmd: String,
    output_summary: String,
    is_error: bool,
}

pub struct LoopBreaker {
    recent_history: Vec<ToolExecutionRecord>,
    max_history: usize,
    circuit_break_threshold: usize,
}

impl Default for LoopBreaker {
    fn default() -> Self {
        Self::new(8, 2)
    }
}

impl LoopBreaker {
    pub fn new(max_history: usize, circuit_break_threshold: usize) -> Self {
        Self {
            recent_history: Vec::with_capacity(max_history),
            max_history,
            circuit_break_threshold,
        }
    }

    pub fn record_execution(&mut self, cmd: &str, output: &str, is_error: bool) -> LoopAnalysis {
        let trimmed_cmd = cmd.trim().to_string();
        let output_summary: String = output
            .lines()
            .take(3)
            .collect::<Vec<&str>>()
            .join(" | ")
            .chars()
            .take(120)
            .collect();

        // If this is a DIFFERENT command and it succeeded, reset history
        if !is_error {
            if let Some(last) = self.recent_history.last() {
                if last.cmd != trimmed_cmd {
                    self.recent_history.clear();
                }
            }
        }

        let record = ToolExecutionRecord {
            cmd: trimmed_cmd,
            output_summary,
            is_error,
        };

        self.recent_history.push(record);
        if self.recent_history.len() > self.max_history {
            self.recent_history.remove(0);
        }

        // Count consecutive identical command executions or error loops
        let mut loop_count = 1;
        if self.recent_history.len() >= 2 {
            let last = self.recent_history.last().unwrap();
            for prev in self.recent_history.iter().rev().skip(1) {
                if prev.cmd == last.cmd {
                    loop_count += 1;
                } else if prev.is_error && last.is_error && prev.output_summary == last.output_summary {
                    loop_count += 1;
                } else {
                    break;
                }
            }
        }

        // Check ping-pong oscillation (A-B-A-B)
        let mut is_ping_pong = false;
        if self.recent_history.len() >= 4 {
            let n = self.recent_history.len();
            let h = &self.recent_history;
            if h[n - 1].cmd == h[n - 3].cmd && h[n - 2].cmd == h[n - 4].cmd && h[n - 1].cmd != h[n - 2].cmd {
                is_ping_pong = true;
                loop_count = loop_count.max(4);
            }
        }

        let should_break = loop_count >= self.circuit_break_threshold || is_ping_pong;

        let corrective_hint = if should_break {
            Some(self.generate_corrective_hint(cmd, output, is_error, is_ping_pong))
        } else {
            None
        };

        LoopAnalysis {
            is_looping: loop_count >= 2 || is_ping_pong,
            loop_count,
            should_break,
            corrective_hint,
        }
    }

    pub fn record_failure(&mut self, cmd: &str, output: &str) -> LoopAnalysis {
        self.record_execution(cmd, output, true)
    }

    pub fn record_success(&mut self) {
        self.recent_history.clear();
    }

    fn generate_corrective_hint(&self, cmd: &str, output: &str, is_error: bool, is_ping_pong: bool) -> String {
        if is_ping_pong {
            return "🛑 [Jev 熔断器介入]: 检测到 Agent 在两条交替指令之间反复震荡调用（Ping-Pong Loop）。请立即停止重复尝试，结合现有信息重新规划策略！".into();
        }

        let lower = output.to_lowercase();
        let cmd_lower = cmd.to_lowercase();

        if !is_error && (cmd_lower.starts_with("grep") || cmd_lower.contains("find") || cmd_lower.contains("cat")) {
            return format!(
                "🛑 [Jev 熔断器介入]: 检测到相同检索/只读命令被连续重复调用多次（`{}`）。目标信息可能不存在或已被读取完毕，请立即停止盲目重复 grep/find，分析已有信息或更换关键词！",
                cmd.chars().take(60).collect::<String>()
            );
        }

        if lower.contains("command not found") || lower.contains("no such file or directory") {
            "🛑 [Jev 熔断器介入]: 检测到相同命令持续因“找不到文件/命令”失败。请立即停止重复执行相同命令，先使用 `pwd` 和 `ls` 确定当前目录或检查依赖是否安装。".into()
        } else if lower.contains("permission denied") || lower.contains("eacces") {
            "🛑 [Jev 熔断器介入]: 检测到权限不足错误。请不要盲目重试，核查文件写权限或向用户说明需要提权。".into()
        } else if lower.contains("syntaxerror") || lower.contains("parse error") {
            "🛑 [Jev 熔断器介入]: 检测到连续语法解析失败。请回退刚刚修改的文件，仔细对比括号与导出语句，不要直接重跑构建。".into()
        } else {
            "🛑 [Jev 熔断器介入]: 检测到 Agent 在相同命令或报错上持续打转超过阈值，已执行强制熔断以阻止 Token 浪费！请切换思路排查核心原因。".into()
        }
    }
}
