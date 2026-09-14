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
        let temp_dir = std::env::temp_dir().join(format!("openpi-tools-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();

        let test_file = temp_dir.join("sample_service.rs");
        let mut f = std::fs::File::create(&test_file).unwrap();
        writeln!(f, "fn main() {{\n    println!(\"hello openpi\");\n}}").unwrap();

        let found = FileScanner::find_files(&temp_dir, "sample", 10);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0], test_file);

        let grep_results = FileScanner::grep_content(&test_file, "openpi").unwrap();
        assert_eq!(grep_results.len(), 1);
        assert_eq!(grep_results[0].0, 2); // line 2
        assert!(grep_results[0].1.contains("hello openpi"));

        let _ = std::fs::remove_dir_all(temp_dir);
    }
}
