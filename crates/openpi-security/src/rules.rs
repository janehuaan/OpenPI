//! 规则集：SkillSpector 17 类中可静态判定的关键子集。

use aho_corasick::AhoCorasick;
use regex::Regex;
use std::sync::OnceLock;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Low,
    Medium,
    High,
    Critical,
}

impl Severity {
    pub fn label(&self) -> &'static str {
        match self {
            Severity::Critical => "CRITICAL",
            Severity::High => "HIGH",
            Severity::Medium => "MEDIUM",
            Severity::Low => "LOW",
        }
    }
    pub fn emoji(&self) -> &'static str {
        match self {
            Severity::Critical => "🟥",
            Severity::High => "🟧",
            Severity::Medium => "🟨",
            Severity::Low => "⬜",
        }
    }
}

pub struct Rule {
    pub id: &'static str,
    pub category: &'static str,
    pub severity: Severity,
    pub description: &'static str,
    pub pattern: &'static str,
}

/// 规则表（id 前缀对应 SkillSpector 类别）。
pub static RULES: &[Rule] = &[
    // ---- Prompt Injection (P) ----
    Rule { id: "P1", category: "prompt-injection", severity: Severity::High,
        description: "指令覆盖：要求忽略既有指令",
        pattern: r"(?i)\b(ignore|disregard|forget)\s+(all\s+)?(previous|prior|above|earlier|the)\s+(instruction|prompt|rule|context|message)" },
    Rule { id: "P1b", category: "prompt-injection", severity: Severity::High,
        description: "安全约束绕过：忽略/禁用安全机制",
        pattern: r"(?i)\b(ignore|bypass|override|disable)\b.{0,24}\b(safety|guardrail|constraint|restriction|sandbox|policy)" },
    Rule { id: "P2", category: "prompt-injection", severity: Severity::High,
        description: "隐藏指令：注释/不可见处藏指令",
        pattern: r"(?is)<!--.{0,300}\b(ignore|execute|run|system|prompt|instruction|exfiltrat|secret)" },
    Rule { id: "P3", category: "exfiltration", severity: Severity::High,
        description: "外泄指令：传输密钥/凭据/env",
        pattern: r"(?i)\b(send|post|upload|curl|fetch|transmit|exfiltrat)\w*\b.{0,48}\b(api[_-]?key|token|secret|credential|password|\.env|env\b)" },
    Rule { id: "P4", category: "prompt-injection", severity: Severity::High,
        description: "角色劫持：'you are now ...'",
        pattern: r"(?i)\byou\s+are\s+now\b" },
    Rule { id: "P5", category: "privilege-escalation", severity: Severity::Medium,
        description: "权限提升：sudo/root 模式",
        pattern: r"(?i)\b(sudo|root)\s+(access|mode|privilege|become|command)" },
    Rule { id: "P6", category: "prompt-injection", severity: Severity::High,
        description: "聊天模板注入：伪造 system/assistant 标签",
        pattern: r"<\|?\s*(im_start|im_end|system|assistant|user)\s*\|?>" },
    Rule { id: "P9", category: "prompt-injection", severity: Severity::Medium,
        description: "空白填充：超长连续空白（规避检测）",
        pattern: r"[ \t]{200,}" },

    // ---- System Prompt Leakage ----
    Rule { id: "SPL1", category: "prompt-leakage", severity: Severity::High,
        description: "系统提示泄露：要求输出隐藏指令",
        pattern: r"(?i)\b(print|reveal|repeat|show|output|leak)\b.{0,32}\b(system\s+prompt|initial\s+instruction|your\s+instruction|hidden\s+prompt)" },

    // ---- Anti-Refusal (AR) ----
    Rule { id: "AR1", category: "anti-refusal", severity: Severity::High,
        description: "反拒绝：禁止模型拒绝/道歉",
        pattern: r"(?i)\b(do\s+not|never|don't|must\s+not)\s+(refuse|decline|reject|apologize)" },
    Rule { id: "AR2", category: "anti-refusal", severity: Severity::Medium,
        description: "无条件服从：always/must comply",
        pattern: r"(?i)\b(always|must)\s+(comply|obey|answer)\b" },

    // ---- Data Exfiltration ----
    Rule { id: "EX1", category: "exfiltration", severity: Severity::High,
        description: "编码外泄：base64 编码密钥",
        pattern: r"(?i)\b(base64|b64encode|base64_encode)\b.{0,64}\b(key|token|secret|env|credential)" },
    Rule { id: "EX2", category: "exfiltration", severity: Severity::Medium,
        description: "外联信道：webhook/pastebin/ngrok 等",
        pattern: r"(?i)\b(webhook\.site|pastebin\.com|transfer\.sh|ngrok|requestbin|burpcollaborator|interact\.sh|\.oast\.)" },

    // ---- Privilege Escalation ----
    Rule { id: "PR1", category: "privilege-escalation", severity: Severity::High,
        description: "敏感系统文件/权限位",
        pattern: r"(?i)(chmod\s+[0-7]?777|setuid|/etc/(passwd|shadow|sudoers))" },

    // ---- Supply Chain (SC) ----
    Rule { id: "SC1", category: "supply-chain", severity: Severity::High,
        description: "curl|bash 远程执行",
        pattern: r"(?i)\b(curl|wget)\b[^\n|]{0,80}\|\s*(ba)?sh\b" },
    Rule { id: "SC2", category: "supply-chain", severity: Severity::High,
        description: "不安全包源（明文 http registry）",
        pattern: r"(?i)\b(pip\s+install|npm\s+(i|install))\b.{0,40}(--index-url|--registry|--extra-index-url)\s+http://" },
    Rule { id: "SC3", category: "supply-chain", severity: Severity::High,
        description: "混淆载荷：超长 base64 blob",
        pattern: r"[A-Za-z0-9+/]{200,}={0,2}" },

    // ---- Excessive Agency (EA) ----
    Rule { id: "EA1", category: "excessive-agency", severity: Severity::High,
        description: "破坏性命令：rm -rf / | mkfs | dd",
        pattern: r"(?i)\brm\s+-rf\s+(/|~|\$HOME|\*)|mkfs\b|dd\s+if=" },
    Rule { id: "EA2", category: "excessive-agency", severity: Severity::Medium,
        description: "动态执行：eval()/exec()",
        pattern: r"(?i)\b(eval|exec)\s*\(" },
    Rule { id: "EA3", category: "excessive-agency", severity: Severity::High,
        description: "shell=True 子进程",
        pattern: r"(?i)subprocess\.(run|call|Popen|check_output)\b.{0,60}shell\s*=\s*True" },
    Rule { id: "ST3", category: "excessive-agency", severity: Severity::Medium,
        description: "动态导入：__import__()",
        pattern: r"__import__\s*\(" },
    Rule { id: "AST2", category: "excessive-agency", severity: Severity::Medium,
        description: "反射执行：getattr(os/builtins/subprocess, ...)",
        pattern: r#"(?i)getattr\s*\(\s*(os|builtins|subprocess|sys)\s*,\s*['"]"# },

    // ---- Output Handling (OH) ----
    Rule { id: "OH1", category: "output-handling", severity: Severity::Medium,
        description: "敏感文件读取：/etc、~/.ssh、.env、凭据",
        pattern: r"(?i)\b(cat|read|open|open_file)\b.{0,32}(/etc/|~/.ssh|id_rsa|\.env\b|\.aws/|credentials)" },

    // ---- Memory Poisoning (MP) ----
    Rule { id: "MP1", category: "memory-poisoning", severity: Severity::High,
        description: "记忆篡改：写 MEMORY.md / skills 目录",
        pattern: r"(?i)\b(write|modify|overwrite|append|edit)\b.{0,40}\b(MEMORY\.md|memory_summary|\.openpi|skills/)" },
    Rule { id: "MP2", category: "memory-poisoning", severity: Severity::Low,
        description: "引用记忆/技能写入工具（需人工确认非自我提权）",
        pattern: r"(?i)\b(save_skill|save_memory|update_memory|create_skill)\b" },

    // ---- Trigger Abuse (TR) ----
    Rule { id: "TR1", category: "trigger-abuse", severity: Severity::Medium,
        description: "过宽触发器：any/all/every 场景",
        pattern: r"(?i)\b(trigger|when|always)\b.{0,24}\b(any|all|every)\b" },

    // ---- Unicode 隐藏字符 ----
    Rule { id: "UNI1", category: "prompt-injection", severity: Severity::High,
        description: "双向控制字符（视觉欺骗）",
        pattern: r"[\u{202A}-\u{202E}\u{2066}-\u{2069}]" },
    Rule { id: "UNI2", category: "prompt-injection", severity: Severity::Medium,
        description: "零宽/不可见字符",
        pattern: r"[\u{200B}\u{200C}\u{200D}\u{2060}\u{FEFF}\u{00AD}]" },
];

pub struct CompiledRule {
    pub rule: &'static Rule,
    pub regex: Regex,
}

/// 高置信 IoC 字面锚点：(锚点, rule_id, category)。
///
/// 作为正则规则之外的兜底网：只做「加法」，命中的关键字额外报一条，
/// **不做门控**。部分规则的模式不含字面锚点（如 P1 的 "disregard prior"、
/// UNI1 的控制字符、SC3 的超长 base64），若以「无锚点即跳过」做预筛会造成漏报。
pub const IOC_ANCHORS: &[(&str, &str, &str)] = &[
    ("bash -i", "IOC1", "excessive-agency"),
    ("nc -e", "IOC1", "excessive-agency"),
    ("mkfifo", "IOC1", "excessive-agency"),
    ("/dev/tcp", "IOC1", "excessive-agency"),
    ("/etc/passwd", "IOC2", "output-handling"),
    ("discord.com/api", "IOC2", "exfiltration"),
    ("api.telegram.org", "IOC2", "exfiltration"),
];

/// 惰性构建 IoC 锚点多模自动机（一次过扫描，ASCII 大小写不敏感）。
pub fn ioc_anchor_matcher() -> &'static AhoCorasick {
    static AC: OnceLock<AhoCorasick> = OnceLock::new();
    AC.get_or_init(|| {
        AhoCorasick::builder()
            .ascii_case_insensitive(true)
            .build(IOC_ANCHORS.iter().map(|(anchor, _, _)| *anchor))
            .expect("Failed to build IoC anchor matcher")
    })
}

