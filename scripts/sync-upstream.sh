#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ $# != 2 ]]; then
  echo "Usage: $0 cpa|manager <tag-or-branch>" >&2
  exit 1
fi
case "$1" in
  cpa) remote=cpa-upstream; url=https://github.com/router-for-me/CLIProxyAPI.git ;;
  manager) remote=manager-upstream; url=https://github.com/seakee/CPA-Manager-Plus.git ;;
  *) echo "Choose cpa or manager." >&2; exit 1 ;;
esac
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Commit or stash work before syncing upstream." >&2
  exit 1
fi
if git remote get-url "$remote" >/dev/null 2>&1; then
  [[ "$(git remote get-url "$remote")" == "$url" ]] || {
    echo "Unexpected URL for $remote; inspect it before syncing." >&2; exit 1;
  }
else
  git remote add "$remote" "$url"
fi
git subtree pull --prefix="$1" "$remote" "$2" -m "chore($1): sync upstream $2"
