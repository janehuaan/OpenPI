use crate::types::{AppMode, ModelTier, RouteDecision};
use regex::Regex;

pub struct SemanticRouter {
    chat_patterns: Vec<Regex>,
    code_patterns: Vec<Regex>,
    heavy_refactor_patterns: Vec<Regex>,
}

impl Default for SemanticRouter {
    fn default() -> Self {
        Self::new()
    }
}

impl SemanticRouter {
    pub fn new() -> Self {
        let chat_patterns = vec![
            Regex::new(r"(?i)^(你好|您好|hi|hello|hey|在吗|在不在)[\s!！?？~.]*$").unwrap(),
            Regex::new(r"(?i)^(谢谢|多谢|thanks|thank you|ok|好的|收到|了解|明白)[\s!！?？~.]*$").unwrap(),
            Regex::new(r"(?i)(解释一下|是什么|为什么|怎么理解|区别是什么|对比|聊聊|讲个笑话|写首诗|翻译|介绍一下)").unwrap(),
            Regex::new(r"(?i)\b(explain|what is|why is|difference between|compare|tell me about|translate)\b").unwrap(),
        ];

        let code_patterns = vec![
            Regex::new(r"(?i)(重构|写一个|实现|改bug|修复|编写|报错|代码|函数|组件|接口|单测|构建|编译|依赖|安装|部署|提交|分支)").unwrap(),
            Regex::new(r"(?i)(跑不起来|跑一下|跑试试|试试看|运行一下|跑下|跑通|启不来|打不开)").unwrap(),
            Regex::new(r"(?i)(加个|做个|弄个|搞个|补个|写个).*(弹窗|按钮|页面|功能|接口|样式|组件|卡片|列表|表单|路由|输入框)").unwrap(),
            Regex::new(r"(?i)\.(ts|tsx|js|jsx|py|rs|go|c|cpp|h|java|swift|json|ya?ml|html|css|vue|svelte)\b").unwrap(),
            Regex::new(r"```[a-z0-9_-]*\n[\s\S]*?\n```").unwrap(),
        ];

        let heavy_refactor_patterns = vec![
            Regex::new(r"(?i)(全栈重构|全面重构|架构重构|迁移到|模块重写|性能优化专项|深度分析整个项目)").unwrap(),
            Regex::new(r"(?i)(refactor the entire|rewrite architecture|migrate from .* to|deep architecture review)").unwrap(),
        ];

        Self {
            chat_patterns,
            code_patterns,
            heavy_refactor_patterns,
        }
    }

    pub fn route(&self, prompt: &str, has_workspace: bool) -> RouteDecision {
        let text = prompt.trim();
        if text.is_empty() {
            return RouteDecision {
                mode: AppMode::Chat,
                recommended_tier: ModelTier::Fast,
                confidence: 0.95,
                requires_workspace: false,
                reason: "Empty prompt defaults to lightweight chat".into(),
            };
        }

        // 1. Heavy refactoring intent -> Max Tier
        for pat in &self.heavy_refactor_patterns {
            if pat.is_match(text) {
                return RouteDecision {
                    mode: AppMode::Code,
                    recommended_tier: ModelTier::Max,
                    confidence: 0.96,
                    requires_workspace: true,
                    reason: "Detected heavy architectural refactoring intent".into(),
                };
            }
        }

        // 2. Pure Chat check
        for pat in &self.chat_patterns {
            if pat.is_match(text) {
                // If it doesn't also contain explicit code keywords
                let has_code = self.code_patterns.iter().any(|cp| cp.is_match(text));
                if !has_code {
                    return RouteDecision {
                        mode: AppMode::Chat,
                        recommended_tier: ModelTier::Fast,
                        confidence: 0.95,
                        requires_workspace: false,
                        reason: "Matched conversational inquiry or explanation".into(),
                    };
                }
            }
        }

        // 3. Coding Patterns
        let mut code_matches = 0;
        for pat in &self.code_patterns {
            if pat.is_match(text) {
                code_matches += 1;
            }
        }

        if code_matches > 0 {
            let tier = if code_matches >= 2 || text.len() > 100 {
                ModelTier::Thinking
            } else {
                ModelTier::Fast
            };

            return RouteDecision {
                mode: AppMode::Code,
                recommended_tier: tier,
                confidence: (0.80 + (code_matches as f32) * 0.05).min(0.98),
                requires_workspace: true,
                reason: format!("Detected technical engineering keywords (score={})", code_matches),
            };
        }

        // 4. Contextual Workspace check
        if has_workspace && text.len() > 10 {
            return RouteDecision {
                mode: AppMode::Code,
                recommended_tier: ModelTier::Fast,
                confidence: 0.70,
                requires_workspace: true,
                reason: "Contextual fallback: user has an active code workspace".into(),
            };
        }

        RouteDecision {
            mode: AppMode::Chat,
            recommended_tier: ModelTier::Fast,
            confidence: 0.75,
            requires_workspace: false,
            reason: "Standard informational query fallback".into(),
        }
    }
}
