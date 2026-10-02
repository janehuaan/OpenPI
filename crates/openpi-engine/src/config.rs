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
