//! 单轮（turn）工具预算与「原地打转」检测。
//!
//! 背景：agent loop 此前只有 `max_steps` 一道闸（默认 200，可配 0 = 无限），而
//! **每一步可以发起多个工具调用**。真机实测出现过一轮 220 次工具调用、跑了 23 分钟
//! 仍未收敛，而 UI 上只有一句「执行中 21m 21s」——用户完全分不出「在稳步推进」和
//! 「已经卡死」。
//!
//! 这里的策略是**软性收尾**，不是硬杀：
//!
//! * 到 soft 阈值 → 注入一句提示，让模型知道自己用了多少、该准备收尾；
//! * 到 firm 阈值 → 明确要求「先给结论或先向用户请示」；
//! * 到 hard 阈值 → 不再执行新工具，交给既有的「最终总结」通道（tools 关闭，
//!   强制产出面向用户的汇报），而不是无声中断；
//! * 同一条命令连续/累计重复 → 判定原地打转，立即提示换思路。
//!
//! 注入位置很关键：提示必须**在所有工具结果都追加完之后**再 push 进消息链，
//! 否则 assistant 的 `tool_calls` 会缺少对应的 tool 结果，上游会直接 400。

use std::collections::HashMap;

/// 默认硬顶：一轮最多执行多少次工具调用。
pub const DEFAULT_TOOL_BUDGET: usize = 160;
/// 同一条命令**连续**重复这么多次 → 判定原地打转。
pub const REPEAT_STREAK: usize = 3;
/// 同一条命令在本轮**累计**出现这么多次 → 判定原地打转。
pub const REPEAT_TOTAL: usize = 5;
/// 指纹（命令 + 参数）截断长度：够区分命令，又不会因为超长参数产生误判。
const FINGERPRINT_LIMIT: usize = 400;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GuardLevel {
    /// 到 soft 阈值：温和提醒，准备收尾。
    Soft,
    /// 到 firm 阈值：要求先给结论或先问用户。
    Firm,
    /// 同一条命令在打转。
    Repeat,
}

