use anyhow::Result;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrendingRepo {
    pub repo: String,
    pub description: String,
    pub language: String,
    pub stars: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuickSearchResult {
    pub title: String,
    pub snippet: String,
    pub link: String,
}

pub struct WebRadar;

impl WebRadar {
    /// 免 API 嗅探 GitHub 热榜（原生 CLI/HTTP 流式抓取）
    pub async fn fetch_github_trending(since: Option<&str>) -> Result<Vec<TrendingRepo>> {
        let period = since.unwrap_or("daily");
        let url = format!("https://github.com/trending?since={}", period);

        // 使用系统原生 curl 请求，免第三方重型网络库，零额外显式依赖
        let output = tokio::process::Command::new("curl")
            .arg("-sL")
            .arg("-H")
            .arg("User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")
            .arg(&url)
            .output()
            .await?;

        if !output.status.success() {
            return Ok(Vec::new());
        }

        let html = String::from_utf8_lossy(&output.stdout);
        let mut repos = Vec::new();

        // 极简零依赖正则提取 repo
        let re_repo = regex::Regex::new(r#"href="/([a-zA-Z0-9_\-\.]+/[a-zA-Z0-9_\-\.]+)"\s+data-hydro-click"#).unwrap();
        let re_desc = regex::Regex::new(r#"<p class="col-9 color-fg-muted my-1 pr-4">\s*(.*?)\s*</p>"#).unwrap();

        let repo_names: Vec<String> = re_repo
            .captures_iter(&html)
            .map(|c| c[1].to_string())
            .filter(|name| !name.contains("features/") && !name.contains("pricing") && !name.contains("trending/"))
            .collect();

        let descs: Vec<String> = re_desc
            .captures_iter(&html)
            .map(|c| c[1].trim().to_string())
            .collect();

        for (i, repo_name) in repo_names.into_iter().take(10).enumerate() {
            let desc = descs.get(i).cloned().unwrap_or_default();
            repos.push(TrendingRepo {
                repo: repo_name,
                description: desc,
                language: "Unknown".into(),
                stars: "N/A".into(),
            });
        }

        Ok(repos)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_radar_structure() {
        // 验证基本数据结构序列化
        let item = TrendingRepo {
            repo: "rust-lang/rust".into(),
            description: "Empowering everyone to build reliable and efficient software.".into(),
            language: "Rust".into(),
            stars: "95k".into(),
        };
        let serialized = serde_json::to_string(&item).unwrap();
        assert!(serialized.contains("rust-lang/rust"));
    }
}
