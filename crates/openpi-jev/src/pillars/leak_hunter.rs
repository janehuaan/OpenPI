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
                Regex::new(r"(?i)\b(sk-[a-zA-Z0-9_\-]{20,200})\b").unwrap(),
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
                "AWS Secret Access Key",
                Regex::new(r#"(?i)(aws_?secret[_a-z]*\s*[=:]\s*["']?)([A-Za-z0-9/+=]{40})"#).unwrap(),
                "$1[REDACTED_AWS_SECRET]",
            ),
            (
                "Google API Key",
                Regex::new(r"\b(AIza[0-9A-Za-z_\-]{35})\b").unwrap(),
                "[REDACTED_GOOGLE_KEY]",
            ),
            (
                "Slack Token",
                Regex::new(r"\b(xox[baprs]-[0-9A-Za-z-]{10,72})\b").unwrap(),
                "[REDACTED_SLACK_TOKEN]",
            ),
            (
                "Stripe Secret Key",
                Regex::new(r"\b((?:sk|rk)_live_[0-9a-zA-Z]{16,})\b").unwrap(),
                "[REDACTED_STRIPE_KEY]",
            ),
            (
                "npm Token",
                Regex::new(r"\b(npm_[A-Za-z0-9]{36})\b").unwrap(),
                "[REDACTED_NPM_TOKEN]",
            ),
            (
                "JWT",
                Regex::new(r"\b(eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,})\b").unwrap(),
                "[REDACTED_JWT]",
            ),
            (
                "Generic secret assignment",
                Regex::new(r#"(?i)((?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token)\s*[=:]\s*["']?)([^\s"',;]{6,})"#).unwrap(),
                "$1[REDACTED]",
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
