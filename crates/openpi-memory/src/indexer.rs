use std::collections::HashMap;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use walkdir::WalkDir;
use crate::bm25::Bm25Index;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CodeChunk {
    pub file_path: String,
    pub start_line: usize,
    pub end_line: usize,
    pub content: String,
}

/// 单文件指纹：内容长度 + 修改时间（纳秒）。用于判定文件是否变化。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FileFingerprint {
    pub len: u64,
    pub mtime_nanos: u128,
}

impl FileFingerprint {
    pub fn of(path: &Path) -> Option<Self> {
        let md = path.metadata().ok()?;
        let mtime_nanos = md
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        Some(Self {
            len: md.len(),
            mtime_nanos,
        })
    }
}

/// 增量刷新统计。
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct IndexDelta {
    pub added: usize,
    pub updated: usize,
    pub removed: usize,
    pub unchanged: usize,
}

impl IndexDelta {
    pub fn changed(&self) -> usize {
        self.added + self.updated + self.removed
    }
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
    fingerprints: HashMap<String, FileFingerprint>,
}

impl CodebaseIndex {
    pub fn index_workspace(root: &Path, max_files: usize) -> anyhow::Result<Self> {
        let mut chunks = Vec::new();
        let mut indexed_files_count = 0;
        let mut fingerprints: HashMap<String, FileFingerprint> = HashMap::new();

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
                if let Some(fp) = FileFingerprint::of(path) {
                    fingerprints.insert(rel_path.clone(), fp);
                }
            }
        }

        let texts: Vec<String> = chunks.iter().map(|c| c.content.clone()).collect();
        let bm25 = Bm25Index::new(&texts);

        Ok(Self {
            root_path: root.to_path_buf(),
            chunks,
            bm25,
            indexed_files_count,
            fingerprints,
        })
    }

    /// 增量刷新：复用 `self` 中未变化文件的 chunk，仅重读新增/变更文件。
    ///
    /// 产出的索引与 [`index_workspace`](Self::index_workspace) 全量重建**逐字节等价**
    /// （chunk 顺序、内容、BM25 语料完全一致），但跳过未变化文件的磁盘读取与分词开销。
    pub fn refresh_from(
        &self,
        root: &Path,
        max_files: usize,
    ) -> anyhow::Result<(Self, IndexDelta)> {
        // 旧 chunk 按文件分组，供未变化文件复用。
        let mut by_file: HashMap<&str, Vec<CodeChunk>> = HashMap::new();
        for c in &self.chunks {
            by_file.entry(c.file_path.as_str()).or_default().push(c.clone());
        }

        let mut delta = IndexDelta::default();
        let mut chunks: Vec<CodeChunk> = Vec::new();
        let mut fingerprints: HashMap<String, FileFingerprint> = HashMap::new();
        let mut indexed_files_count = 0usize;

        for entry in WalkDir::new(root)
            .into_iter()
            .filter_entry(|e| !Self::is_ignored_dir(e))
            .filter_map(|e| e.ok())
        {
            if indexed_files_count >= max_files {
                break;
            }
            let path = entry.path();
            if !path.is_file() || Self::is_ignored_file(path) {
                continue;
            }
            if let Ok(metadata) = path.metadata() {
                if metadata.len() > MAX_FILE_SIZE {
                    continue;
                }
            }

            let rel_path = path
                .strip_prefix(root)
                .unwrap_or(path)
                .to_string_lossy()
                .to_string();

            let fp = FileFingerprint::of(path);
            let unchanged = fp.is_some_and(|fp| self.fingerprints.get(&rel_path) == Some(&fp));

            if unchanged {
                // 复用旧 chunk（顺序与全量重建一致；空文件自然得到空 vec）。
                chunks.extend(by_file.remove(rel_path.as_str()).unwrap_or_default());
                indexed_files_count += 1;
                delta.unchanged += 1;
                if let Some(fp) = fp {
                    fingerprints.insert(rel_path, fp);
                }
                continue;
            }

            // 新增或变更 → 重读 + 重新分块。
            if let Ok(content) = std::fs::read_to_string(path) {
                if self.fingerprints.contains_key(&rel_path) {
                    delta.updated += 1;
                } else {
                    delta.added += 1;
                }
                by_file.remove(rel_path.as_str());
                chunks.extend(Self::chunk_text(&rel_path, &content));
                indexed_files_count += 1;
                if let Some(fp) = fp {
                    fingerprints.insert(rel_path, fp);
                }
            }
        }

        // 旧索引中已从磁盘消失的文件计为移除（被 max_files 截断者仍存在，不计）。
        delta.removed = self
            .fingerprints
            .keys()
            .filter(|k| !fingerprints.contains_key(*k) && !root.join(k.as_str()).exists())
            .count();

        let texts: Vec<String> = chunks.iter().map(|c| c.content.clone()).collect();
        let bm25 = Bm25Index::new(&texts);

        Ok((
            Self {
                root_path: root.to_path_buf(),
                chunks,
                bm25,
                indexed_files_count,
                fingerprints,
            },
            delta,
        ))
    }

    /// 已索引文件数。
    pub fn indexed_files(&self) -> usize {
        self.indexed_files_count
    }

    /// 当前 chunk 切片（供测试/观测）。
    pub fn chunks(&self) -> &[CodeChunk] {
        &self.chunks
    }

    /// 记录的指纹数量。
    pub fn fingerprint_count(&self) -> usize {
        self.fingerprints.len()
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

    fn fresh_dir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!(
            "idx_inc_{}_{}",
            tag,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&d).unwrap();
        d
    }

    /// 增量刷新必须与全量重建逐字节等价，且 delta 统计正确。
    #[test]
    fn incremental_matches_full_rebuild() {
        let dir = fresh_dir("equiv");
        fs::write(dir.join("a.rs"), "fn alpha() { let x = 1; }\n").unwrap();
        fs::write(dir.join("b.rs"), "fn beta() { let y = 2; }\n").unwrap();
        fs::write(dir.join("c.rs"), "fn gamma() { let z = 3; }\n").unwrap();

        let base = CodebaseIndex::index_workspace(&dir, 1000).unwrap();

        // 改一个、加一个、删一个。
        fs::write(dir.join("a.rs"), "fn alpha_changed() { let x = 42; }\nfn extra() {}\n").unwrap();
        fs::write(dir.join("d.rs"), "fn delta_new() { let w = 4; }\n").unwrap();
        fs::remove_file(dir.join("c.rs")).unwrap();

        let (inc, delta) = base.refresh_from(&dir, 1000).unwrap();
        let full = CodebaseIndex::index_workspace(&dir, 1000).unwrap();

        // 逐字节等价（顺序 + 内容）。
        assert_eq!(inc.chunks(), full.chunks(), "增量结果与全量重建不一致");
        assert_eq!(inc.indexed_files(), full.indexed_files());

        assert_eq!(delta.updated, 1, "delta={:?}", delta);
        assert_eq!(delta.added, 1, "delta={:?}", delta);
        assert_eq!(delta.removed, 1, "delta={:?}", delta);
        assert_eq!(delta.unchanged, 1, "delta={:?}", delta);

        // 搜索也应一致。
        assert_eq!(
            inc.search("alpha_changed", 5)[0].file_path,
            full.search("alpha_changed", 5)[0].file_path
        );

        let _ = fs::remove_dir_all(&dir);
    }

    /// 未变化文件不得被重读：用同长度改写并复原 mtime 来验证复用。
    #[test]
    fn unchanged_file_is_not_reread() {
        let dir = fresh_dir("reuse");
        let a = dir.join("a.rs");
        fs::write(&a, "fn keep() { 1111; }\n").unwrap();

        let base = CodebaseIndex::index_workspace(&dir, 100).unwrap();
        let before = FileFingerprint::of(&a).unwrap();

        // 同长度改写，并把 mtime 复原 → 指纹不变。
        fs::write(&a, "fn keep() { 2222; }\n").unwrap();
        if let Ok(f) = fs::File::open(&a) {
            let _ = f.set_modified(std::time::UNIX_EPOCH + std::time::Duration::from_nanos(before.mtime_nanos as u64));
        }
        let after = FileFingerprint::of(&a).unwrap();

        if before == after {
            let (inc, delta) = base.refresh_from(&dir, 100).unwrap();
            assert_eq!(delta.unchanged, 1, "应判为未变化: {:?}", delta);
            assert_eq!(delta.updated, 0);
            assert!(
                inc.chunks().iter().any(|c| c.content.contains("1111")),
                "应复用旧 chunk（未重读）"
            );
            assert!(
                !inc.chunks().iter().any(|c| c.content.contains("2222")),
                "不应读到新磁盘内容"
            );
        }

        let _ = fs::remove_dir_all(&dir);
    }

    /// 二次刷新（无任何变化）应全部命中 unchanged，且仍与全量等价。
    #[test]
    fn second_refresh_is_noop() {
        let dir = fresh_dir("noop");
        fs::write(dir.join("x.rs"), "fn x() {}\n").unwrap();
        fs::write(dir.join("y.rs"), "fn y() {}\n").unwrap();

        let base = CodebaseIndex::index_workspace(&dir, 100).unwrap();
        let (inc, delta) = base.refresh_from(&dir, 100).unwrap();

        assert_eq!(delta.unchanged, 2, "delta={:?}", delta);
        assert_eq!(delta.changed(), 0, "delta={:?}", delta);
        assert_eq!(inc.chunks(), base.chunks());

        let _ = fs::remove_dir_all(&dir);
    }
}
