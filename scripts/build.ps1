# Build reproduzível no Windows. Uso: .\scripts\build.ps1 [-Test] [-Bundle]
param([switch]$Test, [switch]$Bundle)
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

# rc.exe e headers do Windows SDK (necessários ao embutir ícone/manifest). Ajusta para a versão mais nova instalada.
$sdk = "${env:ProgramFiles(x86)}\Windows Kits\10"
$ver = (Get-ChildItem "$sdk\Include" | Sort-Object Name -Descending | Select-Object -First 1).Name
$env:PATH = "$env:USERPROFILE\.cargo\bin;$sdk\bin\$ver\x64;$env:PATH"
$env:INCLUDE = "$sdk\Include\$ver\um;$sdk\Include\$ver\shared;$sdk\Include\$ver\ucrt;$env:INCLUDE"

npm install
if ($Test) {
  npm test
  cargo test --workspace -- --test-threads=1
}
cargo build --release -p regente-cli
if ($Bundle) { npx tauri build --config src-tauri/tauri.bundle.conf.json } else { npx tauri build --no-bundle }
Write-Host "OK: target\release\regente-app.exe"
