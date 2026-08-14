const directResponsePromptPattern =
	/^(?:please\s+)?(?:say|reply|respond|answer|output|print|return)\s+(?:exactly\s+)?["'`]?[\s\S]{1,200}$/i;
const directResponsePromptPatternZh = /^(?:请)?(?:直接)?(?:说|回复|回答|输出|返回)[：:\s]?[\s\S]{1,200}$/;
const workPromptPattern =
	/\b(?:fix|implement|add|change|modify|edit|write|refactor|migrate|build|create|install|upgrade|debug|investigate|review)\b/i;
const workPromptPatternZh = /(?:修复|实现|增加|添加|修改|重构|迁移|构建|创建|安装|升级|开发|调试|排查|审查)/;
const workspacePromptPattern =
	/\b(?:repo|repository|project|workspace|codebase|package|file|folder|directory|function|class|type|test|error|exception|stack trace|diff|commit|pr|issue)\b/i;
const workspacePromptPatternZh = /(?:仓库|项目|代码|文件|目录|函数|类型|测试|报错|错误|异常|堆栈|提交|合并请求|问题)/;

export function isDirectResponsePrompt(prompt: string): boolean {
	const normalized = prompt.trim();
	if (!normalized) return false;
	if (workPromptPattern.test(normalized) || workPromptPatternZh.test(normalized)) return false;
	if (workspacePromptPattern.test(normalized) || workspacePromptPatternZh.test(normalized)) return false;
	return directResponsePromptPattern.test(normalized) || directResponsePromptPatternZh.test(normalized);
}
