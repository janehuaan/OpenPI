export type MarketplaceKind = "all" | "skills" | "mcp" | "repositories" | "plugins";

export type MarketplaceRegistry = "all" | "official" | "mcp" | "skills" | "security" | "workflow";

export interface MarketplaceRegistryInfo {
	id: MarketplaceRegistry;
	name: string;
	description: string;
	badge: string;
}

export const MARKETPLACE_REGISTRIES: MarketplaceRegistryInfo[] = [
	{ id: "all", name: "全部分类", description: "浏览所有已收录的生产级扩展、MCP 服务与技能", badge: "All" },
	{ id: "official", name: "🌟 官方推荐", description: "OpenPI 官方认证核心套件、子代理与协议网关", badge: "Official" },
	{ id: "mcp", name: "🔌 MCP 服务库", description: "Model Context Protocol 标准服务与数据连接器", badge: "MCP Hub" },
	{ id: "skills", name: "📚 研发技能库", description: "研发规范、TDD、架构规划、代码自愈与审阅技能", badge: "Skills" },
	{ id: "security", name: "🛡️ 安全与逆向", description: "渗透测试、漏洞自查、静态分析与逆向套件", badge: "Security" },
	{ id: "workflow", name: "⚙️ 工作流协作", description: "多智能体编排、任务依赖图谱与沙箱权限", badge: "Workflow" },
];

export interface MarketplaceRepo {
	id: string;
	name: string;
	fullName: string;
	url: string;
	description: string;
	type: "mcp" | "skills" | "plugins" | "all";
	typeName: string;
	stars?: string;
	featured?: boolean;
	tags: string[];
	itemsCount?: string;
}

export const MARKETPLACE_REPOSITORIES: MarketplaceRepo[] = [
	{
		id: "repo-mcp-official",
		name: "Model Context Protocol 官方核心仓库",
		fullName: "modelcontextprotocol/servers",
		url: "https://github.com/modelcontextprotocol/servers",
		description: "Anthropic & MCP 官方核心协议服务合集，提供受控文件系统、Git、GitHub、PostgreSQL、SQLite、Puppeteer、Slack、Brave 等官方标准化服务。",
		type: "mcp",
		typeName: "官方 MCP 仓库",
		stars: "68.5k ★",
		featured: true,
		itemsCount: "20+ 官方服务",
		tags: ["Anthropic", "MCP 核心", "数据库连接器", "官方标准"],
	},
	{
		id: "repo-awesome-mcp",
		name: "Awesome MCP Servers 全球社区总仓",
		fullName: "punkpeye/awesome-mcp-servers",
		url: "https://github.com/punkpeye/awesome-mcp-servers",
		description: "全球规模最大、星标最多的 MCP 开源聚合仓库，汇集了 500+ 个高质量第三方 MCP 服务，覆盖云原生、搜索引擎、浏览器自动化、向量库等所有垂直场景。",
		type: "mcp",
		typeName: "社区 MCP 总仓",
		stars: "42.0k ★",
		featured: true,
		itemsCount: "500+ MCP 资源",
		tags: ["社区最全", "资源宝库", "全场景服务", "每日更新"],
	},
	{
		id: "repo-anthropic-skills",
		name: "Anthropic 官方 Skills & 智能体示范",
		fullName: "anthropics/anthropic-quickstarts",
		url: "https://github.com/anthropics/anthropic-quickstarts",
		description: "Anthropic 官方开源的 Claude 原生能力与生产级技能库，包含 Computer Use 屏幕操控、深度文档解析、复杂图表生成与自动化工程规划。",
		type: "skills",
		typeName: "官方 Skills 库",
		stars: "28.5k ★",
		featured: true,
		itemsCount: "官方技能范例",
		tags: ["Anthropic 官方", "Claude Skills", "智能体工具", "Computer Use"],
	},
	{
		id: "repo-superpowers",
		name: "Superpowers 软件工程自愈与规范仓库",
		fullName: "obra/superpowers",
		url: "https://github.com/obra/superpowers",
		description: "面向 AI 编码智能体的全套实战工程技能与行为准则，涵盖严格 TDD 驱动规范、多重验证门禁、系统化缺陷定位与分布式子代理调度。",
		type: "skills",
		typeName: "工程规范技能库",
		stars: "12.5k ★",
		featured: true,
		itemsCount: "70+ 工程技能",
		tags: ["TDD 规范", "工程自愈", "子代理调度", "代码审查"],
	},
	{
		id: "repo-awesome-cursorrules",
		name: "Awesome Cursorrules & AI 研发规则库",
		fullName: "PatrickJS/awesome-cursorrules",
		url: "https://github.com/PatrickJS/awesome-cursorrules",
		description: "业界最火爆的 AI 研发规则与工程上下文规约仓库，收录了 200+ 主流技术栈（Next.js、Rust、Python、Go、Docker 等）的最佳工程实践与技能指令。",
		type: "skills",
		typeName: "技术栈规则库",
		stars: "16.8k ★",
		featured: true,
		itemsCount: "200+ 技术栈规则",
		tags: ["技术栈全集", "工程规约", "高频使用", "开发标准"],
	},
	{
		id: "repo-smithery-registry",
		name: "Smithery.ai 开放 MCP 服务注册中心",
		fullName: "smithery-ai/registry",
		url: "https://smithery.ai",
		description: "全球领先的 MCP 服务在线注册与云端分发平台，支持按类别、评分检索上千款可直接部署的 MCP 插件，并提供一键连接与配置生成。",
		type: "mcp",
		typeName: "在线 MCP 目录",
		stars: "1000+ 在线服务",
		featured: true,
		itemsCount: "1000+ 在线 MCP",
		tags: ["云端目录", "一键生成配置", "分类榜单", "生态标准"],
	},
	{
		id: "repo-openpi-official",
		name: "OpenPI 官方主仓与生态套件",
		fullName: "janehuaan/OpenPI",
		url: "https://github.com/janehuaan/OpenPI",
		description: "OpenPI 官方核心代码主仓，包含 Pi Subagents 并行子代理调度、Pi MCP Adapter 协议适配层、Rust 高性能原生守护引擎与系统安全权限套件。",
		type: "all",
		typeName: "OpenPI 官方主仓",
		stars: "官方主仓",
		featured: true,
		itemsCount: "核心生态",
		tags: ["官方核心", "多子代理", "MCP 适配", "Rust Daemon"],
	},
	{
		id: "repo-wong2-mcp",
		name: "Awesome MCP 中文精选仓库",
		fullName: "wong2/awesome-mcp-servers",
		url: "https://github.com/wong2/awesome-mcp-servers",
		description: "国内开发者广泛参考的 MCP 服务器精选中文列表，包含飞书、钉钉、微信读书、知乎等本土化服务，并提供中文快速上手指引。",
		type: "mcp",
		typeName: "中文精选 MCP",
		stars: "8.5k ★",
		featured: false,
		itemsCount: "100+ 中文服务",
		tags: ["中文生态", "办公协同", "飞书/钉钉", "配置教程"],
	},
	{
		id: "repo-glama-mcp",
		name: "Glama MCP Explorer 目录与测试场",
		fullName: "glama-ai/mcp-servers",
		url: "https://glama.ai/mcp/servers",
		description: "开源 MCP 协议实时监控与互操作性索引平台，提供各类服务协议兼容性检测、在线测试与活跃社区服务器发现。",
		type: "mcp",
		typeName: "MCP 索引目录",
		stars: "活跃更新",
		featured: false,
		itemsCount: "数百款已验证服务",
		tags: ["协议兼容", "实时状态", "在线测试", "开发者索引"],
	},
	{
		id: "repo-mcp-sdk",
		name: "MCP 官方 TypeScript SDK 与脚手架",
		fullName: "modelcontextprotocol/typescript-sdk",
		url: "https://github.com/modelcontextprotocol/typescript-sdk",
		description: "MCP 官方 SDK 仓库与脚手架模板，提供自建 MCP 服务器所需的标准协议实现、传输层工具（stdio / SSE）与类型定义。",
		type: "plugins",
		typeName: "官方 SDK",
		stars: "官方 SDK",
		featured: false,
		itemsCount: "开发者模板",
		tags: ["SDK 开发", "自定义 Server", "官方标准", "TypeScript"],
	},
	{
		id: "repo-easyeda",
		name: "嘉立创 (EasyEDA) 官方 AI 智能设计生态",
		fullName: "easyeda/eext-easyeda-api-agent",
		url: "https://github.com/easyeda",
		description: "嘉立创 EDA 官方开源 AI 扩展与智能体套件，涵盖 EasyEDA Pro Extension API Agent、AI 智能建库与符号生成、Run API Gateway 通信网关及电路/PCB 自动化全流程工具集。",
		type: "all",
		typeName: "嘉立创官方生态",
		stars: "官方开源",
		featured: true,
		itemsCount: "3款 官方技能与MCP",
		tags: ["嘉立创EDA", "硬件设计", "AI 电路智能体", "官方 MCP", "立创商城"],
	},
];

