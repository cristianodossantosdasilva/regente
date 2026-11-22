param([string[]]$Files, [switch]$CreateOnly)
# Cria (se preciso) um certificado autoassinado de code signing em CurrentUser\My e assina os arquivos.
$ErrorActionPreference = "Stop"
$subject = "CN=Regente (autoassinado)"
$store = "Cert:\CurrentUser\My"
$cert = Get-ChildItem $store | Where-Object { $_.Subject -eq $subject -and $_.NotAfter -gt (Get-Date) } | Select-Object -First 1
if (-not $cert) {
  $cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject $subject -KeyUsage DigitalSignature `
    -KeyAlgorithm RSA -KeyLength 3072 -HashAlgorithm SHA256 -CertStoreLocation $store -NotAfter (Get-Date).AddYears(3)
}
$root = Split-Path $PSScriptRoot -Parent
Export-Certificate -Cert $cert -FilePath (Join-Path $root "Regente-autoassinado.cer") | Out-Null
Write-Output "THUMBPRINT=$($cert.Thumbprint)"
if ($CreateOnly) { return }
$signtool = "C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64\signtool.exe"
$Files = @($Files | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim().Trim('"') } | Where-Object { $_ })
foreach ($f in $Files) { & $signtool sign /fd sha256 /sha1 $cert.Thumbprint $f; if ($LASTEXITCODE -ne 0) { throw "falha ao assinar $f" } }
