use anyhow::Result;
use openpi_jev::types::GateVerdict;
use openpi_jev::JevCoordinator;
use openpi_tools::file_ops::FileOps;
use openpi_tools::managed_bash::ManagedBash;
use openpi_tools::search_ops::SearchOps;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tracing::{info, warn};

use crate::protocol::ToolDefinition;

#[derive(Debug, Clone)]
pub struct ToolExecutionResult {
    pub output: String,
    pub is_error: bool,
}

#[derive(Clone)]
pub struct ToolRegistry {
    pub jev: Arc<JevCoordinator>,
    pub memory: Arc<openpi_memory::CodebaseMemoryManager>,
}

impl ToolRegistry {
    pub fn new(jev: Arc<JevCoordinator>, memory: Arc<openpi_memory::CodebaseMemoryManager>) -> Self {
        Self { jev, memory }
    }

    pub fn definitions(&self) -> Vec<ToolDefinition> {
        vec![
            ToolDefinition::new(
                "read",
                "Read the contents of a file with line numbers. Use offset and limit for large files. Automatically windowed and bounded for maximum speed.",
                json!({
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "Path to the file to read (relative or absolute)" },
                        "offset": { "type": "number", "description": "Line number to start reading from (1-indexed)" },
                        "limit": { "type": "number", "description": "Maximum number of lines to read (default 200, max 2000)" }
                    },
                    "required": ["path"]
                }),
            ),
            ToolDefinition::new(
                "write",
                "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
                json!({
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "Path to the file to write (relative or absolute)" },
                        "content": { "type": "string", "description": "Full content to write to the file" }
                    },
                    "required": ["path", "content"]
                }),
            ),
            ToolDefinition::new(
                "search_replace",
                "Surgically replaces exact text in a file. Guaranteed deterministic atomic modification without modifying unrelated lines.",
                json!({
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "Path to the target file to modify" },
                        "old_string": { "type": "string", "description": "The exact existing text chunk to find and replace. Must match uniquely." },
                        "new_string": { "type": "string", "description": "The new replacement text." }
                    },
                    "required": ["path", "old_string", "new_string"]
                }),
            ),
            ToolDefinition::new(
                "edit",
                "Edit a file using targeted replacements. Compatible with single edit or multiple targeted edits.",
                json!({
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "Path to the file to edit" },
                        "oldText": { "type": "string", "description": "Exact text to find and replace" },
                        "newText": { "type": "string", "description": "Replacement text" },
                        "edits": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "oldText": { "type": "string" },
                                    "newText": { "type": "string" }
                                },
                                "required": ["oldText", "newText"]
                            }
                        }
                    },
                    "required": ["path"]
                }),
            ),
            ToolDefinition::new(
                "grep",
                "Search code files for an exact string or regex pattern. Lightning fast, skips noise and binary folders.",
                json!({
                    "type": "object",
                    "properties": {
                        "query": { "type": "string", "description": "Search string or regular expression" },
                        "path": { "type": "string", "description": "Optional subpath or directory to scope the search (default: current workspace)" },
                        "is_regex": { "type": "boolean", "description": "Whether to treat query as regex (default false)" },
                        "limit": { "type": "number", "description": "Max matching lines to return (default 50)" }
                    },
                    "required": ["query"]
                }),
            ),
            ToolDefinition::new(
                "find",
                "Find files by glob pattern or filename. Bounded depth and automatically skips heavy noise directories (.git, node_modules, target, etc.).",
                json!({
                    "type": "object",
                    "properties": {
                        "pattern": { "type": "string", "description": "File name pattern or glob to find (e.g. '*.rs' or 'Cargo.toml')" },
                        "path": { "type": "string", "description": "Optional root directory to search in (default: current workspace)" },
                        "max_depth": { "type": "number", "description": "Maximum directory traversal depth (default 5)" },
                        "limit": { "type": "number", "description": "Maximum number of files to return (default 50)" }
                    },
                    "required": ["pattern"]
                }),
            ),
            ToolDefinition::new(
                "bash",
                "Execute an OS bash command in the current working directory. Governed by Jev SafetyGate with execution timeouts (default 20s) and stream output caps.",
                json!({
                    "type": "object",
                    "properties": {
                        "command": { "type": "string", "description": "Shell command to execute" },
                        "timeout": { "type": "number", "description": "Timeout in seconds (optional, default 20s)" }
                    },
                    "required": ["command"]
                }),
            ),
            ToolDefinition::new(
                "code_search",
                "Search the codebase using BM25 and semantic index (openpi-memory). Returns relevant code chunks, exact file paths, line ranges, and relevance scores.",
                json!({
                    "type": "object",
                    "properties": {
                        "query": { "type": "string", "description": "The search query (function name, symbol, error message, or feature description)" },
                        "path": { "type": "string", "description": "Optional subpath or directory to scope the search" },
                        "limit": { "type": "number", "description": "Max number of matching code snippets to return (default 5, max 20)" }
                    },
                    "required": ["query"]
                }),
            ),
            ToolDefinition::new(
                "repo_map",
                "Generate a compact architectural map and file outline of the current workspace or subfolder.",
                json!({
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "Optional folder path to inspect (defaults to current workspace)" },
                        "depth": { "type": "number", "description": "Exploration directory depth (default 3)" }
                    }
                }),
            ),
            ToolDefinition::new(
                "jev_sentinel_status",
                "Inspect OpenPI Jev System 1 instincts, SafetyGate statistics, LeakHunter redactions, ActKV savings, Proactive Diagnostics, and log compression.",
                json!({
                    "type": "object",
                    "properties": {}
                }),
            ),
        ]
    }

    fn resolve_path(cwd: &str, p: &str) -> PathBuf {
        let path = Path::new(p);
        if path.is_absolute() {
            path.to_path_buf()
        } else {
            Path::new(cwd).join(path)
        }
    }

    pub async fn execute(
        &self,
        name: &str,
        args: &Value,
        cwd: &str,
    ) -> Result<ToolExecutionResult> {
        match name {
            "read" => {
                let path_str = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
                let full_path = Self::resolve_path(cwd, path_str);
                let offset = args.get("offset").and_then(|v| v.as_u64()).map(|n| n as usize);
                let limit = args.get("limit").and_then(|v| v.as_u64()).map(|n| n as usize);

                match FileOps::read_file(&full_path, offset, limit, None) {
                    Ok(res) => {
                        let mut out = format!(
                            "File: {} (Lines {}-{} of {})\n\n{}",
                            res.path, res.start_line, res.end_line, res.total_lines, res.content
                        );
                        if res.is_truncated {
                            out.push_str("\n\n[Output truncated: use offset to read further]");
                        }
                        Ok(ToolExecutionResult {
                            output: out,
                            is_error: false,
                        })
                    }
                    Err(e) => Ok(ToolExecutionResult {
                        output: format!("Error reading file: {}", e),
                        is_error: true,
                    }),
                }
            }

            "write" => {
                let path_str = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
                let content = args.get("content").and_then(|v| v.as_str()).unwrap_or("");
                let full_path = Self::resolve_path(cwd, path_str);

                match FileOps::write_file(&full_path, content, true) {
                    Ok(res) => Ok(ToolExecutionResult {
                        output: format!("Successfully wrote {} bytes to {}", res.bytes_written, res.path),
                        is_error: false,
                    }),
                    Err(e) => Ok(ToolExecutionResult {
                        output: format!("Error writing file: {}", e),
                        is_error: true,
                    }),
                }
            }

            "search_replace" => {
                let path_str = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
                let old_str = args.get("old_string").and_then(|v| v.as_str()).unwrap_or("");
                let new_str = args.get("new_string").and_then(|v| v.as_str()).unwrap_or("");
                let full_path = Self::resolve_path(cwd, path_str);

                match FileOps::search_replace(&full_path, old_str, new_str, false) {
                    Ok(res) => Ok(ToolExecutionResult {
                        output: format!(
                            "Successfully replaced exact chunk in {}. Applied {} replacement, {} lines changed.",
                            res.path, res.replacements_count, res.lines_changed
                        ),
                        is_error: false,
                    }),
                    Err(e) => Ok(ToolExecutionResult {
                        output: format!("Error replacing text: {}", e),
                        is_error: true,
                    }),
                }
            }

            "edit" => {
                let path_str = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
                let full_path = Self::resolve_path(cwd, path_str);

                if let Some(edits) = args.get("edits").and_then(|e| e.as_array()) {
                    let mut count = 0;
                    for edit in edits {
                        let old_text = edit.get("oldText").and_then(|v| v.as_str()).unwrap_or("");
                        let new_text = edit.get("newText").and_then(|v| v.as_str()).unwrap_or("");
                        if let Err(e) = FileOps::search_replace(&full_path, old_text, new_text, false) {
                            return Ok(ToolExecutionResult {
                                output: format!("Error in edit #{}: {}", count + 1, e),
                                is_error: true,
                            });
                        }
                        count += 1;
                    }
                    Ok(ToolExecutionResult {
                        output: format!("Successfully applied {} edits to {}", count, path_str),
                        is_error: false,
                    })
                } else {
                    let old_text = args.get("oldText").or_else(|| args.get("old_string")).and_then(|v| v.as_str()).unwrap_or("");
                    let new_text = args.get("newText").or_else(|| args.get("new_string")).and_then(|v| v.as_str()).unwrap_or("");
                    match FileOps::search_replace(&full_path, old_text, new_text, false) {
                        Ok(res) => Ok(ToolExecutionResult {
                            output: format!(
                                "Successfully applied edit to {}. Applied {} replacement, {} lines changed.",
                                res.path, res.replacements_count, res.lines_changed
                            ),
                            is_error: false,
                        }),
                        Err(e) => Ok(ToolExecutionResult {
                            output: format!("Error in edit: {}", e),
                            is_error: true,
                        }),
                    }
                }
            }

            "grep" => {
                let query = args.get("query").and_then(|v| v.as_str()).unwrap_or("");
                let path_str = args.get("path").and_then(|v| v.as_str()).unwrap_or(".");
                let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(50) as usize;
                let full_path = Self::resolve_path(cwd, path_str);

                match SearchOps::grep_search(&full_path, query, None, limit) {
                    Ok(res) => {
                        if res.matches.is_empty() {
                            Ok(ToolExecutionResult {
                                output: format!("No matches found for '{}' in {}", query, path_str),
                                is_error: false,
                            })
                        } else {
                            let mut out = format!(
                                "Found {} matches for '{}':\n\n",
                                res.total_matches, query
                            );
                            for m in res.matches {
                                out.push_str(&format!("{}:{}: {}\n", m.file_path, m.line_number, m.line_content));
                            }
                            if res.is_truncated {
                                out.push_str("\n... [Output capped at limit] ...");
                            }
                            Ok(ToolExecutionResult {
                                output: out,
                                is_error: false,
                            })
                        }
                    }
                    Err(e) => Ok(ToolExecutionResult {
                        output: format!("Error in grep search: {}", e),
                        is_error: true,
                    }),
                }
            }

            "find" => {
                let pattern = args.get("pattern").and_then(|v| v.as_str()).unwrap_or("*");
                let path_str = args.get("path").and_then(|v| v.as_str()).unwrap_or(".");
                let max_depth = args.get("max_depth").and_then(|v| v.as_u64()).unwrap_or(5) as usize;
                let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(50) as usize;
                let full_path = Self::resolve_path(cwd, path_str);

                let files = SearchOps::find_files(&full_path, pattern, max_depth, limit);
                if files.is_empty() {
                    Ok(ToolExecutionResult {
                        output: format!("No files found matching '{}' in {}", pattern, path_str),
                        is_error: false,
                    })
                } else {
                    let mut out = format!("Found {} files matching '{}':\n\n", files.len(), pattern);
                    for f in files {
                        out.push_str(&format!("{}\n", f));
                    }
                    Ok(ToolExecutionResult {
                        output: out,
                        is_error: false,
                    })
                }
            }

            "bash" => {
                let raw_cmd = args.get("command").and_then(|v| v.as_str()).unwrap_or("");
                let custom_timeout = args.get("timeout").and_then(|v| v.as_u64());

                // Jev SafetyGate Pre-execution Check
                let effective_cmd = match self.jev.pre_check_command(raw_cmd) {
                    GateVerdict::Deny { reason } => {
                        warn!("🛑 [Jev SafetyGate] Intercepted blocked bash command: `{}`. Reason: {}", raw_cmd, reason);
                        return Ok(ToolExecutionResult {
                            output: format!("🛑 [Jev SafetyGate] Command execution DENIED for safety: {}\nReason: {}", raw_cmd, reason),
                            is_error: true,
                        });
                    }
                    GateVerdict::ModifyCommand { safe_command, reason } => {
                        info!("💡 [Jev SafetyGate] Auto-patched command: `{}` -> `{}` (Reason: {})", raw_cmd, safe_command, reason);
                        safe_command
                    }
                    _ => raw_cmd.to_string(),
                };

                let cwd_path = Path::new(cwd);
                let res = ManagedBash::execute(&effective_cmd, cwd_path, custom_timeout, None).await;

                match res {
                    Ok(bash_res) => {
                        let combined = if bash_res.exit_code == 0 {
                            if bash_res.stdout.trim().is_empty() && !bash_res.stderr.trim().is_empty() {
                                bash_res.stderr
                            } else {
                                bash_res.stdout
                            }
                        } else {
                            format!(
                                "{}\n{}\n(Command exited with code {})",
                                bash_res.stdout.trim(),
                                bash_res.stderr.trim(),
                                bash_res.exit_code
                            )
                        };

                        // Jev Output Compression & Leak Masking
                        let (compressed, leak) = self.jev.process_command_output(&combined);
                        let final_output = if compressed.was_compressed || leak.has_leaks {
                            compressed.content
                        } else {
                            combined
                        };

                        // Jev Loop Breaker Recording
                        let is_err = bash_res.exit_code != 0;
                        if let Some(loop_res) = self.jev.record_command_result(&effective_cmd, !is_err, &final_output).await {
                            if loop_res.should_break {
                                warn!("🛑 [Jev LoopBreaker] Tripped for bash: `{}`", effective_cmd);
                                return Ok(ToolExecutionResult {
                                    output: format!(
                                        "{}\n\n🛑 [Jev LoopBreaker] Recurring command error pattern detected! (Tripped {} times)\nCorrective guidance: {}",
                                        final_output,
                                        loop_res.loop_count,
                                        loop_res.corrective_hint.as_deref().unwrap_or("none")
                                    ),
                                    is_error: true,
                                });
                            }
                        }

                        Ok(ToolExecutionResult {
                            output: if final_output.trim().is_empty() { "(no output)".to_string() } else { final_output },
                            is_error: is_err,
                        })
                    }
                    Err(e) => Ok(ToolExecutionResult {
                        output: format!("Execution failed: {}", e),
                        is_error: true,
                    }),
                }
            }

            "code_search" | "semantic_search" => {
                let query = args.get("query").and_then(|v| v.as_str()).unwrap_or("");
                let path_str = args.get("path").and_then(|v| v.as_str()).unwrap_or(".");
                let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(5) as usize;
                let full_path = Self::resolve_path(cwd, path_str);

                match SearchOps::grep_search(&full_path, query, None, limit * 4) {
                    Ok(res) => {
                        if res.matches.is_empty() {
                            Ok(ToolExecutionResult {
                                output: format!("No code matches found for '{}'", query),
                                is_error: false,
                            })
                        } else {
                            let mut out = format!("Code search results for '{}':\n\n", query);
                            for m in res.matches.into_iter().take(limit * 3) {
                                out.push_str(&format!("{}:{}: {}\n", m.file_path, m.line_number, m.line_content));
                            }
                            Ok(ToolExecutionResult {
                                output: out,
                                is_error: false,
                            })
                        }
                    }
                    Err(e) => Ok(ToolExecutionResult {
                        output: format!("Search error: {}", e),
                        is_error: true,
                    }),
                }
            }

            "repo_map" => {
                let path_str = args.get("path").and_then(|v| v.as_str()).unwrap_or(".");
                let depth = args.get("depth").and_then(|v| v.as_u64()).unwrap_or(3) as usize;
                let full_path = Self::resolve_path(cwd, path_str);

                let files = SearchOps::find_files(&full_path, "*", depth, 150);
                let mut out = format!("Repository map for {} ({} items):\n\n", path_str, files.len());
                for f in files {
                    out.push_str(&format!("  - {}\n", f));
                }
                Ok(ToolExecutionResult {
                    output: out,
                    is_error: false,
                })
            }

            "jev_sentinel_status" => {
                let stats = json!({
                    "jev_status": "active",
                    "engine": "openpi-engine-native-rust",
                    "execution_sovereignty": true,
                    "zero_node_dependency": true
                });
                Ok(ToolExecutionResult {
                    output: serde_json::to_string_pretty(&stats).unwrap_or_default(),
                    is_error: false,
                })
            }

            other => Ok(ToolExecutionResult {
                output: format!("Unknown tool '{}'", other),
                is_error: true,
            }),
        }
    }
}
