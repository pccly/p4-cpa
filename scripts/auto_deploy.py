#!/usr/bin/env python3
"""Poll main, require its CI result, and deploy under the existing operations lock."""
import datetime
import json
import os
from pathlib import Path

import ops

REPO = 'pccly/p4-cpa'
WORKFLOW = 'validate.yml'


def ci_passed(revision):
    runs = json.loads(ops.run(
        'gh', 'api', f'repos/{REPO}/actions/workflows/{WORKFLOW}/runs?'
        f'head_sha={revision}&event=push&branch=main&per_page=1', capture=True, timeout=30
    ))['workflow_runs']
    return bool(runs and runs[0]['head_sha'] == revision and
                runs[0]['status'] == 'completed' and runs[0]['conclusion'] == 'success')


def write_state(path, **values):
    values['updatedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(values, indent=2) + '\n')
    temporary.replace(path)


def deploy():
    state_path = ops.ROOT / '.artifacts/deployment.json'
    state = json.loads(state_path.read_text()) if state_path.exists() else {}
    if state.get('status') in ('deploying', 'failed') and os.environ.get('P4_CPA_DEPLOY_RETRY') != '1':
        raise ValueError('Automatic deployment paused. Inspect .artifacts/deployment.json and logs; '
                         'run P4_CPA_DEPLOY_RETRY=1 scripts/auto-deploy.sh after resolving the failure.')
    if ops.run('git', 'status', '--porcelain', capture=True).strip():
        raise ValueError('Deployment checkout has local changes; refusing to overwrite them.')
    if ops.run('git', 'branch', '--show-current', capture=True).strip() != 'main':
        raise ValueError('Automatic deployment requires the main branch.')
    ops.run('git', 'fetch', 'origin', 'main', timeout=120)
    target = ops.run('git', 'rev-parse', 'origin/main', capture=True).strip()
    current = ops.run('git', 'rev-parse', 'HEAD', capture=True).strip()
    # Checking reachability also rejects a local main ahead of the remote.
    ops.run('git', 'merge-base', '--is-ancestor', current, target)
    if state.get('status') == 'healthy' and state.get('revision') == target:
        print(f'Already deployed: {target}', flush=True)
        return
    if not ci_passed(target):
        print(f'Waiting for successful {WORKFLOW} on {target}', flush=True)
        return
    running = set(ops.compose('ps', '--status', 'running', '--services', capture=True).split())
    if not {'cli-proxy-api', 'cpa-manager-plus'} <= running:
        raise ValueError('Deployment requires a running primary stack; not starting a standby.')
    # Automatic runs retain backups. Pruning is a separate, deliberate operation.
    os.environ['BACKUP_KEEP'] = '0'
    backup_root = Path(os.environ.get('BACKUP_DIR', str(Path.home() / 'Backups/p4-cpa'))).expanduser()
    os.environ['BACKUP_DIR'] = str(backup_root / 'deployments')
    previous = state.get('previous', current) if state.get('status') in ('failed', 'deploying') else state.get('revision', current)
    archive = state.get('backup') if state.get('status') in ('failed', 'deploying') else None
    write_state(state_path, status='deploying', revision=target, previous=previous, backup=archive)

    def backup_created(path):
        nonlocal archive
        archive = archive or str(path)
        write_state(state_path, status='deploying', revision=target, previous=previous, backup=archive)

    try:
        ops.backup(on_created=backup_created)
        ops.run('git', 'merge', '--ff-only', target)
        os.environ['P4_CPA_SOURCE_COMMIT'] = target
        os.environ['CPA_BUILD_DATE'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        ops.compose('build')
        ops.compose('up', '-d', '--wait', '--wait-timeout', '120')
        ops.run(str(ops.ROOT / 'scripts/verify.sh'))
        for service in ('cli-proxy-api', 'cpa-manager-plus'):
            container = ops.compose('ps', '-q', service, capture=True).strip()
            revision = ops.run('docker', 'inspect', '--format',
                               '{{index .Config.Labels "org.opencontainers.image.revision"}}',
                               container, capture=True).strip()
            if revision != target:
                raise ValueError(f'{service}: deployed revision does not match {target}')
        write_state(state_path, status='healthy', revision=target, previous=previous, backup=str(archive))
        print(f'Deployed and verified: {target}', flush=True)
    except BaseException:
        write_state(state_path, status='failed', revision=target, previous=previous, backup=str(archive) if archive else None)
        raise


if __name__ == '__main__':
    ops.main(deploy)
