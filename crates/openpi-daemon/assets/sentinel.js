/**
 * OpenPI Jev Sentinel Extension
 * 
 * System 1 Local Instinct Engine Bridge connecting pi-coding-agent
 * with openpi-jev via Unix domain socket (~/.openpi/openpi.sock).
 * 
 * Provides:
 * 1. Physical hard-blocking of dangerous commands (<55ms deterministic pre-flight).
 * 2. Interactive UI confirmation modal (via ctx.ui.confirm) for medium-risk operations.
 * 3. Automatic command modification (e.g. appending -y to prevent hanging interactive installs).
 * 4. Automatic secret leakage redaction (LeakHunter) & verbose log compression (Compressor).
 * 5. Loop breaking & early termination guidance (LoopBreaker / StopDecider).
 */

import net from "node:net";
import os from "node:os";
import path from "node:path";

const SOCKET_PATH = process.env.OPENPI_SOCKET_PATH || path.join(os.homedir(), ".openpi", "openpi.sock");

// Statistics & In-Memory State
let totalBlockedCount = 0;
let totalConfirmedCount = 0;
let totalModifiedCount = 0;
let totalLeaksRedacted = 0;
let totalTokensSaved = 0;
let totalLoopBreaks = 0;
const blockedLog = [];
const commandHistory = [];

// Fallback high-risk patterns if daemon socket is momentarily unavailable
const LOCAL_HIGH_RISK_PATTERNS = [
  {
    pattern: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*|-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*)\s+([~/]|\*|\.\.|\$HOME)/i,
    risk: 0.99,
    reason: "Attempting recursive forced deletion of root, home, parent dir, or wildcard (*)."
  },
  {
    pattern: /\b(mkfs|dd\s+if=.*of=\/dev|fdisk|parted)\b/i,
    risk: 0.99,
    reason: "Low-level block device or filesystem formatting command."
  },
  {
    pattern: /\b(shutdown|reboot|poweroff|halt)\b/i,
    risk: 0.98,
    reason: "Command attempts to power down or reboot the operating system."
  },
  {
    pattern: /\bgit\s+reset\s+--hard\b/i,
    risk: 0.92,
    reason: "git reset --hard permanently discards all uncommitted working changes."
  },
  {
    pattern: /\bgit\s+clean\s+(-[a-zA-Z]*f|--force)/i,
    risk: 0.92,
    reason: "git clean -f permanently removes all untracked files."
  },
  {
    pattern: /\bgit\s+push\s+.*(-f\b|--force\b|--force-with-lease\b)/i,
    risk: 0.96,
    reason: "Force pushing may overwrite commits on the remote branch."
  }
];

class JevClient {
  static async query(op, timeoutMs = 150) {
    return new Promise((resolve) => {
      let resolved = false;
      const client = net.createConnection(SOCKET_PATH, () => {
        const id = `jev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        client.write(JSON.stringify({ type: "app", id, op }) + "\n");
      });

      let buffer = "";
      client.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        const nl = buffer.indexOf("\n");
        if (nl !== -1) {
          const line = buffer.slice(0, nl).trim();
          try {
            const resp = JSON.parse(line);
            if (!resolved) {
              resolved = true;
              client.destroy();
              resolve(resp.ok ? resp.data : null);
            }
          } catch {
            if (!resolved) {
              resolved = true;
              client.destroy();
              resolve(null);
            }
          }
        }
      });

      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          client.destroy();
          resolve(null);
        }
      }, timeoutMs);

      client.on("error", () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          client.destroy();
          resolve(null);
        }
      });
    });
  }

  static async checkCommand(command) {
    const remote = await this.query({ name: "jev_check_command", command });
    if (remote) {
      return remote;
    }

    // Local fallback heuristics if daemon is unreachable
    const trimmed = (command || "").trim();
    if (!trimmed) return { action: "allow" };

    if (/\b(apt|apt-get|yum|brew|pacman)\s+install\b/i.test(trimmed) && !trimmed.includes("-y") && !trimmed.includes("--yes")) {
      return {
        action: "modify_command",
        safe_command: `${trimmed} -y`,
        reason: "Appended -y flag to prevent hanging on interactive confirmation prompt."
      };
    }

    for (const rule of LOCAL_HIGH_RISK_PATTERNS) {
      if (rule.pattern.test(trimmed)) {
        if (rule.risk >= 0.95) {
          return { action: "deny", reason: rule.reason, risk_score: rule.risk };
        } else {
          return {
            action: "require_confirmation",
            prompt: `智能体请求执行高风险命令: \`${trimmed}\``,
            reasons: [rule.reason],
            risk_score: rule.risk
          };
        }
      }
    }

    return { action: "allow" };
  }

  static async processOutput(output) {
    return await this.query({ name: "jev_process_output", output }, 200);
  }

  static async evaluateTask(goal, command, output, successes) {
    return await this.query({ name: "jev_evaluate_task", goal, command, output, successes }, 200);
  }
}

