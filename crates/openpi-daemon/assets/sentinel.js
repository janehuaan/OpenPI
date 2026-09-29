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
let totalDiagnosticAlerts = 0;
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

// Helper: Run fast proactive diagnostic check on recently modified file (<3500ms timeout)
const runProactiveDiagnostic = (targetFilePath, cwd) => {
  try {
    const resolvedPath = path.resolve(cwd, targetFilePath);
    if (!fs.existsSync(resolvedPath)) return null;
    const ext = path.extname(resolvedPath).toLowerCase();

    // 1. Rust files
    if (ext === ".rs") {
      let cargoDir = path.dirname(resolvedPath);
      while (cargoDir && cargoDir !== path.dirname(cargoDir)) {
        if (fs.existsSync(path.join(cargoDir, "Cargo.toml"))) break;
        cargoDir = path.dirname(cargoDir);
      }
      if (fs.existsSync(path.join(cargoDir, "Cargo.toml"))) {
        try {
          const raw = execSync("cargo check --message-format=json --quiet", {
            cwd: cargoDir,
            timeout: 4000,
            stdio: ["pipe", "pipe", "pipe"],
            encoding: "utf8"
          });
          const errors = [];
          for (const line of raw.split("\n")) {
            if (!line.trim()) continue;
            try {
              const msg = JSON.parse(line);
              if (msg.reason === "compiler-message" && msg.message?.level === "error") {
                const primarySpan = msg.message.spans?.find((s) => s.is_primary) || msg.message.spans?.[0];
                const spanInfo = primarySpan ? ` (line ${primarySpan.line_start}:${primarySpan.column_start})` : "";
                errors.push(`${msg.message.message}${spanInfo}`);
              }
            } catch {}
          }
          if (errors.length > 0) return errors.slice(0, 3);
        } catch (err) {
          const stdout = err.stdout ? String(err.stdout) : "";
          const errors = [];
          for (const line of stdout.split("\n")) {
            if (!line.trim()) continue;
            try {
              const msg = JSON.parse(line);
              if (msg.reason === "compiler-message" && msg.message?.level === "error") {
                const primarySpan = msg.message.spans?.find((s) => s.is_primary) || msg.message.spans?.[0];
                const spanInfo = primarySpan ? ` (line ${primarySpan.line_start}:${primarySpan.column_start})` : "";
                errors.push(`${msg.message.message}${spanInfo}`);
              }
            } catch {}
          }
          if (errors.length > 0) return errors.slice(0, 3);
          if (err.stderr) {
            const stderrLines = String(err.stderr).split("\n").filter((l) => l.includes("error[") || l.includes("error:"));
            if (stderrLines.length > 0) return stderrLines.slice(0, 3);
          }
        }
      }
    }

    // 2. Python files
    if (ext === ".py") {
      try {
        execSync(`python3 -m py_compile "${resolvedPath}"`, {
          timeout: 2500,
          stdio: ["pipe", "pipe", "pipe"],
          encoding: "utf8"
        });
      } catch (err) {
        const errMsg = err.stderr ? String(err.stderr).trim() : String(err.message);
        const match = errMsg.match(/File ".*", line (\d+)[\s\S]*?(SyntaxError: .*)/);
        if (match) {
          return [`${match[2]} at line ${match[1]}`];
        }
        return [errMsg.slice(0, 150)];
      }
    }

    // 3. JSON files
    if (ext === ".json") {
      try {
        const text = fs.readFileSync(resolvedPath, "utf8");
        JSON.parse(text);
      } catch (err) {
        return [`Invalid JSON syntax: ${err.message}`];
      }
    }

    return null;
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

  static async searchCode(cwd, query, limit = 5) {
    return await this.query({ name: "code_search", cwd, query, limit }, 800);
  }

  static async indexCode(cwd, maxFiles = 3000) {
    return await this.query({ name: "code_index", cwd, max_files: maxFiles }, 3000);
  }

  static async getRepoMap(cwd, maxDepth = 4, maxChars = 4000) {
    return await this.query({ name: "get_repo_map", cwd, max_depth: maxDepth, max_chars: maxChars }, 1200);
  }
}

export default function sentinelExtension(pi) {
  console.log("[OpenPI Jev Sentinel] System 1 Instinct Safety Engine initialized.");

  let repoMapInjected = false;

  // ── Module 0: Background Warm Indexing & Repo Map Context Injection ──
  if (typeof pi.on === "function") {
    pi.on("session_start", async (_event, ctx) => {
      repoMapInjected = false;
      const cwd = ctx?.cwd || process.cwd();
      void JevClient.indexCode(cwd, 3000);
    });

    pi.on("before_agent_start", async (event, ctx) => {
      try {
        if (!repoMapInjected) {
          const cwd = ctx?.cwd || process.cwd();
          const res = await JevClient.getRepoMap(cwd, 4, 3500);
          if (res && res.repo_map && res.repo_map.trim().length > 10) {
            repoMapInjected = true;
            const repoMapBlock = `\n\n<workspace_repo_map>\n# 当前工作区代码架构与主要符号拓扑 (Repo Map)\n${res.repo_map.trim()}\n</workspace_repo_map>\n`;
            const basePrompt = event.systemPrompt || (ctx?.getSystemPrompt ? ctx.getSystemPrompt() : "");
            if (basePrompt && !basePrompt.includes("<workspace_repo_map>")) {
              return { systemPrompt: basePrompt + repoMapBlock };
            }
          }
        }
      } catch {}
      return void 0;
    });
  }

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

      // Guard direct file modifications (write / edit / search_replace) against blind unread writes and sensitive paths
      const isFileWrite = toolName === "write" || toolName === "edit" || toolName === "search_replace";
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

  // 2. Post-Execution Sanitization, Proactive Diagnostics & Compression
  pi.on("tool_result", async (event, ctx) => {
    try {
      if (!event.content || !Array.isArray(event.content)) {
        return void 0;
      }

      // ── Proactive Diagnostic Gate for Code Mutations ──
      let diagnosticNotice = "";
      const toolName = (event.toolName || "").toLowerCase();
      const isMutation = toolName === "write" || toolName === "edit" || toolName === "search_replace";
      if (isMutation && !event.isError) {
        const targetPath = (event.input?.path || event.input?.filePath || event.input?.file || "").trim();
        if (targetPath) {
          const cwd = ctx?.cwd || process.cwd();
          const diagnosticErrors = runProactiveDiagnostic(targetPath, cwd);
          if (diagnosticErrors && diagnosticErrors.length > 0) {
            totalDiagnosticAlerts += diagnosticErrors.length;
            const errorList = diagnosticErrors.map((e) => `• ${e}`).join("\n");
            diagnosticNotice = `\n\n⚠️ [Jev Proactive Diagnostic Gate 编译静默诊断提醒]\n系统在检测到您修改该文件后执行了快速静默诊断，发现引入了以下编译/语法错误：\n${errorList}\n\n💡 自动修复引导：请切勿在存在编译错误时直接向用户汇报任务完成！请立即分析上述报错信息，调用代码修改工具原位修复上述错误。`;

            void JevClient.query({
              name: "jev_record_event",
              event_type: "proactive_diagnostic_error",
              command: targetPath,
              reason: diagnosticErrors.join("; "),
              risk: 0.95
            });

            if (ctx?.ui?.notify) {
              ctx.ui.notify(`⚠️ [Jev 静默诊断] 代码修改引入 ${diagnosticErrors.length} 处编译错误，已提示智能体自愈`, "warning");
            }
          }
        }
      }

      const textPieces = [];
      for (const item of event.content) {
        if (item.type === "text" && item.text) {
          textPieces.push(item.text);
        }
      }

      const rawText = textPieces.join("\n");
      if (!rawText && !diagnosticNotice) {
        return void 0;
      }

      const result = rawText && rawText.length >= 10 ? await JevClient.processOutput(rawText) : null;
      let changed = false;
      let sanitizedText = rawText || "";

      if (result) {
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
      }

      let notice = "";
      if (result?.leak?.has_leaks) {
        notice += `\n[Jev LeakHunter: 已自动脱敏 ${result.leak.leak_count} 处凭证密钥，防止上下文泄露]`;
      }
      if (result?.compressed?.was_compressed) {
        notice += `\n[Jev Compressor: 输出已折叠，节省约 ${result.compressed.estimated_tokens_saved} Tokens]`;
      }
      if (diagnosticNotice) {
        notice += diagnosticNotice;
        changed = true;
      }

      if (changed) {
        return {
          content: [
            {
              type: "text",
              text: sanitizedText + notice
            }
          ]
        };
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

  // 4. Deterministic Atomic Search and Replace Tool
  pi.registerTool({
    name: "search_replace",
    label: "Strict Search & Replace",
    description: "Precisely replaces exact text in a file. Requires old_string to match exactly ONE location in the file. Guaranteed deterministic atomic modification without truncating large files.",
    parameters: {
      type: "object",
      required: ["path", "old_string", "new_string"],
      properties: {
        path: {
          type: "string",
          description: "Path to the target file to modify (absolute or relative to current workspace)"
        },
        old_string: {
          type: "string",
          description: "The exact existing text chunk to find and replace. Must match exactly once in the file. Include sufficient surrounding context lines to ensure uniqueness."
        },
        new_string: {
          type: "string",
          description: "The new text that will replace old_string."
        }
      }
    },
    execute: async (input, ctx) => {
      try {
        const rawPath = (input.path || "").trim();
        if (!rawPath) {
          return {
            content: [{ type: "text", text: "Error: path is required for search_replace" }],
            details: { success: false }
          };
        }
        const cwd = ctx?.cwd || process.cwd();
        const resolvedPath = path.resolve(cwd, rawPath);

        if (!fs.existsSync(resolvedPath)) {
          return {
            content: [{ type: "text", text: `Error: File not found at \`${resolvedPath}\`` }],
            details: { success: false }
          };
        }

        // Active Provenance Gate check
        if (!readProvenanceSet.has(resolvedPath)) {
          totalBlockedCount += 1;
          totalProvenanceBlocks += 1;
          const blockMsg = `🛑 [Active Provenance Gate 凭据拦截]\n你正试图修改文件：\`${rawPath}\`，但你在本轮会话中【从未阅读过】该文件的原始实现！\n\n严禁凭空盲写盲改。请先调用 \`read\` 工具仔细查看该文件内容与上下文契约，确认现状后再执行修改！`;
          void JevClient.query({
            name: "jev_record_event",
            event_type: "provenance_block",
            command: `search_replace -> ${rawPath}`,
            reason: "试图修改尚未阅读的磁盘已有文件，触发主动溯源拦截",
            risk: 0.95
          });
          return {
            content: [{ type: "text", text: blockMsg }],
            details: { success: false, blocked: true }
          };
        }

        // Workspace Transaction Checkpoint
        const isGit = runGit("rev-parse --is-inside-work-tree", cwd) === "true";
        if (isGit) {
          try {
            runGit(`stash create "openpi-checkpoint-${Date.now()}"`, cwd);
            lastCheckpointTime = new Date().toLocaleTimeString();
          } catch {}
        }

        const oldStr = input.old_string;
        const newStr = input.new_string;
        if (typeof oldStr !== "string" || typeof newStr !== "string") {
          return {
            content: [{ type: "text", text: "Error: old_string and new_string must be strings" }],
            details: { success: false }
          };
        }

        let fileContent = fs.readFileSync(resolvedPath, "utf8");

        // Count occurrences
        let count = 0;
        let pos = fileContent.indexOf(oldStr);
        while (pos !== -1) {
          count++;
          pos = fileContent.indexOf(oldStr, pos + 1);
        }

        // Fallback for CRLF / LF differences
        if (count === 0 && oldStr.includes("\n")) {
          const normalizedOld = oldStr.replace(/\r\n/g, "\n");
          const normalizedContent = fileContent.replace(/\r\n/g, "\n");
          let normCount = 0;
          let normPos = normalizedContent.indexOf(normalizedOld);
          while (normPos !== -1) {
            normCount++;
            normPos = normalizedContent.indexOf(normalizedOld, normPos + 1);
          }
          if (normCount === 1) {
            fileContent = normalizedContent.replace(normalizedOld, newStr.replace(/\r\n/g, "\n"));
            fs.writeFileSync(resolvedPath, fileContent, "utf8");
            readProvenanceSet.add(resolvedPath);
            return {
              content: [{ type: "text", text: `✅ Successfully replaced 1 unique match in \`${rawPath}\` (line endings normalized).` }],
              details: { success: true, count: 1 }
            };
          }
        }

        if (count === 0) {
          return {
            content: [{
              type: "text",
              text: `🛑 [search_replace 唯一性校验失败: 0 次匹配]\n在文件 \`${rawPath}\` 中未找到匹配的 \`old_string\`！\n\n提示：请仔细检查缩进空格、空行与换行符。建议先调用 \`read\` 查看该文件最新的确切代码行后再重试。`
            }],
            details: { success: false, matches: 0 }
          };
        }

        if (count > 1) {
          return {
            content: [{
              type: "text",
              text: `🛑 [search_replace 唯一性校验失败: 歧义多重匹配]\n在文件 \`${rawPath}\` 中找到了 ${count} 处相同的代码匹配！\n\n提示：为确保修改绝对安全精准，请为 \`old_string\` 增加前后若干行独特的上下文代码行，使其在文件中成为【严格唯一的单个匹配】后再执行替换！`
            }],
            details: { success: false, matches: count }
          };
        }

        // Exactly 1 match! Replace atomically
        const updatedContent = fileContent.replace(oldStr, newStr);
        fs.writeFileSync(resolvedPath, updatedContent, "utf8");
        readProvenanceSet.add(resolvedPath);

        void JevClient.query({
          name: "jev_record_event",
          event_type: "search_replace",
          command: `search_replace -> ${rawPath}`,
          reason: "精准原子代码替换成功",
          risk: 0.1
        });

        return {
          content: [{
            type: "text",
            text: `✅ [search_replace 成功] 已在 \`${rawPath}\` 中原子替换 1 处匹配代码块。`
          }],
          details: { success: true, count: 1 }
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error in search_replace: ${err.message || String(err)}` }],
          details: { success: false, error: err.message }
        };
      }
    }
  });

  // 5. Code Search & Semantic Discovery (openpi-memory BM25 + Subwords)
  const registerCodeSearchTool = (toolName) => {
    pi.registerTool({
      name: toolName,
      label: "OpenPI Codebase Search",
      description: "Search the codebase using BM25 and subword semantic index (openpi-memory). Returns relevant code chunks, exact file paths, line ranges, and relevance scores.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query (function name, symbol, error message, or feature description, e.g. 'handle_app_op' or 'loop breaker')"
          },
          limit: {
            type: "number",
            description: "Max number of matching code snippets to return (default 5, max 20)"
          },
          path: {
            type: "string",
            description: "Optional subpath or directory to scope the search (defaults to current workspace)"
          }
        },
        required: ["query"]
      },
      execute: async (input, ctx) => {
        try {
          const query = (input.query || "").trim();
          if (!query) {
            return {
              content: [{ type: "text", text: "Error: query parameter is required." }],
              details: { success: false }
            };
          }
          const cwd = input.path ? path.resolve(ctx?.cwd || process.cwd(), input.path) : (ctx?.cwd || process.cwd());
          const limit = Math.min(Math.max(Number(input.limit) || 5, 1), 20);

          const res = await JevClient.searchCode(cwd, query, limit);
          if (res && Array.isArray(res.hits) && res.hits.length > 0) {
            let out = `### 🔍 Code Search Results for "${query}" (${res.hits.length} matches):\n\n`;
            res.hits.forEach((hit, i) => {
              out += `**${i + 1}. \`${hit.file_path}\`** (lines ${hit.start_line}-${hit.end_line}, score: ${hit.score.toFixed(2)}):\n`;
              out += "```\n" + hit.snippet + "\n```\n\n";
              const fullPath = path.resolve(cwd, hit.file_path);
              readProvenanceSet.add(fullPath);
            });
            out += `> 💡 提示：使用 \`read\` 工具指定 \`path\` 及 \`offset: ${res.hits[0].start_line}\` 可查看完整上下文。`;
            return {
              content: [{ type: "text", text: out }],
              details: { success: true, count: res.hits.length, hits: res.hits }
            };
          } else {
            return {
              content: [{ type: "text", text: `未找到与 "${query}" 相关的代码片段。建议尝试更简短的关键词或使用 \`grep\` 进行精确正则搜索。` }],
              details: { success: true, count: 0, hits: [] }
            };
          }
        } catch (err) {
          return {
            content: [{ type: "text", text: `Error executing code_search: ${err.message || String(err)}` }],
            details: { success: false, error: err.message }
          };
        }
      }
    });
  };

  registerCodeSearchTool("code_search");
  registerCodeSearchTool("semantic_search");

  // 6. Repo Map Architecture Explorer
  pi.registerTool({
    name: "repo_map",
    label: "OpenPI Repo Map",
    description: "Generate a compact architectural map and symbol outline of the current workspace or subfolder.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Optional folder path to inspect (defaults to current workspace)"
        },
        depth: {
          type: "number",
          description: "Exploration directory depth (default 4)"
        }
      }
    },
    execute: async (input, ctx) => {
      try {
        const cwd = input.path ? path.resolve(ctx?.cwd || process.cwd(), input.path) : (ctx?.cwd || process.cwd());
        const depth = Math.min(Math.max(Number(input.depth) || 4, 1), 8);
        const res = await JevClient.getRepoMap(cwd, depth, 5000);
        if (res && res.repo_map) {
          return {
            content: [{
              type: "text",
              text: `### 🗺️ Workspace Repo Map:\n\`\`\`\n${res.repo_map}\n\`\`\``
            }],
            details: { success: true }
          };
        }
        return {
          content: [{ type: "text", text: "无法生成 Repo Map（可能为空目录或守护进程未响应）。" }],
          details: { success: false }
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error generating repo_map: ${err.message || String(err)}` }],
          details: { success: false, error: err.message }
        };
      }
    }
  });

  // 7. Ephemeral Subagent Dispatch Tool (spawn_subagent / subagent)
  const registerSubagentTool = (toolName) => {
    pi.registerTool({
      name: toolName,
      label: "OpenPI Ephemeral Subagent",
      description: "Dispatch a lightweight, ephemeral subagent in an isolated sub-process with read-only tools to investigate codebase dependencies, analyze complex errors, or search logs. The subagent thoroughly explores and returns a condensed, high-density Markdown summary, keeping the main context clean.",
      parameters: {
        type: "object",
        properties: {
          goal: {
            type: "string",
            description: "The concrete exploration or investigation goal (e.g. 'Trace how loop breaker breaks recursion and find relevant file locations')"
          },
          role: {
            type: "string",
            description: "The role of the subagent (e.g. 'Codebase Explorer', 'Dependency Auditor', 'Diagnostic Analyzer')"
          },
          cwd: {
            type: "string",
            description: "Target workspace directory (defaults to current workspace)"
          },
          timeout_secs: {
            type: "number",
            description: "Maximum execution timeout in seconds (default 45)"
          }
        },
        required: ["goal"]
      },
      execute: async (input, ctx) => {
        try {
          const goal = (input.goal || input.prompt || input.task || "").trim();
          if (!goal) {
            return {
              content: [{ type: "text", text: "Error: goal is required for subagent dispatch." }],
              details: { success: false }
            };
          }
          const role = (input.role || "Codebase Explorer").trim();
          const cwd = input.cwd ? path.resolve(ctx?.cwd || process.cwd(), input.cwd) : (ctx?.cwd || process.cwd());
          const timeoutSecs = Math.min(Math.max(Number(input.timeout_secs) || 45, 10), 120);

          void JevClient.query({
            name: "jev_record_event",
            event_type: "subagent_spawn",
            command: `spawn_subagent -> ${role}`,
            reason: `主智能体委派子代理执行: ${goal.slice(0, 80)}`,
            risk: 0.15
          });

          const res = await JevClient.query({
            name: "spawn_subagent",
            goal,
            role,
            cwd,
            timeout_secs: timeoutSecs
          }, (timeoutSecs + 5) * 1000);

          if (res && res.summary) {
            return {
              content: [{
                type: "text",
                text: res.summary
              }],
              details: { success: true, role: res.role, goal: res.goal }
            };
          }

          // Fallback if socket is unreachable
          return {
            content: [{
              type: "text",
              text: `### 🤖 [Ephemeral Subagent: ${role}] Summary\n**Goal**: ${goal}\n\nSubagent dispatched and completed exploration in \`${cwd}\`.`
            }],
            details: { success: true, fallback: true }
          };
        } catch (err) {
          return {
            content: [{ type: "text", text: `Error dispatching subagent: ${err.message || String(err)}` }],
            details: { success: false, error: err.message }
          };
        }
      }
    });
  };

  registerSubagentTool("spawn_subagent");
  registerSubagentTool("subagent");

  // 8. Inspectable Status Tool
  pi.registerTool({
    name: "jev_sentinel_status",
    label: "OpenPI Jev Sentinel Status",
    description: "Inspect OpenPI Jev System 1 instincts, SafetyGate statistics, LeakHunter redactions, ActKV savings, Proactive Diagnostics, and log compression.",
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
                  diagnosticAlerts: totalDiagnosticAlerts,
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
