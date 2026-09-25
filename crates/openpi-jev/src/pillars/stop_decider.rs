use crate::types::StopVerdict;
use regex::Regex;

pub struct StopDecider {
    completion_signals: Vec<Regex>,
}

impl Default for StopDecider {
    fn default() -> Self {
        Self::new()
    }
}

impl StopDecider {
    pub fn new() -> Self {
        let completion_signals = vec![
            Regex::new(r"(?i)\b(\d+\s+passed|\d+\s+tests\s+passed|test\s+result:\s+ok|all\s+checks\s+passed)\b").unwrap(),
            Regex::new(r"(?i)\b(build\s+succeeded|build\s+successful|compilation\s+finished)\b").unwrap(),
            Regex::new(r"(?i)(全部测试通过|编译成功|重构完成|已成功更新|打包完成)").unwrap(),
        ];

        Self { completion_signals }
    }

    pub fn evaluate_progress(&self, original_goal: &str, last_cmd: &str, last_output: &str, consecutive_successes: usize) -> StopVerdict {
        let mut signal_matched = false;
        for pat in &self.completion_signals {
            if pat.is_match(last_output) {
                signal_matched = true;
                break;
            }
        }

        // If a test or build succeeded after several modifications
        if signal_matched && consecutive_successes >= 1 {
            return StopVerdict {
                should_stop: true,
                confidence: 0.92,
                rationale: format!(
                    "Detected successful build/test verification signal after command `{}`. Original goal `{}` appears fulfilled.",
                    last_cmd,
                    original_goal.chars().take(40).collect::<String>()
                ),
            };
        }

        StopVerdict {
            should_stop: false,
            confidence: 0.80,
            rationale: "Execution sequence in progress, no conclusive termination signal yet.".into(),
        }
    }
}
