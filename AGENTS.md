# ARType — Agent Guide

ARType is the corporate fork of TypeTide: native selection translation and
replacement on macOS and Windows, backed by one managed API. Preserve the full
MIT license and upstream attribution. Historical TypeTide marketing and assets
are documented in `docs/ARCHIVE.md`; they do not define the current product.

## Boundaries

- `server/src/app.js` composes HTTP routes. Domain services own authorization,
  transactions and billing; `database.js` and versioned migrations stay independent
  of business services. Keep imports acyclic.
- `server/public/modules` separates session/API, navigation, actions and views.
  Escape untrusted values; late responses cannot restore an old tenant or session.
- Provider keys remain server-side. Each connection has its own URL, encrypted
  key and default model. A destination change requires explicit key entry.
- Roles, product entitlement and billing are distinct. Preserve tenant locks,
  one charge per tenant/email/UTC month, immutable ledger and idempotency keys.
- Native clients use only managed ARType translation. Do not reintroduce offline
  model downloads, direct provider credentials or upstream automatic updates.
- Preserve selection capture, clipboard restoration and target identity across
  asynchronous translation. Do not replace text when the captured target changed.
- Keep native UI work on the main thread; snapshot settings for worker requests.
  Legacy `TypeTide` scheme, resource and storage identifiers may remain for
  compatibility. Do not erase existing user settings or stored sessions.

## Verification

- Server: `cd server && npm run check && npm test`; set `TEST_DATABASE_URL` to an
  isolated PostgreSQL database with a name ending in `_test`. Product tests clear
  its tables; coordinate concurrent runs.
- Deployment: `node --test deployment/tests/*.test.mjs` from the repository root.
- macOS: Xcode project `macos/TypeTide.xcodeproj`, scheme `TypeTide`; run its tests.
- Windows: compile and run `ARType.exe --selftest` in Windows CI, including the
  installed application. See `windows/TESTING.md` for manual native checks.
- Never call unsigned builds or simulated OAuth/provider fixtures distribution
  ready. Report the exact checks performed and any remaining platform limits.

## Delivery

Use `scripts/build-artype-macos.sh SERVICE_URL --validation|--release` and
`scripts/build-artype-windows.ps1 -ServiceUrl URL -Validation` (or signing
certificate). Legacy build paths forward to these scripts.

Use `scripts/package-artype-server.sh` for a Docker source archive and
`node scripts/package-artype-pilot.mjs` to include explicit installers. Packaging
requires committed release inputs, excludes local credentials and records the
source commit. See `docs/OPERATIONS.md` for commands and manifest semantics.

`VERSION` is shared across platforms; update it with `scripts/bump-version.sh`.
Building never commits, pushes, publishes or installs tools automatically.
