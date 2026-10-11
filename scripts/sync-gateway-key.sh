#!/usr/bin/env bash
# 同步 gateway 入站 key 到引擎侧 models.json。
#
# 背景：gateway 开启入站鉴权后，models.json 里所有指向 gateway 的 provider
# 必须把 apiKey 设为 ~/.openpi/gateway-key 的内容，否则全部 401。
# 这个断层没有别的自动化，所以有本脚本：
#   1. key 文件缺失时用 openssl 生成 32 字节随机 key 并创建；
#   2. 权限收紧为 600；
#   3. 找出 models.json 里 baseUrl 含 gateway 端口的 provider，把 apiKey 同步成 key；
#   4. 修改前备份原文件（models.json.bak.key.<时间戳>，与项目现有备份惯例一致）。
#
# 用法：bash scripts/sync-gateway-key.sh [--dry-run]
# 环境变量：OPENPI_GATEWAY_ADDR（默认 127.0.0.1:8788）、OPENPI_GATEWAY_KEY_FILE、
#           OPENPI_AGENT_DIR（默认 ~/.openpi/agent）

set -euo pipefail

DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

KEY_FILE="${OPENPI_GATEWAY_KEY_FILE:-$HOME/.openpi/gateway-key}"
AGENT_DIR="${OPENPI_AGENT_DIR:-$HOME/.openpi/agent}"
MODELS_JSON="$AGENT_DIR/models.json"
ADDR="${OPENPI_GATEWAY_ADDR:-127.0.0.1:8788}"
PORT="${ADDR##*:}"   # 匹配 baseUrl 只按端口，避免 host 写法五花八门

if [[ ! -f "$MODELS_JSON" ]]; then
  echo "错误：找不到 $MODELS_JSON" >&2
  exit 1
fi

# 1+2. 确保 key 存在且权限收紧
if [[ ! -s "$KEY_FILE" ]]; then
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "[dry-run] 将生成新 key 到 $KEY_FILE"
  else
    mkdir -p "$(dirname "$KEY_FILE")"
    if command -v openssl >/dev/null 2>&1; then
      openssl rand -hex 32 > "$KEY_FILE"
    else
      # 无 openssl 时的兜底（macOS/Linux 都有 head/od）
      od -An -tx1 -N32 /dev/urandom | tr -d ' \n' > "$KEY_FILE"
    fi
    chmod 600 "$KEY_FILE"
    echo "已生成新 key：$KEY_FILE"
  fi
else
  MODE=$(stat -f '%Lp' "$KEY_FILE" 2>/dev/null || stat -c '%a' "$KEY_FILE" 2>/dev/null || echo '600')
  if [[ "$MODE" != "600" ]]; then
    if [[ $DRY_RUN -eq 1 ]]; then
      echo "[dry-run] 将把 $KEY_FILE 权限 $MODE 收紧为 600"
    else
      chmod 600 "$KEY_FILE"
      echo "已收紧 $KEY_FILE 权限：$MODE → 600"
    fi
  fi
fi
KEY=$(tr -d '[:space:]' < "$KEY_FILE")
if [[ ${#KEY} -lt 16 ]]; then
  echo "错误：$KEY_FILE 内容过短（${#KEY} 字节，至少 16）" >&2
  exit 1
fi

# 3. 同步 apiKey（用 python3 做 JSON 级修改，不要 sed——见 AGENTS.md 的教训）
export SYNC_KEY="$KEY" SYNC_PORT="$PORT" SYNC_MODELS="$MODELS_JSON" SYNC_DRY="$DRY_RUN"
python3 - <<'PYEOF'
import json, os, sys

models_path = os.environ["SYNC_MODELS"]
key = os.environ["SYNC_KEY"]
port = os.environ["SYNC_PORT"]
dry = os.environ["SYNC_DRY"] == "1"

with open(models_path) as f:
    root = json.load(f)

providers = root.get("providers", {})
touched = []
for name, prov in providers.items():
    base_url = prov.get("baseUrl") or ""
    if f":{port}" not in base_url:
        continue
    if prov.get("apiKey") == key:
        continue
    touched.append(f"{name} ({base_url})")
    prov["apiKey"] = key

if not touched:
    print("models.json 已与 gateway key 一致，无需改动")
    sys.exit(0)

if dry:
    print(f"[dry-run] 将更新 {len(touched)} 个 provider 的 apiKey: {', '.join(touched)}")
    sys.exit(0)

import shutil, time
bak = f"{models_path}.bak.key.{time.strftime('%Y%m%d_%H%M%S')}"
shutil.copy2(models_path, bak)
with open(models_path, "w") as f:
    json.dump(root, f, ensure_ascii=False, indent=2)
    f.write("\n")
print(f"已更新 {len(touched)} 个 provider 的 apiKey（备份：{bak}）:")
for t in touched:
    print(f"  - {t}")
PYEOF
