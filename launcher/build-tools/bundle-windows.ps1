param([string]$Tauri = 'tauri')
$ErrorActionPreference = 'Stop'
$launcherRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Push-Location (Join-Path $launcherRoot 'src-tauri')
try {
    # A Linux cross-build can supply the executable; Windows packages it with NSIS.
    & $Tauri bundle --target x86_64-pc-windows-msvc --bundles nsis --ci
    if ($LASTEXITCODE -ne 0) { throw 'Windows installer packaging failed.' }
}
finally { Pop-Location }
