use anyhow::Result;
use std::path::Path;
use std::time::Duration;
use crate::config::ModelConfig;
use crate::llm_client::LlmClient;
use crate::protocol::ChatMessage;

/// Fast heuristic title extractor from user prompt and optional assistant response.
/// Zero network cost, 0ms, robust and clean.
pub fn summarize_title_heuristic(prompt: &str, cwd: &str) -> String {
    let raw = prompt.trim();
    if raw.is_empty() {
        return fallback_from_cwd(cwd);
    }

    // Strip markdown symbols, code fences, list bullets at start
    let cleaned = raw
        .trim_start_matches(|c: char| c == '#' || c == '*' || c == '`' || c == '>' || c == '~' || c == '/' || c == '-' || c.is_whitespace());

    // Common conversational opening fluff in Chinese and English
    let fluff_patterns = [
        "你好，", "你好", "您好，", "您好", "在吗", "哈喽", "hello", "hi",
        "请问，", "请问", "请帮我", "帮我看看", "看一下", "看看", "分析一下", "查一下", "找一找",
        "麻烦你", "麻烦帮我", "麻烦", "请把", "我想让你", "我想请你", "我想", "我要",
        "好了，", "好了", "ok，", "ok", "now，", "now", "对了，", "对了", "现在，", "现在",
        "oh，对了", "你现在呢，", "你现在，", "你现在", "需要帮我", "给我", "能不能", "能否",
        "可以帮我", "可以", "仔细熟悉一下", "熟悉一下", "实现一个功能，就是", "实现一个功能就是",
        "做一个", "做个", "写一个", "写个", "请用一句话回答：", "用一句话回答：",
    ];

    let mut text = cleaned.to_string();
    for _ in 0..3 {
        let mut matched = false;
        for pat in &fluff_patterns {
            if let Some(stripped) = text.strip_prefix(pat) {
                text = stripped.trim_start_matches(|c: char| c == '，' || c == ',' || c == '。' || c == '：' || c == ':' || c.is_whitespace()).to_string();
                matched = true;
                break;
            }
        }
        if !matched {
            break;
        }
    }

    let folder = folder_name(cwd);

    // Normalize generic project queries with folder name
    if cleaned.contains("熟悉") || cleaned.contains("架构") {
        return if !folder.is_empty() {
            format!("{} 项目架构分析", folder)
        } else {
            "项目架构分析".to_string()
        };
    }
    if cleaned.contains("进行") || cleaned.contains("程度") || cleaned.contains("进展") || cleaned.contains("进度") {
        return if !folder.is_empty() {
            format!("{} 项目进展查看", folder)
        } else {
            "项目进展评估".to_string()
        };
    }

    // Strip trailing punctuation
    let text = text.trim_end_matches(|c: char| c == '，' || c == ',' || c == '。' || c == '！' || c == '!' || c == '？' || c == '?' || c == '~').trim();

    // If text is very long, take the first clause (split by punctuation)
    let first_clause = text.split(|c: char| c == '，' || c == ',' || c == '。' || c == '；' || c == ';' || c == '！' || c == '!' || c == '？' || c == '?')
        .next()
        .unwrap_or(text)
        .trim();

    let mut title = if first_clause.chars().count() >= 4 && first_clause.chars().count() <= 18 {
        first_clause.to_string()
    } else {
        let chars: Vec<char> = text.chars().collect();
        if chars.len() > 18 {
            format!("{}…", chars[..17].iter().collect::<String>())
        } else {
            text.to_string()
        }
    };

    // If title is a generic short token, prefix folder name
    let generic_tokens = ["项目", "代码", "构建", "测试", "会话", "bug", "报错", "分析", "工程"];
    if !folder.is_empty() && generic_tokens.iter().any(|&g| title == g) {
        title = format!("{} {}", folder, title);
    }

    if title.is_empty() {
        fallback_from_cwd(cwd)
    } else {
        title
    }
}

fn folder_name(cwd: &str) -> String {
    if cwd.is_empty() {
        return String::new();
    }
    let p = Path::new(cwd);
    let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
    if name.is_empty() || name == "huaan" || name == "Users" || name == "." {
        String::new()
    } else {
        name.to_string()
    }
}

fn fallback_from_cwd(cwd: &str) -> String {
    let folder = folder_name(cwd);
    if !folder.is_empty() {
        format!("{} 会话", folder)
    } else {
        "新对话".to_string()
    }
}

