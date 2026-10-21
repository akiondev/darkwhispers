$ErrorActionPreference = 'Stop'
$uploadRoot = '/home/deploy/darkwhispers-site-upload'
ssh -o BatchMode=yes -o ConnectTimeout=15 vps1-deploy "install -d -m 700 $uploadRoot"
if ($LASTEXITCODE -ne 0) { throw 'SSH staging setup failed' }
scp -o BatchMode=yes (Join-Path $PSScriptRoot 'deploy\maintenance.caddy') (Join-Path $PSScriptRoot 'deploy\maintenance.py') "vps1-deploy:$uploadRoot/"
if ($LASTEXITCODE -ne 0) { throw 'Maintenance configuration upload failed' }
ssh -o BatchMode=yes -o ConnectTimeout=15 vps1-deploy "sudo python3 $uploadRoot/maintenance.py $uploadRoot/maintenance.caddy"
if ($LASTEXITCODE -ne 0) { throw 'Maintenance activation failed' }
