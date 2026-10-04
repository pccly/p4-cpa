#!/usr/bin/env python3
"""Render per-user LaunchAgents; install only with explicit --install."""
import argparse
import os
from pathlib import Path
import plistlib
import subprocess

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--install', action='store_true', help='load jobs on this Mac')
parser.add_argument('--auto-deploy', action='store_true', help='also install the CI-gated main polling job')
parser.add_argument('--runtime', choices=['orbstack', 'colima', 'existing'], default='orbstack')
args = parser.parse_args()
os.umask(0o077)
home = Path.home()
logs = home / 'Library/Logs/p4-cpa'
output = home / 'Library/LaunchAgents' if args.install else root / '.artifacts/launchd'
context = subprocess.check_output(['docker', 'context', 'show'], text=True).strip()
values = {'__REPO__': str(root), '__HOME__': str(home), '__LOGS__': str(logs),
          '__CONTEXT__': context, '__RUNTIME__': args.runtime,
          '__PATH__': os.environ['PATH']}


def replace(value):
    if isinstance(value, str):
        for key, text in values.items():
            value = value.replace(key, text)
    elif isinstance(value, dict):
        value = {k: replace(v) for k, v in value.items()}
    elif isinstance(value, list):
        value = [replace(v) for v in value]
    return value


output.mkdir(parents=True, exist_ok=True)
if args.install:
    logs.mkdir(parents=True, exist_ok=True, mode=0o700)
for template in sorted((root / 'launchd').glob('*.plist')):
    if template.name.endswith('.autodeploy.plist') and not args.auto_deploy:
        continue
    data = replace(plistlib.loads(template.read_bytes()))
    if data['Label'].endswith(('.backup', '.autodeploy')):
        for key in ('BACKUP_DIR', 'BACKUP_KEEP'):
            if key in os.environ:
                data['EnvironmentVariables'][key] = os.environ[key]
    if data['Label'].endswith('.autodeploy'):
        data['EnvironmentVariables']['BACKUP_KEEP'] = '0'
    target = output / template.name
    encoded = plistlib.dumps(data)
    changed = not target.exists() or target.read_bytes() != encoded
    label = data['Label']
    domain = f'gui/{os.getuid()}'
    if args.install:
        loaded = subprocess.run(['launchctl', 'print', f'{domain}/{label}'],
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
        if loaded and not changed:
            print(f'Already loaded: {label}')
            continue
        if loaded:
            subprocess.run(['launchctl', 'bootout', f'{domain}/{label}'], check=True)
    target.write_bytes(encoded)
    target.chmod(0o600)
    subprocess.run(['plutil', '-lint', str(target)], check=True)
    if args.install:
        subprocess.run(['launchctl', 'bootstrap', domain, str(target)], check=True)
    print(f'{"Installed" if args.install else "Rendered only"}: {target}')
