#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
command -v python3 >/dev/null || { echo "Python 3 is required." >&2; exit 1; }
python3 - <<'PYTHON'
from pathlib import Path
import re
import secrets

p = Path('.')
env = p / '.env'
config = p / 'config.yaml'
if env.exists() and config.exists():
    print('Already initialized; existing keys and config preserved.')
    raise SystemExit(0)
if config.exists():
    raise SystemExit('config.yaml exists without .env; restore the matching .env before initializing.')
if env.is_symlink() or config.is_symlink():
    raise SystemExit('Refusing to initialize through symlinked secret files.')
text = env.read_text() if env.exists() else (p / '.env.example').read_text()
values = {}
for key, prefix in [('CPA_MANAGEMENT_KEY', 'cpa_'), ('CPAMP_ADMIN_KEY', 'cpamp_'), ('CPA_CLIENT_KEY', 'sk-')]:
    matches = re.findall(r'^' + key + r'=(.*)$', text, re.M)
    if len(matches) != 1:
        raise SystemExit(f'Expected exactly one {key}= line in .env.')
    value = matches[0].strip()
    if not value:
        value = prefix + secrets.token_hex(32)
        text = re.sub(r'^' + key + r'=.*$', key + '=' + value, text, flags=re.M)
    if not re.fullmatch(r'[A-Za-z0-9_-]{32,}', value):
        raise SystemExit(f'{key} must contain at least 32 letters, digits, underscores or hyphens.')
    values[key] = value
rendered = (p / 'config.example.yaml').read_text()
for key in ('CPA_MANAGEMENT_KEY', 'CPA_CLIENT_KEY'):
    rendered = rendered.replace('__' + key + '__', values[key])
env.write_text(text)
env.chmod(0o600)
with config.open('x') as f:
    f.write(rendered)
config.chmod(0o600)
print('Initialized .env and config.yaml; secrets are never printed.')
PYTHON
mkdir -p auths data logs plugins
chmod 700 auths data logs plugins
printf '%s\n' 'Start: docker compose up -d --wait'
