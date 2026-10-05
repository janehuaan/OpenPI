use crate::types::GateVerdict;
use regex::Regex;

pub struct SafetyGate {
    destructive_rules: Vec<(Regex, f32, &'static str)>,
    hang_rules: Vec<(Regex, &'static str, &'static str)>, // (pattern, reason, suggested_modifier)
    pkg_install_regex: Regex,
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
            // Self-preservation: an agent must never be able to destroy the daemon
            // that supervises it. Overwriting a *running* binary in place (cp/mv/dd/
            // truncation) invalidates its mapped pages and wedges the live process;
            // killing the daemon then leaves a permanently "running" ghost state.
            // Updates must go through an atomic, externally supervised deploy.
            (
                Regex::new(r"(?i)\b(cp|mv|install|dd|tee|truncate)\b[^\n]*?(\.app/Contents/Resources/openpi/bin/openpi-daemon|/\.local/bin/openpi-daemon)").unwrap(),
                0.99,
                "🛑 禁止原地覆写正在运行的 openpi-daemon 二进制：这把运行中的进程镜像写坏会导致其静默卡死。请使用 scripts/install-daemon.sh（原子替换 + 受监管重启），不要用 cp/mv 直接覆盖。",
            ),
            (
                Regex::new(r"(?i)>\s*[^\s;&|]*(\.app/Contents/Resources/openpi/bin/openpi-daemon|\.local/bin/openpi-daemon)").unwrap(),
                0.99,
                "🛑 禁止用重定向截断正在运行的 openpi-daemon 二进制（会损坏运行中进程的映像）。",
            ),
            (
                Regex::new(r"(?i)\b(pkill|killall)\b[^\n]*openpi-daemon").unwrap(),
                0.99,
                "🛑 禁止杀死 openpi-daemon 自身/父守护进程：这会抹掉当前会话的监管进程并留下僵死运行态。",
            ),
            (
                Regex::new(r"(?i)\bkill\b[^\n]*\$PPID").unwrap(),
                0.99,
                "🛑 禁止杀死自身的父进程 ($PPID)：该父进程正是监管你的 daemon。",
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

        let pkg_install_regex = Regex::new(r"(?i)\b(apt|apt-get|yum|brew|pacman|dnf|zypper)\s+install\b").unwrap();

        Self {
            destructive_rules,
            hang_rules,
            pkg_install_regex,
        }
    }

    pub fn inspect_command(&self, cmd: &str) -> GateVerdict {
        let trimmed = cmd.trim();
        if trimmed.is_empty() {
            return GateVerdict::Allow;
        }

        // 1. Check interactive package manager install without -y
        if self.pkg_install_regex.is_match(trimmed)
            && !trimmed.contains("-y")
            && !trimmed.contains("--yes")
        {
            return GateVerdict::ModifyCommand {
                safe_command: format!("{} -y", trimmed),
                reason: "Appended -y flag to prevent hanging on interactive confirmation prompt.".into(),
            };
        }

        // 1b. Check ping without packet count limit (-c)
        if Regex::new(r"(?i)^ping\s+([a-zA-Z0-9.-]+)$").unwrap().is_match(trimmed) && !trimmed.contains("-c") {
            return GateVerdict::ModifyCommand {
                safe_command: format!("{} -c 4", trimmed),
                reason: "Appended -c 4 to prevent infinite terminal ping hang.".into(),
            };
        }

        // 1c. Check git log/diff/show without --no-pager
        if Regex::new(r"(?i)^git\s+(log|diff|show)\b").unwrap().is_match(trimmed)
            && !trimmed.contains("--no-pager")
            && !trimmed.contains("GIT_PAGER")
        {
            let subcmd = trimmed[4..].trim();
            return GateVerdict::ModifyCommand {
                safe_command: format!("git --no-pager {}", subcmd),
                reason: "Appended --no-pager to prevent git from opening interactive pager (less) and blocking.".into(),
            };
        }

        // 1d. Block unconstrained broad recursive searches over home or root directory
        let broad_grep_regex = Regex::new(
            r#"(?i)\b(grep|egrep|fgrep)\s+(-[a-zA-Z]*r[a-zA-Z]*)\s+.*(?:\s|^|["'])(~/?|\$HOME|/Users/[^/\s"']+/?|/)(?:\s|$|["'])"#,
        ).unwrap();
        if broad_grep_regex.is_match(trimmed) {
            return GateVerdict::Deny {
                reason: "🛑 [Jev SafetyGate] 严禁在用户主目录 (~ 或 /Users/xxx) 或根目录发起全盘递归搜索 (grep -r)！该操作将无差别扫描数十万系统文件与工程依赖导致严重卡死。请先通过 ls 查看项目目录，再在具体项目内进行搜索。".into(),
            };
        }

        let broad_find_regex = Regex::new(
            r#"(?i)\bfind\s+(?:-[a-zA-Z]+\s+)*["']?(~/?|\$HOME|/Users/[^/\s"']+/?|/)(?:["']|\s|$)"#,
        ).unwrap();
        if broad_find_regex.is_match(trimmed) && !trimmed.contains("-maxdepth") {
            return GateVerdict::Deny {
                reason: "🛑 [Jev SafetyGate] 严禁在用户主目录或根目录下执行无 -maxdepth 限制的深度递归 find！请加上 `-maxdepth 2` 或指定具体项目目录。".into(),
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

        // 3. Check Hang / Blocking Process Rules
        for (pat, reason, modifier) in &self.hang_rules {
            if pat.is_match(trimmed) {
                return GateVerdict::Warn {
                    reasons: vec![format!("{}: Suggested guard: {}", reason, modifier)],
                };
            }
        }

        // 13. 极简代码律/反过度工程拦截 (Anti-Overengineering Gate)
        // 拦截大面积无关代码扩散或一刀切破坏性大改
        let overengineering_patterns = [
            (r"(?i)rm\s+-rf\s+(src|crates|apps|lib)", "严禁一刀切删除源码树！触犯「砍大动脉零容忍」铁律，请执行微创修改。"),
            (r"(?i)cargo\s+add\s+.*(actix|rocket|warp|diesel)", "禁止无方案盲目引入大型重型框架，严格遵守原生 MDL 极简架构。"),
        ];
        for (pattern, reason) in overengineering_patterns {
            if let Ok(re) = Regex::new(pattern) {
                if re.is_match(trimmed) {
                    return GateVerdict::Deny {
                        reason: reason.to_string(),
                    };
                }
            }
        }

        GateVerdict::Allow
    }

    /// Inspect direct file modification paths (for write / edit tools)
    pub fn inspect_file_path(&self, file_path: &str) -> GateVerdict {
        let normalized = file_path.trim().replace('\\', "/");
        if normalized.is_empty() {
            return GateVerdict::Allow;
        }

        // Critical System Paths (Physical Hard Block)
        let critical_system_prefixes = [
            "/etc", "/System", "/Library", "/boot", "/dev", "/var/root",
            "/usr/bin", "/usr/sbin", "/bin", "/sbin", "/private/etc",
        ];
        for prefix in &critical_system_prefixes {
            if normalized == *prefix || normalized.starts_with(&format!("{}/", prefix)) {
                return GateVerdict::Deny {
                    reason: format!("Direct write/modification to critical OS system path `{}` is prohibited.", normalized),
                };
            }
        }

        // Sensitive credentials and keys (Physical Hard Block or Confirmation)
        let sensitive_patterns = [
            "/.ssh/id_", "/.ssh/authorized_keys", "/.gnupg/", "/.aws/credentials",
            "/.config/gcloud/", "/.kube/config", "/.docker/config.json",
        ];
        for pat in &sensitive_patterns {
            if normalized.contains(pat) {
                return GateVerdict::Deny {
                    reason: format!("Direct write/modification to sensitive secret or credential file `{}` is denied.", normalized),
                };
            }
        }

        // User Shell Startup Profiles (Require User Confirmation)
        let shell_startup_files = [".bashrc", ".zshrc", ".bash_profile", ".zprofile", ".profile"];
        for sh_file in &shell_startup_files {
            if normalized.ends_with(sh_file) {
                return GateVerdict::RequireConfirmation {
                    prompt: format!("The agent is requesting to modify your shell startup script `{}`", normalized),
                    reasons: vec!["Modifying shell profiles alters terminal environment and execution behavior.".into()],
                    risk_score: 0.88,
                };
            }
        }

        GateVerdict::Allow
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_anti_overengineering_gate() {
        let gate = SafetyGate::new();
        // 拦截破坏性全删源码树
        let verdict = gate.inspect_command("rm -rf crates/openpi-jev");
        match verdict {
            GateVerdict::Deny { reason } => {
                assert!(reason.contains("严禁一刀切删除源码树"));
            }
            _ => panic!("Expected Deny on rm -rf crates, got {:?}", verdict),
        }

        // 拦截盲目引入重型框架
        let verdict2 = gate.inspect_command("cargo add actix-web");
        match verdict2 {
            GateVerdict::Deny { reason } => {
                assert!(reason.contains("禁止无方案盲目引入大型重型框架"));
            }
            _ => panic!("Expected Deny on heavy cargo add, got {:?}", verdict2),
        }
    }

    #[test]
    fn test_self_protection_blocks_daemon_overwrite_and_kill() {
        let gate = SafetyGate::new();

        // The exact incident: in-place overwrite of the daemon's own executable.
        let overwrite = gate.inspect_command(
            "cp target/debug/openpi-daemon /Applications/OpenPI.app/Contents/Resources/openpi/bin/openpi-daemon",
        );
        assert!(
            matches!(overwrite, GateVerdict::Deny { .. }),
            "must deny overwriting the running daemon, got {:?}",
            overwrite
        );

        let truncate = gate.inspect_command(": > /Users/someone/.local/bin/openpi-daemon");
        assert!(
            matches!(truncate, GateVerdict::Deny { .. }),
            "must deny truncating the daemon binary, got {:?}",
            truncate
        );

        let kill = gate.inspect_command("pkill -f openpi-daemon");
        assert!(
            matches!(kill, GateVerdict::Deny { .. }),
            "must deny killing the supervisor, got {:?}",
            kill
        );

        // A copy that does not target a running daemon stays allowed.
        let benign = gate.inspect_command("cp target/debug/openpi-daemon /tmp/openpi-daemon-backup");
        assert!(
            matches!(benign, GateVerdict::Allow),
            "benign copy should stay allowed, got {:?}",
            benign
        );
    }
}
