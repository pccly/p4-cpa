#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export GIT_TERMINAL_PROMPT=0
export GH_PROMPT_DISABLED=1
exec python3 scripts/auto_deploy.py
