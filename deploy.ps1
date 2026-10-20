$ErrorActionPreference = 'Stop'

$addonsDirectory = 'C:\Program Files (x86)\World of Warcraft\_retail_\Interface\AddOns'
$sourceDirectory = if (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'addons') -PathType Container) { Join-Path $PSScriptRoot 'addons' } else { $PSScriptRoot }

if (-not (Test-Path -LiteralPath $addonsDirectory -PathType Container)) {
    throw "WoW AddOns directory not found: $addonsDirectory"
}
# Validate the public raid tool before changing its installation.
$addonNames = @('DarkWhisperRaidTools')
foreach ($addonName in $addonNames) {
    $manifest = Join-Path $sourceDirectory "$addonName\$addonName.toc"
    if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) {
        throw "Missing addon manifest: $manifest"
    }
}

foreach ($addonName in $addonNames) {
    $source = (Resolve-Path -LiteralPath (Join-Path $sourceDirectory $addonName)).Path
    $destination = Join-Path $addonsDirectory $addonName
    $files = @(Get-ChildItem -LiteralPath $source -File -Recurse |
        Where-Object { $_.Extension -in @('.lua', '.toc', '.tga') })
    foreach ($file in $files) {
        $relativePath = $file.FullName.Substring($source.Length).TrimStart('\')
        $targetFile = Join-Path $destination $relativePath
        New-Item -ItemType Directory -Path (Split-Path -Parent $targetFile) -Force | Out-Null
        Copy-Item -LiteralPath $file.FullName -Destination $targetFile -Force

        $sourceHash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
        $targetHash = (Get-FileHash -LiteralPath $targetFile -Algorithm SHA256).Hash
        if ($sourceHash -ne $targetHash) {
            throw "Installed file does not match the source: $addonName\$relativePath"
        }
    }
    Write-Output "Installed and verified $($files.Count) files in $destination"
}
