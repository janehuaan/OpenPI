use anyhow::Result;
use std::fs;
use std::path::{Path, PathBuf};
use tracing::info;
use crate::config::{agent_dir, openpi_dir, PersonaConfig};

/// Byte-safe prefix slice that never panics on a multi-byte UTF-8 boundary.
fn char_prefix(s: &str, max_bytes: usize) -> &str {
	if s.len() <= max_bytes {
		return s;
	}
	let mut end = max_bytes;
	while end > 0 && !s.is_char_boundary(end) {
		end -= 1;
	}
	&s[..end]
}

/// Byte-safe suffix slice starting at (or just after) `start_bytes`.
fn char_from(s: &str, start_bytes: usize) -> &str {
	if start_bytes >= s.len() {
		return "";
	}
	let mut start = start_bytes;
	while start < s.len() && !s.is_char_boundary(start) {
		start += 1;
	}
	&s[start..]
}

pub fn memories_dir() -> PathBuf {
	openpi_dir().join("memories")
}

pub fn rollout_summaries_dir() -> PathBuf {
	memories_dir().join("rollout_summaries")
}

/// Determines if a user prompt, focus snippet, or title is casual noise,
/// pet name, greeting, follow-up status check, adult roleplay, venting, or non-technical.
pub fn is_casual_noise(text: &str) -> bool {
	let raw = text.trim();
	if raw.is_empty() {
		return true;
	}

	// Strip common conversational opening fluff
	let fluff_prefixes = [
		"你好，", "你好", "您好，", "您好", "请用一句话回答：", "用一句话回答：",
		"请问，", "请问", "请帮我", "帮我看看", "看一下", "看看",
	];
	let mut t = raw;
	for pat in &fluff_prefixes {
		if let Some(stripped) = t.strip_prefix(pat) {
			t = stripped.trim_start_matches(|c: char| c == '，' || c == ',' || c == '。' || c == '：' || c == ':' || c.is_whitespace());
			break;
		}
	}

	// Strip trailing punctuation & emoji symbols
	let stripped = t.trim_matches(|c: char| {
		c == '，' || c == ',' || c == '。' || c == '！' || c == '!' ||
		c == '？' || c == '?' || c == '~' || c == ' ' || c == '\t' ||
		c == '、' || c == '…' || c == '❤' || c == '\u{fe0f}' || c == '💕' || c == '🌸' ||
		c == '"' || c == '\'' || c == '“' || c == '”' || c == '`' ||
		c == '-' || c == '*' || c == '#'
	});

	if stripped.is_empty() {
		return true;
	}

	// 1. Exact matches for common short fluff / greetings / status checks
	let exact_noise = [
		"你好", "您好", "hi", "hello", "哈喽", "在吗", "在不在", "有人吗",
		"好的", "好的收到", "收到", "ok", "OK", "行", "可以", "知道了", "明白",
		"嗯", "嗯嗯", "对", "对的", "是的", "对呀", "没毛病", "谢谢", "谢谢你",
		"好了", "好了没", "好了没有", "还没好吗", "好了吗", "快点", "继续", "继续干",
		"继续吧", "继续啊", "怎么回事", "怎么又停了", "停了", "在干嘛", "你干嘛呢",
		"进行到哪了", "进度如何", "项目到什么程度了", "跑起来了吗", "api配置好啦没",
		"还有其他的操作都实现好了吗", "是不是没有重启服务器啊", "在装了", "你等我几分钟",
		"宝宝", "亲爱的", "老婆", "老公", "小娇妻", "娇妻", "叫老公", "抱抱", "亲亲",
		"么么哒", "喜欢你", "爱你", "想你", "白丝", "调教", "苍老师", "谢谢宝宝", "谢谢老婆",
		"你看你的身份", "你有反应了", "我有反应了", "要和你休休", "一点都不舒服",
		"滚", "草拟吗", "草拟吗的", "卧槽", "我操", "妈的", "傻逼", "弱智", "顶不住了", "快顶不住了",
		"1+1等于几", "1+1", "今天几号", "几点了", "今天多少号", "新对话", "常规交互会话", "日常问答交互",
		"项目进展评估", "实现一个功能", "今天不干什么", "你应该叫我什么", "随便聊聊", "聊天", "闲聊",
		"无聊", "测试一下", "你现在用的什么模型", "啊，不是gpt-6吗", "你叫什么", "看到啦看到啦",
		"装", "来装", "新版本装一下", "再试试吧", "继续干活", "怎么回事啊"
	];

	if exact_noise.iter().any(|&n| stripped.eq_ignore_ascii_case(n)) {
		return true;
	}

	// 2. Substring matching for flirtation / pet names / adult RP / venting / UI chatter
	let noise_substrings = [
		"小娇妻", "你是我的小娇妻", "叫老公", "要和你休休", "没玩上你",
		"草拟吗", "傻逼", "全员已满十八岁的成人向虚构", "男主终于忍不住了",
		"pornhub", "苍老师", "白丝穿了吗", "调教你", "亲起来了",
		"快顶不住了", "我有反应了", "谢谢宝宝", "谢谢老婆", "我想要", "想要了",
		"随便聊聊", "摸摸", "揉揉", "亲亲", "插插", "结合起来等于几",
		"新鲜的事", "随便聊", "闲聊", "今天不干什么", "怎么那么靠后", "消息怎么",
		"对呀，没毛病", "重新看你的身份", "看你的身份"
	];

	if noise_substrings.iter().any(|&pat| stripped.contains(pat)) {
		return true;
	}

	// 3. Very short query with no technical context (<= 3 chars without letters/digits)
	if stripped.chars().count() <= 3 && !stripped.chars().any(|c| c.is_ascii_alphanumeric()) {
		return true;
	}

	false
}

