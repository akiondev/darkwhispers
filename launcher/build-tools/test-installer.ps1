$ErrorActionPreference = 'Stop'
$launcherRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$testRoot = [IO.Path]::GetFullPath((Join-Path $launcherRoot 'dist\installer-test'))
if (-not $testRoot.StartsWith($launcherRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Installer test target is outside the launcher workspace.'
}
$registration = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\DarkWhispers Addons'
$productKey = 'HKCU:\Software\akion\DarkWhispers Addons'
if ((Test-Path -LiteralPath $registration) -or (Test-Path -LiteralPath $productKey) -or (Test-Path -LiteralPath $testRoot)) {
    throw 'Existing launcher registration or test folder found. No installer was run.'
}
$version = (Get-Content -LiteralPath (Join-Path $launcherRoot 'src-tauri\tauri.conf.json') -Raw | ConvertFrom-Json).version
$installer = Join-Path $launcherRoot "target\x86_64-pc-windows-msvc\release\bundle\nsis\DarkWhispers Addons_$($version)_x64-setup.exe"
$install = Start-Process -FilePath $installer -ArgumentList "/S /NS /D=$testRoot" -WindowStyle Hidden -PassThru
if (-not $install.WaitForExit(30000)) { throw 'Installer did not complete within 30 seconds.' }
if ($install.ExitCode -ne 0) { throw "Installer failed: $($install.ExitCode)" }
$installedExe = Join-Path $testRoot 'darkwhispers-addons.exe'
$builtExe = Join-Path $launcherRoot 'target\x86_64-pc-windows-msvc\release\darkwhispers-addons.exe'
# Tauri patches this marker in the packaged copy, then restores the build output.
$encoding = [Text.Encoding]::Latin1
$expectedBytes = $encoding.GetBytes($encoding.GetString([IO.File]::ReadAllBytes($builtExe)).Replace('__TAURI_BUNDLE_TYPE_VAR_UNK', '__TAURI_BUNDLE_TYPE_VAR_NSS'))
$expectedHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($expectedBytes))
if ((Get-FileHash -LiteralPath $installedExe).Hash -ne $expectedHash) {
    throw 'Installed executable differs from the built executable.'
}
if (-not (Test-Path -LiteralPath (Join-Path $testRoot 'THIRD-PARTY-NOTICES.txt'))) { throw 'Dependency notices missing.' }
$registeredPath = (Get-ItemProperty -LiteralPath $registration).InstallLocation.Trim('"')
if ($registeredPath -ne $testRoot) { throw 'Unexpected installer location. Uninstall test stopped.' }
Write-Output 'Windows installer: successful; installed executable SHA-256 verified.'

# This uninstaller was just installed into the verified, previously absent test folder.
$uninstall = Start-Process -FilePath (Join-Path $testRoot 'uninstall.exe') -ArgumentList '/S' -WindowStyle Hidden -PassThru
if (-not $uninstall.WaitForExit(30000)) { throw 'Uninstaller did not complete within 30 seconds.' }
# NSIS may continue in its temporary child process after this parent exits.
# Wait for both filesystem and registry cleanup, not just executable deletion.
$cleanupDeadline = [DateTime]::UtcNow.AddSeconds(30)
while ([DateTime]::UtcNow -lt $cleanupDeadline -and ((Test-Path -LiteralPath $installedExe) -or (Test-Path -LiteralPath $registration))) {
    Start-Sleep -Milliseconds 100
}
if ((Test-Path -LiteralPath $installedExe) -or (Test-Path -LiteralPath $registration)) { throw 'Uninstall verification failed.' }
# NSIS intentionally remembers its install directory. Remove only the test's new key.
if (Test-Path -LiteralPath $productKey) {
    if ((Get-Item -LiteralPath $productKey).GetValue('') -ne $testRoot) { throw 'Unexpected registry value; retained.' }
    Remove-Item -LiteralPath $productKey
}
Write-Output 'Windows uninstaller: successful; test registration removed.'
