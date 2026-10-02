use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;

pub fn openpi_dir() -> PathBuf {
    if let Ok(p) = std::env::var("OPENPI_DIR") {
        PathBuf::from(p)
    } else {
        let home = std::env::var("HOME")
            .or_else(|_| std::env::var("USERPROFILE"))
            .unwrap_or_else(|_| ".".into());
        PathBuf::from(home).join(".openpi")
    }
}

pub fn agent_dir() -> PathBuf {
    openpi_dir().join("agent")
}

pub fn sessions_dir() -> PathBuf {
    openpi_dir().join("sessions")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelConfig {
    pub id: String,
    pub name: Option<String>,
    pub provider: String,
    pub base_url: String,
    pub api_key: String,
    pub context_window: usize,
    pub max_tokens: usize,
    pub reasoning: bool,
}

#[derive(Debug, Clone)]
pub struct EngineConfig {
    pub default_provider: Option<String>,
    pub default_model: Option<String>,
    pub models: HashMap<String, ModelConfig>,
}

impl EngineConfig {
    pub fn load() -> Result<Self> {
        let a_dir = agent_dir();
        let settings_path = a_dir.join("settings.json");
        let app_settings_path = a_dir.join("app_settings.json");
        let models_path = a_dir.join("models.json");

        let mut default_model = None;
        let mut default_provider = None;

        if settings_path.exists() {
            if let Ok(content) = std::fs::read_to_string(&settings_path) {
                if let Ok(v) = serde_json::from_str::<Value>(&content) {
                    if let Some(m) = v.get("defaultModel").and_then(|x| x.as_str()) {
                        default_model = Some(m.to_string());
                    }
                    if let Some(p) = v.get("defaultProvider").and_then(|x| x.as_str()) {
                        default_provider = Some(p.to_string());
                    }
                }
            }
        }

        if app_settings_path.exists() {
            if let Ok(content) = std::fs::read_to_string(&app_settings_path) {
                if let Ok(v) = serde_json::from_str::<Value>(&content) {
                    if let Some(m) = v.get("defaultModel").and_then(|x| x.as_str()) {
                        default_model = Some(m.to_string());
                    }
                    if let Some(p) = v.get("defaultProvider").and_then(|x| x.as_str()) {
                        default_provider = Some(p.to_string());
                    }
                }
            }
        }

        let mut models = HashMap::new();

        if models_path.exists() {
            if let Ok(content) = std::fs::read_to_string(&models_path) {
                if let Ok(root) = serde_json::from_str::<Value>(&content) {
                    if let Some(providers) = root.get("providers").and_then(|p| p.as_object()) {
                        for (prov_name, prov_val) in providers {
                            let base_url = prov_val
                                .get("baseUrl")
                                .and_then(|u| u.as_str())
                                .unwrap_or("https://api.openai.com/v1")
                                .trim_end_matches('/')
                                .to_string();
                            let api_key = prov_val
                                .get("apiKey")
                                .and_then(|k| k.as_str())
                                .unwrap_or("")
                                .to_string();

                            if let Some(m_arr) = prov_val.get("models").and_then(|m| m.as_array()) {
                                for m in m_arr {
                                    let model_id = match m.get("id").and_then(|id| id.as_str()) {
                                        Some(id) => id.to_string(),
                                        None => continue,
                                    };
                                    let model_name = m
                                        .get("name")
                                        .and_then(|n| n.as_str())
                                        .map(|s| s.to_string());
                                    let context_window = m
                                        .get("contextWindow")
                                        .and_then(|c| c.as_u64())
                                        .unwrap_or(128_000) as usize;
                                    let max_tokens = m
                                        .get("maxTokens")
                                        .and_then(|c| c.as_u64())
                                        .unwrap_or(8192) as usize;
                                    let reasoning = m
                                        .get("reasoning")
                                        .and_then(|r| r.as_bool())
                                        .unwrap_or(false);

                                    let cfg = ModelConfig {
                                        id: model_id.clone(),
                                        name: model_name,
                                        provider: prov_name.clone(),
                                        base_url: base_url.clone(),
                                        api_key: api_key.clone(),
                                        context_window,
                                        max_tokens,
                                        reasoning,
                                    };

                                    // Store with both plain ID and "provider/id"
                                    models.insert(format!("{}/{}", prov_name, model_id), cfg.clone());
                                    models.entry(model_id).or_insert(cfg);
                                }
                            }
                        }
                    }
                }
            }
        }

        Ok(Self {
            default_provider,
            default_model,
            models,
        })
    }

    pub fn resolve_model(&self, requested: Option<&str>) -> Result<ModelConfig> {
        let key = if let Some(req) = requested {
            if !req.is_empty() {
                req.to_string()
            } else if let Some(ref def) = self.default_model {
                def.clone()
            } else {
                bail!("No model specified and no defaultModel found in settings");
            }
        } else if let Some(ref def) = self.default_model {
            def.clone()
        } else {
            bail!("No model specified and no defaultModel found in settings");
        };

        if let Some(m) = self.models.get(&key) {
            return Ok(m.clone());
        }

        // Try matching by provider prefix or fallback
        if let Some((prov, id)) = key.split_once('/') {
            let combined = format!("{}/{}", prov, id);
            if let Some(m) = self.models.get(&combined) {
                return Ok(m.clone());
            }
            if let Some(m) = self.models.get(id) {
                return Ok(m.clone());
            }
        }

        // Try find any model matching suffix
        for (k, v) in &self.models {
            if k.ends_with(&format!("/{}", key)) || k == &key {
                return Ok(v.clone());
            }
        }

        // If not found in models.json, fallback to default provider if present
        if let Some(ref prov) = self.default_provider {
            let fallback_key = format!("{}/{}", prov, key);
            if let Some(m) = self.models.get(&fallback_key) {
                return Ok(m.clone());
            }
        }

        bail!("Model '{}' not found in configuration", key)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PersonaConfig {
    pub user_name: Option<String>,
    pub user_role: Option<String>,
    pub user_habits: Option<String>,
    pub assistant_name: Option<String>,
    pub assistant_role: Option<String>,
    pub tone: Option<String>,
    pub custom_tone_prompt: Option<String>,
    pub code_style: Option<String>,
    pub response_language: Option<String>,
}

impl PersonaConfig {
    pub fn load() -> Self {
        let profile_path = agent_dir().join("profile.json");
        if !profile_path.exists() {
            return Self::default();
        }
        if let Ok(c) = std::fs::read_to_string(&profile_path) {
            if let Ok(val) = serde_json::from_str::<Value>(&c) {
                let user_name = val.get("nickname")
                    .or_else(|| val.get("userName"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());

                let user_role = val.get("userRole")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());

                let user_habits = val.get("userHabits")
                    .or_else(|| val.get("habits"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());

                let assistant_name = val.get("assistantName")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());

                let assistant_role = val.get("assistantRole")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());

                let tone = val.get("tone")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());

                let custom_tone_prompt = val.get("customTonePrompt")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());

                let code_style = val.get("codeStyle")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());

                let response_language = val.get("responseLanguage")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());

                return Self {
                    user_name,
                    user_role,
                    user_habits,
                    assistant_name,
                    assistant_role,
                    tone,
                    custom_tone_prompt,
                    code_style,
                    response_language,
                };
            }
        }
        Self::default()
    }

    pub fn to_prompt_directive(&self) -> String {
        let mut sections = Vec::new();

        if let Some(ref name) = self.user_name {
            if !name.trim().is_empty() {
                sections.push(format!("- 用户称呼/姓名: {}", name));
            }
        }
        if let Some(ref role) = self.user_role {
            if !role.trim().is_empty() {
                sections.push(format!("- 用户角色身份: {}", role));
            }
        }
        if let Some(ref habits) = self.user_habits {
            if !habits.trim().is_empty() {
                sections.push(format!("- 用户工作与交互习惯: {}", habits));
            }
        }
        if let Some(ref style) = self.code_style {
            if !style.trim().is_empty() {
                sections.push(format!("- 用户代码风格偏好: {}", style));
            }
        }
        if let Some(ref a_name) = self.assistant_name {
            if !a_name.trim().is_empty() {
                sections.push(format!("- 助手设定名称: {}", a_name));
            }
        }
        if let Some(ref a_role) = self.assistant_role {
            if !a_role.trim().is_empty() {
                sections.push(format!("- 助手角色定位: {}", a_role));
            }
        }

        let tone_desc = match self.tone.as_deref() {
            Some("concise") => "极简干练（直奔主题，避免客套与冗余解释，直接给出解决方案与代码）",
            Some("professional") => "严谨专业（逻辑缜密，全面分析系统根因，结构化分点陈述）",
            Some("friendly") => "亲切自然（温和耐受，通俗生动，如资深结对伙伴并肩作战）",
            _ => "",
        };

        if !tone_desc.is_empty() {
            sections.push(format!("- 回答语气基调: {}", tone_desc));
        }

        if let Some(ref custom_tone) = self.custom_tone_prompt {
            if !custom_tone.trim().is_empty() {
                sections.push(format!("- 自定义语气细节要求: {}", custom_tone));
            }
        }

        let lang_str = self.response_language.as_deref().unwrap_or("zh-CN");
        let lower_lang = lang_str.to_lowercase();
        let lang_rule = match lower_lang.as_str() {
            "zh" | "zh-cn" | "zh_cn" | "chinese" | "简体中文" => {
                "必须且始终使用规范的【简体中文】回答所有问题、输出思考与进行技术解释（严禁擅自使用英文或繁体中文整段回复，代码中的关键字、变量与专有名词除外）"
            }
            "en" | "en-us" | "english" => "Must always respond in English.",
            other => other,
        };
        sections.push(format!("- 强制回答语言 (Mandatory Language): {}", lang_rule));

        if sections.is_empty() {
            return String::new();
        }

        format!(
            "\n\n【用户人设画像与核心协作宪法 (User Persona & Core Interaction Contract)】\n\
             {}\n\
             ※ 核心执行原则：此人设契约为最高优先级的系统元指令。在所有对话、规划思考、代码生成、工具调用与交付验证中，必须 100% 严格服从以上准则，杜绝一切违背上述偏好的空话与行为。",
            sections.join("\n")
        )
    }
}

