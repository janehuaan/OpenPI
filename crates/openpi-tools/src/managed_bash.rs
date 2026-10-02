use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Stdio;
use std::time::Instant;
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::time::{timeout, Duration};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BashResult {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub is_timed_out: bool,
    pub is_truncated: bool,
    pub duration_ms: u64,
}

pub struct ManagedBash;

impl ManagedBash {
    /// Safely execute bash command with hard-fenced OS timeout and output stream cap
    pub async fn execute<P: AsRef<Path>>(
        cmd: &str,
        cwd: P,
        timeout_secs: Option<u64>,
        max_output_bytes: Option<usize>,
    ) -> Result<BashResult> {
        let t_secs = timeout_secs.unwrap_or(20).clamp(1, 60);
        let cap_bytes = max_output_bytes.unwrap_or(50 * 1024); // 50KB default cap
        let start = Instant::now();

        let mut child = Command::new("/bin/bash")
            .arg("-c")
            .arg(cmd)
            .current_dir(cwd.as_ref())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()?;

        let mut stdout_handle = child.stdout.take();
        let mut stderr_handle = child.stderr.take();

        let mut stdout_buf = Vec::new();
        let mut stderr_buf = Vec::new();

        let read_future = async {
            let mut out_chunk = [0u8; 4096];
            let mut err_chunk = [0u8; 4096];
            let mut stdout_done = stdout_handle.is_none();
            let mut stderr_done = stderr_handle.is_none();
            let mut is_truncated = false;

            while !stdout_done || !stderr_done {
                tokio::select! {
                    res = async {
                        if let Some(ref mut out) = stdout_handle {
                            out.read(&mut out_chunk).await
                        } else {
                            std::future::pending().await
                        }
                    }, if !stdout_done => {
                        match res {
                            Ok(0) => { stdout_done = true; }
                            Ok(n) => {
                                if stdout_buf.len() + n <= cap_bytes {
                                    stdout_buf.extend_from_slice(&out_chunk[..n]);
                                } else {
                                    let remaining = cap_bytes.saturating_sub(stdout_buf.len());
                                    if remaining > 0 {
                                        stdout_buf.extend_from_slice(&out_chunk[..remaining]);
                                    }
                                    is_truncated = true;
                                    stdout_done = true;
                                }
                            }
                            Err(_) => { stdout_done = true; }
                        }
                    }
                    res = async {
                        if let Some(ref mut err) = stderr_handle {
                            err.read(&mut err_chunk).await
                        } else {
                            std::future::pending().await
                        }
                    }, if !stderr_done => {
                        match res {
                            Ok(0) => { stderr_done = true; }
                            Ok(n) => {
                                if stderr_buf.len() + n <= cap_bytes {
                                    stderr_buf.extend_from_slice(&err_chunk[..n]);
                                } else {
                                    let remaining = cap_bytes.saturating_sub(stderr_buf.len());
                                    if remaining > 0 {
                                        stderr_buf.extend_from_slice(&err_chunk[..remaining]);
                                    }
                                    is_truncated = true;
                                    stderr_done = true;
                                }
                            }
                            Err(_) => { stderr_done = true; }
                        }
                    }
                }
            }

            let status = child.wait().await?;
            Ok::<(i32, bool), anyhow::Error>((status.code().unwrap_or(-1), is_truncated))
        };

        match timeout(Duration::from_secs(t_secs), read_future).await {
            Ok(Ok((exit_code, is_truncated))) => {
                let duration_ms = start.elapsed().as_millis() as u64;
                let mut stdout = String::from_utf8_lossy(&stdout_buf).to_string();
                let stderr = String::from_utf8_lossy(&stderr_buf).to_string();

                if is_truncated {
                    stdout.push_str("\n... [Output truncated: 50KB stream limit reached] ...\n");
                }

                Ok(BashResult {
                    exit_code,
                    stdout,
                    stderr,
                    is_timed_out: false,
                    is_truncated,
                    duration_ms,
                })
            }
            Ok(Err(e)) => Err(e),
            Err(_) => {
                let duration_ms = start.elapsed().as_millis() as u64;
                Ok(BashResult {
                    exit_code: -1,
                    stdout: String::from_utf8_lossy(&stdout_buf).to_string(),
                    stderr: format!("Command timed out after {} seconds. Process terminated.", t_secs),
                    is_timed_out: true,
                    is_truncated: false,
                    duration_ms,
                })
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_managed_bash_echo() {
        let res = ManagedBash::execute("echo 'hello openpi'", ".", Some(5), None).await.unwrap();
        assert_eq!(res.exit_code, 0);
        assert!(res.stdout.contains("hello openpi"));
        assert!(!res.is_timed_out);
    }

    #[tokio::test]
    async fn test_managed_bash_timeout() {
        let res = ManagedBash::execute("sleep 5", ".", Some(1), None).await.unwrap();
        assert!(res.is_timed_out);
        assert!(res.stderr.contains("Command timed out after 1 seconds"));
    }
}
