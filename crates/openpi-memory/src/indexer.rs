use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use walkdir::WalkDir;
use crate::bm25::Bm25Index;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeChunk {
    pub file_path: String,
    pub start_line: usize,
    pub end_line: usize,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeSearchHit {
    pub file_path: String,
    pub start_line: usize,
    pub end_line: usize,
    pub score: f32,
    pub snippet: String,
}

const IGNORED_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    ".next",
    ".openpi",
    "vendor",
    ".cache",
    "coverage",
    "__pycache__",
    ".venv",
    ".tox",
    "Pods",
    ".gradle",
    ".idea",
    ".vscode",
];

const IGNORED_EXTS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "ico", "webp", "pdf", "zip", "tar", "gz", "wasm",
    "dylib", "so", "dll", "exe", "bin", "o", "a", "pyc", "class", "lock",
];

const MAX_FILE_SIZE: u64 = 500 * 1024; // 500 KB
const CHUNK_SIZE: usize = 35;
const CHUNK_OVERLAP: usize = 10;

pub struct CodebaseIndex {
    root_path: PathBuf,
    chunks: Vec<CodeChunk>,
    bm25: Bm25Index,
    indexed_files_count: usize,
}

impl CodebaseIndex {
    pub fn index_workspace(root: &Path, max_files: usize) -> anyhow::Result<Self> {
        let mut chunks = Vec::new();
        let mut indexed_files_count = 0;

        for entry in WalkDir::new(root)
            .into_iter()
            .filter_entry(|e| !Self::is_ignored_dir(e))
            .filter_map(|e| e.ok())
        {
            if indexed_files_count >= max_files {
                break;
            }

            let path = entry.path();
            if !path.is_file() {
                continue;
            }

            if Self::is_ignored_file(path) {
                continue;
            }

            if let Ok(metadata) = path.metadata() {
                if metadata.len() > MAX_FILE_SIZE {
                    continue;
                }
            }

            if let Ok(content) = std::fs::read_to_string(path) {
                let rel_path = path
                    .strip_prefix(root)
                    .unwrap_or(path)
                    .to_string_lossy()
                    .to_string();

                let file_chunks = Self::chunk_text(&rel_path, &content);
                chunks.extend(file_chunks);
                indexed_files_count += 1;
            }
        }

        let texts: Vec<String> = chunks.iter().map(|c| c.content.clone()).collect();
        let bm25 = Bm25Index::new(&texts);

        Ok(Self {
            root_path: root.to_path_buf(),
            chunks,
            bm25,
            indexed_files_count,
        })
    }

    pub fn search(&self, query: &str, limit: usize) -> Vec<CodeSearchHit> {
        if self.chunks.is_empty() || query.trim().is_empty() {
            return Vec::new();
        }

        let scores = self.bm25.score(query);
        let mut candidates: Vec<(usize, f32)> = scores
            .into_iter()
            .enumerate()
            .filter(|(_, score)| *score > 0.0)
            .collect();

        candidates.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

        let mut hits = Vec::new();
        for (idx, score) in candidates {
            if hits.len() >= limit {
                break;
            }

            let chunk = &self.chunks[idx];
            // Format a clean snippet preview
            let snippet = if chunk.content.lines().count() > 10 {
                let first_few: Vec<&str> = chunk.content.lines().take(8).collect();
                format!("{}\n... ({} lines total)", first_few.join("\n"), chunk.content.lines().count())
            } else {
                chunk.content.clone()
            };

            hits.push(CodeSearchHit {
                file_path: chunk.file_path.clone(),
                start_line: chunk.start_line,
                end_line: chunk.end_line,
                score,
                snippet,
            });
        }

        hits
    }

    pub fn stats(&self) -> (usize, usize) {
        (self.indexed_files_count, self.chunks.len())
    }

    pub fn root(&self) -> &Path {
        &self.root_path
    }

    fn is_ignored_dir(entry: &walkdir::DirEntry) -> bool {
        if !entry.file_type().is_dir() {
            return false;
        }
        let file_name = entry.file_name().to_string_lossy();
        IGNORED_DIRS.iter().any(|&d| file_name == d)
    }

    fn is_ignored_file(path: &Path) -> bool {
        if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            let lower = ext.to_lowercase();
            if IGNORED_EXTS.iter().any(|&ie| lower == ie) {
                return true;
            }
        }
        false
    }

    fn chunk_text(file_path: &str, content: &str) -> Vec<CodeChunk> {
        let lines: Vec<&str> = content.lines().collect();
        let total_lines = lines.len();

        if total_lines == 0 {
            return Vec::new();
        }

        if total_lines <= CHUNK_SIZE + CHUNK_OVERLAP {
            return vec![CodeChunk {
                file_path: file_path.to_string(),
                start_line: 1,
                end_line: total_lines,
                content: content.to_string(),
            }];
        }

        let mut chunks = Vec::new();
        let mut start = 0;
        let step = CHUNK_SIZE.saturating_sub(CHUNK_OVERLAP).max(1);

        while start < total_lines {
            let end = (start + CHUNK_SIZE).min(total_lines);
            let chunk_lines = &lines[start..end];
            let chunk_content = chunk_lines.join("\n");

            chunks.push(CodeChunk {
                file_path: file_path.to_string(),
                start_line: start + 1,
                end_line: end,
                content: chunk_content,
            });

            if end == total_lines {
                break;
            }
            start += step;
        }

        chunks
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;

    #[test]
    fn test_codebase_index_and_search() {
        let temp_dir = std::env::temp_dir().join(format!("test_codebase_index_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir_all(&temp_dir).unwrap();

        let file1 = temp_dir.join("main.rs");
        let mut f1 = fs::File::create(&file1).unwrap();
        writeln!(f1, "fn main() {{\n    println!(\"Hello World from OpenPI!\");\n    start_daemon_server();\n}}").unwrap();

        let file2 = temp_dir.join("daemon.rs");
        let mut f2 = fs::File::create(&file2).unwrap();
        writeln!(f2, "pub fn start_daemon_server() {{\n    let socket = \"/tmp/openpi.sock\";\n    listen(socket);\n}}").unwrap();

        let index = CodebaseIndex::index_workspace(&temp_dir, 100).unwrap();
        let (files, chunks) = index.stats();
        assert_eq!(files, 2);
        assert!(chunks >= 2);

        let hits = index.search("daemon server socket", 5);
        assert!(!hits.is_empty());
        assert_eq!(hits[0].file_path, "daemon.rs");

        let _ = fs::remove_dir_all(&temp_dir);
    }
}
