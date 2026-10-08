#!/usr/bin/env bash
# Claude Code disables MCP tool search for custom API endpoints by default.
set -euo pipefail

: "${ANTHROPIC_BASE_URL:?Set ANTHROPIC_BASE_URL to your compatible CPA endpoint}"
export ENABLE_TOOL_SEARCH="${ENABLE_TOOL_SEARCH:-true}"
exec claude "$@"