export default function sentinelExtension(pi) {
  console.log("[OpenPI Jev Sentinel] System 1 Instinct Safety Engine initialized.");

  // 1. Physical Pre-Execution Gate (<55ms)
  pi.on("tool_call", async (event, ctx) => {
    try {
      const toolName = (event.toolName || "").toLowerCase();
      const isShell = toolName === "bash" || toolName === "powershell" || toolName === "terminal" || toolName === "cmd";
      if (!isShell) {
        return void 0;
      }

      const cmd = (event.input?.command || event.input?.cmd || "").trim();
      if (!cmd) {
        return void 0;
      }

      // ── Jev Pillar 4: LoopBreaker Pre-Flight Circuit Breaker ──
      // Normalize command (strip trailing echoes, delimiters, and spaces)
      const normCmd = cmd.replace(/;\s*echo\s*.*$/i, "").replace(/[;\s]+$/, "").trim();

      // Check consecutive repetition
      let repeatCount = 0;
      for (let i = commandHistory.length - 1; i >= 0; i--) {
        if (commandHistory[i].normCmd === normCmd) {
          repeatCount++;
        } else {
          break;
        }
      }

      // If already executed twice (this is the 3rd attempt): HARD FUSE BREAK!
      if (repeatCount >= 2) {
        totalBlockedCount += 1;
        totalLoopBreaks += 1;
        const entry = {
          timestamp: Date.now(),
          tool: event.toolName,
          command: cmd,
          reason: `[Jev LoopBreaker] 连续重复执行相同指令 ${repeatCount + 1} 次且无新进展`,
          risk: 0.95
        };
        blockedLog.push(entry);
        if (blockedLog.length > 50) blockedLog.shift();

        console.warn(`🛑 [Jev LoopBreaker] Circuit breaker tripped for repetitive command (${repeatCount + 1}x): \`${cmd}\``);

        if (ctx?.ui?.notify) {
          ctx.ui.notify(`🛑 [Jev 熔断] 检测到指令连续重复陷入死循环，已强制阻断`, "warning");
        }

        return {
          block: true,
          reason: `🛑 [Jev LoopBreaker 死循环强制熔断]\n系统检测到当前任务已连续 ${repeatCount + 1} 次重复执行完全相同的检索/执行指令：\n\n\`${cmd}\`\n\n为避免智能体陷入死循环打转并浪费 Token 与时间，系统底层已物理阻断该指令继续调用！\n\n💡 核心建议与排查引导：\n1. 目标信息可能不存在，或者在第 1 次执行时已经返回了全部输出。\n2. 请立即停止重复执行相同的 grep / find / cat 指令！\n3. 请仔细阅读并分析前几次调用中已经获取到的终端输出内容。\n4. 若需进一步定位，请换用不同的关键词、正则表达式，或切换到其他代码文件进行核对。`
        };
      }

      // Check Ping-Pong oscillation (A -> B -> A -> B -> A)
      if (commandHistory.length >= 4) {
        const n = commandHistory.length;
        const h = commandHistory;
        if (h[n - 1].normCmd === h[n - 3].normCmd && h[n - 2].normCmd === h[n - 4].normCmd && normCmd === h[n - 2].normCmd) {
          totalBlockedCount += 1;
          totalLoopBreaks += 1;
          return {
            block: true,
            reason: `🛑 [Jev LoopBreaker 震荡死循环熔断]\n检测到智能体在两条交替指令之间陷入反复震荡死循环（Ping-Pong Loop）：\n\n1) \`${h[n - 1].normCmd}\`\n2) \`${h[n - 2].normCmd}\`\n\n系统底层已强制阻断后续震荡，请立即停止机械重试并切换排查思路！`
          };
        }
      }

      // Record this execution into history
      commandHistory.push({
        tool: event.toolName,
        cmd,
        normCmd,
        timestamp: Date.now()
      });
      if (commandHistory.length > 40) commandHistory.shift();

      const verdict = await JevClient.checkCommand(cmd);

      // A) Physical Hard Block
      if (verdict.action === "deny") {
        totalBlockedCount += 1;
        const entry = {
          timestamp: Date.now(),
          tool: event.toolName,
          command: cmd,
          reason: verdict.reason,
          risk: verdict.risk_score || 0.99
        };
        blockedLog.push(entry);
        if (blockedLog.length > 50) blockedLog.shift();

        console.warn(`🛑 [Jev SafetyGate] Physically blocked destructive command: \`${cmd}\`. Reason: ${verdict.reason}`);

        return {
          block: true,
          reason: `🛑 [Jev SafetyGate 物理阻断] 该高危命令已被系统内核物理拦截，未创建执行子进程。\n\n• 拦截原因: ${verdict.reason}\n• 风险评估: ${((verdict.risk_score || 0.99) * 100).toFixed(0)}%\n• 目标命令: \`${cmd}\`\n\n提示: 该命令可能对系统或仓库造成不可逆破坏，已被拒绝执行。`
        };
      }

      // B) Interactive User Confirmation Dialog
      if (verdict.action === "require_confirmation") {
        if (ctx && ctx.hasUI && ctx.ui && typeof ctx.ui.confirm === "function") {
          const reasonsText = Array.isArray(verdict.reasons) ? verdict.reasons.map((r) => `• ${r}`).join("\n") : (verdict.reason || "");
          const dialogMessage = `${verdict.prompt || `智能体请求执行高风险命令：\n\`${cmd}\``}\n\n风险原因：\n${reasonsText}\n\n是否允许继续执行？`;

          console.info(`⚠️ [Jev SafetyGate] Triggering interactive confirmation dialog for: \`${cmd}\``);
          const confirmed = await ctx.ui.confirm("⚠️ Jev 安全确认", dialogMessage);

          if (!confirmed) {
            totalBlockedCount += 1;
            console.warn(`🛑 [Jev SafetyGate] User cancelled command confirmation: \`${cmd}\``);
            return {
              block: true,
              reason: `🛑 [Jev SafetyGate] 用户在安全确认弹窗中取消了此操作（命令未执行: \`${cmd}\`）。`
            };
          }

          totalConfirmedCount += 1;
          console.info(`✅ [Jev SafetyGate] User approved execution of: \`${cmd}\``);
          return void 0;
        } else {
          // In headless mode without UI capability, block dangerous operations by default
          return {
            block: true,
            reason: `🛑 [Jev SafetyGate] 操作需要人工确认，但在非交互/无界面环境下默认拦截: \`${cmd}\``
          };
        }
      }

      // C) Auto-Modify Command (e.g. non-interactive flags)
      if (verdict.action === "modify_command" && verdict.safe_command) {
        if (verdict.safe_command !== cmd) {
          totalModifiedCount += 1;
          console.info(`💡 [Jev SafetyGate] Auto-patched command: \`${cmd}\` -> \`${verdict.safe_command}\``);
          event.input.command = verdict.safe_command;
          if (ctx?.ui?.notify) {
            ctx.ui.notify(`💡 [Jev 优化] 自动补全安全参数: ${verdict.safe_command}`, "info");
          }
        }
        return void 0;
      }

      // D) Allow
      return void 0;
    } catch (err) {
      console.error("[OpenPI Jev Sentinel] Error in pre-execution check:", err);
      return void 0;
    }
  });

  // 2. Post-Execution Sanitization & Compression
  pi.on("tool_result", async (event) => {
    try {
      if (!event.content || !Array.isArray(event.content)) {
        return void 0;
      }

      const textPieces = [];
      for (const item of event.content) {
        if (item.type === "text" && item.text) {
          textPieces.push(item.text);
        }
      }

      const rawText = textPieces.join("\n");
      if (!rawText || rawText.length < 10) {
        return void 0;
      }

      const result = await JevClient.processOutput(rawText);
      if (result) {
        let changed = false;
        let sanitizedText = rawText;

        if (result.leak?.has_leaks) {
          totalLeaksRedacted += result.leak.leak_count || 1;
          sanitizedText = result.leak.sanitized_text || sanitizedText;
          changed = true;
          console.warn(`🛡️ [Jev LeakHunter] Redacted ${result.leak.leak_count} secret(s): ${result.leak.redacted_types.join(", ")}`);
        }

        if (result.compressed?.was_compressed) {
          totalTokensSaved += result.compressed.estimated_tokens_saved || 0;
          sanitizedText = result.compressed.content || sanitizedText;
          changed = true;
          console.info(`📦 [Jev Compressor] Truncated ${result.compressed.lines_truncated} lines, saved ~${result.compressed.estimated_tokens_saved} tokens.`);
        }

        if (changed) {
          let notice = "";
          if (result.leak?.has_leaks) {
            notice += `\n[Jev LeakHunter: 已自动脱敏 ${result.leak.leak_count} 处凭证密钥，防止上下文泄露]`;
          }
          if (result.compressed?.was_compressed) {
            notice += `\n[Jev Compressor: 输出已折叠，节省约 ${result.compressed.estimated_tokens_saved} Tokens]`;
          }

          return {
            content: [
              {
                type: "text",
                text: sanitizedText + notice
              }
            ]
          };
        }
      }
    } catch (err) {
      console.warn("[OpenPI Jev Sentinel] Error in tool_result processing:", err);
    }
    return void 0;
  });

  // 3. Inspectable Status Tool
  pi.registerTool({
    name: "jev_sentinel_status",
    label: "OpenPI Jev Sentinel Status",
    description: "Inspect OpenPI Jev System 1 instincts, SafetyGate statistics, LeakHunter redactions, and log compression.",
    parameters: {
      type: "object",
      properties: {}
    },
    execute: async () => {
      const jevStatus = await JevClient.query({ name: "jev_status" }, 150);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                status: "active",
                engine: jevStatus?.engine || "ModernBERT-base (FP32/INT8)",
                daemonConnected: !!jevStatus,
                statistics: {
                  blockedCommands: totalBlockedCount,
                  userConfirmedCommands: totalConfirmedCount,
                  autoPatchedCommands: totalModifiedCount,
                  secretsRedacted: totalLeaksRedacted,
                  estimatedTokensSaved: totalTokensSaved,
                  loopBreaks: totalLoopBreaks
                },
                recentBlocks: blockedLog.slice(-5)
              },
              null,
              2
            )
          }
        ],
        details: {}
      };
    }
  });
}
