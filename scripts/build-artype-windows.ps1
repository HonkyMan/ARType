param(
  [Parameter(Mandatory=$true)][string]$ServiceUrl,
  [switch]$Validation,
  [string]$CertificateThumbprint,
  [string]$TimestampUrl = 'http://timestamp.digicert.com'
)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$url=[uri]$ServiceUrl
if ($url.UserInfo -or $url.Query -or $url.Fragment -or $url.AbsolutePath -ne '/') {throw 'Expected service origin'}
if ($url.Scheme -ne 'https' -and !($Validation -and $url.IsLoopback)) {throw 'HTTPS required'}
if (!$Validation -and ($url.IsLoopback -or !$CertificateThumbprint)) {throw 'Release requires public HTTPS URL and signing certificate'}
cmake -S windows -B windows/build -A x64 "-DARTYPE_SERVICE_URL=$($ServiceUrl.TrimEnd('/'))"
if ($LASTEXITCODE -ne 0) {throw 'Configure failed'}
cmake --build windows/build --config Release
if ($LASTEXITCODE -ne 0) {throw 'Build failed'}
$env:TYPETIDE_DATA_DIR = Join-Path $env:TEMP ('artype-test-'+[guid]::NewGuid())
$test=Start-Process windows/build/Release/ARType.exe -ArgumentList '--selftest' -Wait -PassThru -NoNewWindow
if ($test.ExitCode -ne 0) {throw 'Self-tests failed'}
Copy-Item windows/build/Release/ARType.exe windows/build/ARType.exe -Force
Copy-Item LICENSE windows/build/TypeTide-LICENSE.txt -Force
if (!$Validation) {
  signtool sign /sha1 $CertificateThumbprint /fd SHA256 /tr $TimestampUrl /td SHA256 windows/build/ARType.exe
  if ($LASTEXITCODE -ne 0) {throw 'Executable signing failed'}
}
$iscc=Get-Command ISCC.exe -ErrorAction SilentlyContinue
$compiler=if ($iscc) {$iscc.Source} else {"${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe"}
if (!(Test-Path $compiler)) {throw 'Inno Setup 6 compiler is required'}
$version=(Get-Content VERSION -Raw).Trim()
& $compiler "/DAppVersion=$version" windows/installer/TypeTide.iss
if ($LASTEXITCODE -ne 0) {throw 'Installer build failed'}
$installer="windows/build/ARType-Setup-$version.exe"
if (!$Validation) {
  signtool sign /sha1 $CertificateThumbprint /fd SHA256 /tr $TimestampUrl /td SHA256 $installer
  if ($LASTEXITCODE -ne 0) {throw 'Installer signing failed'}
  signtool verify /pa $installer
  if ($LASTEXITCODE -ne 0) {throw 'Signature verification failed'}
} else {
  $new="windows/build/ARType-Setup-$version-UNSIGNED-VALIDATION.exe"
  Move-Item $installer $new -Force
  $installer=$new
}
Get-FileHash $installer -Algorithm SHA256 | Format-List | Out-File "$installer.sha256"
Write-Output (Resolve-Path $installer)