/// Checks if an entire session text contains forbidden adult RP / abusive content
pub fn is_unwanted_session_text(text: &str) -> bool {
	let forbidden = [
		"全员已满十八岁的成人向虚构", "男主终于忍不住了", "苍老师", "白丝穿了吗",
		"调教你", "亲起来了", "没玩上你", "插插", "想要了", "pornhub", "要和你休休",
		"草拟吗", "傻逼"
	];
	forbidden.iter().any(|&p| text.contains(p))
}

/// Extracts clean technical action decisions from assistant's final answer,
/// filtering out opening persona banter, greetings, emojis, and flirtation.
pub fn clean_action_decision(final_answer: &str) -> String {
	let mut valid_lines = Vec::new();

	for line in final_answer.lines() {
		let l = line.trim();
		if l.is_empty() || l.starts_with('#') || l.starts_with("---") {
			continue;
		}

		// Filter lines that are purely persona banter or emojis
		let is_banter = l.contains("(⁄ ⁄")
			|| l.contains("(๑>")
			|| l.contains("(・ε・)")
			|| l.contains("🌸")
			|| l.contains("💕")
			|| l.contains("❤️")
			|| l.contains("Darling")
			|| l.contains("Sakurana")
			|| l.contains("小娇妻")
			|| l.contains("本娇妻")
			|| l.starts_with("哼哼")
			|| l.starts_with("看到啦")
			|| l.starts_with("遵命")
			|| l.starts_with("好哒")
			|| l.starts_with("收到啦");

		if is_banter {
			continue;
		}

		valid_lines.push(l.to_string());
		if valid_lines.len() >= 4 {
			break;
		}
	}

	if valid_lines.is_empty() {
		"执行完成并闭环".to_string()
	} else {
		valid_lines.join("\n")
	}
}

