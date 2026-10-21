# ARType 0.1.22 — Plus navigation and live language policy

Verified on 21 October 2026. Native product source: `a9c0641`; subsequent
`6bf6811` adds integration coverage, overview wording and operating documentation.

## Delivered behavior

- The current user's Plus summary appears separately above Business organizations.
  Existing Plus owners manage their subscription or create Business, without
  another Plus creation form. Customer personal accounts remain in the paginated
  Users directory rather than in organization navigation.
- Plus languages resolve from current plan configuration for old and new accounts.
  Business languages remain per workspace; other plan defaults retain creation scope.
- Clients refresh profiles every 30 seconds and fetch the authorized language
  policy before translation. Disabled choices stay selected and visibly marked.
  The error offers the fixed `artype://settings/languages` recovery route.
- Server enforcement rejects disabled languages before calling the AI provider.
  Policy reads require authorization, support paired desktop bearers and do not
  mutate billing or expose provider secrets.

## Evidence

- Server syntax checks and the full PostgreSQL/UI suite: **122/122 passed**.
  Includes an existing Plus account, device pairing and bearer policy reads,
  unauthorized account rejection, immediate language removal and an unchanged
  Business policy. A disabled request does not invoke the mocked provider.
- Native portable policies and macOS standalone policies passed.
- Full current local Xcode suite: **42/42 passed**, failures/skips/runtime warnings 0.
  The new production-popup integration test checks error propagation, unchanged
  text and selected language, and opens the actual settings window on Languages.
  This test injects the language-policy error; it is not a physical hotkey test.
- [CI for native product source](https://github.com/HonkyMan/ARType/actions/runs/39585768241):
  all three jobs passed. Windows includes compile, self-tests, EXE installation,
  installed self-tests and uninstall. macOS includes full Xcode tests.
- Deployment/packaging tests: **16/16 passed**.
- Chrome on isolated fixtures: paid Plus overview and Business-only creation in
  English/Russian; 390px mobile view without horizontal overflow.
- A separate macOS QA bundle signed in through simulated Google/device approval
  to an existing, paid Plus fixture on `localhost:8081`. The running client showed
  ten languages. Removing Bengali in the administrator UI marked the selected
  Bengali choice unavailable; restoring it removed the warning, without a restart
  or silent selection change. The fixture did not use the real AI provider.
- On the real local service at `127.0.0.1:8080`, the adt account shows its paid Plus
  summary and both 0.1.22 downloads. Updated served web files match source.
- Docker API was rebuilt after retaining the pre-update database dump; health is
  successful. No production balance or membership was changed by write tests.
- DMG `hdiutil verify` passed. Mounted app version, service configuration and full
  MIT license were checked. The Windows artifact contains version 0.1.22, the same
  service origin, and the full license (Windows CRLF line endings).
- Download manifest hashes and sizes are generated from the published installers.
  Server and pilot packages are built from committed release inputs and record
  their source commit in `PACKAGE.json`; local credentials are excluded.
- `/Applications/ARType.app` was updated to 0.1.22 with previous bundles retained
  under `.local/backups/plus-languages-20261021/`. Real Google/device sign-in as adt
  succeeded and the installed client displayed all ten languages. macOS required
  renewed Accessibility permission for this unsigned replacement; that OS grant
  is separate from successful login and language synchronization.

## Distribution limits

These are unsigned local validation installers, both configured for
`http://127.0.0.1:8080`. On another computer that URL refers to that computer,
not this Mac. External employee deployment requires a public HTTPS service origin,
matching Google callback, client builds for that origin and OS/signing acceptance.
Windows was tested in CI, not manually on an employee workstation in this run.

Install 0.1.22 once to obtain synchronization. Subsequent enabling/disabling of the
ten supported languages needs no rebuild. Entirely new languages still require
client support and a release. This revision does not claim improved AI quality.
