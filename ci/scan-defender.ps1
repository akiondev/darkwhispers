$ErrorActionPreference = 'Stop'
$scanRoot = [IO.Path]::GetFullPath((Join-Path $PWD 'inputs'))
$reportRoot = Join-Path $PWD 'reports-defender'
New-Item -ItemType Directory -Force $reportRoot | Out-Null
$inventory = @(Get-ChildItem -LiteralPath $scanRoot -File | ForEach-Object {
    [ordered]@{filename=$_.Name;sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant();bytes=$_.Length}
})
if ($inventory.Count -lt 4) { throw 'Incomplete release inputs' }
$started = [DateTime]::UtcNow.ToString('o')
if (-not (Get-Service WinDefend -ErrorAction SilentlyContinue)) { throw 'Defender is unavailable on this runner; no passed result recorded' }
if ((Get-Service WinDefend).Status -ne 'Running') { Start-Service WinDefend }
Update-MpSignature
$status = Get-MpComputerStatus
if (-not $status.AntivirusEnabled -or -not $status.AMServiceEnabled) { throw 'Defender is inactive' }
$platform = Join-Path $env:ProgramData 'Microsoft\Windows Defender\Platform'
$scanner = Get-ChildItem -LiteralPath $platform -Directory | Sort-Object Name -Descending | ForEach-Object {Join-Path $_.FullName 'MpCmdRun.exe'} | Where-Object {Test-Path -LiteralPath $_} | Select-Object -First 1
if (-not $scanner) { $scanner = Join-Path $env:ProgramFiles 'Windows Defender\MpCmdRun.exe' }
$output = & $scanner -Scan -ScanType 3 -File $scanRoot -DisableRemediation 2>&1
$result = $LASTEXITCODE
$output | ForEach-Object { "$_".Replace($scanRoot,'<release-inputs>') } | Set-Content (Join-Path $reportRoot 'defender-console.txt') -Encoding utf8
if ($result -ne 0) { throw "Defender scan failed (exit $result); inspect the complete public log" }
foreach ($item in $inventory) {
    if ((Get-FileHash -LiteralPath (Join-Path $scanRoot $item.filename)).Hash.ToLowerInvariant() -ne $item.sha256) { throw 'Release input changed during scan' }
}
[ordered]@{
    schema=1;status='passed';engine='Microsoft Defender Antivirus';exit_code=$result;detections=0
    engine_version=$status.AMEngineVersion;signature_version=$status.AntivirusSignatureVersion
    signatures_updated_at=$status.AntivirusSignatureLastUpdated.ToUniversalTime().ToString('o')
    started_at=$started;checked_at=[DateTime]::UtcNow.ToString('o');artifacts=$inventory
    scope='All downloaded release packages; custom scan with archive scanning and remediation disabled. No exclusions added.'
} | ConvertTo-Json -Depth 7 | Set-Content (Join-Path $reportRoot 'defender.json') -Encoding utf8
Write-Output "Defender: 0 detections in $($inventory.Count) release files. See defender-console.txt and exact SHA-256 inventory."
