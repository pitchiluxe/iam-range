#!/usr/bin/env bash
# Verify a local Ollama instance is answering before anything else is built.
# Exit 0 with the verification line on success; exit 1 with start-up
# instructions for this platform on failure, so callers halt.
set -euo pipefail

ENDPOINT="${1:-${OLLAMA_ENDPOINT:-http://localhost:11434}}"
TAGS="${ENDPOINT%/}/api/tags"

if resp="$(curl -fsS --max-time 5 "$TAGS" 2>/dev/null)"; then
  echo "OLLAMA LOCAL INSTANCE VERIFIED: Training Instructor Integrated."
  models="$(printf '%s' "$resp" | grep -o '"name":"[^"]*"' | cut -d'"' -f4 | paste -sd ', ' - || true)"
  echo "Installed models: ${models:-(none - run: ollama pull llama3)}"
  exit 0
fi

echo "OLLAMA LOCAL INSTANCE NOT REACHABLE: Lab build halted."
echo "Could not reach $TAGS"
echo
case "$(uname -s)" in
  Darwin)
    cat <<'EOF'
Start Ollama on macOS:
  1. If it is not installed: brew install ollama   (or the app from https://ollama.com/download/mac)
  2. Start it: open the Ollama app, or run:  brew services start ollama   (or: ollama serve)
  3. Pull a model:  ollama pull llama3
  4. Confirm:       curl -s http://localhost:11434/api/tags
  5. Re-run this lab build.
EOF
    ;;
  *)
    cat <<'EOF'
Start Ollama on Linux:
  1. If it is not installed: curl -fsSL https://ollama.com/install.sh | sh
  2. Start the service:      sudo systemctl enable --now ollama
     (no systemd: run  ollama serve  in another terminal)
  3. Pull a model:           ollama pull llama3
  4. Confirm:                curl -s http://localhost:11434/api/tags
  5. Re-run this lab build.
(On Windows, use Test-OllamaInstructor.ps1 instead.)
EOF
    ;;
esac
exit 1
