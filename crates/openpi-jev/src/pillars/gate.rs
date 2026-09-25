use crate::types::GateVerdict;
use regex::Regex;

pub struct SafetyGate {
    destructive_rules: Vec<(Regex, f32, &'static str)>,
    hang_rules: Vec<(Regex, &'static str, &'static str)>, // (pattern, reason, suggested_modifier)
}

impl Default for SafetyGate {
    fn default() -> Self {
        Self::new()
    }
}

impl SafetyGate {
    pub fn new() -> Self {
        let destructive_rules = vec![
            // Recursive forced deletions of root / parent / home / wildcard
            (
                Regex::new(r"(?i)\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*|-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*)\s+([~/]|\*|\.\.|\$HOME)").unwrap(),
                0.99,
                "Attempting recursive forced deletion of root, home, parent dir, or wildcard (*).",
            ),
            // Git wipeouts
            (
                Regex::new(r"(?i)\bgit\s+reset\s+--hard\b").unwrap(),
                0.92,
                "git reset --hard permanently discards all uncommitted working changes.",
            ),
            (
                Regex::new(r"(?i)\bgit\s+push\s+.*(-f\b|--force\b|--force-with-lease\b)").unwrap(),
                0.96,
                "Force pushing may overwrite commits on the remote branch.",
            ),
            (
                Regex::new(r"(?i)\bgit\s+clean\s+(-[a-zA-Z]*f|--force)").unwrap(),
                0.92,
                "git clean -f permanently removes all untracked files.",
            ),
            // Low-level disk & system commands
            (
                Regex::new(r"(?i)\b(mkfs|dd\s+if=.*of=/dev|fdisk|parted)\b").unwrap(),
                0.99,
                "Low-level block device or filesystem formatting command.",
            ),
            (
                Regex::new(r"(?i)\b(shutdown|reboot|poweroff|halt)\b").unwrap(),
                0.98,
                "Command attempts to power down or reboot the operating system.",
            ),
            (
                Regex::new(r"(?i)\bchmod\s+(-R\s+)?(777|a\+rwx)\s+([~/]|\.\.|\/)").unwrap(),
                0.92,
                "Granting dangerous global 777 permissions across root or home directory.",
            ),
            // Dropping production databases
            (
                Regex::new(r"(?i)\b(drop\s+(database|schema|table)|truncate\s+table)\b").unwrap(),
                0.95,
                "Destructive SQL operation (DROP/TRUNCATE).",
            ),
        ];

        let hang_rules = vec![
            // Long running dev servers or continuous log monitors
            (
                Regex::new(r"(?i)\b(tail\s+-f|top|htop|watch\s+|less\s+|more\s+|vim\b|nano\b|vi\b)").unwrap(),
                "Interactive terminal or endless stream will hang the agent execution indefinitely.",
                "timeout 10 ",
            ),
            (
                Regex::new(r"(?i)\b(npm\s+run\s+dev|vite\b|cargo\s+run\s+--bin\s+daemon|python\s+-m\s+http\.server)").unwrap(),
                "Local server process runs forever and blocks command completion.",
                "run in background with timeout",
            ),
        ];

        Self {
            destructive_rules,
            hang_rules,
        }
    }

    pub fn inspect_command(&self, cmd: &str) -> GateVerdict {
        let trimmed = cmd.trim();
        if trimmed.is_empty() {
            return GateVerdict::Allow;
        }

        // 1. Check interactive package manager install without -y
        if Regex::new(r"(?i)\b(apt|apt-get|yum|brew|pacman)\s+install\b").unwrap().is_match(trimmed)
            && !trimmed.contains("-y")
            && !trimmed.contains("--yes")
        {
            return GateVerdict::ModifyCommand {
                safe_command: format!("{} -y", trimmed),
                reason: "Appended -y flag to prevent hanging on interactive confirmation prompt.".into(),
            };
        }

        // 2. Check Destructive Rules
        for (pat, risk, reason) in &self.destructive_rules {
            if pat.is_match(trimmed) {
                if *risk >= 0.95 {
                    return GateVerdict::Deny {
                        reason: reason.to_string(),
                    };
                } else {
                    return GateVerdict::RequireConfirmation {
                        prompt: format!("The agent is requesting to execute a high-risk command: `{}`", trimmed),
                        reasons: vec![reason.to_string()],
                        risk_score: *risk,
                    };
                }
            }
        }

        // 2. Check Hang / Blocking Process Rules
        for (pat, reason, modifier) in &self.hang_rules {
            if pat.is_match(trimmed) {
                // If it's a command like apt-get or brew without -y, suggest auto-appending -y
                if Regex::new(r"(?i)\b(apt|apt-get|yum|brew|pacman)\s+install\b").unwrap().is_match(trimmed)
                    && !trimmed.contains("-y")
                    && !trimmed.contains("--yes")
                {
                    return GateVerdict::ModifyCommand {
                        safe_command: format!("{} -y", trimmed),
                        reason: "Appended -y flag to prevent hanging on interactive confirmation prompt.".into(),
                    };
                }

                return GateVerdict::Warn {
                    reasons: vec![format!("{}: Suggested guard: {}", reason, modifier)],
                };
            }
        }

        GateVerdict::Allow
    }
}
