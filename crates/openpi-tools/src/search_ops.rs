use anyhow::Result;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{BufRead, BufReader, Read};
use std::path::Path;
use walkdir::WalkDir;

const IGNORED_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    ".next",
    ".openpi",
    ".cache",
    "coverage",
    "__pycache__",
    ".venv",
    ".tox",
    "Pods",
    ".gradle",
    ".idea",
    ".vscode",
    "Library",
    "Applications",
    "Music",
    "Movies",
    "Pictures",
    "Downloads",
    "Documents",
    ".Trash",
    ".npm",
    ".cargo",
    ".rustup",
    ".pyenv",
    ".nvm",
    ".docker",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrepMatch {
    pub file_path: String,
    pub line_number: usize,
    pub line_content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub query: String,
    pub total_matches: usize,
    pub is_truncated: bool,
    pub matches: Vec<GrepMatch>,
}

pub struct SearchOps;

impl SearchOps {
    fn is_ignored(name: &str) -> bool {
        IGNORED_DIRS.contains(&name)
    }

    /// Fast, safe recursive file finder that never traverses noise/binary directories
    pub fn find_files<P: AsRef<Path>>(
        root: P,
        query: &str,
        max_depth: usize,
        limit: usize,
    ) -> Vec<String> {
        let root_path = root.as_ref();
        let q = query.trim().to_lowercase();
        let mut results = Vec::new();
        let max_results = limit.max(1).min(100);
        let depth = max_depth.max(1).min(10);

        for entry in WalkDir::new(root_path)
            .max_depth(depth)
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| !Self::is_ignored(&e.file_name().to_string_lossy()))
            .filter_map(|e| e.ok())
        {
            if entry.file_type().is_file() {
                let file_name = entry.file_name().to_string_lossy().to_lowercase();
                let rel_path = entry
                    .path()
                    .strip_prefix(root_path)
                    .unwrap_or_else(|_| entry.path())
                    .to_string_lossy()
                    .to_string();

                if q.is_empty() || file_name.contains(&q) || rel_path.to_lowercase().contains(&q) {
                    results.push(rel_path);
                    if results.len() >= max_results {
                        break;
                    }
                }
            }
        }

        results
    }

    /// Fast, bounded content search across workspace files
    pub fn grep_search<P: AsRef<Path>>(
        root: P,
        pattern: &str,
        file_extension: Option<&str>,
        max_results: usize,
    ) -> Result<SearchResult> {
        let root_path = root.as_ref();
        let limit = max_results.max(1).min(80);

        let regex = Regex::new(&format!("(?i){}", pattern))
            .or_else(|_| Regex::new(&regex::escape(pattern)))?;

        let mut matches = Vec::new();
        let mut is_truncated = false;

        for entry in WalkDir::new(root_path)
            .max_depth(7)
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| !Self::is_ignored(&e.file_name().to_string_lossy()))
            .filter_map(|e| e.ok())
        {
            if !entry.file_type().is_file() {
                continue;
            }

            let path = entry.path();

            // Optional extension filter
            if let Some(ext) = file_extension {
                if let Some(file_ext) = path.extension().and_then(|e| e.to_str()) {
                    if !file_ext.eq_ignore_ascii_case(ext.trim_start_matches('.')) {
                        continue;
                    }
                } else {
                    continue;
                }
            }

            // Skip files larger than 1.5MB
            if let Ok(meta) = entry.metadata() {
                if meta.len() > 1_500_000 || meta.len() == 0 {
                    continue;
                }
            }

            // Quick binary check: read first 512 bytes for null byte
            if Self::is_binary_file(path) {
                continue;
            }

            if let Ok(file) = File::open(path) {
                let reader = BufReader::new(file);
                let rel_path = path
                    .strip_prefix(root_path)
                    .unwrap_or(path)
                    .to_string_lossy()
                    .to_string();

                for (line_idx, line_res) in reader.lines().enumerate() {
                    if let Ok(line) = line_res {
                        if regex.is_match(&line) {
                            matches.push(GrepMatch {
                                file_path: rel_path.clone(),
                                line_number: line_idx + 1,
                                line_content: line.trim().to_string(),
                            });

                            if matches.len() >= limit {
                                is_truncated = true;
                                break;
                            }
                        }
                    }
                }
            }

            if is_truncated {
                break;
            }
        }

        let total_matches = matches.len();
        Ok(SearchResult {
            query: pattern.to_string(),
            total_matches,
            is_truncated,
            matches,
        })
    }

    fn is_binary_file(path: &Path) -> bool {
        let mut buf = [0u8; 512];
        if let Ok(mut file) = File::open(path) {
            if let Ok(bytes_read) = file.read(&mut buf) {
                return buf[..bytes_read].contains(&0);
            }
        }
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_search_ops() {
        let tmp = std::env::temp_dir().join(format!("test_search_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let src_dir = tmp.join("src");
        fs::create_dir_all(&src_dir).unwrap();

        fs::write(src_dir.join("main.rs"), "fn main() {\n    println!(\"Hello World\");\n}\n").unwrap();
        fs::write(src_dir.join("lib.rs"), "pub fn compute_sum() -> i32 {\n    42\n}\n").unwrap();

        // Test find_files
        let files = SearchOps::find_files(&tmp, "main", 3, 10);
        assert_eq!(files.len(), 1);
        assert!(files[0].contains("main.rs"));

        // Test grep_search
        let grep_res = SearchOps::grep_search(&tmp, "compute_sum", None, 10).unwrap();
        assert_eq!(grep_res.total_matches, 1);
        assert_eq!(grep_res.matches[0].line_number, 1);
        assert!(grep_res.matches[0].line_content.contains("pub fn compute_sum"));

        let _ = fs::remove_dir_all(&tmp);
    }
}
