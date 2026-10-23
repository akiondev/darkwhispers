"""Root-only setup: read credentials from stdin, never argv, files in Git or output."""
import json
import os
from pathlib import Path
import re
import sys

assert os.geteuid() == 0, 'Run as root'
values = json.load(sys.stdin)
client_id, client_secret = values['id'], values['secret']
assert isinstance(client_id, str) and re.fullmatch(r'[A-Za-z0-9_-]{10,200}', client_id)
assert isinstance(client_secret, str) and re.fullmatch(r'[A-Za-z0-9._~-]{20,500}', client_secret)
path = Path('/etc/darkwhispers-app.env')
assert path.is_file() and not path.is_symlink(), 'Provision the app before setting credentials'
lines = [line for line in path.read_text().splitlines()
         if not line.startswith(('WCL_CLIENT_ID=', 'WCL_CLIENT_SECRET='))]
lines.extend(['WCL_CLIENT_ID=' + client_id, 'WCL_CLIENT_SECRET=' + client_secret])
temporary = path.with_name('.darkwhispers-app.env.pending')
fd = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
with os.fdopen(fd, 'w') as handle:
    handle.write('\n'.join(lines) + '\n')
    handle.flush()
    os.fsync(handle.fileno())
temporary.replace(path)
print('Warcraft Logs backend credentials configured. Values were not printed.')
