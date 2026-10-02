#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose config --quiet
python3 - <<'PYTHON'
import json
import subprocess
import urllib.error
import urllib.request

cfg = json.loads(subprocess.check_output(['docker', 'compose', 'config', '--format', 'json']))
services = cfg['services']
manager = services['cpa-manager-plus']
cpa = services['cli-proxy-api']
for service in services:
    container = subprocess.check_output(['docker', 'compose', 'ps', '-q', service], text=True).strip()
    if not container:
        raise SystemExit(f'{service}: not running')
    state = json.loads(subprocess.check_output(['docker', 'inspect', container]))[0]['State']
    assert state['Health']['Status'] == 'healthy', f'{service}: unhealthy'
    print(f'{service}: healthy')

def base(service, target):
    port = next(p for p in service['ports'] if p['target'] == target)
    host = port.get('host_ip', '127.0.0.1')
    if host == '0.0.0.0':
        host = '127.0.0.1'
    return f"http://{host}:{port['published']}"

def get(url, key=None):
    request = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + key} if key else {})
    return urllib.request.urlopen(request, timeout=10)

url = base(manager, 18317)
key = manager['environment']['CPA_MANAGER_ADMIN_KEY']
with get(url + '/health') as response:
    assert json.load(response)['ok']
with get(url + '/management.html') as response:
    assert response.status == 200 and b'<html' in response.read().lower()
print('Manager health and UI: HTTP 200')
with get(url + '/status', key) as response:
    status = json.load(response)
collector = status['collector']
assert collector['collector'] == 'running' and not collector.get('lastError'), collector
assert collector['upstream'] == 'http://cli-proxy-api:8317'
assert collector['transport'] == 'http'
print('Collector: running, HTTP transport, CPA upstream connected')
with get(url + '/v0/management/auth-files', key) as response:
    assert isinstance(json.load(response)['files'], list)
print('Authenticated Manager -> CPA proxy: HTTP 200')
for endpoint in [url + '/status', base(cpa, 8317) + '/v1/models']:
    try:
        get(endpoint)
    except urllib.error.HTTPError as error:
        assert error.code == 401, error.code
    else:
        raise SystemExit('FAIL: unauthenticated protected endpoint succeeded')
print('Unauthenticated manager and inference requests: HTTP 401')
PYTHON
