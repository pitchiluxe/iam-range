#!/usr/bin/env bash
# Build the IAM-Portfolio-Labs workspace after verifying local Ollama.
# Usage: ./new-iam-portfolio-workspace.sh [parent-dir] [--force]
# Safe to re-run: README.md files are never overwritten; config.json only with --force.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${1:-$HOME/Documents}"
FORCE="${2:-}"

# 1. Ollama verification pre-check (halts on failure)
if ! "$HERE/test-ollama-instructor.sh"; then
  echo
  echo "Workspace NOT created. Start Ollama as shown above, then re-run this script."
  exit 1
fi

# 2. File tree
WS="$ROOT/IAM-Portfolio-Labs"
FOLDERS=(
  00-Organization-Setup 01-JML-Pipeline 02-RBAC-Matrix 03-Access-Reviews
  04-Stale-Accounts 05-Enterprise-SSO 06-Conditional-Access 07-OIDC-AuthPortal
  08-JIT-Privilege-Escalation 09-Cross-Account-AWS 10-SIEM-LogAuditing
)
mkdir -p "$WS"
for f in "${FOLDERS[@]}"; do
  mkdir -p "$WS/$f/scripts"
  [ -e "$WS/$f/README.md" ] || : > "$WS/$f/README.md"
  echo "  $f/  (README.md, scripts/)"
done

# 3. Instructor configuration
mkdir -p "$WS/.ollama-instructor"
if [ "$FORCE" = "--force" ] || [ ! -e "$WS/.ollama-instructor/config.json" ]; then
  cp "$HERE/ollama-instructor.config.json" "$WS/.ollama-instructor/config.json"
  # system-prompt.txt: the "systemPrompt" lines, one per line.
  python3 - "$HERE/ollama-instructor.config.json" "$WS/.ollama-instructor/system-prompt.txt" <<'PY' 2>/dev/null || true
import json, sys
cfg = json.load(open(sys.argv[1], encoding="utf-8"))
open(sys.argv[2], "w", encoding="utf-8").write("\n".join(cfg["systemPrompt"]) + "\n")
PY
  echo "  .ollama-instructor/config.json"
else
  echo "  .ollama-instructor/config.json  (kept; use --force to refresh)"
fi

echo
echo "Workspace ready: $WS"