/// Inspects session .jsonl file and extracts a clean title from messages
pub fn extract_title_from_jsonl(path: &Path, cwd: &str) -> Option<String> {
    if !path.exists() {
        return None;
    }

    let file = std::fs::File::open(path).ok()?;
    use std::io::{BufRead, BufReader};
    let reader = BufReader::new(file);

    let mut first_user_prompt = None;
    let mut second_user_prompt = None;

    for line in reader.lines().flatten() {
        if line.trim().is_empty() {
            continue;
        }
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) {
            if val.get("type").and_then(|v| v.as_str()) == Some("message") {
                if let Some(msg) = val.get("message") {
                    if msg.get("role").and_then(|v| v.as_str()) == Some("user") {
                        if let Some(contents) = msg.get("content").and_then(|v| v.as_array()) {
                            for c in contents {
                                if c.get("type").and_then(|v| v.as_str()) == Some("text") {
                                    if let Some(txt) = c.get("text").and_then(|v| v.as_str()) {
                                        let t = txt.trim();
                                        if !t.is_empty() {
                                            if first_user_prompt.is_none() {
                                                first_user_prompt = Some(t.to_string());
                                            } else if second_user_prompt.is_none() {
                                                second_user_prompt = Some(t.to_string());
                                                break;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    let chosen_prompt = match (first_user_prompt, second_user_prompt) {
        (Some(p1), Some(p2)) => {
            // If first was just greeting like "你好", choose second
            let trimmed = p1.trim_matches(|c: char| c == '，' || c == ',' || c == '。' || c == '！' || c.is_whitespace());
            if trimmed == "你好" || trimmed == "您好" || trimmed == "hi" || trimmed == "hello" || trimmed == "在吗" {
                p2
            } else {
                p1
            }
        }
        (Some(p1), None) => p1,
        _ => return None,
    };

    let title = summarize_title_heuristic(&chosen_prompt, cwd);
    if title.is_empty() || title == "新对话" {
        None
    } else {
        Some(title)
    }
}

/// Asynchronously asks LLM to summarize conversation into a concise title (4-12 chars).
pub async fn summarize_title_llm(
    llm: &LlmClient,
    model_config: &ModelConfig,
    prompt: &str,
    reply: &str,
) -> Result<String> {
    let clean_prompt: String = prompt.chars().take(200).collect();
    let clean_reply: String = reply.chars().take(200).collect();

    let system_msg = ChatMessage::system("你是一个会话标题提炼专家。请阅读用户与助手的对话，用4-10个字的简短中文短语归纳对话核心主题。直接输出标题，严禁任何标点符号、引号或套话前缀（如'标题：'）。");
    let user_msg = ChatMessage::user(format!("用户：{}\n助手：{}", clean_prompt, clean_reply));

    let cancel_token = tokio_util::sync::CancellationToken::new();
    struct NullHandler;
    impl crate::llm_client::StreamEventHandler for NullHandler {}

    // 4-second timeout limit
    let fut = llm.stream_chat_completion(
        model_config,
        vec![system_msg, user_msg],
        None,
        cancel_token.clone(),
        &NullHandler,
    );

    let res = tokio::time::timeout(Duration::from_secs(4), fut).await??;
    let title = res.text.trim();
    let clean_title = title
        .trim_start_matches("标题：")
        .trim_start_matches("标题:")
        .trim_matches(|c: char| c == '"' || c == '“' || c == '”' || c == '《' || c == '》' || c == '`' || c == ' ')
        .trim_end_matches(|c: char| c == '。' || c == '！' || c == '!' || c == '？' || c == '?' || c == '，' || c == ',');

    if clean_title.is_empty() {
        anyhow::bail!("Empty LLM title");
    }

    let final_title: String = clean_title.chars().take(18).collect();
    Ok(final_title)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_heuristic_cleaning() {
        assert_eq!(
            summarize_title_heuristic("你好，帮我看看这个项目进行的如何了", "/Users/huaan/tv_app"),
            "tv_app 项目进展查看"
        );
        assert_eq!(
            summarize_title_heuristic("找一找pi-agent的破甲插件", "/Users/huaan"),
            "pi-agent的破甲插件"
        );
        assert_eq!(
            summarize_title_heuristic("仔细熟悉一下这个项目", "/Users/huaan/Compositor-main"),
            "Compositor-main 项目架构分析"
        );
        assert_eq!(
            summarize_title_heuristic("查看当前网络下的设备", "/Users/huaan"),
            "查看当前网络下的设备"
        );
        assert_eq!(
            summarize_title_heuristic("请用一句话回答：1+1等于几", "/Users/huaan/tv_app"),
            "1+1等于几"
        );
    }
}
