# ARType Windows validation

Run automated gates on Windows 10/11 x64. Use the corporate build script from the
repository root; it runs `ARType.exe --selftest` with an isolated data directory
before constructing the installer. The installed executable must pass the same
self-test in CI. Portable policy tests under `windows/tests` cover response bounds,
request deadlines, JSON, target replacement and worker/clipboard lifecycles.

## Manual acceptance

Use a dedicated test organization and a client built for that server URL.

- Pair through Google, compare the device code, select the invited organization,
  restart and verify session persistence. Revoke access and verify the next request.
- Verify paid, disabled, unpaid and suspended organization states; members cannot
  configure provider keys or override server rules.
- Exercise selection capture and translation in Notepad, a Chromium/Electron text
  field and a WPF control. Verify both direct UI Automation and clipboard fallback.
- Change focus, selection or organization while translation is pending. The result
  must not replace another target; manual copying remains available when relevant.
- Check Copy, Replace, cancellation and Ctrl+Z. Confirm original clipboard content
  returns after replacement and failures, including non-text clipboard formats.
- Test shortcut conflicts, restoring defaults, exclusions and launch at login.
  Restart Explorer and suspend/resume before repeating shortcuts.
- Verify settings and popup readability under light/dark themes and display scaling.
- Install, launch, upgrade and uninstall the generated ARType installer. Unsigned
  validation packages may trigger OS warnings and are not signed releases.

Record Windows version, scaling, application, exact steps and result. Do not attach
selected text, secrets or unreviewed local configuration to reports.

The former OpenAI/Ollama mock E2E scripts and bundled-model preparer were removed:
they exercised providers that are no longer part of ARType. The historical
[upstream matrix](../docs/archive/upstream/windows-TESTING.md) is reference only.
