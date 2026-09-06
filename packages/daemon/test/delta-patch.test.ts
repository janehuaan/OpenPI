import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	applyHandbookPatches,
	classifyMemoryIntent,
	generateSummaryIndex,
	type MemoryPatch,
} from "../src/memory/delta-patch.ts";

describe("Delta Patch Engine & Intent Classifier", () => {
	it("classifies intent into standard categories and safe staging notes", () => {
		// User preference / negative constraint
		assert.equal(
			classifyMemoryIntent("切勿在提交代码时包含 node_modules"),
			"User Preferences & Habits",
		);
		assert.equal(
			classifyMemoryIntent("Always prefer Chinese for explanations"),
			"User Preferences & Habits",
		);

		// Platform / build quirks
		assert.equal(
			classifyMemoryIntent("macOS 打包时使用 ditto 保留符号链接"),
			"Platform Quirks & Build Recipes",
		);
		assert.equal(
			classifyMemoryIntent("Electron codesign fails without ad-hoc identity"),
			"Platform Quirks & Build Recipes",
		);

		// Architecture
		assert.equal(
			classifyMemoryIntent("本项目采用 monorepo 架构并使用 Vitest 组织测试"),
			"Architecture & Conventions",
		);

		// Troubleshooting
		assert.equal(
			classifyMemoryIntent("Fix error TS2352 by casting unknown first"),
			"Troubleshooting Lessons",
		);

		// Ambiguous text goes to Staging Notes (not dumped into Troubleshooting)
		assert.equal(
			classifyMemoryIntent("今天下午测试了用户界面的一些文字排版"),
			"Staging Notes",
		);
	});

	it("surgically applies add patch with immutable evidence anchor", () => {
		const initialHandbook = `# OpenPI Knowledge Handbook

## Platform Quirks & Build Recipes
- Linux requires libsecret for keychain credentials
`;

		const patches: MemoryPatch[] = [
			{
				op: "add",
				section: "Platform Quirks & Build Recipes",
				item: "macOS ditto preserves symlinks for Electron app bundle",
				evidence: "2026-09-06-macos-ditto.md",
			},
		];

		const updated = applyHandbookPatches(initialHandbook, patches);
		assert.ok(updated.includes("Linux requires libsecret"));
		assert.ok(updated.includes("macOS ditto preserves symlinks"));
		assert.ok(updated.includes("<!-- src: 2026-09-06-macos-ditto.md -->"));
	});

	it("applies supersede patch without lossy rewrite of other lines", () => {
		const initialHandbook = `# OpenPI Knowledge Handbook

## Architecture & Conventions
- 项目采用 Jest 进行单元测试覆盖
- 前端使用 Vite 7 进行单页面应用构建
`;

		const patches: MemoryPatch[] = [
			{
				op: "supersede",
				section: "Architecture & Conventions",
				target_phrase: "Jest",
				item: "项目全面采用 Vitest 进行单元测试覆盖",
				evidence: "2026-09-06-vitest-mig.md",
				reason: "已迁移到 Vitest",
			},
		];

		const updated = applyHandbookPatches(initialHandbook, patches);
		assert.ok(updated.includes("Vitest"));
		assert.ok(updated.includes("<!-- superseded prior entry: 已迁移到 Vitest -->"));
		// Untouched line remains byte-exact
		assert.ok(updated.includes("前端使用 Vite 7 进行单页面应用构建"));
	});

	it("respects human lock <!-- lock --> to protect sensitive manual edits", () => {
		const lockedHandbook = `# OpenPI Knowledge Handbook

## User Preferences & Habits
<!-- lock -->
- 核心指令：无论何时均禁止直接修改生产环境数据库密码
<!-- /lock -->
`;

		const patches: MemoryPatch[] = [
			{
				op: "add",
				section: "User Preferences & Habits",
				item: "允许在特定情况下临时测试数据库",
			},
		];

		const updated = applyHandbookPatches(lockedHandbook, patches);
		// Did not inject into locked section
		assert.ok(!updated.includes("允许在特定情况下临时测试数据库"));
		assert.ok(updated.includes("禁止直接修改生产环境数据库密码"));
	});

	it("generates compact routing index from updated handbook", () => {
		const handbook = `# OpenPI Knowledge Handbook

## Platform Quirks & Build Recipes
- macOS ditto rule

## Architecture & Conventions
- Monorepo structure
`;

		const summary = generateSummaryIndex(handbook);
		assert.ok(summary.includes("# Memory Index"));
		assert.ok(summary.includes("[Platform Quirks & Build Recipes]"));
		assert.ok(summary.includes("[Architecture & Conventions]"));
	});
});
