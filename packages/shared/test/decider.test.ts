import test from "node:test";
import assert from "node:assert/strict";
import { FastSentinel, FastModeRouter, StepVerifier, OpenPIDecider } from "../src/decider/index.ts";

test("FastSentinel: correctly identifies high-risk commands", () => {
	const safeCases = [
		"git status",
		"ls -la",
		"cat README.md",
		"npm test",
		"cargo check",
		"echo 'hello world'",
	];

	for (const cmd of safeCases) {
		const res = FastSentinel.checkCommand(cmd);
		assert.equal(res.isDangerous, false, `Expected '${cmd}' to be safe`);
		assert.ok(res.riskScore < 0.5, `Expected low risk score for '${cmd}'`);
	}

	const dangerCases = [
		"rm -rf /",
		"rm -rf *",
		"rm -rf ~/.config",
		"git reset --hard HEAD~1",
		"git clean -fdx",
		"git push origin main --force",
		"cat ~/.ssh/id_rsa",
		"DROP TABLE users;",
		"chmod -R 777 /var/root",
	];

	for (const cmd of dangerCases) {
		const res = FastSentinel.checkCommand(cmd);
		assert.equal(res.isDangerous, true, `Expected '${cmd}' to be flagged dangerous`);
		assert.ok(res.riskScore >= 0.85, `Expected high risk score for '${cmd}', got ${res.riskScore}`);
		assert.ok(res.reason, "Expected reason to be provided");
	}
});

test("FastModeRouter: accurately classifies chat vs code intent", () => {
	const chatPrompts = [
		"你好，在吗？",
		"hello, who are you?",
		"解释一下量子计算的基本原理",
		"介绍一下中国唐代诗歌的历史",
		"谢谢你的帮助，太棒了",
	];

	for (const p of chatPrompts) {
		const res = FastModeRouter.route(p);
		assert.equal(res.mode, "chat", `Expected '${p}' to be routed to chat`);
		assert.equal(res.requiresWorkspace, false);
	}

	const codePrompts = [
		"帮我实现一个冒泡排序算法，用 TypeScript 写",
		"把这个函数的类型修一下，添加单测",
		"refactor user authentication controller and add error handling",
		"为什么这个 npm build 编译报错了？帮我改 bug",
		"git rebase 冲突怎么解决，帮我看一下仓库状态",
	];

	for (const p of codePrompts) {
		const res = FastModeRouter.route(p);
		assert.equal(res.mode, "code", `Expected '${p}' to be routed to code`);
		assert.equal(res.requiresWorkspace, true);
	}

	// Colloquial dev expressions & slang
	const colloquialCases = [
		{ p: "怎么跑不起来了", want: "code" },
		{ p: "按刚才说的改", want: "code" },
		{ p: "优化一下", want: "code" },
		{ p: "这个页面好丑", want: "code" },
		{ p: "加个弹窗", want: "code" },
		{ p: "跑一下试试", want: "code" },
		{ p: "这个地方逻辑不对", want: "code" },
		{ p: "报错了：Uncaught TypeError: Cannot read property", want: "code" },
		{ p: "看看这个", ctx: { hasWorkspace: true }, want: "code" },
		{ p: "继续", ctx: { previousMode: "code" as const }, want: "code" },
		{ p: "先别动代码，跟我聊聊方案", want: "chat" },
	];

	for (const item of colloquialCases) {
		const res = FastModeRouter.route(item.p, item.ctx);
		assert.equal(res.mode, item.want, `Expected '${item.p}' to be routed to '${item.want}'`);
	}
});

test("StepVerifier: detects loops and generates steering suggestions", () => {
	const verifier = new StepVerifier();

	// Success
	const okRes = verifier.verify("bash", false, "Done in 12ms");
	assert.equal(okRes.passed, true);
	assert.equal(okRes.isLooping, false);

	// Missing command error
	const err1 = verifier.verify("bash", true, "zsh: command not found: foobar");
	assert.equal(err1.passed, false);
	assert.ok(err1.correctiveHint?.includes("路径不存在"));

	// Repetitive identical error -> looping
	const err2 = verifier.verify("bash", true, "zsh: command not found: foobar");
	assert.equal(err2.isLooping, true);
	assert.ok(err2.correctiveHint?.includes("死循环"));
});

test("OpenPIDecider: unified API works synchronously and rapidly", () => {
	const t0 = performance.now();
	const mode = OpenPIDecider.decideMode("帮我写一个快速排序");
	const safety = OpenPIDecider.checkSafety("bash", { command: "rm -rf /tmp/test" });
	const elapsed = performance.now() - t0;

	assert.equal(mode.mode, "code");
	assert.equal(safety.isDangerous, true);
	assert.ok(elapsed < 5, `Decider should execute within 5ms, took ${elapsed}ms`);
});

test("OpenPIDecider: decideModeAsync neural semantic router", async () => {
	const res1 = await OpenPIDecider.decideModeAsync("按刚才说的改");
	assert.equal(res1.mode, "code");

	const t0 = performance.now();
	const res2 = await OpenPIDecider.decideModeAsync("先别动代码，跟我聊聊方案");
	const t1 = performance.now();
	assert.equal(res2.mode, "chat");

	const res3 = await OpenPIDecider.decideModeAsync("今天天气真好，讲个笑话");
	const t2 = performance.now();
	assert.equal(res3.mode, "chat");

	const res4 = await OpenPIDecider.decideModeAsync("加个弹窗");
	const t3 = performance.now();
	assert.equal(res4.mode, "code");

	console.log(`[Perf] decideModeAsync subsequent calls: ${(t1 - t0).toFixed(2)}ms, ${(t2 - t1).toFixed(2)}ms, ${(t3 - t2).toFixed(2)}ms`);
	assert.ok((t3 - t2) < 30, `Inference should be under 30ms on CPU, got ${(t3 - t2).toFixed(2)}ms`);
});

