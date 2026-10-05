//! Git operations for the desktop bridge.
//!
//! Extracted from `handle_invoke`, which had grown into a single ~3,270-line
//! function. These arms only shell out to `git` and return JSON, so they are
//! self-contained: the only workspace helper they need is `default_workspace`.

use crate::daemon_client::default_workspace;
use serde_json::{json, Value};
use std::path::Path;
use std::process::Command;

/// Handle a `git_*` channel. Route only `git_*` channels here.
pub fn handle(op: &str, args: &Value) -> Result<Value, String> {
    match op {
        "git_status" => {
            let cwd = args.get("cwd").and_then(|v| v.as_str()).unwrap_or_else(|| default_workspace());
            let out = Command::new("git")
                .args(["status", "--porcelain=v1", "-b", "-uall"])
                .current_dir(cwd)
                .output();

            let out = match out {
                Ok(o) => o,
                Err(_) => {
                    return Ok(json!({
                        "isRepo": false,
                        "branch": "",
                        "clean": true,
                        "ahead": 0,
                        "behind": 0,
                        "files": []
                    }));
                }
            };

            if !out.status.success() {
                return Ok(json!({
                    "isRepo": false,
                    "branch": "",
                    "clean": true,
                    "ahead": 0,
                    "behind": 0,
                    "files": []
                }));
            }

            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
            let mut branch = "main".to_string();
            let mut ahead = 0;
            let mut behind = 0;
            let mut files = Vec::new();

            for line in stdout.lines() {
                if line.starts_with("##") {
                    let b_info = line.trim_start_matches('#').trim();
                    let branch_part = b_info.split_whitespace().next().unwrap_or("main");
                    branch = branch_part.split("...").next().unwrap_or("main").to_string();
                    if let Some(pos) = b_info.find('[') {
                        let bracket = &b_info[pos..];
                        if let Some(ahead_pos) = bracket.find("ahead ") {
                            let s = &bracket[ahead_pos + 6..];
                            let num: String = s.chars().take_while(|c| c.is_ascii_digit()).collect();
                            ahead = num.parse().unwrap_or(0);
                        }
                        if let Some(behind_pos) = bracket.find("behind ") {
                            let s = &bracket[behind_pos + 7..];
                            let num: String = s.chars().take_while(|c| c.is_ascii_digit()).collect();
                            behind = num.parse().unwrap_or(0);
                        }
                    }
                } else if line.len() >= 3 {
                    let x = line.chars().next().unwrap_or(' ');
                    let y = line.chars().nth(1).unwrap_or(' ');
                    let file_path = line[3..].trim();

                    if x == '?' && y == '?' {
                        files.push(json!({
                            "path": file_path,
                            "status": "untracked",
                            "staged": false
                        }));
                    } else if x == 'U' || y == 'U' || (x == 'A' && y == 'A') || (x == 'D' && y == 'D') {
                        files.push(json!({
                            "path": file_path,
                            "status": "conflicted",
                            "staged": false
                        }));
                    } else {
                        if x != ' ' && x != '?' {
                            let st = match x {
                                'A' => "added",
                                'D' => "deleted",
                                'R' => "renamed",
                                _ => "modified",
                            };
                            files.push(json!({
                                "path": file_path,
                                "status": st,
                                "staged": true
                            }));
                        }
                        if y != ' ' && y != '?' {
                            let st = match y {
                                'D' => "deleted",
                                _ => "modified",
                            };
                            files.push(json!({
                                "path": file_path,
                                "status": st,
                                "staged": false
                            }));
                        }
                    }
                }
            }

            Ok(json!({
                "isRepo": true,
                "branch": branch,
                "clean": files.is_empty(),
                "ahead": ahead,
                "behind": behind,
                "files": files
            }))
        }

        "git_diff" => {
            let cwd = args.get("cwd").and_then(|v| v.as_str()).unwrap_or_else(|| default_workspace());
            let staged = args.get("staged").and_then(|v| v.as_bool()).unwrap_or(false);
            let mut cmd = Command::new("git");
            cmd.arg("diff");
            if staged {
                cmd.arg("--cached");
            }
            let file_opt = args.get("path").or_else(|| args.get("filePath")).and_then(|v| v.as_str());
            if let Some(file) = file_opt {
                cmd.arg("--").arg(file);
            }
            let out = cmd.current_dir(cwd).output();
            let (mut diff_str, err_msg) = match out {
                Ok(o) => {
                    let s = String::from_utf8_lossy(&o.stdout).to_string();
                    let e = if o.status.success() { None } else { Some(String::from_utf8_lossy(&o.stderr).to_string()) };
                    (s, e)
                }
                Err(e) => (String::new(), Some(e.to_string())),
            };

            // If empty and unstaged and a specific file was requested, check for untracked file
            if diff_str.trim().is_empty() && !staged {
                if let Some(f) = file_opt {
                    let full_path = Path::new(cwd).join(f);
                    if full_path.exists() && full_path.is_file() {
                        if let Ok(no_index) = Command::new("git")
                            .args(["diff", "--no-index", "/dev/null", f])
                            .current_dir(cwd)
                            .output()
                        {
                            let s = String::from_utf8_lossy(&no_index.stdout).to_string();
                            if !s.is_empty() {
                                diff_str = s;
                            }
                        }
                    }
                }
            }

            Ok(json!({
                "diff": diff_str,
                "error": err_msg
            }))
        }

        "git_stage" => {
            let cwd = args.get("cwd").and_then(|v| v.as_str()).unwrap_or_else(|| default_workspace());
            let all = args.get("all").and_then(|v| v.as_bool()).unwrap_or(false);
            let mut paths: Vec<String> = Vec::new();
            if let Some(arr) = args.get("paths").and_then(|v| v.as_array()) {
                for p in arr {
                    if let Some(s) = p.as_str() {
                        paths.push(s.to_string());
                    }
                }
            } else if let Some(p) = args.get("path").and_then(|v| v.as_str()) {
                paths.push(p.to_string());
            }

            let mut cmd = Command::new("git");
            cmd.arg("add");
            if all || paths.is_empty() {
                cmd.arg("-A");
            } else {
                for p in &paths {
                    cmd.arg(p);
                }
            }
            match cmd.current_dir(cwd).output() {
                Ok(out) => {
                    let success = out.status.success();
                    let stderr = String::from_utf8_lossy(&out.stderr).to_string();
                    Ok(json!({ "ok": success, "success": success, "error": if success { Value::Null } else { json!(stderr) } }))
                }
                Err(e) => Ok(json!({ "ok": false, "success": false, "error": e.to_string() })),
            }
        }

        "git_unstage" => {
            let cwd = args.get("cwd").and_then(|v| v.as_str()).unwrap_or_else(|| default_workspace());
            let all = args.get("all").and_then(|v| v.as_bool()).unwrap_or(false);
            let mut paths: Vec<String> = Vec::new();
            if let Some(arr) = args.get("paths").and_then(|v| v.as_array()) {
                for p in arr {
                    if let Some(s) = p.as_str() {
                        paths.push(s.to_string());
                    }
                }
            } else if let Some(p) = args.get("path").and_then(|v| v.as_str()) {
                paths.push(p.to_string());
            }

            let mut cmd = Command::new("git");
            cmd.args(["restore", "--staged"]);
            if all || paths.is_empty() {
                cmd.arg(".");
            } else {
                for p in &paths {
                    cmd.arg(p);
                }
            }
            match cmd.current_dir(cwd).output() {
                Ok(out) => {
                    let success = out.status.success();
                    let stderr = String::from_utf8_lossy(&out.stderr).to_string();
                    Ok(json!({ "ok": success, "success": success, "error": if success { Value::Null } else { json!(stderr) } }))
                }
                Err(e) => Ok(json!({ "ok": false, "success": false, "error": e.to_string() })),
            }
        }

        "git_discard" => {
            let cwd = args.get("cwd").and_then(|v| v.as_str()).unwrap_or_else(|| default_workspace());
            let mut paths: Vec<String> = Vec::new();
            if let Some(arr) = args.get("paths").and_then(|v| v.as_array()) {
                for p in arr {
                    if let Some(s) = p.as_str() {
                        paths.push(s.to_string());
                    }
                }
            } else if let Some(p) = args.get("path").and_then(|v| v.as_str()) {
                paths.push(p.to_string());
            }

            if paths.is_empty() {
                let _ = Command::new("git").args(["restore", "."]).current_dir(cwd).output();
                let _ = Command::new("git").args(["clean", "-fd"]).current_dir(cwd).output();
            } else {
                for p in &paths {
                    let _ = Command::new("git").args(["restore", p]).current_dir(cwd).output();
                    let _ = Command::new("git").args(["clean", "-fd", p]).current_dir(cwd).output();
                }
            }
            Ok(json!({ "ok": true, "success": true }))
        }

        "git_commit" => {
            let cwd = args.get("cwd").and_then(|v| v.as_str()).unwrap_or_else(|| default_workspace());
            let msg = args.get("message").and_then(|v| v.as_str()).unwrap_or("Update");
            let stage_all = args.get("stageAll").and_then(|v| v.as_bool()).unwrap_or(false);
            if stage_all {
                let _ = Command::new("git").args(["add", "-A"]).current_dir(cwd).output();
            }
            match Command::new("git").args(["commit", "-m", msg]).current_dir(cwd).output() {
                Ok(out) => {
                    let success = out.status.success();
                    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
                    let stderr = String::from_utf8_lossy(&out.stderr).to_string();
                    Ok(json!({
                        "ok": success,
                        "success": success,
                        "output": stdout,
                        "error": if success { Value::Null } else { json!(stderr) }
                    }))
                }
                Err(e) => Ok(json!({ "ok": false, "success": false, "error": e.to_string() })),
            }
        }

        "git_branches" => {
            let cwd = args.get("cwd").and_then(|v| v.as_str()).unwrap_or_else(|| default_workspace());
            let out = Command::new("git").args(["branch", "-a"]).current_dir(cwd).output().map_err(|e| e.to_string())?;
            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
            let mut current = "main".to_string();
            let mut branches = Vec::new();
            for line in stdout.lines() {
                let is_current = line.contains('*');
                let clean = line.replace('*', "").trim().to_string();
                if !clean.is_empty() {
                    if is_current {
                        current = clean.clone();
                    }
                    branches.push(json!({
                        "name": clean,
                        "current": is_current
                    }));
                }
            }
            Ok(json!({
                "current": current,
                "branches": branches
            }))
        }

        "git_checkout" => {
            let cwd = args.get("cwd").and_then(|v| v.as_str()).unwrap_or_else(|| default_workspace());
            let branch = args.get("branch").and_then(|v| v.as_str()).unwrap_or("main");
            let create = args.get("create").and_then(|v| v.as_bool()).unwrap_or(false);
            let mut cmd = Command::new("git");
            cmd.arg("checkout");
            if create {
                cmd.arg("-b");
            }
            cmd.arg(branch);
            match cmd.current_dir(cwd).output() {
                Ok(out) => {
                    let success = out.status.success();
                    let stderr = String::from_utf8_lossy(&out.stderr).to_string();
                    Ok(json!({
                        "ok": success,
                        "success": success,
                        "currentBranch": branch,
                        "error": if success { Value::Null } else { json!(stderr) }
                    }))
                }
                Err(e) => Ok(json!({ "ok": false, "success": false, "error": e.to_string() })),
            }
        }

        "git_sync" => {
            let cwd = args.get("cwd").and_then(|v| v.as_str()).unwrap_or_else(|| default_workspace());
            let action = args.get("action").and_then(|v| v.as_str()).unwrap_or("sync");
            match action {
                "pull" => {
                    match Command::new("git").args(["pull", "--rebase"]).current_dir(cwd).output() {
                        Ok(out) => {
                            let success = out.status.success();
                            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
                            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
                            Ok(json!({
                                "ok": success,
                                "success": success,
                                "output": stdout,
                                "error": if success { Value::Null } else { json!(stderr) }
                            }))
                        }
                        Err(e) => Ok(json!({ "ok": false, "success": false, "error": e.to_string() })),
                    }
                }
                "push" => {
                    match Command::new("git").args(["push"]).current_dir(cwd).output() {
                        Ok(out) => {
                            let success = out.status.success();
                            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
                            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
                            Ok(json!({
                                "ok": success,
                                "success": success,
                                "output": stdout,
                                "error": if success { Value::Null } else { json!(stderr) }
                            }))
                        }
                        Err(e) => Ok(json!({ "ok": false, "success": false, "error": e.to_string() })),
                    }
                }
                _ => {
                    let _ = Command::new("git").args(["pull", "--rebase"]).current_dir(cwd).output();
                    match Command::new("git").args(["push"]).current_dir(cwd).output() {
                        Ok(out) => {
                            let success = out.status.success();
                            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
                            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
                            Ok(json!({
                                "ok": success,
                                "success": success,
                                "output": stdout,
                                "error": if success { Value::Null } else { json!(stderr) }
                            }))
                        }
                        Err(e) => Ok(json!({ "ok": false, "success": false, "error": e.to_string() })),
                    }
                }
            }
        }
        "git_init" => {
            let cwd = args.get("cwd").and_then(|v| v.as_str()).unwrap_or_else(|| default_workspace());
            let _ = std::fs::create_dir_all(cwd);
            match Command::new("git").arg("init").current_dir(cwd).output() {
                Ok(out) => {
                    let success = out.status.success();
                    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
                    let stderr = String::from_utf8_lossy(&out.stderr).to_string();
                    Ok(json!({
                        "ok": success,
                        "success": success,
                        "output": stdout,
                        "error": if success { Value::Null } else { json!(stderr) }
                    }))
                }
                Err(e) => {
                    Ok(json!({
                        "ok": false,
                        "success": false,
                        "error": e.to_string()
                    }))
                }
            }
        }
        "git_resolve_conflict" => {
            let cwd = args.get("cwd").and_then(|v| v.as_str()).unwrap_or_else(|| default_workspace());
            let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
            let strategy = args.get("strategy").and_then(|v| v.as_str()).unwrap_or("ours");
            if path.is_empty() {
                return Ok(json!({ "ok": false, "success": false, "error": "Missing path" }));
            }
            let flag = if strategy == "theirs" { "--theirs" } else { "--ours" };
            let out = Command::new("git").args(["checkout", flag, path]).current_dir(cwd).output();
            match out {
                Ok(o) => {
                    if o.status.success() {
                        let _ = Command::new("git").args(["add", path]).current_dir(cwd).output();
                        Ok(json!({ "ok": true, "success": true }))
                    } else {
                        let stderr = String::from_utf8_lossy(&o.stderr).to_string();
                        Ok(json!({ "ok": false, "success": false, "error": stderr }))
                    }
                }
                Err(e) => Ok(json!({ "ok": false, "success": false, "error": e.to_string() })),
            }
        }
        other => Err(format!("unhandled git op: {}", other)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_git_op_is_reported() {
        let err = handle("git_does_not_exist", &json!({})).unwrap_err();
        assert!(err.contains("unhandled git op"));
    }

    #[test]
    fn status_and_init_work_against_a_real_repo() {
        let dir = std::env::temp_dir().join(format!("openpi-gitops-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let cwd = dir.to_string_lossy().to_string();

        let init = handle("git_init", &json!({ "cwd": cwd })).unwrap();
        assert_eq!(init["ok"], true, "git_init should succeed: {:?}", init);

        let status = handle("git_status", &json!({ "cwd": cwd })).unwrap();
        assert_eq!(status["isRepo"], true, "freshly initialized dir is a repo: {:?}", status);

        let _ = std::fs::remove_dir_all(&dir);
    }
}
