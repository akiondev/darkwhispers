$ErrorActionPreference = 'Stop'
$site = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$public = Join-Path $site 'public'
$output = Join-Path $site 'build\security'
New-Item -ItemType Directory -Force -Path $output | Out-Null
$version = (Get-Content -LiteralPath (Join-Path $public 'launcher\releases.json') -Raw | ConvertFrom-Json).version
$paths = @(
    "launcher/downloads/DarkWhispers-Addons-$version-windows-x64-setup.exe",
    "launcher/downloads/DarkWhispers-Addons-$version-linux-amd64.deb",
    'downloads/DarkWhisperRaidTools-1.0.0.zip'
)
$artifacts = @()
foreach ($relative in $paths) {
    $file = Join-Path $public $relative
    $artifacts += [ordered]@{ filename = [IO.Path]::GetFileName($file); url = '/' + $relative; sha256 = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant(); bytes = (Get-Item -LiteralPath $file).Length }
}
try { Update-MpSignature -ErrorAction Stop | Out-Null } catch { Write-Output 'Signature update was unavailable; reporting the actual installed signature version.' }
$status = Get-MpComputerStatus
if (-not $status.AMServiceEnabled -or -not $status.AntivirusEnabled) { throw 'Defender is not active. No passed scan will be recorded.' }
$platformRoot = Join-Path $env:ProgramData 'Microsoft\Windows Defender\Platform'
$scanner = Get-ChildItem -LiteralPath $platformRoot -Directory | Sort-Object Name -Descending | ForEach-Object { Join-Path $_.FullName 'MpCmdRun.exe' } | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $scanner) { throw 'Microsoft Defender command-line scanner was not found.' }
$started = [DateTime]::UtcNow.ToString('o')
# Custom scan only. This does not turn off real-time protection or add exclusions.
$scanOutput = & $scanner -Scan -ScanType 3 -File $public -DisableRemediation 2>&1
$scanExit = $LASTEXITCODE
$scanOutput | Set-Content -LiteralPath (Join-Path $output 'defender-private.log') -Encoding utf8
if ($scanExit -ne 0) { throw "Defender did not return a clean scan (exit $scanExit). Review the private scan log." }
foreach ($artifact in $artifacts) {
    $after = (Get-FileHash -LiteralPath (Join-Path $public $artifact.url.TrimStart('/')) -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($after -ne $artifact.sha256) { throw 'An artifact changed during scanning. No passed scan recorded.' }
    $artifact['scan'] = [ordered]@{ status='passed'; detections=0; scanner='Microsoft Defender Antivirus'; exit_code=$scanExit }
}
$report = [ordered]@{
    schema=1; version=$version; started_at=$started; checked_at=[DateTime]::UtcNow.ToString('o')
    malware=[ordered]@{ engine='Microsoft Defender Antivirus'; engine_version=$status.AMEngineVersion; platform_version=$status.AMProductVersion; signature_version=$status.AntivirusSignatureVersion; signatures_updated_at=$status.AntivirusSignatureLastUpdated.ToUniversalTime().ToString('o'); scope='Full public release directory, including installers, addon archives, runtime files and website scripts'; mode='Custom scan with remediation disabled; real-time protection remains enabled'; exit_code=$scanExit }
    artifacts=$artifacts
}
$report | ConvertTo-Json -Depth 9 | Set-Content -LiteralPath (Join-Path $output 'defender.json') -Encoding utf8
Write-Output "Defender scan passed for release $version. Artifact hashes preserved. Signatures: $($status.AntivirusSignatureVersion)."
