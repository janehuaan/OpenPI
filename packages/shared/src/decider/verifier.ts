import type { VerificationResult } from "./types.ts";

export class StepVerifier {
	private recentErrors: string[] = [];

	/**
	 * Verify tool execution output and generate steering hints if execution failed.
	 */
	verify(toolName: string, isError: boolean, outputText: string): VerificationResult {
		if (!isError && !outputText.includes("Error:") && !outputText.includes("FAILED")) {
			this.recentErrors = [];
			return {
				passed: true,
				isLooping: false,
				severity: "info",
			};
		}

		const text = outputText.slice(0, 1000);
		this.recentErrors.push(text);
		if (this.recentErrors.length > 5) {
			this.recentErrors.shift();
		}

		// Check for repetitive loops (same error twice in a row)
		const isLooping =
			this.recentErrors.length >= 2 &&
			this.recentErrors[this.recentErrors.length - 1] === this.recentErrors[this.recentErrors.length - 2];

		let hint: string | undefined;

		if (isLooping) {
			hint =
				"🛑 [OpenPI Sentinel] 检测到工具重复报错死循环。请立即停止尝试相同命令，更换解决思路或向用户澄清上下文。";
		} else if (/command not found|no such file or directory/i.test(text)) {
			hint =
				"💡 [OpenPI Sentinel] 提示：文件或命令路径不存在。请先检查当前工作目录 (`pwd`) 或确认是否需要先安装依赖。";
		} else if (/permission denied|EACCES/i.test(text)) {
			hint = "💡 [OpenPI Sentinel] 提示：无权限执行此操作。请检查文件写权限或向用户请求更高权限。";
		} else if (/syntax error|parse error|TypeError/i.test(text)) {
			hint = "💡 [OpenPI Sentinel] 提示：检测到语法解析或类型错误，请重点核对刚刚修改的代码块语法闭合与导出。";
		}

		return {
			passed: false,
			isLooping,
			severity: isLooping ? "error" : "warning",
			correctiveHint: hint,
		};
	}

	reset(): void {
		this.recentErrors = [];
	}
}
