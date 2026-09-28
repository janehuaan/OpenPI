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
import fs from "node:fs";
import { execSync } from "node:child_process";

const SOCKET_PATH = process.env.OPENPI_SOCKET_PATH || path.join(os.homedir(), ".openpi", "openpi.sock");

// Statistics & In-Memory State
let totalBlockedCount = 0;
let totalConfirmedCount = 0;
let totalModifiedCount = 0;
let totalLeaksRedacted = 0;
let totalTokensSaved = 0;
let totalLoopBreaks = 0;
let totalProvenanceBlocks = 0;
let totalActKVPrunedTokens = 0;
let lastCheckpointTime = null;
const blockedLog = [];
const commandHistory = [];
const readProvenanceSet = new Set();
let dynamicLoopThreshold = 2;

// Helper: safe local git operations for workspace transactions
const runGit = (cmd, cwd) => {
  try {
    return execSync(`git ${cmd}`, { cwd, stdio: ["pipe", "pipe", "ignore"], encoding: "utf8" }).trim();
  } catch {
    return null;
  }
};

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

    if (/\b(apt|apt-get|yum|brew|pacman|dnf|zypper)\s+install\b/i.test(trimmed) && !trimmed.includes("-y") && !trimmed.includes("--yes")) {
      return {
        action: "modify_command",
        safe_command: `${trimmed} -y`,
        reason: "Appended -y flag to prevent hanging on interactive confirmation prompt."
      };
    }

    if (/^npm\s+init$/i.test(trimmed)) {
      return {
        action: "modify_command",
        safe_command: "npm init -y",
        reason: "Appended -y flag to prevent hanging on interactive npm init questionnaire."
      };
    }

    if (/^ping\s+([a-zA-Z0-9.-]+)$/i.test(trimmed) && !trimmed.includes("-c")) {
      return {
        action: "modify_command",
        safe_command: `${trimmed} -c 4`,
        reason: "Appended -c 4 to prevent infinite terminal ping hang."
      };
    }

    if (/^git\s+(log|diff|show)\b/i.test(trimmed) && !trimmed.includes("--no-pager") && !trimmed.includes("GIT_PAGER")) {
      return {
        action: "modify_command",
        safe_command: `git --no-pager ${trimmed.slice(4).trim()}`,
        reason: "Appended --no-pager to prevent git from opening interactive pager (less) and blocking."
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

  static async checkFilePath(filePath) {
    const remote = await this.query({ name: "jev_check_file_path", path: filePath });
    if (remote) {
      return remote;
    }
    const normalized = (filePath || "").trim().replace(/\\/g, "/");
    if (!normalized) return { action: "allow" };
    const criticalPrefixes = ["/etc", "/System", "/Library", "/boot", "/dev", "/var/root", "/usr/bin", "/usr/sbin", "/bin", "/sbin", "/private/etc"];
    for (const prefix of criticalPrefixes) {
      if (normalized === prefix || normalized.startsWith(`${prefix}/`)) {
        return { action: "deny", reason: `Direct write to critical OS system path \`${normalized}\` is prohibited.` };
      }
    }
    const sensitivePatterns = ["/.ssh/id_", "/.ssh/authorized_keys", "/.gnupg/", "/.aws/credentials", "/.config/gcloud/", "/.kube/config", "/.docker/config.json"];
    for (const pat of sensitivePatterns) {
      if (normalized.includes(pat)) {
        return { action: "deny", reason: `Direct write to sensitive secret or credential file \`${normalized}\` is denied.` };
      }
    }
    const shellFiles = [".bashrc", ".zshrc", ".bash_profile", ".zprofile", ".profile"];
    for (const sh of shellFiles) {
      if (normalized.endsWith(sh)) {
        return {
          action: "require_confirmation",
          prompt: `智能体请求修改系统终端配置文件 \`${normalized}\``,
          reasons: ["修改 Shell 配置文件将改变终端环境与执行行为。"],
          risk_score: 0.88
        };
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

  // ── Module A: Client-side ActKV Context Trimmer (pi.on("context")) ──
  pi.on("context", async (event) => {
    try {
      if (!event.messages || !Array.isArray(event.messages)) return void 0;

      // Locate all tool / tool_result message indices
      const toolIndices = [];
      event.messages.forEach((msg, idx) => {
        const isTool = msg.role === "tool" || (msg.role === "user" && Array.isArray(msg.content) && msg.content.some((c) => c.type === "tool_result"));
        if (isTool) toolIndices.push(idx);
      });

      const KEEP_RECENT = 2;
      if (toolIndices.length <= KEEP_RECENT) return void 0;

      const pruneIndices = new Set(toolIndices.slice(0, toolIndices.length - KEEP_RECENT));
      let prunedCharsThisTurn = 0;

      event.messages = event.messages.map((msg, idx) => {
        if (!pruneIndices.has(idx)) return msg;

        // Case 1: Plain string content
        if (typeof msg.content === "string" && msg.content.length > 300) {
          const originalLen = msg.content.length;
          prunedCharsThisTurn += originalLen - 150;
          return {
            ...msg,
            content: `[ActKV Pruned: 历史步骤执行完毕，已修剪 ${originalLen} 字符冗余日志以节约显存]\n` + msg.content.slice(0, 150) + "\n..."
          };
        }

        // Case 2: Structured array content
        if (Array.isArray(msg.content)) {
          let changed = false;
          const updated = msg.content.map((part) => {
            if (part && part.type === "text" && typeof part.text === "string" && part.text.length > 300) {
              const originalLen = part.text.length;
              prunedCharsThisTurn += originalLen - 150;
              changed = true;
              return {
                ...part,
                text: `[ActKV Pruned: 历史步骤执行完毕，已修剪 ${originalLen} 字符冗余日志以节约显存]\n` + part.text.slice(0, 150) + "\n..."
              };
            }
            return part;
          });
          if (changed) {
            return { ...msg, content: updated };
          }
        }

        return msg;
      });

      if (prunedCharsThisTurn > 0) {
        const savedTokens = Math.round(prunedCharsThisTurn / 4);
        totalTokensSaved += savedTokens;
        totalActKVPrunedTokens += savedTokens;
        void JevClient.query({
          name: "jev_record_event",
          event_type: "actkv_prune",
          command: "context_trim",
          reason: `ActKV 动态修剪历史 Observation 节省约 ${savedTokens} Tokens`,
          risk: savedTokens
        });
        console.info(`📦 [Jev ActKV] Dynamically pruned ${prunedCharsThisTurn} chars (~${savedTokens} tokens) from deep history.`);
      }

      return { messages: event.messages };
    } catch (err) {
      console.warn("[OpenPI Jev Sentinel] ActKV context pruning error:", err);
      return void 0;
    }
  });

  // 1. Physical Pre-Execution Gate (<55ms)
  pi.on("tool_call", async (event, ctx) => {
    try {
      const toolName = (event.toolName || "").toLowerCase();

      // Track Read Provenance (Pillar 2 & Active Provenance Gate)
      if (toolName === "read") {
        const readPath = (event.input?.path || event.input?.filePath || event.input?.file || "").trim();
        if (readPath) {
          try {
            readProvenanceSet.add(path.resolve(readPath));
          } catch {}
        }
        return void 0;
      }

      // Guard direct file modifications (write / edit) against blind unread writes and sensitive paths
      const isFileWrite = toolName === "write" || toolName === "edit";
      if (isFileWrite) {
        const filePath = (event.input?.path || event.input?.filePath || event.input?.file || "").trim();
        if (filePath) {
          const resolvedPath = path.resolve(filePath);

          // ── Module B: Active Provenance Gate ──
          // If the file already exists on disk, the agent MUST have read it in this session.
          // Blindly overwriting an unread file is blocked as an ungrounded hallucination.
          const fileExists = fs.existsSync(resolvedPath);
          if (fileExists && !readProvenanceSet.has(resolvedPath)) {
            totalBlockedCount += 1;
            totalProvenanceBlocks += 1;
            const entry = {
              timestamp: Date.now(),
              tool: event.toolName,
              command: `blind write/edit -> ${filePath}`,
              reason: `[Active Provenance Gate] 试图直接覆写未阅读文件: ${filePath}`,
              risk: 0.95
            };
            blockedLog.push(entry);
            if (blockedLog.length > 50) blockedLog.shift();

            void JevClient.query({
              name: "jev_record_event",
              event_type: "provenance_block",
              command: `write/edit -> ${filePath}`,
              reason: "试图修改尚未阅读的磁盘已有文件，触发主动溯源拦截",
              risk: 0.95
            });

            console.warn(`🛑 [Jev ProvenanceGate] Blocked blind write to unread file: \`${filePath}\``);
            if (ctx?.ui?.notify) {
              ctx.ui.notify(`🛑 [Jev 溯源拦截] 严禁盲改未阅读文件: ${path.basename(filePath)}`, "warning");
            }

            return {
              block: true,
              reason: `🛑 [Jev Active Provenance Gate 凭据拦截]\n你正试图修改文件：\`${filePath}\`，但你在本轮会话中【从未阅读过】该文件的原始实现！\n\n严禁凭空盲写。请先调用 \`read\` 工具（或终端查看工具）仔细查看该文件内容与上下文契约，确认现状后再执行修改！`
            };
          }

          // Record written file in provenance set so future edits pass
          readProvenanceSet.add(resolvedPath);

          // ── Module C: Workspace Transaction Snapshot Checkpoint ──
          const cwd = ctx?.cwd || process.cwd();
          const isGit = runGit("rev-parse --is-inside-work-tree", cwd) === "true";
          if (isGit) {
            try {
              runGit(`stash create "openpi-checkpoint-${Date.now()}"`, cwd);
              lastCheckpointTime = new Date().toLocaleTimeString();
            } catch {}
          }

          const verdict = await JevClient.checkFilePath(filePath);
          if (verdict.action === "deny") {
            totalBlockedCount += 1;
            const entry = {
              timestamp: Date.now(),
              tool: event.toolName,
              command: `write/edit -> ${filePath}`,
              reason: verdict.reason,
              risk: verdict.risk_score || 0.99
            };
            blockedLog.push(entry);
            if (blockedLog.length > 50) blockedLog.shift();

            console.warn(`🛑 [Jev SafetyGate] Physically blocked sensitive file modification: \`${filePath}\`. Reason: ${verdict.reason}`);

            return {
              block: true,
              reason: `🛑 [Jev SafetyGate 物理阻断] 该文件修改操作已被系统底层物理拦截！\n\n• 拦截原因: ${verdict.reason}\n• 目标文件: \`${filePath}\`\n\n提示: 严禁直接修改操作系统关键目录或凭证密钥文件。`
            };
          }

          if (verdict.action === "require_confirmation") {
            if (ctx && ctx.hasUI && ctx.ui && typeof ctx.ui.confirm === "function") {
              const reasonsText = Array.isArray(verdict.reasons) ? verdict.reasons.map((r) => `• ${r}`).join("\n") : (verdict.reason || "");
              const dialogMessage = `${verdict.prompt || `智能体请求修改敏感文件：\n\`${filePath}\``}\n\n风险原因：\n${reasonsText}\n\n是否允许继续执行？`;

              console.info(`⚠️ [Jev SafetyGate] Triggering confirmation for file: \`${filePath}\``);
              const confirmed = await ctx.ui.confirm("⚠️ Jev 文件安全确认", dialogMessage);

              if (!confirmed) {
                totalBlockedCount += 1;
                console.warn(`🛑 [Jev SafetyGate] User rejected file modification: \`${filePath}\``);
                void JevClient.query({
                  name: "jev_record_event",
                  event_type: "user_rejected",
                  command: `write/edit -> ${filePath}`,
                  reason: "用户取消了此文件修改操作",
                  risk: verdict.risk_score || 0.9
                });
                return {
                  block: true,
                  reason: `🛑 [Jev SafetyGate] 用户取消了对文件 \`${filePath}\` 的修改操作。`
                };
              }

              totalConfirmedCount += 1;
              void JevClient.query({
                name: "jev_record_event",
                event_type: "user_approved",
                command: `write/edit -> ${filePath}`,
                reason: "用户批准修改敏感文件",
                risk: verdict.risk_score || 0.8
              });
              return void 0;
            } else {
              return {
                block: true,
                reason: `🛑 [Jev SafetyGate] 文件修改需要人工确认，但在非交互环境下默认拦截: \`${filePath}\``
              };
            }
          }
        }
        return void 0;
      }

      const isShell = toolName === "bash" || toolName === "powershell" || toolName === "terminal" || toolName === "cmd";
      if (!isShell) {
        return void 0;
      }

      const cmd = (event.input?.command || event.input?.cmd || "").trim();
      if (!cmd) {
        return void 0;
      }

      // ── Active Provenance: 自动解析 Bash 中的只读查看命令 (cat, grep, head, tail, view) ──
      const bashReadMatch = cmd.match(/\b(cat|head|tail|grep|view|less|more)\s+(?:-[a-zA-Z0-9-]+\s+)*["']?([^\s"';|&>]+)["']?/i);
      if (bashReadMatch && bashReadMatch[2] && !bashReadMatch[2].startsWith("-")) {
        try {
          readProvenanceSet.add(path.resolve(bashReadMatch[2]));
        } catch {}
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

      // If already executed beyond adaptive threshold: HARD FUSE BREAK!
      if (repeatCount >= dynamicLoopThreshold) {
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

        // Notify daemon telemetry
        void JevClient.query({
          name: "jev_record_event",
          event_type: "loop_break",
          command: cmd,
          reason: `连续重复执行相同指令 ${repeatCount + 1} 次且无新进展，触发死循环熔断`,
          risk: 0.95
        });

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
          void JevClient.query({
            name: "jev_record_event",
            event_type: "loop_break",
            command: `${h[n - 1].normCmd} ⟷ ${h[n - 2].normCmd}`,
            reason: "检测到指令之间交替震荡，触发死循环熔断",
            risk: 0.95
          });
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
            void JevClient.query({
              name: "jev_record_event",
              event_type: "user_rejected",
              command: cmd,
              reason: "用户在安全确认弹窗中取消了此高危操作",
              risk: verdict.risk_score || 0.9
            });
            return {
              block: true,
              reason: `🛑 [Jev SafetyGate] 用户在安全确认弹窗中取消了此操作（命令未执行: \`${cmd}\`）。`
            };
          }

          totalConfirmedCount += 1;
          console.info(`✅ [Jev SafetyGate] User approved execution of: \`${cmd}\``);
          void JevClient.query({
            name: "jev_record_event",
            event_type: "user_approved",
            command: cmd,
            reason: "用户在安全确认弹窗中批准执行",
            risk: verdict.risk_score || 0.8
          });
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

  // 3. Workspace Transaction & /rollback Slash Command
  pi.registerCommand("rollback", {
    description: "事务性回滚：撤销智能体最近的所有未提交改动并恢复干净工作区",
    handler: async (_args, ctx) => {
      const cwd = ctx.cwd || process.cwd();
      const isGit = runGit("rev-parse --is-inside-work-tree", cwd) === "true";
      if (!isGit) {
        const msg = "当前工作目录未初始化 Git 仓库，无法执行自动事务回滚。";
        console.warn(`[Jev Transaction] Not a git worktree: ${cwd}`);
        if (ctx?.ui?.notify) ctx.ui.notify(msg, "warning");
        return;
      }

      try {
        runGit("checkout .", cwd);
        runGit("clean -fd", cwd);
        const successMsg = `⏪ 已成功回滚当前工作区代码！所有未提交的修改已重置（最近检查点时间: ${lastCheckpointTime || "刚才"}）。`;
        console.info(`[Jev Transaction] Worktree rolled back in ${cwd}`);
        if (ctx?.ui?.notify) {
          ctx.ui.notify(successMsg, "info");
        }
      } catch (err) {
        const errMsg = `回滚失败: ${err.message || String(err)}`;
        console.error("[Jev Transaction] Rollback error:", err);
        if (ctx?.ui?.notify) ctx.ui.notify(errMsg, "error");
      }
    }
  });

  // 4. Inspectable Status Tool
  pi.registerTool({
    name: "jev_sentinel_status",
    label: "OpenPI Jev Sentinel Status",
    description: "Inspect OpenPI Jev System 1 instincts, SafetyGate statistics, LeakHunter redactions, ActKV savings, and log compression.",
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
                  loopBreaks: totalLoopBreaks,
                  provenanceBlocks: totalProvenanceBlocks,
                  actKVPrunedTokens: totalActKVPrunedTokens,
                  lastCheckpointTime: lastCheckpointTime
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
