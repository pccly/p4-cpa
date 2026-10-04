#!/usr/bin/env python3
"""Serialized host operations for this checkout's Compose project."""
import datetime
import fcntl
import io
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import tarfile
import uuid

ROOT = Path(__file__).resolve().parent.parent
os.chdir(ROOT)
os.umask(0o077)


def run(*args, capture=False, timeout=None):
    return subprocess.run(args, check=True, text=True,
                          stdout=subprocess.PIPE if capture else None,
                          timeout=timeout).stdout


def compose(*args, **kwargs):
    return run('docker', 'compose', *args, **kwargs)


def backup(on_created=None):
    destination = Path(os.environ.get('BACKUP_DIR', str(Path.home() / 'Backups/p4-cpa'))).expanduser().resolve()
    if destination == ROOT or ROOT in destination.parents:
        raise ValueError('BACKUP_DIR must be outside the repository.')
    keep = int(os.environ.get('BACKUP_KEEP', '14'))
    if keep < 0:
        raise ValueError('BACKUP_KEEP must be nonnegative; 0 retains all archives.')
    paths = ['.env', 'config.yaml', 'auths', 'data', 'plugins']
    for name in paths:
        if not (ROOT / name).exists() or (ROOT / name).is_symlink():
            raise ValueError(f'{name} must exist locally and must not be a symlink.')
    if not (ROOT / 'data/data.key').is_file() or not (ROOT / 'data/usage.sqlite').is_file():
        raise ValueError('Start the stack once to create SQLite and data.key before backing up.')
    compose('config', '--quiet')
    revision = run('git', 'rev-parse', 'HEAD', capture=True).strip()
    running = compose('ps', '--status', 'running', '--services', capture=True).split()
    destination.mkdir(parents=True, exist_ok=True, mode=0o700)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    archive = destination / f'p4-cpa-{stamp}-{uuid.uuid4().hex[:8]}.tar.gz'
    partial = archive.with_suffix('.partial')
    try:
        if running:
            compose('stop', '--timeout', '30', *running)
        # Docker stop has completed, so SQLite and auth files are now quiescent.
        with partial.open('xb') as output:
            os.chmod(partial, 0o600)
            with tarfile.open(fileobj=output, mode='w:gz') as tar:
                for name in paths:
                    tar.add(ROOT / name, arcname=name)
                metadata = json.dumps({'commit': revision, 'createdAt': stamp}).encode()
                info = tarfile.TarInfo('p4-cpa-backup.json')
                info.size, info.mode = len(metadata), 0o600
                tar.addfile(info, io.BytesIO(metadata))
        os.replace(partial, archive)
        if on_created:
            on_created(archive)
    finally:
        # Restore only services that were running, including after an archive failure.
        if running:
            compose('start', '--wait', '--wait-timeout', '120', *running)
    print(f'Backup: {archive}', flush=True)
    # Prune only this script's completed archives, after a successful backup/restart.
    pattern = re.compile(r'p4-cpa-\d{8}T\d{6}Z-[0-9a-f]{8}\.tar\.gz')
    archives = sorted((p for p in destination.iterdir()
                       if pattern.fullmatch(p.name) and p.is_file() and not p.is_symlink()),
                      key=lambda p: p.stat().st_mtime_ns, reverse=True)
    for old in archives[keep:] if keep else []:
        old.unlink()
        print(f'Pruned: {old.name}', flush=True)
    return archive


def upgrade():
    if run('git', 'status', '--porcelain', capture=True).strip():
        raise ValueError('Commit or stash changes before upgrading.')
    previous = run('git', 'rev-parse', 'HEAD', capture=True).strip()
    archive = backup()
    print(f'Previous commit: {previous}', flush=True)
    try:
        run('git', 'pull', '--ff-only', 'origin', 'main')
        compose('build')
        compose('up', '-d', '--wait', '--wait-timeout', '120')
        run(str(ROOT / 'scripts/verify.sh'))
    except BaseException:
        print(f'Upgrade failed. Previous commit: {previous}; backup: {archive}.\n'
              'See docs/hosting.md for manual rollback. No automatic data restore was attempted.',
              file=sys.stderr)
        raise


def start():
    runtime = os.environ.get('P4_CPA_RUNTIME', 'orbstack')
    if runtime == 'orbstack':
        run('orb', 'start', timeout=120)
    elif runtime == 'colima':
        run('colima', 'start', timeout=180)
    elif runtime != 'existing':
        raise ValueError('P4_CPA_RUNTIME must be orbstack, colima, or existing.')
    run('docker', 'info', timeout=30, capture=True)
    compose('up', '-d', '--no-build', '--wait', '--wait-timeout', '120')


def interrupted(_signum, _frame):
    raise KeyboardInterrupt


def main(operation):
    try:
        signal.signal(signal.SIGTERM, interrupted)
        (ROOT / '.artifacts').mkdir(exist_ok=True)
        with (ROOT / '.artifacts/operations.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            operation()
    except BlockingIOError:
        sys.exit('Another p4-cpa operation is running in this checkout.')
    except (ValueError, OSError, subprocess.SubprocessError, KeyboardInterrupt) as error:
        sys.exit(f'Operation failed: {error}')


if __name__ == '__main__':
    if len(sys.argv) != 2 or sys.argv[1] not in ('backup', 'upgrade', 'start'):
        sys.exit('Usage: ops.py backup|upgrade|start')
    main({'backup': backup, 'upgrade': upgrade, 'start': start}[sys.argv[1]])
