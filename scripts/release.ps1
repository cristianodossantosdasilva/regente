# Gera os binários e o instalador de release SEM vazar caminhos da sua máquina (usuário do Windows, pasta do projeto).
# Uso (PowerShell, na raiz do repositório):  .\scripts\release.ps1
# Resultado: target\release\bundle\nsis\Regente_<versão>_x64-setup.exe  e  SHA256SUMS.txt ao lado.
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)
$root = (Get-Location).Path
$cargo = if ($env:CARGO_HOME) { $env:CARGO_HOME } else { Join-Path $env:USERPROFILE ".cargo" }
$rustup = if ($env:RUSTUP_HOME) { $env:RUSTUP_HOME } else { Join-Path $env:USERPROFILE ".rustup" }
# Substitui, nos caminhos embutidos nos executáveis (panics, debug info), as pastas locais por nomes genéricos.
$env:RUSTFLAGS = "--remap-path-prefix=$root=/regente --remap-path-prefix=$cargo=/cargo --remap-path-prefix=$rustup=/rustup --remap-path-prefix=$env:USERPROFILE=/home/user"
# rc.exe e headers do Windows SDK (ajuste a versão se precisar)
$sdk = "${env:ProgramFiles(x86)}\Windows Kits\10"
$ver = (Get-ChildItem "$sdk\Include" | Sort-Object Name -Descending | Select-Object -First 1).Name
$env:PATH = "$sdk\bin\$ver\x64;$env:PATH"
$env:INCLUDE = "$sdk\Include\$ver\um;$sdk\Include\$ver\shared;$sdk\Include\$ver\ucrt;$env:INCLUDE"
npm ci
cargo build --release -p regente-cli
npx tauri build --config src-tauri/tauri.bundle.conf.json
$setup = Get-ChildItem "target\release\bundle\nsis\*-setup.exe" | Select-Object -First 1
$sha = [System.Security.Cryptography.SHA256]::Create()
$hash = ([System.BitConverter]::ToString($sha.ComputeHash([System.IO.File]::ReadAllBytes($setup.FullName))) -replace "-", "").ToLower()
"$hash *$($setup.Name)" | Set-Content -Encoding ascii (Join-Path $setup.DirectoryName "SHA256SUMS.txt")
Write-Host "OK: $($setup.FullName)`nSHA-256: $hash"
Write-Host "Confira que nenhum caminho pessoal vazou:  Select-String -Path target\release\*.exe -Pattern ([regex]::Escape(`$env:USERNAME)) -Encoding ascii"