impl GuardLevel {
    /// 给 UI 用的稳定标识。
    pub fn as_str(self) -> &'static str {
        match self {
            GuardLevel::Soft => "soft",
            GuardLevel::Firm => "firm",
            GuardLevel::Repeat => "repeat",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GuardNotice {
    pub level: GuardLevel,
    pub tool_calls: usize,
    pub budget: usize,
    /// 注入给模型的系统提示（作为 user 消息追加）。
    pub directive: String,
    /// 给 UI 显示的一句话。
    pub message: String,
}

/// 工具调用的「身份指纹」：命令名 + 归一化后的参数。
///
/// 归一化做三件事：把连续空白折成一个空格（`git   status` 与 `git status` 是同一条
/// 命令）、**在字符串值内部也折叠空白**（`Value::to_string()` 会把真换行转义成
/// `\n` 两个字面字符，直接哈希 JSON 文本会让同一条命令算出两个指纹）、截断超长参数
/// （避免 `write` 大文件正文导致每次都算新指纹）。
pub fn fingerprint(tool_name: &str, args: &serde_json::Value) -> String {
    let mut raw = String::new();
    push_normalized(args, &mut raw);

    let mut out = String::with_capacity(tool_name.len() + 1 + raw.len().min(FINGERPRINT_LIMIT));
    out.push_str(tool_name);
    out.push('|');
    let mut prev_space = false;
    for ch in raw.chars() {
        if out.len() >= FINGERPRINT_LIMIT {
            break;
        }
        if ch.is_whitespace() {
            if !prev_space {
                out.push(' ');
                prev_space = true;
            }
        } else {
            out.push(ch);
            prev_space = false;
        }
    }
    out
}

/// 把 JSON 展开成「键=值;」的扁平文本，字符串按原样（不转义）追加，
/// 这样真换行、制表符才会被上层的空白折叠处理掉。
fn push_normalized(value: &serde_json::Value, out: &mut String) {
    match value {
        serde_json::Value::String(s) => out.push_str(s.trim()),
        serde_json::Value::Array(items) => {
            for item in items {
                push_normalized(item, out);
                out.push(',');
            }
        }
        serde_json::Value::Object(map) => {
            for (key, val) in map {
                out.push_str(key);
                out.push('=');
                push_normalized(val, out);
                out.push(';');
            }
        }
        other => out.push_str(&other.to_string()),
    }
}

/// 一轮之内的工具预算 + 打转检测器。纯内存状态、无 IO，便于单测。
#[derive(Debug)]
pub struct TurnGuard {
    budget: usize,
    calls: usize,
    last_fingerprint: Option<String>,
    streak: usize,
    seen: HashMap<String, usize>,
    fired_soft: bool,
    fired_firm: bool,
    /// 上次因打转提示时已经执行了多少次调用，避免每一步都念一遍。
    last_repeat_at: Option<usize>,
}

impl Default for TurnGuard {
    fn default() -> Self {
        Self::new(DEFAULT_TOOL_BUDGET)
    }
}

impl TurnGuard {
    pub fn new(budget: usize) -> Self {
        Self {
            // 预算至少留 8 次，避免配置成 0 时第一轮就被硬顶掐掉。
            budget: budget.max(8),
            calls: 0,
            last_fingerprint: None,
            streak: 0,
            seen: HashMap::new(),
            fired_soft: false,
            fired_firm: false,
            last_repeat_at: None,
        }
    }

    /// 从环境变量读取硬顶，与 `OPENPI_MAX_STEPS` 的既有做法保持一致。
    pub fn from_env() -> Self {
        let budget = std::env::var("OPENPI_TURN_TOOL_BUDGET")
            .ok()
            .and_then(|s| s.parse::<usize>().ok())
            .unwrap_or(DEFAULT_TOOL_BUDGET);
        Self::new(budget)
    }

    pub fn budget(&self) -> usize {
        self.budget
    }

    pub fn tool_calls(&self) -> usize {
        self.calls
    }

    /// soft 阈值：预算的 1/4（下限 10）。
    fn soft_at(&self) -> usize {
        (self.budget / 4).max(10)
    }

    /// firm 阈值：预算的 1/2（下限 20）。
    fn firm_at(&self) -> usize {
        (self.budget / 2).max(20)
    }

    /// 是否已达硬顶。调用方在**执行新工具之前**检查，达到就转入最终总结。
    pub fn budget_exhausted(&self) -> bool {
        self.calls >= self.budget
    }

    /// 记录一次即将执行的工具调用，返回需要注入的提示（没有则 `None`）。
    pub fn record(&mut self, tool_name: &str, args: &serde_json::Value) -> Option<GuardNotice> {
        self.calls += 1;
        let fp = fingerprint(tool_name, args);

        if self.last_fingerprint.as_deref() == Some(fp.as_str()) {
            self.streak += 1;
        } else {
            self.last_fingerprint = Some(fp.clone());
            self.streak = 1;
        }
        let total = {
            let entry = self.seen.entry(fp.clone()).or_insert(0);
            *entry += 1;
            *entry
        };

        // 打转比预算更具体、更有用，优先提示；冷却 REPEAT_STREAK 次调用再念一次。
        let spinning = self.streak >= REPEAT_STREAK || total >= REPEAT_TOTAL;
        let repeat_cooled_down = self
            .last_repeat_at
            .map(|at| self.calls >= at + REPEAT_STREAK)
            .unwrap_or(true);
        if spinning && repeat_cooled_down {
            self.last_repeat_at = Some(self.calls);
            let cmd: String = fp.chars().take(160).collect();
            return Some(GuardNotice {
                level: GuardLevel::Repeat,
                tool_calls: self.calls,
                budget: self.budget,
                directive: format!(
                    "⚠️ [系统提示]：你本轮已经重复执行同一条操作 {} 次（`{}`）。重复执行通常不会产生新信息。\
                     请改为：① 基于已有结果给出结论；② 换一个真正不同的思路或命令；\
                     ③ 直接向用户说明卡在哪里、需要什么信息。若你确实需要重复（例如目标文件已被修改），\
                     请先说明理由再执行。",
                    total.max(self.streak),
                    cmd
                ),
                message: format!("检测到重复操作，已提醒模型换思路（第 {} 次工具调用）", self.calls),
            });
        }

        if self.calls >= self.firm_at() && !self.fired_firm {
            self.fired_firm = true;
            return Some(GuardNotice {
                level: GuardLevel::Firm,
                tool_calls: self.calls,
                budget: self.budget,
                directive: format!(
                    "⚠️ [系统提示]：本轮已执行 {} 次工具调用（上限 {}）。请立即收敛：先向用户汇报目前掌握的结论与证据，\
                     并说明还需要哪些步骤；如需继续，请先征求用户同意，不要继续无止境探索。",
                    self.calls, self.budget
                ),
                message: format!("本轮工具调用已达 {} 次，已提醒模型收敛并汇报", self.calls),
            });
        }

        if self.calls >= self.soft_at() && !self.fired_soft {
            self.fired_soft = true;
            return Some(GuardNotice {
                level: GuardLevel::Soft,
                tool_calls: self.calls,
                budget: self.budget,
                directive: format!(
                    "ℹ️ [系统提示]：本轮已执行 {} 次工具调用（上限 {}）。请开始收敛：优先复用已有结果，\
                     避免重复探索，并准备向用户给出阶段性结论。",
                    self.calls, self.budget
                ),
                message: format!("本轮已执行 {} 次工具调用，Agent 正在收敛", self.calls),
            });
        }

        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn args(cmd: &str) -> serde_json::Value {
        json!({ "command": cmd })
    }

    #[test]
    fn fingerprint_collapses_whitespace() {
        assert_eq!(
            fingerprint("bash", &args("git   status\n")),
            fingerprint("bash", &args("git status"))
        );
    }

    #[test]
    fn fingerprint_distinguishes_commands_and_tools() {
        assert_ne!(fingerprint("bash", &args("ls")), fingerprint("bash", &args("ls -la")));
        assert_ne!(fingerprint("bash", &args("ls")), fingerprint("read", &args("ls")));
    }

    #[test]
    fn fingerprint_truncates_long_payloads() {
        let long = "x".repeat(5000);
        let fp = fingerprint("write", &args(&long));
        assert!(fp.len() <= FINGERPRINT_LIMIT);
    }

    #[test]
    fn soft_and_firm_fire_exactly_once() {
        let mut guard = TurnGuard::new(40); // soft=10, firm=20
        let mut notices = Vec::new();
        for i in 0..30 {
            if let Some(n) = guard.record("bash", &args(&format!("cmd-{i}"))) {
                notices.push(n.level);
            }
        }
        assert_eq!(notices, vec![GuardLevel::Soft, GuardLevel::Firm]);
    }

    #[test]
    fn hard_budget_is_reached_after_the_configured_number_of_calls() {
        let mut guard = TurnGuard::new(12);
        for i in 0..11 {
            assert!(!guard.budget_exhausted());
            guard.record("bash", &args(&format!("cmd-{i}")));
        }
        guard.record("bash", &args("cmd-11")); // 第 12 次 → 到达硬顶
        assert!(guard.budget_exhausted());
        assert_eq!(guard.tool_calls(), 12);
    }

    #[test]
    fn consecutive_repeats_are_flagged() {
        let mut guard = TurnGuard::new(1000);
        assert!(guard.record("bash", &args("log show --last 1m")).is_none());
        assert!(guard.record("bash", &args("log show --last 1m")).is_none());
        let notice = guard
            .record("bash", &args("log show --last 1m"))
            .expect("第 3 次连续重复应提示");
        assert_eq!(notice.level, GuardLevel::Repeat);
        assert!(notice.message.contains("重复"));
    }

    #[test]
    fn repeated_command_that_is_not_consecutive_is_still_flagged() {
        let mut guard = TurnGuard::new(1000);
        let mut flagged = false;
        for i in 0..5 {
            // 中间穿插别的命令，连续计数到不了 3，但累计到 5 仍应提示
            guard.record("bash", &args(&format!("other-{i}")));
            if let Some(n) = guard.record("bash", &args("ps aux | grep chronod")) {
                assert_eq!(n.level, GuardLevel::Repeat);
                flagged = true;
            }
        }
        assert!(flagged, "累计 5 次同一命令应被判为打转");
    }

    #[test]
    fn repeat_notice_is_cooled_down() {
        let mut guard = TurnGuard::new(1000);
        let mut count = 0;
        for _ in 0..12 {
            if let Some(n) = guard.record("bash", &args("same")) {
                if n.level == GuardLevel::Repeat {
                    count += 1;
                }
            }
        }
        // 12 次调用里不应每一步都念，但也必须不止念一次。
        assert!((2..=5).contains(&count), "重复提示应被冷却，实际 {count}");
    }

    #[test]
    fn budget_floor_protects_against_a_zero_config() {
        let guard = TurnGuard::new(0);
        assert_eq!(guard.budget(), 8);
        assert!(!guard.budget_exhausted());
    }
}
