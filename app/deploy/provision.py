"""Scoped prototype deployment. Run as root with an attested archive; activate separately.

Only this application's OS user/database/units and its Caddy domain snippet are changed.
The existing website and other VPS services are never removed or restarted.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import subprocess
import tarfile
import time
import urllib.request

BASE = Path('/srv/darkwhispers-app')
USER = 'darkwhispers_app'
SITE = Path('/etc/caddy/darkwhispers.caddy')
UNITS = ('darkwhispers-app-api', 'darkwhispers-app-worker')

def run(*args, **kwargs):
    return subprocess.run(args, check=True, text=True, capture_output=True, **kwargs).stdout.strip()

def snapshot():
    units = [line.split()[0] for line in run('systemctl', 'list-units', '--type=service', '--state=running', '--plain', '--no-legend', '--no-pager').splitlines()]
    return {u: run('systemctl', 'show', u, '--property=MainPID,ActiveState,SubState') for u in units if not u.startswith('darkwhispers-app-')}

def http(path, body=None):
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request('http://127.0.0.1:3210' + path, data=data, headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.load(response)

def smoke():
    for attempt in range(25):
        try:
            assert http('/healthz')['application'] == 'darkwhispers-app'
            break
        except Exception:
            if attempt == 24:
                raise
            time.sleep(1)
    results = []
    for mode, boss, count in [('all', None, 12), ('wipes', 3420, 3), ('kills', 3420, 1)]:
        job = http('/api/analyses', {'reportCode':'demo', 'demo':True, 'selection':{'encounterId':boss, 'difficulty':5, 'mode':mode, 'fightIds':None, 'excludeWipeTail':False}})
        for attempt in range(30):
            result = http('/api/analyses/' + job['id'])
            if result['status'] == 'complete':
                assert result['result']['summary']['pulls'] == count
                assert result['result']['report']['source'] == 'demo'
                assert len(result['result']['players']) == 20
                results.append({'mode':mode, 'boss':boss, 'pulls':count, 'players':20, 'job':job['id']})
                break
            if result['status'] == 'failed':
                raise RuntimeError('Database-backed demo worker failed')
            time.sleep(1)
        else:
            raise RuntimeError('Database-backed demo job timed out')
    return results

def install(archive, sha, release_id):
    assert re.fullmatch(r'[a-f0-9]{40}', release_id), 'Use a full source commit ID'
    assert hashlib.sha256(archive.read_bytes()).hexdigest() == sha, 'Archive digest mismatch'
    BASE.mkdir(exist_ok=True, mode=0o755)
    state = BASE / 'deployment-state'
    state.mkdir(exist_ok=True, mode=0o700)
    before = snapshot()
    (state / 'services-before.json').write_text(json.dumps(before, indent=2))
    if not (BASE / 'current').exists():
        assert not re.search(r':3210\s', run('ss', '-ltnH')), 'Loopback port 3210 is already occupied'
    try:
        pwd.getpwnam(USER)
    except KeyError:
        run('useradd', '--system', '--home-dir', str(BASE), '--shell', '/usr/sbin/nologin', USER)
    role = run('runuser', '-u', 'postgres', '--', 'psql', '-Atc', "SELECT rolname FROM pg_roles WHERE rolname='darkwhispers_app'")
    if not role:
        run('runuser', '-u', 'postgres', '--', 'psql', '-v', 'ON_ERROR_STOP=1', '-c', 'CREATE ROLE darkwhispers_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE')
    database = run('runuser', '-u', 'postgres', '--', 'psql', '-Atc', "SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname='darkwhispers_app'")
    if not database:
        run('runuser', '-u', 'postgres', '--', 'createdb', '--owner=darkwhispers_app', 'darkwhispers_app')
    else:
        assert database == USER, 'Existing database is not owned by this application'
    release = BASE / 'releases' / release_id
    assert not release.exists(), 'Do not overwrite an existing release'
    release.mkdir(parents=True, mode=0o755)
    with tarfile.open(archive) as tar:
        for member in tar.getmembers():
            assert member.isfile() or member.isdir(), 'Only regular files and directories are allowed'
            assert (release / member.name).resolve().is_relative_to(release.resolve()), 'Unsafe archive path'
            assert not any(part.startswith('.env') for part in Path(member.name).parts), 'Environment files must never be packaged'
        tar.extractall(release, filter='data')
    run('npm', 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--cache', str(BASE / 'npm-cache'), cwd=release, timeout=240)
    envfile = Path('/etc/darkwhispers-app.env')
    if not envfile.exists():
        envfile.write_text('NODE_ENV=production\nPORT=3210\nPGHOST=/var/run/postgresql\nPGDATABASE=darkwhispers_app\nPGUSER=darkwhispers_app\nWCL_CLIENT_ID=\nWCL_CLIENT_SECRET=\n')
        envfile.chmod(0o600)
    for name, script, memory in [('api','main',384), ('worker','worker',768)]:
        unit = f'''[Unit]
Description=DarkWhispers App {name}
After=network-online.target postgresql@16-main.service
Wants=network-online.target

[Service]
Type=simple
User={USER}
Group={USER}
WorkingDirectory={BASE}/current
EnvironmentFile=/etc/darkwhispers-app.env
ExecStart=/usr/bin/node {BASE}/current/dist/server/server/{script}.js
Restart=on-failure
RestartSec=5
TimeoutStopSec=35
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
UMask=0077
MemoryMax={memory}M
CPUQuota=100%
TasksMax=128

[Install]
WantedBy=multi-user.target
'''
        Path('/etc/systemd/system/darkwhispers-app-' + name + '.service').write_text(unit)
    previous = os.readlink(BASE / 'current') if (BASE / 'current').is_symlink() else None
    (state / 'previous-release.json').write_text(json.dumps(previous))
    pending = BASE / 'pending'
    if pending.is_symlink():
        pending.unlink()
    pending.symlink_to(release)
    pending.replace(BASE / 'current')
    run('systemctl', 'daemon-reload')
    try:
        run('systemctl', 'enable', *UNITS)
        # The API initializes the isolated schema before the worker starts.
        # Concurrent first-time CREATE TABLE calls can otherwise race in PostgreSQL.
        run('systemctl', 'restart', UNITS[0])
        for attempt in range(25):
            try:
                assert http('/healthz')['status'] == 'ok'
                break
            except Exception:
                if attempt == 24:
                    raise
                time.sleep(1)
        run('systemctl', 'restart', UNITS[1])
        results = smoke()
    except Exception:
        if previous:
            pending.symlink_to(previous)
            pending.replace(BASE / 'current')
            run('systemctl', 'restart', *UNITS)
        else:
            run('systemctl', 'stop', *UNITS)
        raise
    changed = {u: {'before':old, 'after':run('systemctl','show',u,'--property=MainPID,ActiveState,SubState')} for u,old in before.items() if run('systemctl','show',u,'--property=MainPID,ActiveState,SubState') != old}
    report = {'sourceCommit':release_id, 'archiveSha256':sha, 'smoke':results, 'otherServiceChanges':changed, 'liveConfigured':http('/api/status')['liveConfigured']}
    (state / 'verification.json').write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))

def activate():
    assert all(run('systemctl','is-active',u) == 'active' for u in UNITS)
    assert http('/healthz')['status'] == 'ok'
    state = BASE / 'deployment-state'
    backup = state / ('caddy-before-app-' + time.strftime('%Y%m%d-%H%M%S') + '.caddy')
    shutil.copyfile(SITE, backup)
    SITE.write_text('''darkwhispers.akion.se {
    encode zstd gzip
    header {
        -Server
        Cache-Control "no-store"
        X-Robots-Tag "noindex, noarchive"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "strict-origin-when-cross-origin"
        Strict-Transport-Security "max-age=31536000"
        Permissions-Policy "camera=(), microphone=(), geolocation=()"
        Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    }
    @api path /api/* /healthz
    handle @api {
        reverse_proxy 127.0.0.1:3210
    }
    handle {
        root * /srv/darkwhispers-app/current/dist/client
        @assets path /assets/*
        header @assets Cache-Control "public, max-age=86400"
        file_server
    }
}
''')
    try:
        run('caddy', 'validate', '--config', '/etc/caddy/Caddyfile')
        run('caddy', 'reload', '--config', '/etc/caddy/Caddyfile')
    except Exception:
        shutil.copyfile(backup, SITE)
        run('caddy', 'reload', '--config', '/etc/caddy/Caddyfile')
        raise
    print(json.dumps({'activated':True, 'maintenanceBackup':str(backup), 'url':'https://darkwhispers.akion.se'}))

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--archive', type=Path)
    parser.add_argument('--sha256')
    parser.add_argument('--release')
    parser.add_argument('--activate', action='store_true')
    args = parser.parse_args()
    assert os.geteuid() == 0, 'Root is needed to provision scoped system services'
    if args.activate:
        activate()
    else:
        assert args.archive and args.sha256 and args.release
        install(args.archive, args.sha256, args.release)
