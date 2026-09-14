use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionMode {
    Chat,
    Code,
}

impl Default for SessionMode {
    fn default() -> Self {
        SessionMode::Code
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub session_id: String,
    pub cwd: String,
    pub mode: SessionMode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub in_memory: Option<bool>,
    pub running: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthInfo {
    pub ok: bool,
    pub pid: u32,
    pub version: String,
    pub cli_mtime_ms: u64,
    pub cli_path: String,
    pub session_count: usize,
    pub running_count: usize,
    pub uptime_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum ClientRequest {
    Health { id: String },
    Shutdown { id: String },
    ListSessions { id: String },
    CreateSession {
        id: String,
        cwd: String,
        #[serde(default)]
        mode: Option<SessionMode>,
        #[serde(default)]
        model: Option<String>,
        #[serde(default)]
        name: Option<String>,
        #[serde(default)]
        in_memory: Option<bool>,
    },
    StopSession { id: String, session_id: String },
    DeleteSession { id: String, session_id: String },
    RenameSession { id: String, session_id: String, name: String },
    Subscribe { id: String, session_id: String },
    Unsubscribe { id: String, session_id: String },
    Rpc {
        id: String,
        session_id: String,
        command: Value,
    },
    App {
        id: String,
        op: Value,
    },
}

impl ClientRequest {
    pub fn id(&self) -> &str {
        match self {
            ClientRequest::Health { id } => id,
            ClientRequest::Shutdown { id } => id,
            ClientRequest::ListSessions { id } => id,
            ClientRequest::CreateSession { id, .. } => id,
            ClientRequest::StopSession { id, .. } => id,
            ClientRequest::DeleteSession { id, .. } => id,
            ClientRequest::RenameSession { id, .. } => id,
            ClientRequest::Subscribe { id, .. } => id,
            ClientRequest::Unsubscribe { id, .. } => id,
            ClientRequest::Rpc { id, .. } => id,
            ClientRequest::App { id, .. } => id,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerMessage {
    Response(ServerResponse),
    Event(ServerEvent),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ServerResponse {
    Ok {
        id: String,
        #[serde(rename = "type")]
        response_type: String, // "response"
        ok: bool, // true
        data: Value,
    },
    Err {
        id: String,
        #[serde(rename = "type")]
        response_type: String, // "response"
        ok: bool, // false
        error: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerEvent {
    #[serde(rename = "type")]
    pub event_type: String, // "event"
    pub session_id: String,
    pub event: Value,
}

impl ServerMessage {
    pub fn ok(id: impl Into<String>, data: Value) -> Self {
        ServerMessage::Response(ServerResponse::Ok {
            id: id.into(),
            response_type: "response".to_string(),
            ok: true,
            data,
        })
    }

    pub fn err(id: impl Into<String>, error: impl Into<String>) -> Self {
        ServerMessage::Response(ServerResponse::Err {
            id: id.into(),
            response_type: "response".to_string(),
            ok: false,
            error: error.into(),
        })
    }

    pub fn event(session_id: impl Into<String>, event: Value) -> Self {
        ServerMessage::Event(ServerEvent {
            event_type: "event".to_string(),
            session_id: session_id.into(),
            event,
        })
    }

    pub fn to_json_line(&self) -> Result<String, serde_json::Error> {
        let mut s = serde_json::to_string(self)?;
        s.push('\n');
        Ok(s)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_client_request_parsing() {
        let raw = r#"{"id":"req-1","type":"health"}"#;
        let req: ClientRequest = serde_json::from_str(raw).unwrap();
        assert_eq!(req.id(), "req-1");
        assert!(matches!(req, ClientRequest::Health { .. }));

        let raw_rpc = r#"{"id":"req-2","type":"rpc","sessionId":"s1","command":{"type":"prompt","text":"hello"}}"#;
        let req_rpc: ClientRequest = serde_json::from_str(raw_rpc).unwrap();
        assert_eq!(req_rpc.id(), "req-2");
        if let ClientRequest::Rpc { session_id, command, .. } = req_rpc {
            assert_eq!(session_id, "s1");
            assert_eq!(command["type"], "prompt");
        } else {
            panic!("expected Rpc");
        }
    }

    #[test]
    fn test_server_message_serialization() {
        let msg = ServerMessage::ok("req-1", serde_json::json!({"status": "healthy"}));
        let line = msg.to_json_line().unwrap();
        assert!(line.contains(r#""ok":true"#));
        assert!(line.contains(r#""id":"req-1""#));
        assert!(line.ends_with('\n'));

        let event = ServerMessage::event("s1", serde_json::json!({"type": "token", "content": "hi"}));
        let event_line = event.to_json_line().unwrap();
        assert!(event_line.contains(r#""sessionId":"s1""#));
        assert!(event_line.contains(r#""type":"event""#));
    }
}
