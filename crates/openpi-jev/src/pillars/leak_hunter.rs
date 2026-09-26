use crate::types::LeakScanResult;
use regex::Regex;

pub struct LeakHunter {
    secret_patterns: Vec<(&'static str, Regex, &'static str)>,
}

impl Default for LeakHunter {
    fn default() -> Self {
        Self::new()
    }
}

impl LeakHunter {
    pub fn new() -> Self {
        let secret_patterns = vec![
            (
                "OpenAI/Anthropic/Agnes API Key",
                Regex::new(r"(?i)\b(sk-[a-zA-Z0-9_\-]{20,64})\b").unwrap(),
                "[REDACTED_API_KEY]",
            ),
            (
                "GitHub Personal Access Token",
                Regex::new(r"\b(ghp_[a-zA-Z0-9]{30,42}|github_pat_[a-zA-Z0-9_]{50,100})\b").unwrap(),
                "[REDACTED_GITHUB_TOKEN]",
            ),
            (
                "GitLab / HuggingFace Token",
                Regex::new(r"\b(glpat-[a-zA-Z0-9\-_]{20,40}|hf_[a-zA-Z0-9]{30,50})\b").unwrap(),
                "[REDACTED_ACCESS_TOKEN]",
            ),
            (
                "AWS Access Key ID",
                Regex::new(r"\b(AKIA[0-9A-Z]{16})\b").unwrap(),
                "[REDACTED_AWS_KEY]",
            ),
            (
                "RSA/Ed25519 Private Key Block",
                Regex::new(r"-----BEGIN\s+([A-Z0-9\s]+)PRIVATE KEY-----[\s\S]+?-----END\s+([A-Z0-9\s]+)PRIVATE KEY-----").unwrap(),
                "[REDACTED_PRIVATE_KEY_BLOCK]",
            ),
            (
                "Bearer Authorization Header",
                Regex::new(r"(?i)(Authorization:\s*Bearer\s+)[a-zA-Z0-9_\-\.]{20,}").unwrap(),
                "$1[REDACTED_BEARER_TOKEN]",
            ),
        ];

        Self { secret_patterns }
    }

    pub fn scan_and_sanitize(&self, text: &str) -> LeakScanResult {
        let mut sanitized = text.to_string();
        let mut total_leaks = 0;
        let mut redacted_types = Vec::new();

        for (desc, re, replacement) in &self.secret_patterns {
            let count = re.find_iter(&sanitized).count();
            if count > 0 {
                total_leaks += count;
                redacted_types.push(desc.to_string());
                sanitized = re.replace_all(&sanitized, *replacement).to_string();
            }
        }

        LeakScanResult {
            has_leaks: total_leaks > 0,
            leak_count: total_leaks,
            sanitized_text: sanitized,
            redacted_types,
        }
    }
}
