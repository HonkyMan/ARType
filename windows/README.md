# ARType for Windows

Native Win32 C++20 client for the managed ARType service. WinHTTP handles the
corporate API; UI Automation and a clipboard fallback capture selected text.
Google device pairing selects the organization, whose server supplies model,
languages, access and billing status. Provider credentials remain on the server.

## Build and package

From the repository root on Windows, with Visual Studio C++/Windows SDK, CMake
and Inno Setup 6 installed:

```powershell
./scripts/build-artype-windows.ps1 -ServiceUrl https://translate.example.com -Validation
```

The script compiles `windows/build/Release/ARType.exe`, runs its isolated
`--selftest`, then creates `windows/build/ARType-Setup-VERSION-UNSIGNED-VALIDATION.exe`
and a SHA-256 file. For a signed release, replace `-Validation` with
`-CertificateThumbprint YOUR_CERTIFICATE_THUMBPRINT`; `signtool` must be in PATH.
A signed release requires a public HTTPS service. HTTP loopback is permitted only
for validation. `windows/scripts/build-release.ps1` forwards the same parameters.

Corporate installers contain no llama.cpp runtime, model downloader, Ollama
backend or direct provider setup. Updates are distributed through the corporate
console; upstream GitHub release checks are disabled.

## Native behavior

The tray application handles hotkeys and the message loop on the main thread.
Capture, translation and replacement workers carry a snapshot of the request and
its target. Replacement must reject a changed window/selection and preserve the
clipboard. `Alt+D` translates a selection; `Alt+R` translates for replacement.
Popup, shortcut, language, exclusion and launch-at-login settings remain native.

Some internal resource and storage names retain `TypeTide` to preserve existing
settings. `TYPETIDE_DATA_DIR` selects an isolated test directory. Device credentials
use Windows Credential Manager. Preserve these compatibility boundaries when
renaming code.

Automatic crash reports contain numeric exception metadata, not process memory.
See the [native diagnostic policy](../docs/native-diagnostics.md), including
handling of `.dmp` files left by older clients.

See [TESTING.md](TESTING.md) for validation and the root
[operations guide](../docs/OPERATIONS.md) for packaging and server deployment.
Historical upstream documentation is preserved in
[docs/archive/upstream](../docs/archive/upstream/windows-README.md).
