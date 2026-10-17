param(
  [Parameter(Mandatory=$true)][string]$ServiceUrl,
  [switch]$Validation,
  [string]$CertificateThumbprint
)
$ErrorActionPreference = 'Stop'
& "$PSScriptRoot/build-artype-windows.ps1" -ServiceUrl $ServiceUrl -Validation:$Validation -CertificateThumbprint $CertificateThumbprint
