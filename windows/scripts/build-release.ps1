# Compatibility entry point for the corporate ARType build.
param(
  [Parameter(Mandatory=$true)][string]$ServiceUrl,
  [switch]$Validation,
  [string]$CertificateThumbprint,
  [string]$TimestampUrl = 'http://timestamp.digicert.com'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
& (Join-Path $root 'scripts/build-artype-windows.ps1') @PSBoundParameters
