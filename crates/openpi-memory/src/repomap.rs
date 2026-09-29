use std::collections::BTreeMap;
use std::path::Path;
use regex::Regex;
use walkdir::WalkDir;

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
    "Library",
    "Applications",
    "Music",
    "Movies",
    "Pictures",
    "Downloads",
    "Documents",
    "Desktop",
    ".Trash",
    ".npm",
    ".cargo",
    ".rustup",
    ".pyenv",
    ".nvm",
    ".docker",
];

pub struct RepoMapGenerator;

impl RepoMapGenerator {
    pub fn generate(root: &Path, max_depth: usize, max_chars: usize) -> String {
        let home = std::env::var("HOME").unwrap_or_default();
        if !home.is_empty() && (root == Path::new(&home) || root == Path::new("/")) {
            return String::new();
        }
        let forbidden_roots = ["/Users", "/System", "/Library", "/Applications", "/Volumes", "/private", "/var", "/etc", "/bin", "/usr", "/sbin"];
        if forbidden_roots.iter().any(|f| root == Path::new(f)) {
            return String::new();
        }

        let rust_regex = Regex::new(r"(?m)^\s*(?:pub(?:\([^\)]+\))?\s+)?(?:struct|enum|trait)\s+([A-Za-z0-9_]+)|^\s*(?:pub(?:\([^\)]+\))?\s+)?(?:async\s+)?fn\s+([A-Za-z0-9_]+)").unwrap();
        let ts_regex = Regex::new(r"(?m)^\s*export\s+(?:default\s+)?(?:class|interface|type|enum)\s+([A-Za-z0-9_]+)|^\s*export\s+(?:default\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)").unwrap();
        let py_regex = Regex::new(r"(?m)^\s*(?:class|def)\s+([A-Za-z0-9_]+)").unwrap();
        let go_regex = Regex::new(r"(?m)^\s*func\s+(?:\([^)]+\)\s+)?([A-Za-z0-9_]+)|^\s*type\s+([A-Za-z0-9_]+)\s+(?:struct|interface)").unwrap();

        // Collect directory -> list of (file_name, symbols)
        let mut tree: BTreeMap<String, Vec<(String, Vec<String>)>> = BTreeMap::new();
        let mut total_files = 0;

        for entry in WalkDir::new(root)
            .max_depth(max_depth)
            .into_iter()
            .filter_entry(|e| !Self::is_ignored_dir(e))
            .filter_map(|e| e.ok())
        {
            if total_files >= 60 {
                break;
            }
            let path = entry.path();
            if !path.is_file() {
                continue;
            }

            let rel_path = match path.strip_prefix(root) {
                Ok(p) => p,
                Err(_) => continue,
            };

            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
            if !["rs", "ts", "tsx", "js", "jsx", "py", "go"].contains(&ext.as_str()) {
                continue;
            }

            total_files += 1;
            let dir_name = rel_path.parent().map(|p| p.to_string_lossy().to_string()).unwrap_or_default();
            let file_name = rel_path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();

            let mut symbols = Vec::new();
            if let Ok(content) = std::fs::read_to_string(path) {
                let re = match ext.as_str() {
                    "rs" => &rust_regex,
                    "ts" | "tsx" | "js" | "jsx" => &ts_regex,
                    "py" => &py_regex,
                    "go" => &go_regex,
                    _ => &rust_regex,
                };

                for cap in re.captures_iter(&content) {
                    if let Some(m) = cap.get(1).or_else(|| cap.get(2)) {
                        let sym = m.as_str().to_string();
                        if !symbols.contains(&sym) {
                            symbols.push(sym);
                        }
                    }
                    if symbols.len() >= 6 {
                        break;
                    }
                }
            }

            tree.entry(dir_name).or_default().push((file_name, symbols));
        }

        let mut output = String::new();
        let root_name = root.file_name().map(|n| n.to_string_lossy()).unwrap_or_else(|| "workspace".into());
        output.push_str(&format!("{}/\n", root_name));

        let mut current_chars = output.len();
        let mut truncated = false;

        for (dir, mut files) in tree {
            files.sort_by(|a, b| a.0.cmp(&b.0));

            let dir_prefix = if dir.is_empty() {
                "  ├── ".to_string()
            } else {
                format!("  📁 {}/\n", dir)
            };

            if current_chars + dir_prefix.len() > max_chars {
                truncated = true;
                break;
            }
            output.push_str(&dir_prefix);
            current_chars += dir_prefix.len();

            for (file_name, symbols) in files {
                let sym_str = if symbols.is_empty() {
                    String::new()
                } else {
                    format!(" ({})", symbols.join(", "))
                };

                let line = if dir.is_empty() {
                    format!("  ├── {}{}\n", file_name, sym_str)
                } else {
                    format!("    ├── {}{}\n", file_name, sym_str)
                };

                if current_chars + line.len() > max_chars {
                    truncated = true;
                    break;
                }
                output.push_str(&line);
                current_chars += line.len();
            }

            if truncated {
                break;
            }
        }

        if truncated {
            output.push_str(&format!("\n... [Repo Map truncated to fit budget. Total code files: {}]\n", total_files));
        }

        output
    }

    fn is_ignored_dir(entry: &walkdir::DirEntry) -> bool {
        if !entry.file_type().is_dir() {
            return false;
        }
        let file_name = entry.file_name().to_string_lossy();
        IGNORED_DIRS.iter().any(|&d| file_name == d)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;

    #[test]
    fn test_repo_map_generation() {
        let temp_dir = std::env::temp_dir().join(format!("test_repomap_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let src_dir = temp_dir.join("src");
        fs::create_dir_all(&src_dir).unwrap();

        let cargo_toml = temp_dir.join("Cargo.toml");
        let mut fc = fs::File::create(&cargo_toml).unwrap();
        writeln!(fc, "[package]\nname = \"test\"").unwrap();

        let file1 = src_dir.join("lib.rs");
        let mut f1 = fs::File::create(&file1).unwrap();
        writeln!(f1, "pub struct EngineManager;\npub fn run_engine() {{}}").unwrap();

        let file2 = src_dir.join("app.ts");
        let mut f2 = fs::File::create(&file2).unwrap();
        writeln!(f2, "export class DesktopApp {{}}\nexport function launch() {{}}").unwrap();

        let repomap = RepoMapGenerator::generate(&temp_dir, 4, 2000);
        assert!(repomap.contains("src/"));
        assert!(repomap.contains("lib.rs"));
        assert!(repomap.contains("EngineManager") || repomap.contains("run_engine"));
        assert!(repomap.contains("DesktopApp") || repomap.contains("launch"));

        // Verify root and system root directories return empty string
        assert_eq!(RepoMapGenerator::generate(Path::new("/"), 4, 2000), "");
        assert_eq!(RepoMapGenerator::generate(Path::new("/Users"), 4, 2000), "");

        let _ = fs::remove_dir_all(&temp_dir);
    }
}