export interface MarketplacePackage {
	id: string;
	kind: MarketplaceKind;
	registry?: MarketplaceRegistry;
	name: string;
	packageName: string;
	version: string;
	source: string;
	publisher: string;
	description: string;
	tags: string[];
	repoName?: string;
	repoUrl?: string;
	skillContent?: string;
}

export const MCP_ADAPTER_MARKETPLACE_PACKAGE: MarketplacePackage = {
	id: "pi-mcp-adapter",
	kind: "mcp",
	registry: "official",
	name: "Pi MCP Adapter",
	packageName: "pi-mcp-adapter",
	version: "2.21.0",
	source: "npm:pi-mcp-adapter@2.21.0",
	publisher: "Nico Bailon",
	description: "官方 MCP 协议网关：通过轻量动态代理挂载外部 MCP Server，按需发现工具，杜绝无谓的上下文 Token 消耗。",
	tags: ["官方网关", "MCP 核心", "按需加载"],
	repoName: "janehuaan/OpenPI",
	repoUrl: "https://github.com/janehuaan/OpenPI",
};

export const MARKETPLACE_PACKAGES: MarketplacePackage[] = [
	// ── 🌟 OpenPI 官方推荐源 ──────────────────────────────────────────
	MCP_ADAPTER_MARKETPLACE_PACKAGE,
	{
		id: "pi-subagents",
		kind: "plugins",
		registry: "official",
		name: "Pi Subagents",
		packageName: "@ferris1225/pi-subagents",
		version: "4.3.10",
		source: "npm:@ferris1225/pi-subagents",
		publisher: "ferris1225",
		description: "官方多子代理并行调度引擎：支持独立上下文子任务分治、Git Worktree 物理隔离、后台一键状态追踪与结果汇聚。",
		tags: ["官方核心", "子代理", "Worktree 隔离"],
		repoName: "janehuaan/OpenPI",
		repoUrl: "https://github.com/janehuaan/OpenPI",
	},
	{
		id: "superpowers-zh",
		kind: "skills",
		registry: "official",
		name: "Superpowers ZH",
		packageName: "superpowers-zh",
		version: "1.7.1",
		source: "npm:superpowers-zh@1.7.1",
		publisher: "jnMetaCode",
		description: "中文研发自愈与工程全流程技能集：包含 TDD 驱动、多重验证门禁、系统化缺陷定位与代码评审规范。",
		tags: ["官方推荐", "中文技能", "TDD 研发规范"],
		repoName: "obra/superpowers",
		repoUrl: "https://github.com/obra/superpowers",
	},

	// ── 🔌 MCP 协议服务源 ──────────────────────────────────────────
	{
		id: "mcp-filesystem",
		kind: "mcp",
		registry: "mcp",
		name: "MCP Filesystem",
		packageName: "@modelcontextprotocol/server-filesystem",
		version: "2026.7.10",
		source: "npm:@modelcontextprotocol/server-filesystem@2026.7.10",
		publisher: "modelcontextprotocol",
		description: "官方受控本地文件系统服务：提供跨目录精确读写、全局检索与安全沙箱目录列表。",
		tags: ["文件操作", "标准服务", "官方源"],
		repoName: "modelcontextprotocol/servers",
		repoUrl: "https://github.com/modelcontextprotocol/servers",
	},
	{
		id: "mcp-github",
		kind: "mcp",
		registry: "mcp",
		name: "MCP GitHub",
		packageName: "@modelcontextprotocol/server-github",
		version: "2026.5.0",
		source: "npm:@modelcontextprotocol/server-github@2026.5.0",
		publisher: "modelcontextprotocol",
		description: "官方 GitHub 全功能联动服务：支持检索仓库代码、Issue/PR 追踪与自动化分支操作。",
		tags: ["GitHub", "Git 协作", "官方服务"],
		repoName: "modelcontextprotocol/servers",
		repoUrl: "https://github.com/modelcontextprotocol/servers",
	},
	{
		id: "mcp-postgres",
		kind: "mcp",
		registry: "mcp",
		name: "MCP PostgreSQL",
		packageName: "@modelcontextprotocol/server-postgres",
		version: "2026.4.1",
		source: "npm:@modelcontextprotocol/server-postgres@2026.4.1",
		publisher: "modelcontextprotocol",
		description: "PostgreSQL 数据库智能连接器：自动读取 Schema 表结构、安全只读查询与数据分析。",
		tags: ["PostgreSQL", "SQL 探测", "数据库"],
		repoName: "modelcontextprotocol/servers",
		repoUrl: "https://github.com/modelcontextprotocol/servers",
	},
	{
		id: "mcp-sqlite",
		kind: "mcp",
		registry: "mcp",
		name: "MCP SQLite",
		packageName: "mcp-server-sqlite",
		version: "0.6.2",
		source: "npm:mcp-server-sqlite@0.6.2",
		publisher: "modelcontextprotocol",
		description: "SQLite 数据库本地直连服务：无需额外守护进程，直接对 .db / .sqlite 文件执行 SQL 诊断与分析。",
		tags: ["SQLite", "本地嵌入", "轻量数据库"],
		repoName: "modelcontextprotocol/servers",
		repoUrl: "https://github.com/modelcontextprotocol/servers",
	},
	{
		id: "mcp-puppeteer",
		kind: "mcp",
		registry: "mcp",
		name: "MCP Puppeteer",
		packageName: "@modelcontextprotocol/server-puppeteer",
		version: "2026.6.1",
		source: "npm:@modelcontextprotocol/server-puppeteer@2026.6.1",
		publisher: "modelcontextprotocol",
		description: "无头浏览器端到端自动化：网页截屏渲染、DOM 树提取与交互式端到端测试验证。",
		tags: ["浏览器", "Puppeteer", "自动化渲染"],
		repoName: "modelcontextprotocol/servers",
		repoUrl: "https://github.com/modelcontextprotocol/servers",
	},
	{
		id: "mcp-brave-search",
		kind: "mcp",
		registry: "mcp",
		name: "MCP Brave Search",
		packageName: "@modelcontextprotocol/server-brave-search",
		version: "2026.4.1",
		source: "npm:@modelcontextprotocol/server-brave-search@2026.4.1",
		publisher: "modelcontextprotocol",
		description: "Brave 隐私搜索服务：实时获取互联网新闻、技术文档与开源库最新发布动态。",
		tags: ["网络搜索", "实时信息", "文档检索"],
		repoName: "modelcontextprotocol/servers",
		repoUrl: "https://github.com/modelcontextprotocol/servers",
	},
	{
		id: "mcp-sequential-thinking",
		kind: "mcp",
		registry: "mcp",
		name: "MCP Sequential Thinking",
		packageName: "@modelcontextprotocol/server-sequential-thinking",
		version: "2026.7.4",
		source: "npm:@modelcontextprotocol/server-sequential-thinking@2026.7.4",
		publisher: "modelcontextprotocol",
		description: "结构化链式深入推理服务：拆解多维度难题，逐步推演假设并在过程中自我反思纠偏。",
		tags: ["深度推理", "反思链", "高维思维"],
		repoName: "modelcontextprotocol/servers",
		repoUrl: "https://github.com/modelcontextprotocol/servers",
	},
	{
		id: "mcp-docker",
		kind: "mcp",
		registry: "mcp",
		name: "MCP Docker",
		packageName: "mcp-server-docker",
		version: "1.2.0",
		source: "npm:mcp-server-docker@1.2.0",
		publisher: "docker-ecosystem",
		description: "Docker 容器与镜像诊断管理：查看容器列表、日志流输出、资源占用与构建状态。",
		tags: ["Docker", "容器运维", "DevOps"],
		repoName: "punkpeye/awesome-mcp-servers",
		repoUrl: "https://github.com/punkpeye/awesome-mcp-servers",
	},
	{
		id: "mcp-redis",
		kind: "mcp",
		registry: "mcp",
		name: "MCP Redis",
		packageName: "mcp-server-redis",
		version: "0.5.1",
		source: "npm:mcp-server-redis@0.5.1",
		publisher: "community",
		description: "Redis 键值缓存与状态服务：检查内存指标、TTL 键值探测与缓存击穿排查。",
		tags: ["Redis", "缓存服务", "内存诊断"],
		repoName: "punkpeye/awesome-mcp-servers",
		repoUrl: "https://github.com/punkpeye/awesome-mcp-servers",
	},
	{
		id: "mcp-memory",
		kind: "mcp",
		registry: "mcp",
		name: "MCP Memory",
		packageName: "@modelcontextprotocol/server-memory",
		version: "2026.7.4",
		source: "npm:@modelcontextprotocol/server-memory@2026.7.4",
		publisher: "modelcontextprotocol",
		description: "官方知识图谱实体关联记忆：记录实体、关系与观察结论，形成结构化上下文。",
		tags: ["知识图谱", "实体记忆", "长期知识"],
		repoName: "modelcontextprotocol/servers",
		repoUrl: "https://github.com/modelcontextprotocol/servers",
	},
	{
		id: "mcp-git",
		kind: "mcp",
		registry: "mcp",
		name: "MCP Git",
		packageName: "modelcontextprotocol/servers",
		version: "main",
		source: "git:github.com/modelcontextprotocol/servers",
		publisher: "modelcontextprotocol",
		description: "官方 Git 仓库操作服务：分支切换、提交快照、代码变更 Diff 计算与合并冲突排查。",
		tags: ["Git", "版本管理", "代码审查"],
		repoName: "modelcontextprotocol/servers",
		repoUrl: "https://github.com/modelcontextprotocol/servers",
	},

	// ── 📚 obra/superpowers 官方工程技能源 ─────────────────────────────────────
	{
		id: "skill-tdd-workflow",
		kind: "skills",
		registry: "skills",
		name: "TDD 驱动开发规范",
		packageName: "skill:tdd-workflow",
		version: "1.2.0",
		source: "skill:tdd-workflow",
		publisher: "obra/superpowers",
		description: "严格红-绿-重构循环规范：编写实现前必先写最小失败单测，驱动业务实现，严禁无测试代码入库。",
		tags: ["TDD", "单测优先", "重构规范", "工程自愈"],
		repoName: "obra/superpowers",
		repoUrl: "https://github.com/obra/superpowers",
		skillContent: `---
name: tdd-workflow
description: 严格执行红-绿-重构循环规范，先写最小失败单测，驱动业务实现，严禁无测试代码入库。
---

# TDD 驱动开发规范 (Test-Driven Development)

## 核心法则
1. **先写失败测试**：在编写任何业务实现代码前，必须先编写一个失败的自动化测试用例，明确验收标准与输入输出边界。
2. **最小实现通过**：编写刚好能够让测试通过的最精简实现代码，严禁过度设计与提前超前抽象。
3. **安全重构**：测试全部通过后，在测试用例的保护下重构代码，消除重复逻辑，提升可读性与架构内聚度。
4. **覆盖边界用例**：必须覆盖空值、极值、超时、网络异常与越界等边缘场景。
`,
	},
	{
		id: "skill-systematic-debugging",
		kind: "skills",
		registry: "skills",
		name: "系统化缺陷定位技能",
		packageName: "skill:systematic-debugging",
		version: "1.1.0",
		source: "skill:systematic-debugging",
		publisher: "obra/superpowers",
		description: "基于科学假设与变量隔离排查缺陷：最小复现 -> 根因定位 -> 二分隔离 -> 修复与回归，拒绝盲目试错。",
		tags: ["Debug", "根因分析", "变量隔离", "自动化回归"],
		repoName: "obra/superpowers",
		repoUrl: "https://github.com/obra/superpowers",
		skillContent: `---
name: systematic-debugging
description: 系统化假设驱动排查缺陷，二分定位、隔离变量、根因分析与自动化回归，拒绝盲目试错。
---

# 系统化缺陷定位技能 (Systematic Debugging)

## 标准排查流程
1. **精准复现**：构建确定性的最小复现步骤或单元测试脚本，确认故障的输入、期望输出与实际异常。
2. **假设与变量隔离**：列出可能导致缺陷的假设，每次仅变更单一变量或使用二分法（Binary Search）缩小影响范围。
3. **调用栈与时序分析**：检查崩溃堆栈、并发竞态、生命周期与异步回调时序，找到首个状态失真点。
4. **根因修复与回归防护**：修复根本原因而非掩盖表象，必须补充回归测试用例防止问题死灰复燃。
`,
	},
	{
		id: "skill-verification-gate",
		kind: "skills",
		registry: "skills",
		name: "多重验证门禁技能",
		packageName: "skill:verification-gate",
		version: "1.3.0",
		source: "skill:verification-gate",
		publisher: "obra/superpowers",
		description: "任务交付前强制验证门禁：静态类型检查、Lint 规范检测、自动化测试与运行时校验全量通过。",
		tags: ["验证门禁", "TypeCheck", "Lint", "交付标准"],
		repoName: "obra/superpowers",
		repoUrl: "https://github.com/obra/superpowers",
		skillContent: `---
name: verification-gate
description: 任务交付前的强制验证门禁，包含类型检查、Lint 扫描、回归测试与端到端运行校验。
---

# 多重验证门禁技能 (Verification Gate)

## 交付前检查清单
- [ ] **类型检查**：运行 \`tsc --noEmit\`、\`cargo check\` 等类型校验，确保 0 错误。
- [ ] **静态分析与 Lint**：运行代码风格与规范扫描工具，修复所有 warning 与 error。
- [ ] **自动化测试套件**：运行所有受影响模块的单元测试与集成测试，确保全部 pass。
- [ ] **运行时功能自测**：实际启动进程或调用接口，验证预期行为与边缘异常返回。
`,
	},
	{
		id: "skill-architecture-planner",
		kind: "skills",
		registry: "skills",
		name: "系统架构与重构规划",
		packageName: "skill:architecture-planner",
		version: "1.0.0",
		source: "skill:architecture-planner",
		publisher: "obra/superpowers",
		description: "复杂工程架构演进设计：遵循 Clean Architecture、依赖倒置与单一职责，制定分步渐进式重构路径。",
		tags: ["架构设计", "Clean Architecture", "依赖解耦", "重构"],
		repoName: "obra/superpowers",
		repoUrl: "https://github.com/obra/superpowers",
		skillContent: `---
name: architecture-planner
description: 复杂工程架构演进设计，依赖倒置与单一职责，制定分步渐进式重构路径。
---

# 系统架构与重构规划 (Architecture Planner)

## 架构规划准则
1. **分层隔离**：严格划分领域层（Domain）、应用层（Application）、基础设施层（Infrastructure）。
2. **接口先行**：上层业务只依赖抽象接口，基础设施通过依赖注入实现，保证模块高可测性。
3. **渐进式演进**：大型重构必须拆分为多个独立分支与 PR，每一步保证主干始终处于可用且绿灯状态。
`,
	},
	{
		id: "skill-code-review-standards",
		kind: "skills",
		registry: "skills",
		name: "严苛代码审查规范",
		packageName: "skill:code-review-standards",
		version: "1.1.0",
		source: "skill:code-review-standards",
		publisher: "obra/superpowers",
		description: "全维度代码审查规范：全面排查安全性、内存泄露、并发死锁、性能瓶颈与异常边界覆盖。",
		tags: ["代码审查", "安全审计", "性能", "可维护性"],
		repoName: "obra/superpowers",
		repoUrl: "https://github.com/obra/superpowers",
		skillContent: `---
name: code-review-standards
description: 全维度代码审查规范，排查安全性、内存泄露、并发死锁、性能瓶颈与异常边界。
---

# 严苛代码审查规范 (Code Review Standards)

## 审查重点
- **安全与权限**：杜绝未过滤的外部输入、SQL 注入、命令注入与敏感凭证硬编码。
- **并发与异步**：排查数据竞争、锁未释放、异步上下文丢失与未处理的 Promise 拒绝。
- **性能与资源**：检查大循环中不必要的对象分配、N+1 查询与文件句柄未关闭。
- **错误与异常**：禁止吞掉原始错误或裸空 catch，错误信息需包含充分上下文以便溯源。
`,
	},
	{
		id: "skill-subagent-divide-conquer",
		kind: "skills",
		registry: "skills",
		name: "多子代理分治调度技能",
		packageName: "skill:subagent-divide-conquer",
		version: "1.2.0",
		source: "skill:subagent-divide-conquer",
		publisher: "obra/superpowers",
		description: "长链复杂任务拓扑拆解：将大型项目分解为解耦子任务，派发给独立上下文子代理并行推进并汇聚结果。",
		tags: ["子代理", "并行调度", "任务拓扑", "分治编排"],
		repoName: "obra/superpowers",
		repoUrl: "https://github.com/obra/superpowers",
		skillContent: `---
name: subagent-divide-conquer
description: 将复杂长链工程拆解为独立子任务，派发给独立上下文子代理并行计算并汇总。
---

# 多子代理分治调度技能 (Subagent Divide & Conquer)

## 编排工作流
1. **任务拓扑拆分**：将总目标拆解为独立子目标（调研、契约设计、核心逻辑、单元测试、文档）。
2. **上下文隔离**：通过独立子代理运行各子任务，避免主上下文 Token 爆炸和注意力漂移。
3. **状态同步与汇聚**：父代理监控子代理状态，依赖项就绪后自动唤醒下游，最终合成完整结果。
`,
	},

	// ── 📚 anthropics/anthropic-quickstarts 官方 Skills ─────────────────────
	{
		id: "skill-computer-use",
		kind: "skills",
		registry: "skills",
		name: "Computer Use 屏幕感知与操控",
		packageName: "skill:computer-use",
		version: "2026.3.0",
		source: "skill:computer-use",
		publisher: "Anthropic",
		description: "Anthropic 官方屏幕感知与键鼠自动化技能：截取屏幕视窗、多模态坐标精确定位、模拟点击与键入。",
		tags: ["Anthropic", "Computer Use", "GUI 自动化", "桌面操作"],
		repoName: "anthropics/anthropic-quickstarts",
		repoUrl: "https://github.com/anthropics/anthropic-quickstarts",
		skillContent: `---
name: computer-use
description: Anthropic 官方屏幕感知与键鼠自动化技能，截屏分析、坐标定位与 GUI 自动化。
---

# Computer Use 屏幕感知与操控

## 操控指引
1. **视窗感知**：通过截取屏幕图像分析当前活跃窗口与 UI 元素布局。
2. **坐标精确映射**：识别按钮、文本框与菜单的绝对像素坐标。
3. **安全操作步骤**：模拟鼠标移动、单击、双击、滚动以及键盘文本输入与快捷键。
`,
	},
	{
		id: "skill-document-intelligence",
		kind: "skills",
		registry: "skills",
		name: "多格式文档深度智能解析",
		packageName: "skill:document-intelligence",
		version: "2026.2.0",
		source: "skill:document-intelligence",
		publisher: "Anthropic",
		description: "高维文档结构化解析技能：深度提炼 PDF、Word、Excel、Markdown 的层级目录、表格与关键数据。",
		tags: ["Anthropic", "文档解析", "PDF/Word", "表格提取"],
		repoName: "anthropics/anthropic-quickstarts",
		repoUrl: "https://github.com/anthropics/anthropic-quickstarts",
		skillContent: `---
name: document-intelligence
description: 深度提炼 PDF、Word、Excel、Markdown 的层级目录、表格与关键数据。
---

# 多格式文档深度智能解析 (Document Intelligence)

## 处理规范
1. **结构化提取**：保留多级标题层级（H1-H4），提取关键元数据（作者、发布时间、版本）。
2. **复杂表格保真**：将文档内的嵌套表格转化为干净的 Markdown 表格或 JSON 结构化数据。
3. **交叉引用与脚注**：精确解析参考文献、引用标注与图片说明。
`,
	},
	{
		id: "skill-diagram-flowchart-generator",
		kind: "skills",
		registry: "skills",
		name: "动态架构与业务流程图绘制",
		packageName: "skill:diagram-flowchart-generator",
		version: "2026.1.5",
		source: "skill:diagram-flowchart-generator",
		publisher: "Anthropic",
		description: "自动分析代码逻辑与业务场景，输出符合规范的 Mermaid 流程图、时序图、类图与状态流转图。",
		tags: ["Anthropic", "Mermaid", "架构图", "时序图"],
		repoName: "anthropics/anthropic-quickstarts",
		repoUrl: "https://github.com/anthropics/anthropic-quickstarts",
		skillContent: `---
name: diagram-flowchart-generator
description: 自动分析代码与业务逻辑，输出高质量规范的 Mermaid 架构图、时序图与流程图。
---

# 动态架构与业务流程图绘制

## 输出规约
- 架构拓扑：使用 \`flowchart TD\` 或 \`flowchart LR\` 清晰展示模块依赖。
- 交互协议：使用 \`sequenceDiagram\` 标注请求、异步响应与异常回退通道。
- 状态流转：使用 \`stateDiagram-v2\` 标明状态初态、转换事件与终止条件。
`,
	},
	{
		id: "skill-data-analysis-viz",
		kind: "skills",
		registry: "skills",
		name: "数据洞察与统计分析可视化",
		packageName: "skill:data-analysis-viz",
		version: "2026.2.1",
		source: "skill:data-analysis-viz",
		publisher: "Anthropic",
		description: "加载与探索结构化数据集，生成统计特征摘要、相关性矩阵、异常值检测与高质量可视化建议。",
		tags: ["Anthropic", "数据分析", "统计建模", "趋势预测"],
		repoName: "anthropics/anthropic-quickstarts",
		repoUrl: "https://github.com/anthropics/anthropic-quickstarts",
		skillContent: `---
name: data-analysis-viz
description: 结构化数据探索、统计分布提炼、异常值诊断与可视化分析建议。
---

# 数据洞察与统计分析可视化

## 分析步骤
1. **数据概览**：检查维度、缺失率、字段数据类型与分布偏斜度。
2. **清洗与转换**：提供规范的数据过滤、插值、标准化或离散化方案。
3. **深度洞察**：计算关键业务指标（KPI）、环比变化、相关性与显著性差异。
`,
	},
	{
		id: "skill-customer-support-agent",
		kind: "skills",
		registry: "skills",
		name: "智能客服与企业知识检索",
		packageName: "skill:customer-support-agent",
		version: "2026.1.0",
		source: "skill:customer-support-agent",
		publisher: "Anthropic",
		description: "专业企业知识库问答与客服技能：亲和语气、精准上下文召回、意图理解与工单流转归纳。",
		tags: ["Anthropic", "知识问答", "智能客服", "RAG 增强"],
		repoName: "anthropics/anthropic-quickstarts",
		repoUrl: "https://github.com/anthropics/anthropic-quickstarts",
		skillContent: `---
name: customer-support-agent
description: 企业知识库问答与客服技能，意图识别、合规语气与工单自动摘要。
---

# 智能客服与企业知识检索

## 交互准则
1. **礼貌同理心**：以温暖专业口吻回应用户疑难，确认用户核心诉求。
2. **依据知识库事实**：严禁无根据幻想，答案必须严格锚定所提供的文档与 FAQ。
3. **工单结构化总结**：复杂或需人工介入时，提炼出问题摘要、复现现象与紧急程度。
`,
	},

	// ── 📚 PatrickJS/awesome-cursorrules 技术栈规则技能源 ───────────────────────
	{
		id: "skill-cursorrules-nextjs-react",
		kind: "skills",
		registry: "skills",
		name: "Next.js 15 & React 19 最佳实践",
		packageName: "skill:cursorrules-nextjs-react",
		version: "2.5.0",
		source: "skill:cursorrules-nextjs-react",
		publisher: "PatrickJS",
		description: "现代化 Next.js App Router 与 React 19 研发规约：服务端组件优先、流式 Suspense、细粒度缓存与水合优化。",
		tags: ["Cursorrules", "Next.js", "React 19", "Tailwind CSS"],
		repoName: "PatrickJS/awesome-cursorrules",
		repoUrl: "https://github.com/PatrickJS/awesome-cursorrules",
		skillContent: `---
name: cursorrules-nextjs-react
description: Next.js 15 App Router 与 React 19 最佳工程规范，服务端组件优先与水合优化。
---

# Next.js 15 & React 19 研发规约

## 核心准则
1. **Server Components 优先**：页面和数据抓取默认放在 RSC，仅交互性组件标记 \`"use client"\`。
2. **流式 Suspense**：耗时接口使用 Suspense 骨架屏包裹，避免页面主干阻塞。
3. **类型安全路由与操作**：使用 Server Actions 处理表单与写操作，严格校验 Zod Schema。
4. **Tailwind 原子化样式**：遵循一致的设计系统色彩令牌与响应式断点。
`,
	},
	{
		id: "skill-cursorrules-rust-production",
		kind: "skills",
		registry: "skills",
		name: "Rust 生产级系统工程规范",
		packageName: "skill:cursorrules-rust-production",
		version: "2.3.0",
		source: "skill:cursorrules-rust-production",
		publisher: "PatrickJS",
		description: "Rust 工业级开发规约：Tokio 异步防阻塞、thiserror/anyhow 统一错误模型、内存零拷贝与防死锁设计。",
		tags: ["Cursorrules", "Rust", "Tokio 异步", "系统工程"],
		repoName: "PatrickJS/awesome-cursorrules",
		repoUrl: "https://github.com/PatrickJS/awesome-cursorrules",
		skillContent: `---
name: cursorrules-rust-production
description: Rust 工业级开发规约，Tokio 异步调度、错误模型与零拷贝内存安全。
---

# Rust 生产级系统工程规范

## 工程规范
1. **异步防阻塞**：禁止在 Tokio 异步任务中执行重 CPU 或阻塞 I/O 操作，必要时使用 \`spawn_blocking\`。
2. **统一错误体系**：库级使用 \`thiserror\` 定义领域枚举错误，应用层聚合使用 \`anyhow::Result\`。
3. **锁与死锁防护**：保持加锁范围最小化（Drop 锁后再执行 await），同一调用链路加锁顺序严格一致。
4. **零拷贝设计**：优先借用 \`&str\` / \`&[u8]\`，使用 \`Bytes\` 或 \`Cow\` 减少堆内存拷贝。
`,
	},
	{
		id: "skill-cursorrules-python-fastapi",
		kind: "skills",
		registry: "skills",
		name: "Python FastAPI 架构规范",
		packageName: "skill:cursorrules-python-fastapi",
		version: "2.2.0",
		source: "skill:cursorrules-python-fastapi",
		publisher: "PatrickJS",
		description: "现代化 Python Web 研发准则：Pydantic v2 强类型校验、异步依赖注入、SQLAlchemy 2.0 异步 Session 与自动 OpenAPI。",
		tags: ["Cursorrules", "Python", "FastAPI", "Pydantic v2"],
		repoName: "PatrickJS/awesome-cursorrules",
		repoUrl: "https://github.com/PatrickJS/awesome-cursorrules",
		skillContent: `---
name: cursorrules-python-fastapi
description: Python FastAPI 现代化工程规范，Pydantic v2 校验、依赖注入与异步 ORM。
---

# Python FastAPI 架构规范

## 规范要点
1. **模型分离**：严格区分请求输入 DTO、数据库 ORM Model 与响应输出 Schema。
2. **异步依赖注入**：数据库连接池、认证鉴权与外部客户端通过 \`Depends\` 注入。
3. **全局异常处理器**：统一包装业务错误码与时间戳，避免原生 500 堆栈泄露到生产环境。
`,
	},
	{
		id: "skill-cursorrules-go-cloudnative",
		kind: "skills",
		registry: "skills",
		name: "Go 云原生微服务规范",
		packageName: "skill:cursorrules-go-cloudnative",
		version: "2.1.0",
		source: "skill:cursorrules-go-cloudnative",
		publisher: "PatrickJS",
		description: "Go 高并发与云原生规约：显式 Context 链路传播、Goroutine 泄露排查、接口最小化设计与优雅关停机制。",
		tags: ["Cursorrules", "Golang", "云原生", "高并发"],
		repoName: "PatrickJS/awesome-cursorrules",
		repoUrl: "https://github.com/PatrickJS/awesome-cursorrules",
		skillContent: `---
name: cursorrules-go-cloudnative
description: Go 高并发与云原生微服务规约，显式 Context 传播与优雅关停。
---

# Go 云原生微服务规范

## 规范要求
1. **Context 传播**：所有 I/O 和远程调用首个参数必须是 \`ctx context.Context\`，响应超时与取消信号。
2. **Goroutine 安全**：每个开出的 Goroutine 必须受 \`sync.WaitGroup\` 或 Channel 控制，杜绝无主死循环。
3. **接口最小化**：生产者定义实现，消费者按需定义精简 interface，保持模块最小耦合。
`,
	},
	{
		id: "skill-cursorrules-vue3-vite",
		kind: "skills",
		registry: "skills",
		name: "Vue 3 + Vite 现代化工程规范",
		packageName: "skill:cursorrules-vue3-vite",
		version: "2.0.0",
		source: "skill:cursorrules-vue3-vite",
		publisher: "PatrickJS",
		description: "Vue 3 组合式 API（<script setup>）、Pinia 状态管理、TypeScript 强类型推导与高性能渲染调优。",
		tags: ["Cursorrules", "Vue 3", "Vite", "Pinia"],
		repoName: "PatrickJS/awesome-cursorrules",
		repoUrl: "https://github.com/PatrickJS/awesome-cursorrules",
		skillContent: `---
name: cursorrules-vue3-vite
description: Vue 3 + Vite 现代化工程规范，组合式 API 与响应式渲染调优。
---

# Vue 3 + Vite 现代化工程规范

## 核心准则
1. **单文件组件规范**：全面采用 \`<script setup lang="ts">\`，使用 \`defineProps\` 与 \`defineEmits\`。
2. **状态解耦**：全局可复用状态交由 Pinia 模块化管理，组件私有状态使用 \`ref\` / \`shallowRef\`。
3. **按需优化**：庞大列表使用虚拟滚动，复杂静态节点标记 \`v-once\` 避免重复 Diff。
`,
	},
	{
		id: "skill-cursorrules-docker-k8s",
		kind: "skills",
		registry: "skills",
		name: "Docker & K8s 容器化规范",
		packageName: "skill:cursorrules-docker-k8s",
		version: "1.8.0",
		source: "skill:cursorrules-docker-k8s",
		publisher: "PatrickJS",
		description: "轻量多阶段构建 Dockerfile、非 root 安全运行、健康探测与优雅 SIGTERM 退出处理。",
		tags: ["Cursorrules", "Docker", "Kubernetes", "DevOps"],
		repoName: "PatrickJS/awesome-cursorrules",
		repoUrl: "https://github.com/PatrickJS/awesome-cursorrules",
		skillContent: `---
name: cursorrules-docker-k8s
description: 轻量多阶段构建 Dockerfile、非 root 安全运行与 K8s 健康探测。
---

# Docker & K8s 容器化规范

## 部署清单
1. **多阶段构建**：编译环境与运行环境彻底分离，镜像精简至 scratch 或 alpine 最小基底。
2. **最小权限原则**：创建专门的非 root 用户运行应用，禁用特权模式。
3. **优雅启停**：主进程响应 SIGTERM 信号，平滑释放活跃数据库连接与正在处理的 HTTP 请求。
`,
	},

	// ── 📚 janehuaan/OpenPI 官方核心技能源 ──────────────────────────────────
	{
		id: "skill-pi-subagent-orchestrator",
		kind: "skills",
		registry: "official",
		name: "OpenPI 子代理编排调度技能",
		packageName: "skill:pi-subagent-orchestrator",
		version: "2.1.0",
		source: "skill:pi-subagent-orchestrator",
		publisher: "OpenPI 官方",
		description: "OpenPI 原生多子代理编排规范：任务有向无环图（DAG）构建、Git 分支隔离与消息总线自动流转。",
		tags: ["OpenPI 官方", "子代理编排", "DAG 调度", "Worktree 隔离"],
		repoName: "janehuaan/OpenPI",
		repoUrl: "https://github.com/janehuaan/OpenPI",
		skillContent: `---
name: pi-subagent-orchestrator
description: OpenPI 原生多子代理并行调度规范，任务 DAG 构建与分支物理隔离。
---

# OpenPI 子代理编排调度技能

## 编排机制
1. **子代理生命周期**：通过 \`invoke_subagent\` 初始化专注代理，指定工作区隔离模式（share/branch）。
2. **消息总线交互**：父子代理通过轻量 JSON 消息总线通讯，禁止跨边界脏写。
3. **结果汇总**：子代理汇报完成产物后，父代理执行自动化合并校验。
`,
	},
	{
		id: "skill-git-atomic-commits",
		kind: "skills",
		registry: "official",
		name: "原子化 Git 规范与提交日志",
		packageName: "skill:git-atomic-commits",
		version: "1.5.0",
		source: "skill:git-atomic-commits",
		publisher: "OpenPI 官方",
		description: "遵循 Conventional Commits 规范，保证每个 commit 单一职责、独立可回滚，提交日志语义精准。",
		tags: ["OpenPI 官方", "Git 规范", "原子化提交", "版本演进"],
		repoName: "janehuaan/OpenPI",
		repoUrl: "https://github.com/janehuaan/OpenPI",
		skillContent: `---
name: git-atomic-commits
description: 遵循 Conventional Commits 规范，保证每个 commit 单一职责与清晰可溯源。
---

# 原子化 Git 规范与提交日志

## 提交格式
\`<type>(<scope>): <subject>\`

### 常见类型
- \`feat\`: 引入新功能
- \`fix\`: 修复缺陷
- \`refactor\`: 重构代码（不改变现有行为）
- \`test\`: 补充或修改自动化测试
- \`docs\`: 文档变更
`,
	},
	{
		id: "skill-api-contract-design",
		kind: "skills",
		registry: "official",
		name: "API 接口契约设计规范",
		packageName: "skill:api-contract-design",
		version: "1.4.0",
		source: "skill:api-contract-design",
		publisher: "OpenPI 官方",
		description: "编写清晰、向下兼容、具备幂等性与统一错误码结构的 API 契约设计指南与测试生成。",
		tags: ["OpenPI 官方", "API 契约", "RESTful", "JSON-RPC"],
		repoName: "janehuaan/OpenPI",
		repoUrl: "https://github.com/janehuaan/OpenPI",
		skillContent: `---
name: api-contract-design
description: 编写向下兼容、具备幂等性与统一错误码结构的 API 接口契约。
---

# API 接口契约设计规范

## 设计标准
1. **幂等性设计**：关键写接口支持 \`Idempotency-Key\` 请求头，防止网络抖动导致的重复操作。
2. **统一响应外壳**：包含 \`code\`、\`message\`、\`data\` 与分布式追踪 \`traceId\`。
3. **向下兼容**：禁止在原有字段上改变类型或语义，废弃字段通过文档与响应头提示 Deprecated。
`,
	},
	{
		id: "skill-security-vulnerability-audit",
		kind: "skills",
		registry: "official",
		name: "代码安全漏洞自查技能",
		packageName: "skill:security-vulnerability-audit",
		version: "1.6.0",
		source: "skill:security-vulnerability-audit",
		publisher: "OpenPI 官方",
		description: "全面扫描硬编码密钥、SQL/命令注入漏洞、水平/垂直越权风险与高危第三方依赖。",
		tags: ["OpenPI 官方", "安全自查", "漏洞防护", "OWASP"],
		repoName: "janehuaan/OpenPI",
		repoUrl: "https://github.com/janehuaan/OpenPI",
		skillContent: `---
name: security-vulnerability-audit
description: 全面排查硬编码密钥、注入漏洞、越权漏洞与高风险依赖。
---

# 代码安全漏洞自查技能

## 安全核对清单
- [ ] **密钥检测**：排查 \`API_KEY\`、\`SECRET\`、私钥与数据库连接串是否误提交。
- [ ] **注入漏洞**：SQL 必须参数化执行，系统 Shell 命令严禁直接字符串拼接。
- [ ] **访问控制**：所有资源操作必须在后端验证当前会话的用户 ID 与权限，杜绝越权。
`,
	},

	// ── 📚 mitsu-ai/mitsupi 技能源 ──────────────────────────────────────────
	{
		id: "skill-mitsupi-quick-tools",
		kind: "skills",
		registry: "skills",
		name: "Mitsupi 高频日常开发工具箱",
		packageName: "skill:mitsupi-quick-tools",
		version: "1.6.0",
		source: "skill:mitsupi-quick-tools",
		publisher: "Armin Ronacher",
		description: "Flask 之父精选日常开发技能：临时环境变量安全管理、跨平台路径规范化与极速正则转换。",
		tags: ["Mitsupi", "高频命令", "日常开发", "大师之选"],
		repoName: "mitsu-ai/mitsupi",
		repoUrl: "https://github.com/mitsu-ai/mitsupi",
		skillContent: `---
name: mitsupi-quick-tools
description: Flask 之父精选日常开发技能，跨平台路径、临时环境与正则表达式转换。
---

# Mitsupi 高频日常开发工具箱

## 功能集锦
1. **跨平台路径兼容**：自动规范 Windows 与 Unix 斜杠分隔符。
2. **环境隔离**：轻量级临时环境变量注入，执行完毕自动清理。
3. **正则辅助**：可读性强的正则表达式拆解与测试用例验证。
`,
	},

	// ── ⚡ 嘉立创 (EasyEDA) 官方智能设计生态 ─────────────────────────────
	{
		id: "skill-easyeda-agent",
		kind: "skills",
		registry: "skills",
		name: "嘉立创 EDA 专业版智能设计技能",
		packageName: "skill:easyeda-pro-agent",
		version: "1.2.0",
		source: "skill:easyeda-pro-agent",
		publisher: "嘉立创 (EasyEDA 官方)",
		description: "嘉立创官方电路设计技能：通过自然语言驱动原理图绘制、器件自动选型、网络标号连接与 PCB 自动化布局布线。",
		tags: ["嘉立创EDA", "原理图设计", "PCB布线", "DRC校验", "硬件AI"],
		repoName: "easyeda/eext-easyeda-api-agent",
		repoUrl: "https://github.com/easyeda/eext-easyeda-api-agent",
		skillContent: `---
name: easyeda-pro-agent
description: 嘉立创 EDA 专业版电路原理图与 PCB 自动化设计技能。支持自然语言生成电路原理图、立创商城元件选型、智能连线与 DRC 规则校验。
---

# 嘉立创 EDA 专业版智能设计技能

本技能指导 AI 智能体通过嘉立创官方 API / MCP 协议与嘉立创 EDA 专业版进行交互，实现硬件电路的辅助设计与自动化操作。

## 核心设计规范

### 1. 原理图自动化设计
- **元器件选型**：优先从立创商城（SZLCSC）或嘉立创基础库中检索具有现货且支持 SMT 贴片的元器件（首选带有 C编号 的基础库器件）。
- **网络标号（Net Label）规范**：
  - 电源网络统一命名：\`VCC_3V3\`、\`VCC_5V\`、\`GND\`、\`AGND\` 等。
  - 信号总线命名清晰：如 \`I2C1_SCL\`、\`I2C1_SDA\`、\`SPI_MOSI\`、\`UART_TX\`。
- **模块化布局**：原理图按功能分区：电源管理区、主控 MCU 区、传感器/外设接口区、调试通信区。

### 2. 元器件引脚与连接准则
- 主动元器件的退耦电容（0.1uF / 10uF）必须就近放置在供电引脚旁。
- 晶振电路需保证负载电容与地回路尽量短直。
- 未使用的输入引脚需明确配置上拉/下拉或按芯片 Datasheet 手册处理。

### 3. PCB 布局与布线规范
- **差分线对**：USB/以太网等差分信号保持等长、等宽、紧耦合布线，地平面连续无跨分割。
- **电源走线宽度**：按承载电流计算线宽（通常 1A 对应 20~40mil 线宽）。
- **DRC 检查**：操作完成后必须触发 DRC（设计规则检查），确保无电气开路、短路及安全间距冲突。

### 4. 常用 API 指令参考 (Run API Gateway)
\`\`\`json
{
  "action": "placeComponent",
  "params": {
    "lcscPart": "C2040",
    "x": 1200,
    "y": 800,
    "rotation": 0
  }
}
\`\`\`
`,
	},
	{
		id: "mcp-easyeda-gateway",
		kind: "mcp",
		registry: "mcp",
		name: "嘉立创 EDA MCP 网关服务",
		packageName: "jlcmcp-server",
		version: "1.1.0",
		source: "npm:jlcmcp@1.1.0",
		publisher: "easyeda / hyl64",
		description: "嘉立创 EDA 专业版官方协议 MCP Server：提供 59+ 项电路设计与元件检索工具，直连 EasyEDA Run API Gateway 网关。",
		tags: ["嘉立创MCP", "59+工具", "Run API Gateway", "硬件自动化"],
		repoName: "easyeda/eext-easyeda-api-agent",
		repoUrl: "https://github.com/easyeda/eext-easyeda-api-agent",
	},
	{
		id: "skill-easyeda-library-builder",
		kind: "skills",
		registry: "skills",
		name: "嘉立创 AI 智能器件建库与符号生成",
		packageName: "skill:easyeda-ai-library-builder",
		version: "1.0.4",
		source: "skill:easyeda-ai-library-builder",
		publisher: "嘉立创 (EasyEDA 官方)",
		description: "基于立创商城规格书 Datasheet 与封装引脚图，自动化提取引脚定义并生成嘉立创原理图符号与 PCB 封装。",
		tags: ["嘉立创官方", "智能建库", "Datasheet解析", "封装生成"],
		repoName: "easyeda/eext-ai-library-builder",
		repoUrl: "https://github.com/easyeda/eext-ai-library-builder",
		skillContent: `---
name: easyeda-ai-library-builder
description: 嘉立创 AI 智能器件建库技能。自动化解析芯片 Datasheet PDF，提取 Pinout 引脚电气属性并快速构建嘉立创 EDA 符号与封装库。
---

# 嘉立创 AI 智能器件建库与符号生成

## 工作流程

1. **Datasheet 解析**：
   - 提取目标元器件的 Pin Number、Pin Name、Type（Input / Output / Power / Passive）。
   - 识别特殊功能（如复用引脚 PWM、ADC、I2C）。

2. **原理图符号组织**：
   - 电源引脚统一归类于顶部（VCC）与底部（GND）。
   - 控制与输入信号居左，输出与状态信号居右。
   - 复杂芯片（如 MCU / FPGA）自动拆分为多逻辑门（Multi-Part）。

3. **PCB 封装校验**：
   - 依据 IPC-7351 标准核对焊盘尺寸、间距、丝印外框与 1 号引脚定位标识。
   - 校验 3D 步进模型对齐与偏转角度。
`,
	},

	// ── 🔌 国内与垂直领域精选 MCP 服务源 (wong2 & punkpeye) ─────────────────
	{
		id: "mcp-feishu",
		kind: "mcp",
		registry: "mcp",
		name: "MCP 飞书 / Lark 开放接口",
		packageName: "@larksuite/mcp-server-feishu",
		version: "1.2.0",
		source: "npm:@larksuite/mcp-server-feishu@1.2.0",
		publisher: "wong2",
		description: "飞书团队协作服务：自动同步多维表格（Bitable）、文档知识库与机器人群消息互动。",
		tags: ["飞书", "Lark", "中文协同", "多维表格"],
		repoName: "wong2/awesome-mcp-servers",
		repoUrl: "https://github.com/wong2/awesome-mcp-servers",
	},
	{
		id: "mcp-dingtalk",
		kind: "mcp",
		registry: "mcp",
		name: "MCP 钉钉协同工作台",
		packageName: "mcp-server-dingtalk",
		version: "1.1.0",
		source: "npm:mcp-server-dingtalk@1.1.0",
		publisher: "wong2",
		description: "钉钉机器人与工作流推送：待办任务创建、工作通知触达与组织通讯录查询。",
		tags: ["钉钉", "办公协同", "待办推送", "中文生态"],
		repoName: "wong2/awesome-mcp-servers",
		repoUrl: "https://github.com/wong2/awesome-mcp-servers",
	},
	{
		id: "mcp-wechat-reading",
		kind: "mcp",
		registry: "mcp",
		name: "MCP 微信读书书架同步",
		packageName: "mcp-server-weread",
		version: "0.8.0",
		source: "npm:mcp-server-weread@0.8.0",
		publisher: "wong2",
		description: "微信读书笔记与书架直连：同步划线高亮、读书想法与书单结构化知识库。",
		tags: ["微信读书", "读书笔记", "知识库", "中文生态"],
		repoName: "wong2/awesome-mcp-servers",
		repoUrl: "https://github.com/wong2/awesome-mcp-servers",
	},
	{
		id: "mcp-elasticsearch",
		kind: "mcp",
		registry: "mcp",
		name: "MCP ElasticSearch 检索服务",
		packageName: "@elastic/mcp-server-elasticsearch",
		version: "8.14.0",
		source: "npm:@elastic/mcp-server-elasticsearch@8.14.0",
		publisher: "punkpeye",
		description: "ElasticSearch 搜索与日志检索：多条件倒排索引检索、聚合指标分析与混合向量搜索。",
		tags: ["ElasticSearch", "全文检索", "日志分析", "向量检索"],
		repoName: "punkpeye/awesome-mcp-servers",
		repoUrl: "https://github.com/punkpeye/awesome-mcp-servers",
	},
	{
		id: "mcp-chroma",
		kind: "mcp",
		registry: "mcp",
		name: "MCP Chroma 向量数据库",
		packageName: "mcp-server-chroma",
		version: "0.4.2",
		source: "npm:mcp-server-chroma@0.4.2",
		publisher: "punkpeye",
		description: "Chroma 本地向量数据库服务：构建嵌入向量知识库、相似度近邻查询与混合 RAG 召回。",
		tags: ["Chroma", "向量库", "Embedding", "RAG 增强"],
		repoName: "punkpeye/awesome-mcp-servers",
		repoUrl: "https://github.com/punkpeye/awesome-mcp-servers",
	},
	{
		id: "mcp-s3",
		kind: "mcp",
		registry: "mcp",
		name: "MCP AWS S3 对象存储",
		packageName: "mcp-server-s3",
		version: "1.0.5",
		source: "npm:mcp-server-s3@1.0.5",
		publisher: "punkpeye",
		description: "S3 兼容对象存储操作：桶对象检索、临时预签名 URL 生成与文件安全上传下载。",
		tags: ["AWS S3", "对象存储", "云存储", "DevOps"],
		repoName: "punkpeye/awesome-mcp-servers",
		repoUrl: "https://github.com/punkpeye/awesome-mcp-servers",
	},
	{
		id: "mcp-slack",
		kind: "mcp",
		registry: "mcp",
		name: "MCP Slack 协同机器人",
		packageName: "@modelcontextprotocol/server-slack",
		version: "2026.4.0",
		source: "npm:@modelcontextprotocol/server-slack@2026.4.0",
		publisher: "modelcontextprotocol",
		description: "官方 Slack 团队沟通服务：通道消息监听、富文本卡片发送与线程对话追踪。",
		tags: ["Slack", "团队沟通", "机器人", "官方服务"],
		repoName: "modelcontextprotocol/servers",
		repoUrl: "https://github.com/modelcontextprotocol/servers",
	},
	{
		id: "mcp-smithery-cli",
		kind: "mcp",
		registry: "mcp",
		name: "Smithery 在线目录网关",
		packageName: "@smithery/cli",
		version: "3.2.0",
		source: "npm:@smithery/cli@3.2.0",
		publisher: "smithery-ai",
		description: "Smithery 开放平台服务网关：动态发现并挂载云端上千款即插即用的 MCP 插件服务。",
		tags: ["Smithery", "云端注册中心", "动态挂载"],
		repoName: "smithery-ai/registry",
		repoUrl: "https://smithery.ai",
	},
	{
		id: "mcp-glama-inspector",
		kind: "mcp",
		registry: "mcp",
		name: "Glama MCP 协议调试探针",
		packageName: "@glama/mcp-inspector",
		version: "1.0.8",
		source: "npm:@glama/mcp-inspector@1.0.8",
		publisher: "glama-ai",
		description: "Glama 协议诊断与在线测试器：实时捕获 MCP JSON-RPC 消息、接口延迟分析与容错自测。",
		tags: ["Glama", "协议调试", "在线测试", "稳定性检测"],
		repoName: "glama-ai/mcp-servers",
		repoUrl: "https://glama.ai/mcp/servers",
	},
	{
		id: "mcp-scaffold-ts",
		kind: "plugins",
		registry: "official",
		name: "MCP TypeScript 官方脚手架",
		packageName: "@modelcontextprotocol/create-server",
		version: "1.6.0",
		source: "npm:@modelcontextprotocol/create-server@1.6.0",
		publisher: "modelcontextprotocol",
		description: "MCP 官方 TypeScript 扩展开发脚手架：快速初始化标准 MCP Server 模板项目与类型定义。",
		tags: ["官方 SDK", "TypeScript", "开发脚手架", "代码生成"],
		repoName: "modelcontextprotocol/typescript-sdk",
		repoUrl: "https://github.com/modelcontextprotocol/typescript-sdk",
	},

	// ── 🛡️ 安全与逆向源 ──────────────────────────────────────────
	{
		id: "pi-redteam",
		kind: "plugins",
		registry: "security",
		name: "Pi Redteam",
		packageName: "pi-redteam",
		version: "1.0.4",
		source: "npm:pi-redteam",
		publisher: "security-lab",
		description: "红蓝对抗与应用安全防御套件：系统攻击面分析、敏感信息泄漏排查、越权防护与漏洞规避策略。",
		tags: ["红蓝对抗", "安全扫描", "权限防护"],
		repoName: "janehuaan/OpenPI",
		repoUrl: "https://github.com/janehuaan/OpenPI",
	},
	{
		id: "pi-reverse-basics",
		kind: "plugins",
		registry: "security",
		name: "Pi Reverse Basics",
		packageName: "pi-reverse-basics",
		version: "0.8.2",
		source: "npm:pi-reverse-basics",
		publisher: "binary-research",
		description: "二进制反编译与静态分析套件：反汇编分析辅助、ELF/Mach-O 格式结构探测与依赖符号表解析。",
		tags: ["逆向工程", "二进制分析", "系统内核"],
		repoName: "janehuaan/OpenPI",
		repoUrl: "https://github.com/janehuaan/OpenPI",
	},
	{
		id: "pi-sandbox",
		kind: "plugins",
		registry: "security",
		name: "Pi Sandbox",
		packageName: "carderne/pi-sandbox",
		version: "0.5.1",
		source: "git:github.com/carderne/pi-sandbox@3323223af5f893a36fef5bd47d7f2377552fdd98",
		publisher: "carderne/pi-sandbox",
		description: "操作系统级命令沙箱拦截：网络与关键目录写操作权限交互式审核，防止不可逆破坏。",
		tags: ["命令沙箱", "物理防护", "权限门禁"],
		repoName: "janehuaan/OpenPI",
		repoUrl: "https://github.com/janehuaan/OpenPI",
	},
	{
		id: "pi-permission-system",
		kind: "plugins",
		registry: "security",
		name: "Permission System",
		packageName: "MasuRii/pi-permission-system",
		version: "0.8.0",
		source: "git:github.com/MasuRii/pi-permission-system@9affcc9d1b52cd79b8bb7da2bebb761ac7e5b1d8",
		publisher: "MasuRii",
		description: "分层权限控制策略：针对高危命令行、敏感路径读写与外部连接实施细粒度放行控制。",
		tags: ["访问控制", "细粒度权限", "合规保护"],
		repoName: "janehuaan/OpenPI",
		repoUrl: "https://github.com/janehuaan/OpenPI",
	},

	// ── ⚙️ 工作流协作源 ──────────────────────────────────────────
	{
		id: "pi-dynamic-workflows",
		kind: "repositories",
		registry: "workflow",
		name: "Dynamic Workflows",
		packageName: "QuintinShaw/pi-dynamic-workflows",
		version: "3.4.0",
		source: "git:github.com/QuintinShaw/pi-dynamic-workflows@2c917ef28254611a8f70d990fc9e8706e33386a8",
		publisher: "QuintinShaw",
		description: "动态模型路由与可恢复工作流：根据任务复杂度智能分流大模型，支持长时间断点续跑与深度调研。",
		tags: ["动态路由", "断点续跑", "高阶流程"],
		repoName: "janehuaan/OpenPI",
		repoUrl: "https://github.com/janehuaan/OpenPI",
	},
	{
		id: "pi-tasks",
		kind: "repositories",
		registry: "workflow",
		name: "Pi Tasks",
		packageName: "tintinweb/pi-tasks",
		version: "0.7.1",
		source: "git:github.com/tintinweb/pi-tasks@d478be2f07d56c7af126876eb0a53a36f27bbf0a",
		publisher: "tintinweb",
		description: "持久化任务追踪与依赖图谱：支持多任务并行、状态小部件可视化与子代理分派执行。",
		tags: ["任务图谱", "进度看板", "依赖调度"],
		repoName: "janehuaan/OpenPI",
		repoUrl: "https://github.com/janehuaan/OpenPI",
	},
	{
		id: "pi-agent-teams",
		kind: "repositories",
		registry: "workflow",
		name: "Agent Teams",
		packageName: "tmustier/pi-agent-teams",
		version: "0.5.6",
		source: "git:github.com/tmustier/pi-agent-teams@2c1776d2a68104aaadc1c622d8a704684c7c35d6",
		publisher: "tmustier",
		description: "智能体团队协作网络：主副 Agent 共享任务通道、消息总线，在各自隔离的工作树中协同完成大型项目。",
		tags: ["团队协作", "多智能体", "消息总线"],
		repoName: "janehuaan/OpenPI",
		repoUrl: "https://github.com/janehuaan/OpenPI",
	},
	{
		id: "pi-until-done",
		kind: "repositories",
		registry: "workflow",
		name: "Until Done",
		packageName: "srinitude/pi-until-done",
		version: "0.2.2",
		source: "git:github.com/srinitude/pi-until-done@02b0f3ba900cc01af6b70d2c95778bbf26bea5fc",
		publisher: "srinitude",
		description: "闭环自愈保障：持续迭代执行直到目标满足清晰的完成判定标准或遇到物理阻塞，绝不中途放弃。",
		tags: ["闭环完成", "持续自愈", "坚定执行"],
		repoName: "janehuaan/OpenPI",
		repoUrl: "https://github.com/janehuaan/OpenPI",
	},
	{
		id: "pi-atlas",
		kind: "repositories",
		registry: "workflow",
		name: "Pi Atlas",
		packageName: "MohnDoe/pi-atlas",
		version: "0.2.1",
		source: "git:github.com/MohnDoe/pi-atlas@46f15dfe3fd58214839dac2aa0468a7c4b0fd99d",
		publisher: "MohnDoe",
		description: "可视化分析大屏：实时审计 Token 消耗速率、模型调用延迟分布与各轮次开销成本。",
		tags: ["消耗看板", "Token 审计", "成本分析"],
		repoName: "janehuaan/OpenPI",
		repoUrl: "https://github.com/janehuaan/OpenPI",
	},
];