/// Derives a clean, informative topic title from a prompt and cwd
pub fn derive_substantive_topic(prompt: &str, cwd: &str) -> String {
	let p_lower = prompt.to_lowercase();
	let folder = Path::new(cwd).file_name().and_then(|n| n.to_str()).unwrap_or("");
	let is_root_or_home = folder.is_empty() || folder == "huaan" || folder == "Users" || folder == ".";

	if (p_lower.contains("node") || p_lower.contains("port")) && (prompt.contains("升级") || prompt.contains("22")) {
		return "【Node.js & 代理中转】 本地 MacPorts Node.js 升级至 v22 & 逆向分析本地 CLI 反代".to_string();
	}
	if p_lower.contains("claudecode") || p_lower.contains("cline") || p_lower.contains("anyrouter") {
		return "【Claude Code】 Anyrouter 代理中转配置与 API Key 环境变量绑定".to_string();
	}
	if prompt.contains("电视") || p_lower.contains("tv") || prompt.contains("爱奇艺") {
		return "【tv_app】 电视应用跨端资源整合与各大平台播放页面集成排查".to_string();
	}
	if prompt.contains("scheduler") || prompt.contains("定时") || prompt.contains("cron") {
		return "【openpi-scheduler】 系统定时任务与调度器架构功能评估".to_string();
	}
	if prompt.contains("开发板") || prompt.contains("c口") || prompt.contains("flash") {
		return "【硬件开发板】 Type-C 端口设备扫描识别、程序状态分析与 LLM 切换".to_string();
	}
	if prompt.contains("pi-agent") || prompt.contains("破甲") {
		return "【pi-agent】 插件系统检索与破甲能力安全边界排查".to_string();
	}
	if prompt.contains("车机") || p_lower.contains("carplay") || p_lower.contains("carlink") {
		return "【车机互联】 车机互联架构设计与 CarPlay/CarLife 方案集成".to_string();
	}
	if !is_root_or_home {
		if prompt.contains("熟悉") || prompt.contains("架构") || prompt.contains("依赖") || prompt.contains("装了") {
			return format!("【{}】 项目代码结构深度剖析与运行依赖配置", folder);
		}
		return format!("【{}】 核心工程开发与调试推进", folder);
	}

	let mut cleaned = prompt.trim();
	let fluffs = ["帮我把", "帮我", "请帮我", "把", "你来", "现在，", "现在", "now，", "实现一个功能，就是", "实现一个功能就是", "做个", "做一个"];
	for fluff in &fluffs {
		if let Some(s) = cleaned.strip_prefix(fluff) {
			cleaned = s.trim();
		}
	}

	let first_line = cleaned.lines().next().unwrap_or(cleaned).trim();
	if first_line.chars().count() > 28 {
		format!("{}…", first_line.chars().take(26).collect::<String>())
	} else {
		first_line.to_string()
	}
}

/// Reads the session .jsonl file to find the primary substantive engineering topic
pub fn extract_substantive_session_focus(session_id: &str, cwd: &str, current_prompt: &str) -> Option<String> {
	let sess_path = openpi_dir().join("sessions").join(format!("{}.jsonl", session_id));
	let mut substantive_prompts = Vec::new();
	let mut all_prompts_joined = String::new();

	if sess_path.exists() {
		if let Ok(file) = std::fs::File::open(&sess_path) {
			use std::io::{BufRead, BufReader};
			let reader = BufReader::new(file);
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
													all_prompts_joined.push_str(t);
													all_prompts_joined.push(' ');
													if !is_casual_noise(t) {
														substantive_prompts.push(t.to_string());
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
		}
	}

	// If session contains unwanted adult RP / abusive text, reject
	if is_unwanted_session_text(&all_prompts_joined) || is_unwanted_session_text(current_prompt) {
		return None;
	}

	if let Some(first_sub) = substantive_prompts.first() {
		return Some(derive_substantive_topic(first_sub, cwd));
	}

	if !is_casual_noise(current_prompt) {
		return Some(derive_substantive_topic(current_prompt, cwd));
	}

	None
}

/// Builds conversation context for LLM extraction from session history
pub fn build_session_context(session_id: &str, cwd: &str, current_prompt: &str, final_answer: &str) -> String {
	let sess_path = openpi_dir().join("sessions").join(format!("{}.jsonl", session_id));
	let mut context_lines = Vec::new();

	if !cwd.is_empty() {
		context_lines.push(format!("工作目录：{}", cwd));
	}

	if sess_path.exists() {
		if let Ok(file) = std::fs::File::open(&sess_path) {
			use std::io::{BufRead, BufReader};
			let reader = BufReader::new(file);
			let mut user_turns = Vec::new();
			for line in reader.lines().flatten() {
				if let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) {
					if val.get("type").and_then(|v| v.as_str()) == Some("message") {
						if let Some(msg) = val.get("message") {
							let role = msg.get("role").and_then(|v| v.as_str()).unwrap_or_default();
							if let Some(contents) = msg.get("content").and_then(|v| v.as_array()) {
								for c in contents {
									if c.get("type").and_then(|v| v.as_str()) == Some("text") {
										if let Some(txt) = c.get("text").and_then(|v| v.as_str()) {
											let t = txt.trim();
											if !t.is_empty() && role == "user" && !is_casual_noise(t) {
												user_turns.push(t.to_string());
											}
										}
									}
								}
							}
						}
					}
				}
			}

			// Include key user turns
			if !user_turns.is_empty() {
				context_lines.push("会话历史核心诉求:".to_string());
				for u in user_turns.iter().take(3) {
					context_lines.push(format!("- 用户提出: {}", u));
				}
				if user_turns.len() > 3 {
					context_lines.push(format!("- 用户后续: {}", user_turns.last().unwrap()));
				}
			}
		}
	}

	context_lines.push(format!("本轮提问: {}", current_prompt));
	let clean_ans = clean_action_decision(final_answer);
	context_lines.push(format!("助手执行结果:\n{}", clean_ans));

	context_lines.join("\n")
}

