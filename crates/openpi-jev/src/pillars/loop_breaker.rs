use crate::types::LoopAnalysis;

#[derive(Debug, Clone)]
struct ToolExecutionRecord {
    cmd: String,
    error_summary: String,
}

pub struct LoopBreaker {
    recent_failures: Vec<ToolExecutionRecord>,
    max_history: usize,
    circuit_break_threshold: usize,
}

impl Default for LoopBreaker {
    fn default() -> Self {
        Self::new(6, 2)
    }
}

impl LoopBreaker {
    pub fn new(max_history: usize, circuit_break_threshold: usize) -> Self {
        Self {
            recent_failures: Vec::with_capacity(max_history),
            max_history,
            circuit_break_threshold,
        }
    }

    pub fn record_failure(&mut self, cmd: &str, output: &str) -> LoopAnalysis {
        // Extract a clean error signature (first 2 lines containing error or first line)
        let error_signature: String = output
            .lines()
            .filter(|l| {
                let lower = l.to_lowercase();
                lower.contains("error") || lower.contains("failed") || lower.contains("panic")
            })
            .take(2)
            .collect::<Vec<&str>>()
            .join(" | ");

        let record = ToolExecutionRecord {
            cmd: cmd.trim().to_string(),
            error_summary: if error_signature.is_empty() {
                output.chars().take(80).collect()
            } else {
                error_signature
            },
        };

        self.recent_failures.push(record);
        if self.recent_failures.len() > self.max_history {
            self.recent_failures.remove(0);
        }

        // Count consecutive repetitive failures
        let mut loop_count = 1;
        if self.recent_failures.len() >= 2 {
            let last = &self.recent_failures[self.recent_failures.len() - 1];
            for prev in self.recent_failures.iter().rev().skip(1) {
                if prev.cmd == last.cmd || prev.error_summary == last.error_summary {
                    loop_count += 1;
                } else {
                    break;
                }
            }
        }

        let should_break = loop_count >= self.circuit_break_threshold;

        let corrective_hint = if should_break {
            Some(self.generate_corrective_hint(output))
        } else {
            None
        };

        LoopAnalysis {
            is_looping: loop_count >= 2,
            loop_count,
            should_break,
            corrective_hint,
        }
    }

    pub fn record_success(&mut self) {
        self.recent_failures.clear();
    }

    fn generate_corrective_hint(&self, error_text: &str) -> String {
        let lower = error_text.to_lowercase();

        if lower.contains("command not found") || lower.contains("no such file or directory") {
            "🛑 [Jev 熔断器介入]: 检测到相同命令持续因“找不到文件/命令”失败。请立即停止重复执行相同命令，先使用 `pwd` 和 `ls` 确定当前目录或检查依赖是否安装。".into()
        } else if lower.contains("permission denied") || lower.contains("eacces") {
            "🛑 [Jev 熔断器介入]: 检测到权限不足错误。请不要盲目重试，核查文件写权限或向用户说明需要提权。".into()
        } else if lower.contains("syntaxerror") || lower.contains("parse error") {
            "🛑 [Jev 熔断器介入]: 检测到连续语法解析失败。请回退刚刚修改的文件，仔细对比括号与导出语句，不要直接重跑构建。".into()
        } else {
            "🛑 [Jev 熔断器介入]: 检测到 Agent 在相同报错上持续打转超过阈值，已执行强制熔断以阻止 Token 浪费！请切换思路排查核心原因。".into()
        }
    }
}
