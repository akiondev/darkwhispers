param(
    [string]$Python = 'python'
)
$ErrorActionPreference = 'Stop'

& $Python (Join-Path $PSScriptRoot 'tools\package.py') | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Website packaging failed' }
$release = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'build\release.json') -Raw | ConvertFrom-Json
if ($release.release -notmatch '^[a-f0-9]{16}$' -or $release.archive_sha256 -notmatch '^[a-f0-9]{64}$') {
    throw 'Invalid release metadata'
}
$archiveName = "darkwhispers-site-$($release.release).tar.gz"
$archivePath = Join-Path $PSScriptRoot "build\$archiveName"
if ((Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $release.archive_sha256) {
    throw 'Local deployment archive SHA-256 mismatch'
}

ssh -o BatchMode=yes -o ConnectTimeout=15 vps1-deploy 'install -d -m 700 /home/deploy/darkwhispers-site-upload'
if ($LASTEXITCODE -ne 0) { throw 'SSH staging setup failed' }
$uploadFiles = @(
    $archivePath,
    (Join-Path $PSScriptRoot 'deploy\darkwhispers.caddy'),
    (Join-Path $PSScriptRoot 'deploy\install.py'),
    (Join-Path $PSScriptRoot 'build\release.json'),
    (Join-Path $PSScriptRoot 'tools\verify-deployment.py')
)
scp -o BatchMode=yes @uploadFiles 'vps1-deploy:/home/deploy/darkwhispers-site-upload/'
if ($LASTEXITCODE -ne 0) { throw 'SSH upload failed' }

# Interpolated shell fields are restricted to the hexadecimal values validated above.
$installCommand = "sudo python3 /home/deploy/darkwhispers-site-upload/install.py /home/deploy/darkwhispers-site-upload/$archiveName $($release.archive_sha256) $($release.release) /home/deploy/darkwhispers-site-upload/darkwhispers.caddy"
ssh -o BatchMode=yes -o ConnectTimeout=15 vps1-deploy $installCommand
if ($LASTEXITCODE -ne 0) { throw 'VPS deployment failed; inspect installer rollback output' }
ssh -o BatchMode=yes -o ConnectTimeout=15 vps1-deploy 'python3 /home/deploy/darkwhispers-site-upload/verify-deployment.py /home/deploy/darkwhispers-site-upload/release.json'
if ($LASTEXITCODE -ne 0) { throw 'Published website verification failed' }
Write-Output "Published and verified https://darkwhispers.akion.se/ (release $($release.release))"