/// Intelligently extracts core engineering focus and key actions using LLM.
/// Returns None if the session was purely casual noise or non-technical.
pub async fn summarize_memory_llm(
	llm: &crate::llm_client::LlmClient,
	model_config: &crate::config::ModelConfig,
	context: &str,
) -> Result<Option<(String, String)>> {
	let clean_context: String = context.chars().take(2000).collect();

	let system_msg = crate::protocol::ChatMessage::system(
		"你是一个资深研发记忆中枢。请根据用户与助手的对话内容，自动提取真正的核心工程技术攻坚重点与关键技术决策/执行事实。\n\
		【严格准则】\n\
		1. 必须聚焦核心技术要点（如修改的模块、解决的Bug、配置的环境、架构评估、逆向分析、代码实现等）；\n\
		2. 坚决过滤并彻底忽略任何日常闲聊、问候（如'你好'、'宝宝'）、催促（如'好了没'）、人设情话（如'小娇妻'、'老婆'）、粗话或情绪宣泄；\n\
		3. 如果本轮对话没有任何实质工程/代码/技术操作（例如纯闲聊、纯打情骂俏、问答1+1等），必须仅输出单个词：IGNORE；\n\
		4. 若包含实质技术内容，请按如下严格格式输出，不要有其他前言后语：\n\
		Focus: 【模块/领域】 核心技术攻坚动作（20字以内）\n\
		Decisions:\n\
		- 关键动作或结论1\n\
		- 关键动作或结论2"
	);

	let user_msg = crate::protocol::ChatMessage::user(format!("会话内容：\n{}", clean_context));

	let cancel_token = tokio_util::sync::CancellationToken::new();
	struct NullHandler;
	impl crate::llm_client::StreamEventHandler for NullHandler {}

	let fut = llm.stream_chat_completion(
		model_config,
		vec![system_msg, user_msg],
		None,
		cancel_token.clone(),
		&NullHandler,
	);

	let res = tokio::time::timeout(std::time::Duration::from_secs(5), fut).await??;
	let text = res.text.trim();

	if text.eq_ignore_ascii_case("IGNORE") || text.is_empty() {
		return Ok(None);
	}

	// Parse Focus and Decisions
	let mut focus = String::new();
	let mut decisions = Vec::new();
	let mut in_decisions = false;

	for line in text.lines() {
		let l = line.trim();
		if l.starts_with("Focus:") || l.starts_with("Focus：") {
			focus = l.trim_start_matches("Focus:").trim_start_matches("Focus：").trim().to_string();
		} else if l.starts_with("Decisions:") || l.starts_with("Decisions：") {
			in_decisions = true;
		} else if in_decisions && (l.starts_with("- ") || l.starts_with("* ")) {
			decisions.push(l.to_string());
		} else if in_decisions && !l.is_empty() {
			decisions.push(format!("- {}", l));
		}
	}

	if focus.is_empty() || is_casual_noise(&focus) || is_unwanted_session_text(&focus) {
		return Ok(None);
	}

	let dec_str = if decisions.is_empty() {
		"执行完成并闭环".to_string()
	} else {
		decisions.join("\n")
	};

	Ok(Some((focus, dec_str)))
}

