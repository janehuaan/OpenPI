pub mod agent_loop;
pub mod config;
pub mod llm_client;
pub mod protocol;
pub mod session_journal;
pub mod session_manager;
pub mod tool_registry;

pub use agent_loop::AgentLoop;
pub use config::{EngineConfig, ModelConfig, PersonaConfig};
pub use llm_client::LlmClient;
pub use session_manager::EngineSessionManager;
pub use tool_registry::ToolRegistry;

pub fn engine_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[cfg(test)]
mod tests {
    use super::*;
    use openpi_jev::JevCoordinator;
    use openpi_memory::CodebaseMemoryManager;
    use serde_json::json;
    use std::sync::Arc;

    #[test]
    fn test_engine_config_load() {
        let config = EngineConfig::load().unwrap();
        // Should resolve configured default or test model
        if let Some(ref def) = config.default_model {
            let resolved = config.resolve_model(Some(def)).unwrap();
            assert!(!resolved.base_url.is_empty());
        }
    }

    #[test]
    fn test_session_journal_roundtrip() {
        let sid = format!("test_session_{}", uuid::Uuid::new_v4());
        let mut journal = session_journal::SessionJournal::open(&sid);

        let user_id = journal.append_user_message("Hello world from Rust engine").unwrap();
        assert!(!user_id.is_empty());

        let tc = protocol::ToolCall {
            id: "call_123".into(),
            r#type: "function".into(),
            function: protocol::FunctionCall {
                name: "read".into(),
                arguments: json!({"path": "Cargo.toml"}).to_string(),
            },
        };

        let asst_id = journal.append_assistant_message(
            "I will read Cargo.toml",
            "thinking deeply",
            &[tc],
            "自建",
            "gemini-3.8-flash-high",
            100,
            25,
            "toolUse",
        ).unwrap();
        assert!(!asst_id.is_empty());

        let tool_res_id = journal.append_tool_result("call_123", "read", "[package]\nname = ...", false).unwrap();
        assert!(!tool_res_id.is_empty());

        // Load back
        let history = journal.load_history_messages();
        assert_eq!(history.len(), 3);
        assert_eq!(history[0].role, "user");
        assert_eq!(history[1].role, "assistant");
        assert_eq!(history[2].role, "tool");

        // Cleanup test journal file
        let _ = std::fs::remove_file(&journal.file_path);
    }

    #[tokio::test]
    async fn test_tool_registry_native_execution() {
        let jev = Arc::new(JevCoordinator::new());
        let memory = Arc::new(CodebaseMemoryManager::new());
        let registry = ToolRegistry::new(jev, memory);

        let cwd = env!("CARGO_MANIFEST_DIR");

        // 1. Test read
        let res = registry.execute("read", &json!({"path": "Cargo.toml"}), cwd).await.unwrap();
        assert!(!res.is_error);
        assert!(res.output.contains("openpi-engine"));

        // 2. Test find
        let res = registry.execute("find", &json!({"pattern": "Cargo.toml"}), cwd).await.unwrap();
        assert!(!res.is_error);
        assert!(res.output.contains("Cargo.toml"));

        // 3. Test grep
        let res = registry.execute("grep", &json!({"query": "openpi-engine"}), cwd).await.unwrap();
        assert!(!res.is_error);
        assert!(res.output.contains("Cargo.toml"));

        // 4. Test SafetyGate blocks broad grep
        let res = registry.execute("bash", &json!({"command": "grep -rn 'hello' ~"}), cwd).await.unwrap();
        assert!(res.is_error);
        assert!(res.output.contains("SafetyGate"));
    }

    #[test]
    fn test_persona_directive_generation() {
        let persona = PersonaConfig {
            user_name: Some("Huaan".into()),
            user_role: Some("Full-stack Architect".into()),
            user_habits: Some("Prefers minimal atomic edits, direct execution".into()),
            assistant_name: Some("OpenPI".into()),
            assistant_role: Some("Senior Pair Engineer".into()),
            tone: Some("concise".into()),
            custom_tone_prompt: Some("No pleasantries, explain root cause directly".into()),
            code_style: Some("Clean Rust & TS, MDL law".into()),
            response_language: Some("zh-CN".into()),
        };

        let directive = persona.to_prompt_directive();
        assert!(directive.contains("Huaan"));
        assert!(directive.contains("Full-stack Architect"));
        assert!(directive.contains("Prefers minimal atomic edits"));
        assert!(directive.contains("极简干练"));
        assert!(directive.contains("No pleasantries"));
    }
}

