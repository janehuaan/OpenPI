import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 回归：macOS 的红黄绿交通灯由系统原生绘制（`titleBarStyle: "Overlay"` +
 * `decorations: true`），侧栏里**不能再画一套假圆点** —— 两套错位叠在一起会变成
 * 6 个圆点（真机截图实测）。
 *
 * 侧栏组件有 40+ 个必填 props，渲染测试不现实，所以这里直接对源码做断言：
 * 只要有人把 `.pa-dot` 加回来，这个测试就会红。
 */
function read(relative: string): string {
	return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

describe("sidebar window controls", () => {
	it("keeps the drag spacer but draws no fake traffic lights", () => {
		const tsx = read("./workspace-preview.tsx");
		expect(tsx).toContain('className="pa-window-controls"');
		expect(tsx).not.toMatch(/pa-dot (red|yellow|green)/);
	});

	it("has no fake-dot styling left in the stylesheet", () => {
		const css = read("../../../styles/personal-assistant.css");
		expect(css).not.toMatch(/\.pa-dot\s*\{/);
		expect(css).not.toMatch(/\.pa-dot\.(red|yellow|green)/);
	});

	it("still reserves vertical room so the brand header clears the native buttons", () => {
		const css = read("../../../styles/personal-assistant.css");
		const rule = css.match(/\.pa-window-controls\s*\{([^}]*)\}/)?.[1] ?? "";
		expect(rule).toMatch(/height:/);
		expect(rule).toMatch(/-webkit-app-region:\s*drag/);
	});
});