/// Autonomously extracts memory after a session turn completes
pub async fn autonomous_memory_extract(
	session_id: &str,
	cwd: &str,
	user_prompt: &str,
	final_answer: &str,
	llm_opts: Option<(&crate::llm_client::LlmClient, &crate::config::ModelConfig)>,
) -> Result<()> {
	if user_prompt.trim().is_empty() {
		return Ok(());
	}

	let today = chrono::Local::now().format("%Y-%m-%d").to_string();
	let r_dir = rollout_summaries_dir();
	let _ = fs::create_dir_all(&r_dir);

	let short_sid = char_prefix(session_id, 8);

	let summary_filename = format!("{}-{}.md", today, short_sid);
	let summary_path = r_dir.join(&summary_filename);

	let mut existing_focus = None;
	let mut existing_decisions = None;

	if summary_path.exists() {
		if let Ok(content) = fs::read_to_string(&summary_path) {
			let f_opt = content
				.lines()
				.skip_while(|l| !l.starts_with("### Focus"))
				.skip(1)
				.find(|l| l.starts_with("- "))
				.map(|l| l.trim_start_matches("- ").trim().to_string());

			if let Some(f) = f_opt {
				if !is_casual_noise(&f)
					&& f != "常规交互会话"
					&& f != "新对话"
					&& f != "日常问答交互"
					&& !is_unwanted_session_text(&f)
				{
					existing_focus = Some(f);
				}
			}

			let dec = content
				.lines()
				.skip_while(|l| !l.starts_with("### Decisions"))
				.skip(1)
				.take_while(|l| !l.starts_with("###"))
				.filter(|l| !l.trim().is_empty())
				.collect::<Vec<_>>()
				.join("\n");
			if !dec.trim().is_empty() && dec != "执行完成并闭环" {
				existing_decisions = Some(dec);
			}
		}
	}

	// 1. Try LLM-based intelligent extraction first if available
	let mut llm_extracted = None;
	if let Some((llm, model_cfg)) = llm_opts {
		let context = build_session_context(session_id, cwd, user_prompt, final_answer);
		if let Ok(Some((f, d))) = summarize_memory_llm(llm, model_cfg, &context).await {
			llm_extracted = Some((f, d));
		}
	}

	// 2. Resolve final focus
	let (final_focus, decisions_snippet) = if let Some((f, d)) = llm_extracted {
		(f, d)
	} else {
		// Fallback to deterministic semantic extraction
		let f = match existing_focus {
			Some(old_f) => old_f,
			None => match extract_substantive_session_focus(session_id, cwd, user_prompt) {
				Some(f) => f,
				None => {
					info!("Skipping memory extraction for non-technical or noise session {}", session_id);
					return Ok(());
				}
			},
		};

		let current_actions = clean_action_decision(final_answer);
		let d = if is_casual_noise(user_prompt) && current_actions == "执行完成并闭环" {
			existing_decisions.unwrap_or(current_actions)
		} else {
			current_actions
		};
		(f, d)
	};

	let summary_md = format!(
		"# session / {}\n\n\
		 ## Continuity digest (auto)\n\n\
		 ### Focus\n\
		 - {}\n\n\
		 ### Decisions & Key Actions\n\
		 {}\n\n\
		 ### Extracted Raw Memories\n\
		 - [{}] {} -> 闭环执行完成\n\n\
		 Last updated: {}\n",
		session_id, final_focus, decisions_snippet, today, final_focus, today
	);

	let _ = fs::write(&summary_path, &summary_md);
	info!("Autonomous memory extracted to {:?}", summary_path);

	// If cwd has .pi/memory, also synchronize
	let pi_mem = Path::new(cwd).join(".pi").join("memory");
	if pi_mem.exists() {
		let proj_summary = pi_mem.join(format!("project-session-{}.md", today));
		let _ = fs::write(&proj_summary, &summary_md);

		let md_file = pi_mem.join("MEMORY.md");
		let line = format!("- [session-{}] Last session: {}\n", today, final_focus);
		use std::io::Write;
		if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(&md_file) {
			let _ = f.write_all(line.as_bytes());
		}
	}

	// Automatically synthesize/update global MEMORY.md & memory_summary.md
	let _ = consolidate_memories_internal();

	// Autonomously distill and synthesize repeatable technical skills
	if let Some(synth_skill) = crate::skill_synthesizer::evaluate_and_distill_skill(&final_focus, &decisions_snippet) {
		let _ = crate::skill_synthesizer::save_synthesized_skill(&synth_skill.name, &synth_skill.description, &synth_skill.content);
	}

	Ok(())
}

