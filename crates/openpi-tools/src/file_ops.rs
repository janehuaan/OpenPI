use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReadFileResult {
    pub path: String,
    pub content: String,
    pub total_lines: usize,
    pub start_line: usize,
    pub end_line: usize,
    pub is_truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WriteFileResult {
    pub path: String,
    pub bytes_written: usize,
    pub is_new_file: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchReplaceResult {
    pub path: String,
    pub replacements_count: usize,
    pub lines_changed: usize,
}

pub struct FileOps;

impl FileOps {
    /// Read a file safely with line-based windowing and max-bytes protection
    pub fn read_file<P: AsRef<Path>>(
        path: P,
        start_line: Option<usize>,
        limit_lines: Option<usize>,
        max_bytes: Option<usize>,
    ) -> Result<ReadFileResult> {
        let p = path.as_ref();
        if !p.exists() {
            bail!("File not found: {}", p.display());
        }
        if p.is_dir() {
            bail!("Path is a directory, not a file: {}", p.display());
        }

        let metadata = fs::metadata(p).with_context(|| format!("Failed to read metadata for {}", p.display()))?;
        let byte_limit = max_bytes.unwrap_or(64 * 1024); // default 64KB cap

        // Check file size
        if metadata.len() > 10 * 1024 * 1024 {
            bail!(
                "File too large to inspect directly ({} MB). Please use grep_search or read specific line slices.",
                metadata.len() / (1024 * 1024)
            );
        }

        let raw_content = fs::read_to_string(p)
            .with_context(|| format!("Failed to read file as UTF-8 string: {}", p.display()))?;

        let lines: Vec<&str> = raw_content.lines().collect();
        let total_lines = lines.len();

        let s_line = start_line.unwrap_or(1).max(1);
        if s_line > total_lines && total_lines > 0 {
            return Ok(ReadFileResult {
                path: p.to_string_lossy().to_string(),
                content: String::new(),
                total_lines,
                start_line: s_line,
                end_line: s_line,
                is_truncated: false,
            });
        }

        let max_lines = limit_lines.unwrap_or(300).min(1000);
        let start_idx = s_line - 1;
        let end_idx = (start_idx + max_lines).min(total_lines);

        let mut output = String::new();
        let mut current_bytes = 0;
        let mut is_truncated = end_idx < total_lines;

        for (idx, line) in lines[start_idx..end_idx].iter().enumerate() {
            let line_num = start_idx + idx + 1;
            let formatted_line = format!("{:4} | {}\n", line_num, line);
            if current_bytes + formatted_line.len() > byte_limit {
                is_truncated = true;
                output.push_str("\n... [Output truncated: byte budget exceeded] ...\n");
                break;
            }
            output.push_str(&formatted_line);
            current_bytes += formatted_line.len();
        }

        Ok(ReadFileResult {
            path: p.to_string_lossy().to_string(),
            content: output,
            total_lines,
            start_line: s_line,
            end_line: start_idx + (end_idx - start_idx),
            is_truncated,
        })
    }

    /// Safely write content to a file, creating parent directories if needed
    pub fn write_file<P: AsRef<Path>>(path: P, content: &str, overwrite: bool) -> Result<WriteFileResult> {
        let p = path.as_ref();
        let is_new_file = !p.exists();

        if !is_new_file && !overwrite {
            bail!("File already exists and overwrite is set to false: {}", p.display());
        }

        if let Some(parent) = p.parent() {
            if !parent.exists() {
                fs::create_dir_all(parent)
                    .with_context(|| format!("Failed to create parent directory: {}", parent.display()))?;
            }
        }

        fs::write(p, content).with_context(|| format!("Failed to write to file: {}", p.display()))?;

        Ok(WriteFileResult {
            path: p.to_string_lossy().to_string(),
            bytes_written: content.len(),
            is_new_file,
        })
    }

    /// Surgical exact string replacement in a file
    pub fn search_replace<P: AsRef<Path>>(
        path: P,
        old_content: &str,
        new_content: &str,
        replace_all: bool,
    ) -> Result<SearchReplaceResult> {
        let p = path.as_ref();
        if !p.exists() {
            bail!("Target file does not exist: {}", p.display());
        }

        let content = fs::read_to_string(p)
            .with_context(|| format!("Failed to read target file: {}", p.display()))?;

        let occurrences = content.matches(old_content).count();
        if occurrences == 0 {
            bail!("Target string to replace was not found in: {}", p.display());
        }

        if !replace_all && occurrences > 1 {
            bail!(
                "Target string occurs {} times in {}. Refusing ambiguous single replacement. Provide more surrounding context or set replace_all=true.",
                occurrences,
                p.display()
            );
        }

        let new_file_content = if replace_all {
            content.replace(old_content, new_content)
        } else {
            content.replacen(old_content, new_content, 1)
        };

        let old_lines = content.lines().count();
        let new_lines = new_file_content.lines().count();
        let lines_changed = old_lines.abs_diff(new_lines);

        fs::write(p, new_file_content)
            .with_context(|| format!("Failed to write updated content to: {}", p.display()))?;

        Ok(SearchReplaceResult {
            path: p.to_string_lossy().to_string(),
            replacements_count: if replace_all { occurrences } else { 1 },
            lines_changed,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_read_and_write_file() {
        let tmp = std::env::temp_dir().join(format!("test_file_ops_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let test_file = tmp.join("sub").join("hello.txt");

        let write_res = FileOps::write_file(&test_file, "Line 1\nLine 2\nLine 3\nLine 4", true).unwrap();
        assert!(write_res.is_new_file);
        assert_eq!(write_res.bytes_written, 27);

        let read_res = FileOps::read_file(&test_file, Some(2), Some(2), None).unwrap();
        assert_eq!(read_res.total_lines, 4);
        assert!(read_res.content.contains("Line 2"));
        assert!(read_res.content.contains("Line 3"));
        assert!(!read_res.content.contains("Line 1"));

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_search_replace() {
        let tmp = std::env::temp_dir().join(format!("test_sr_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let test_file = tmp.join("config.rs");

        FileOps::write_file(&test_file, "pub const TIMEOUT: u64 = 30;\npub const RETRIES: u32 = 3;", true).unwrap();

        let sr_res = FileOps::search_replace(&test_file, "TIMEOUT: u64 = 30;", "TIMEOUT: u64 = 60;", false).unwrap();
        assert_eq!(sr_res.replacements_count, 1);

        let updated = fs::read_to_string(&test_file).unwrap();
        assert!(updated.contains("TIMEOUT: u64 = 60;"));

        let _ = fs::remove_dir_all(&tmp);
    }
}