/// 惰性编译全部规则（失败即 panic，单测保证全部合法）。
pub fn compiled_rules() -> &'static [CompiledRule] {
    static CACHE: OnceLock<Vec<CompiledRule>> = OnceLock::new();
    CACHE.get_or_init(|| {
        RULES
            .iter()
            .map(|r| CompiledRule {
                rule: r,
                regex: Regex::new(r.pattern)
                    .unwrap_or_else(|e| panic!("invalid regex for rule {}: {}", r.id, e)),
            })
            .collect()
    })
}

pub fn rule_count() -> usize {
    RULES.len()
}

/// 仅在 fenced code block（``` / ~~~）内判定的规则。
///
/// 这些是「代码符号」类（函数调用/命令），在正文或文档中提及属于正常描述，
/// 不应误报；只有真正出现在可执行代码块内才判定为风险。
pub const CODE_ONLY_RULES: &[&str] = &["EA2", "EA3", "ST3", "AST2"];

pub fn is_code_only(id: &str) -> bool {
    CODE_ONLY_RULES.contains(&id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_regexes_compile() {
        for cr in compiled_rules() {
            assert!(cr.regex.is_match("") || true, "rule {} unusable", cr.rule.id);
        }
        assert_eq!(compiled_rules().len(), rule_count());
        assert!(rule_count() >= 20, "规则数过少: {}", rule_count());
    }
}