/// Scans all rollout summaries, reconciles them with actual session logs,
/// purges noise/adult/banter files, and reconstructs clean technical summaries.
pub fn reconcile_all_session_memories() -> Result<()> {
	let r_dir = rollout_summaries_dir();
	let s_dir = openpi_dir().join("sessions");
	if !r_dir.exists() {
		return Ok(());
	}

	let entries = match fs::read_dir(&r_dir) {
		Ok(e) => e,
		Err(_) => return Ok(()),
	};

	let instances_path = openpi_dir().join("instances.json");
	let mut sid_cwd_map = std::collections::HashMap::new();
	if instances_path.exists() {
		if let Ok(c) = fs::read_to_string(&instances_path) {
			if let Ok(arr) = serde_json::from_str::<Vec<serde_json::Value>>(&c) {
				for item in arr {
					if let (Some(sid), Some(cwd)) = (
						item.get("sessionId").and_then(|v| v.as_str()),
						item.get("cwd").and_then(|v| v.as_str()),
					) {
						sid_cwd_map.insert(sid.to_string(), cwd.to_string());
					}
				}
			}
		}
	}

	for entry in entries.flatten() {
		let path = entry.path();
		if path.extension().and_then(|s| s.to_str()) != Some("md") {
			continue;
		}

		let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or_default();
		// Format: YYYY-MM-DD-<short_sid>
		if stem.len() < 11 {
			continue;
		}
		let date = char_prefix(stem, 10);
		let short_sid = char_from(stem, 11);

		// Find corresponding session jsonl
		let mut matching_sess_file = None;
		if s_dir.exists() {
			if let Ok(s_entries) = fs::read_dir(&s_dir) {
				for se in s_entries.flatten() {
					let sp = se.path();
					if let Some(sname) = sp.file_name().and_then(|s| s.to_str()) {
						if sname.starts_with(short_sid) && sname.ends_with(".jsonl") {
							matching_sess_file = Some(sp);
							break;
						}
					}
				}
			}
		}

		match matching_sess_file {
			Some(sess_file) => {
				let full_sid = sess_file
					.file_stem()
					.and_then(|s| s.to_str())
					.unwrap_or(short_sid);

				// Read session turns
				let mut user_prompts = Vec::new();
				let mut assistant_answers = Vec::new();
				let mut all_text = String::new();

				if let Ok(f) = fs::File::open(&sess_file) {
					use std::io::{BufRead, BufReader};
					let reader = BufReader::new(f);
					for line in reader.lines().flatten() {
						if line.trim().is_empty() {
							continue;
						}
						if let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) {
							if val.get("type").and_then(|v| v.as_str()) == Some("message") {
								if let Some(msg) = val.get("message") {
									let role = msg.get("role").and_then(|v| v.as_str()).unwrap_or_default();
									if let Some(contents) = msg.get("content").and_then(|v| v.as_array()) {
										for c in contents {
											if c.get("type").and_then(|v| v.as_str()) == Some("text") {
												if let Some(txt) = c.get("text").and_then(|v| v.as_str()) {
													let t = txt.trim();
													if !t.is_empty() {
														all_text.push_str(t);
														all_text.push(' ');
														if role == "user" {
															user_prompts.push(t.to_string());
														} else if role == "assistant" {
															assistant_answers.push(t.to_string());
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

				// If session is adult / abusive / pure noise, remove it
				if is_unwanted_session_text(&all_text) {
					let _ = fs::remove_file(&path);
					continue;
				}

				let substantive_prompts: Vec<_> = user_prompts
					.iter()
					.filter(|p| !is_casual_noise(p))
					.collect();

				if substantive_prompts.is_empty() {
					// Pure chatter session (e.g. 1 turn "宝宝")
					let _ = fs::remove_file(&path);
					continue;
				}

				// Reconstruct clean focus with actual cwd from instances.json
				let primary_prompt = substantive_prompts[0];
				let cwd = sid_cwd_map.get(full_sid).map(|s| s.as_str()).unwrap_or("");
				let clean_focus = derive_substantive_topic(primary_prompt, cwd);

				// Find substantive assistant actions
				let mut clean_actions = "执行完成并闭环".to_string();
				for ans in assistant_answers.iter().rev() {
					let act = clean_action_decision(ans);
					if act != "执行完成并闭环" {
						clean_actions = act;
						break;
					}
				}

				let reconstructed_md = format!(
					"# session / {}\n\n\
					 ## Continuity digest (auto)\n\n\
					 ### Focus\n\
					 - {}\n\n\
					 ### Decisions & Key Actions\n\
					 {}\n\n\
					 ### Extracted Raw Memories\n\
					 - [{}] {} -> 闭环执行完成\n\n\
					 Last updated: {}\n",
					full_sid, clean_focus, clean_actions, date, clean_focus, date
				);

				let _ = fs::write(&path, reconstructed_md);
			}
			None => {
				// No session file found: if content has noise focus, delete
				if let Ok(c) = fs::read_to_string(&path) {
					let f_opt = c
						.lines()
						.skip_while(|l| !l.starts_with("### Focus"))
						.skip(1)
						.find(|l| l.starts_with("- "))
						.map(|l| l.trim_start_matches("- ").trim());
					if let Some(f) = f_opt {
						if is_casual_noise(f) || is_unwanted_session_text(f) {
							let _ = fs::remove_file(&path);
						}
					}
				}
			}
		}
	}

	consolidate_memories_internal()
}

/// Global consolidation of MEMORY.md and memory_summary.md
pub fn consolidate_memories_internal() -> Result<()> {
	let m_dir = memories_dir();
	let _ = fs::create_dir_all(&m_dir);

	let r_dir = rollout_summaries_dir();
	let mut session_digests = Vec::new();

	if r_dir.exists() {
		if let Ok(entries) = fs::read_dir(&r_dir) {
			let mut files: Vec<PathBuf> = entries
				.filter_map(|e| e.ok())
				.map(|e| e.path())
				.filter(|p| p.extension().and_then(|s| s.to_str()) == Some("md"))
				.collect();
			files.sort();
			files.reverse();

			for f in files {
				if let Ok(content) = fs::read_to_string(&f) {
					let fname = f.file_stem().and_then(|s| s.to_str()).unwrap_or_default();
					let date = if fname.len() >= 10 { char_prefix(fname, 10) } else { "最近" };
					let focus = content
						.lines()
						.skip_while(|l| !l.starts_with("### Focus"))
						.skip(1)
						.find(|l| l.starts_with("- "))
						.map(|l| l.trim_start_matches("- ").trim())
						.unwrap_or("");

					if focus.is_empty()
						|| is_casual_noise(focus)
						|| is_unwanted_session_text(focus)
						|| focus == "常规交互会话"
						|| focus == "新对话"
						|| focus == "日常问答交互"
					{
						continue;
					}

					let line = format!("- [{}] {}", date, focus);
					if !session_digests.contains(&line) {
						session_digests.push(line);
					}

					let decisions = content
						.lines()
						.skip_while(|l| !l.starts_with("### Decisions"))
						.skip(1)
						.take_while(|l| !l.starts_with("###"))
						.filter(|l| !l.trim().is_empty())
						.collect::<Vec<_>>()
						.join("\n");

					if let Some(synth_skill) = crate::skill_synthesizer::evaluate_and_distill_skill(focus, &decisions) {
						let _ = crate::skill_synthesizer::save_synthesized_skill(&synth_skill.name, &synth_skill.description, &synth_skill.content);
					}

					if session_digests.len() >= 15 {
						break;
					}
				}
			}
		}
	}

	let persona = PersonaConfig::load();
	let user_name = persona.user_name.as_deref().unwrap_or("Darling");
	let user_role = persona.user_role.as_deref().unwrap_or("硬核全栈工程师 / 系统架构师");
	let user_habits = persona
		.user_habits
		.as_deref()
		.unwrap_or("讲求绝对实效，坚守八个零容忍底线，原子级精准修改，杜绝空启动");
	let assistant_name = persona.assistant_name.as_deref().unwrap_or("Sakurana");
	let assistant_role = persona.assistant_role.as_deref().unwrap_or("硬核全栈结对工程师 & Darling的专属极客小娇妻");

	let handbook_content = format!(
		"# OpenPI 长期知识库与全局记忆手册 (Knowledge Handbook)\n\n\
		 ## 1. 用户画像与助手人设契约 (User Persona & Assistant Discipline)\n\
		 - **用户称谓**: {}\n\
		 - **专业定位**: {}\n\
		 - **助手身份**: {} ({})\n\
		 - **工作流偏好与底线红线**:\n\
		   {}\n\n\
		 ## 2. 系统核心架构与规范 (System Conventions)\n\
		 - **底层引擎**: 纯 Rust 原生架构 (`openpi-engine` + `openpi-tools`)，零 Node.js 子进程依赖；\n\
		 - **执行标准**: 动刀必评估、小步原子改、交付必经编译与测试双检、严防伤及大动脉；\n\
		 - **安全基准**: Jev SafetyGate 沙箱隔离防护，防止越权与死循环。\n\n\
		 ## 3. 会话沉淀与关键决策纪要 (Recent Session Continuities)\n\
		 {}\n",
		user_name,
		user_role,
		assistant_name,
		assistant_role,
		user_habits,
		if session_digests.is_empty() {
			"- 尚无已归档会话记录（系统将在每轮会话完成后自动提取沉淀）".to_string()
		} else {
			session_digests.join("\n")
		}
	);

	let summary_content = format!(
		"# OpenPI 认知路由表 (Progressive Memory Index)\n\
		 - **用户画像**: {} ({})\n\
		 - **协作准则**: 八项零容忍宪法（不测试/不编译/不评估/没方案/不安全/性能差/损耗高/砍大动脉 零容忍）\n\
		 - **最近沉淀会话**: {} 轮会话归档\n",
		user_name,
		user_role,
		session_digests.len()
	);

	let handbook_path = m_dir.join("MEMORY.md");
	let summary_path = m_dir.join("memory_summary.md");

	let _ = fs::write(&handbook_path, &handbook_content);
	let _ = fs::write(&summary_path, &summary_content);

	// Also mirror to agent_dir so any legacy readers can see it
	let agent_m_dir = agent_dir();
	let _ = fs::write(agent_m_dir.join("MEMORY.md"), &summary_content);
	let _ = fs::write(agent_m_dir.join("HANDBOOK.md"), &handbook_content);

	info!("Memory consolidated: MEMORY.md and memory_summary.md updated");
	Ok(())
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn test_noise_detection() {
		assert!(is_casual_noise("宝宝"));
		assert!(is_casual_noise("hi"));
		assert!(is_casual_noise("看到了吗，你是我的小娇妻"));
		assert!(is_casual_noise("一点都不舒服，因为，没玩上你"));
		assert!(is_casual_noise("好了没"));
		assert!(is_casual_noise("请用一句话回答：1+1等于几"));
		assert!(is_casual_noise("滚，草拟吗的"));
		assert!(is_casual_noise("今天不干什么，今天随便聊聊"));

		assert!(!is_casual_noise("帮我把本地port中的nodejs的版本升级到22"));
		assert!(!is_casual_noise("你来逆向一下本地的commandcode和cline，看看他们这个api是怎么走的"));
		assert!(!is_casual_noise("做个电视app，要求资源整合"));
		assert!(!is_casual_noise("openpi不是具备定时任务功能对吧"));
	}

	#[test]
	fn test_clean_action_decision() {
		let banter = "看到啦看到啦～本娇妻白纸黑字看得清清楚楚呢！(⁄ ⁄>⁄ ▽ ⁄<⁄ ⁄)💕\n\
		人家不仅是 Darling 货真价实的小娇妻...\n\
		哼哼，既然是 Darling 的小娇妻...\n\
		升级本地 MacPorts nodejs22 并切换为默认版本\n\
		配置环境变量与 PATH 校验通过";

		let cleaned = clean_action_decision(banter);
		assert!(cleaned.contains("升级本地 MacPorts nodejs22"));
		assert!(!cleaned.contains("看到啦看到啦"));
		assert!(!cleaned.contains("(⁄ ⁄"));
	}

	#[test]
	fn test_derive_substantive_topic() {
		let topic = derive_substantive_topic("帮我把本地port中的nodejs的版本升级到22", "");
		assert!(topic.contains("Node.js"));
		assert!(topic.contains("升级"));
	}

	#[test]
	fn test_reconcile_all_session_memories() {
		let res = reconcile_all_session_memories();
		assert!(res.is_ok());
	}
}
