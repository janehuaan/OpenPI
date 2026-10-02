pub mod file_ops;
pub mod search_ops;
pub mod managed_bash;

pub use file_ops::{FileOps, ReadFileResult, WriteFileResult, SearchReplaceResult};
pub use search_ops::{SearchOps, SearchResult, GrepMatch};
pub use managed_bash::{ManagedBash, BashResult};

use std::path::{Path, PathBuf};
use walkdir::WalkDir;

pub struct FileScanner;

impl FileScanner {
    /// Fast recursive search for files matching query pattern, ignoring hidden/dist/node_modules
    pub fn find_files<P: AsRef<Path>>(root: P, query: &str, limit: usize) -> Vec<PathBuf> {
        let q = query.to_lowercase();
        let mut results = Vec::new();

        for entry in WalkDir::new(root)
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| {
                let name = e.file_name().to_string_lossy();
                // Skip common noise directories
                !(name.starts_with('.') && name.len() > 1)
                    && name != "node_modules"
                    && name != "dist"
                    && name != "target"
            })
            .filter_map(|e| e.ok())
        {
            if entry.file_type().is_file() {
                let name = entry.file_name().to_string_lossy().to_lowercase();
                if name.contains(&q) {
                    results.push(entry.path().to_path_buf());
                    if results.len() >= limit {
                        break;
                    }
                }
            }
        }

        results
    }

    /// Fast in-file text grep
    pub fn grep_content<P: AsRef<Path>>(file_path: P, query: &str) -> anyhow::Result<Vec<(usize, String)>> {
        let content = std::fs::read_to_string(file_path)?;
        let q = query.to_lowercase();
        let mut matches = Vec::new();

        for (idx, line) in content.lines().enumerate() {
            if line.to_lowercase().contains(&q) {
                matches.push((idx + 1, line.to_string()));
            }
        }

        Ok(matches)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn test_file_scanner_and_grep() {
        let temp_dir = std::env::temp_dir().join(format!("test_scanner_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let file_path = temp_dir.join("test_code.rs");
        let mut f = std::fs::File::create(&file_path).unwrap();
        writeln!(f, "fn test_function() {{\n    println!(\"Target Line\");\n}}").unwrap();

        let files = FileScanner::find_files(&temp_dir, "test", 5);
        assert_eq!(files.len(), 1);

        let matches = FileScanner::grep_content(&file_path, "target").unwrap();
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].0, 2);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
