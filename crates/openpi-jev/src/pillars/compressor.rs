use crate::types::CompressedOutput;
use regex::Regex;

pub struct OutputCompressor {
    error_patterns: Vec<Regex>,
    max_uncompressed_lines: usize,
    max_uncompressed_chars: usize,
}

impl Default for OutputCompressor {
    fn default() -> Self {
        Self::new(100, 4000)
    }
}

impl OutputCompressor {
    pub fn new(max_lines: usize, max_chars: usize) -> Self {
        let error_patterns = vec![
            Regex::new(r"(?i)\b(error|failed|failure|fatal|panic|exception|traceback|cannot find|not found|undefined)\b").unwrap(),
            Regex::new(r"(?i)\bat\s+\S+:\d+:\d+").unwrap(), // Stack trace
            Regex::new(r"(?i)\[error\]|err:").unwrap(),
        ];

        Self {
            error_patterns,
            max_uncompressed_lines: max_lines,
            max_uncompressed_chars: max_chars,
        }
    }

    pub fn compress(&self, raw_output: &str) -> CompressedOutput {
        let original_chars = raw_output.len();
        let lines: Vec<&str> = raw_output.lines().collect();
        let total_lines = lines.len();

        if total_lines <= self.max_uncompressed_lines && original_chars <= self.max_uncompressed_chars {
            return CompressedOutput {
                content: raw_output.to_string(),
                original_chars,
                compressed_chars: original_chars,
                lines_truncated: 0,
                estimated_tokens_saved: 0,
                was_compressed: false,
            };
        }

        // Head lines (keep first 20 lines)
        let head_count = 20.min(total_lines);
        let head_lines = &lines[..head_count];

        // Tail lines (keep last 30 lines)
        let tail_count = 30.min(total_lines.saturating_sub(head_count));
        let tail_start = total_lines.saturating_sub(tail_count);
        let tail_lines = &lines[tail_start..];

        // Middle segment: extract only error-containing context
        let mut middle_error_lines = Vec::new();
        let middle_slice = &lines[head_count..tail_start];

        for (idx, line) in middle_slice.iter().enumerate() {
            if self.error_patterns.iter().any(|p| p.is_match(line)) {
                // Grab line and adjacent lines
                let start_idx = idx.saturating_sub(1);
                let end_idx = (idx + 2).min(middle_slice.len());
                for &l in &middle_slice[start_idx..end_idx] {
                    if !middle_error_lines.contains(&l) {
                        middle_error_lines.push(l);
                    }
                }
            }
        }

        let lines_omitted = (tail_start.saturating_sub(head_count)).saturating_sub(middle_error_lines.len());

        let mut result = String::with_capacity(self.max_uncompressed_chars);
        for l in head_lines {
            result.push_str(l);
            result.push('\n');
        }

        if !middle_error_lines.is_empty() {
            result.push_str(&format!("\n--- [Jev 智能提取核心错误信息 (省略中途正常日志 {} 行)] ---\n", lines_omitted));
            for l in &middle_error_lines {
                result.push_str(l);
                result.push('\n');
            }
            result.push_str("--- [错误段落提取结束] ---\n\n");
        } else if lines_omitted > 0 {
            result.push_str(&format!("\n[... ⚡ Jev 已自动省略 {} 行构建与正常信息，节约上下文 Token ...]\n\n", lines_omitted));
        }

        for l in tail_lines {
            result.push_str(l);
            result.push('\n');
        }

        let compressed_chars = result.len();
        let chars_saved = original_chars.saturating_sub(compressed_chars);
        // Approximation: 1 token ~ 3.5 chars in code/logs
        let estimated_tokens_saved = (chars_saved as f64 / 3.5).round() as usize;

        CompressedOutput {
            content: result,
            original_chars,
            compressed_chars,
            lines_truncated: lines_omitted,
            estimated_tokens_saved,
            was_compressed: true,
        }
    }
}
