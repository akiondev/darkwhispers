# Local-only recovery copies. No private key is sent to any network service.
$ErrorActionPreference = 'Stop'
if (!$IsWindows) { throw 'This backup uses Windows DPAPI for the current user.' }
$project = Split-Path -Parent $PSScriptRoot
$destination = Join-Path $project '.tools/key-backups'
$null = New-Item -ItemType Directory -Path $destination -Force
foreach ($name in @('catalog-signing-key.pem', 'updater-signing.key')) {
    $source = Join-Path $project ".tools/launcher-build/$name"
    if (!(Test-Path -LiteralPath $source -PathType Leaf)) { throw "Key file missing: $name" }
    $plain = [IO.File]::ReadAllBytes($source)
    try {
        $protected = [Security.Cryptography.ProtectedData]::Protect(
            $plain, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
        $path = Join-Path $destination "$name.dpapi"
        [IO.File]::WriteAllBytes($path, $protected)
        $roundtrip = [Security.Cryptography.ProtectedData]::Unprotect(
            $protected, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
        if ([Convert]::ToBase64String($plain) -cne [Convert]::ToBase64String($roundtrip)) {
            throw "Backup verification failed: $name"
        }
        [Array]::Clear($roundtrip, 0, $roundtrip.Length)
        Write-Output "Encrypted and verified local backup: $name.dpapi"
    } finally { [Array]::Clear($plain, 0, $plain.Length) }
}
Write-Output 'DPAPI recovery requires this Windows user profile. Keep a separate encrypted offline backup before replacing this computer.'
