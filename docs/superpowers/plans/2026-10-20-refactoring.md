# ARType Refactoring Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan
> task by task. Independent review and bounded implementation agents are
> authorized by the user.

**Goal:** Refactor the complete ARType project and remediate source-confirmed
security defects while preserving the corporate product contract.

**Architecture:** Domain modules with an acyclic server dependency graph and
thin HTTP composition; explicit native request/replacement lifecycles; a modular
browser console. Incremental compatible changes, validated before integration.

**Tech Stack:** Node.js 24, Express 5, PostgreSQL 16, browser JavaScript,
Swift/AppKit/SwiftUI, C++20/Win32, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-10-20-refactoring-design.md`

## Global Constraints

- Preserve existing tenant data and monthly billing semantics.
- Keep provider credentials server-side; never print secret material.
- Preserve native capture/clipboard functionality and full upstream license.
- Use isolated test databases; do not credit or debit real organizations.
- Do not install new tools or rewrite the product into a new framework.

## Review Focus

- Translation finishes after focus/selection or account changes: no foreign paste.
- Nested, oversized, truncated or malformed server responses: bounded failure.
- Existing version 4 database: no owner reset, lost encryption key or duplicate fee.
- Browser request resolves after navigation/logout: cannot restore stale access.
- Legacy provider removal: no retained downloads, runtime launchers or hidden UI.

## Task 1: Establish evidence and remediate native boundaries

Files: native capture/replacement, HTTP/managed protocol and JSON sources; matching
Swift and portable C++/Windows self-tests.

- [x] Record baseline server/deployment checks and independent source review.
- [x] Finalize initial security findings and explicit coverage gaps.
- [x] Add regression tests for target mismatch, malformed/deep JSON and size limits.
- [x] Carry target identity and cancellation through replacement; reject uncertain
  targets before clipboard mutation/key injection.
- [x] Bound response buffering and tighten protocol parsing.
- [x] Run native checks and independently review the changed boundaries.

## Task 2: Extract server domain and persistence boundaries

Files: `server/src/app.js`, `store.js`, `auth.js`, `billing.js`, new domain/router/
database modules and server tests.

- [x] Separate HTTP errors, transaction helper, migration runner and authorization.
- [x] Extract versioned migrations and test empty/existing schema plus repeat runs.
- [x] Separate provider, tenant/membership, translation and billing routes/services.
- [x] Eliminate circular imports and duplicate policy; format source for review.
- [x] Validate configuration and provider output; test unsafe URL schemes and
  malformed token metadata without exposing external errors.
- [x] Verify concurrency, revocation, monthly renewal and idempotency regressions.

## Task 3: Modularize browser console

Files: `server/public/app.js`, browser modules, `index.html`, navigation tests.

- [x] Separate API/session, navigation, views and feature actions.
- [x] Centralize stale-response/session invalidation and money formatting.
- [x] Test expired session and reordered responses; inspect rendered operator and
  owner workflows against isolated fixtures.

## Task 4: Remove superseded native/product scaffolding

Files: native build definitions, unused providers/views/tests, scripts and docs.

- [x] Trace each legacy provider, model download, updater and CLI entry point.
- [x] Remove obsolete corporate paths and dependencies; preserve native features.
- [x] Migrate naming/storage references safely and document any retained aliases.
- [x] Build both native targets and run their tests.

## Task 5: Delivery and completion audit

Files: Docker/deployment/build scripts, README/operations/acceptance documents, CI.

- [x] Resolve script/documentation discrepancies and verify archive contents.
- [x] Verify migration and Docker startup on isolated persisted data.
- [x] Review dependency advisories and release automation using current evidence.
- [x] Run all affected checks, native CI and final independent review.
- [x] Reconcile all initial findings, architecture criteria and coverage gaps.
- [x] Produce updated reproducible artifacts and report remaining external limits.

The code refactoring acceptance is complete. Production distribution still has
the explicit infrastructure, signing and manual OS acceptance limits recorded in
`docs/VALIDATION-0.1.20.md`; passing automated checks does not waive them.

## Verification checkpoint, 2026-10-20

- Server syntax and full suite: 75/75 passed on the isolated PostgreSQL test
  database. Current source received an independent review of all 38 domain,
  route, persistence and SQL migration files.
- Deployment: 16/16, including committed-input packaging, deterministic archives,
  secret exclusion, restore ordering and shared platform version metadata.
- Native portable checks: 8 C++ ASan/UBSan runners and 5 Swift policy/protocol
  runners pass, plus the Services manifest contract. Full native CI on source commit 61e32cf passed for macOS and Windows.
- Docker: both an empty database and a persisted version-4 fixture reached
  healthy startup with versions 1–5. Paid-owner flag, credential ciphertext,
  wallet and immutable ledger survived migration and restart. Graceful stop
  returned exit 0. The isolated project and volume were removed afterward.
- Chrome fixture QA: dashboard, tenant settings/model persistence, help empty
  state, logout/reload and a simulated balance credit with exactly one visible
  ledger entry. The credit survived reload and cleared the pending form.
- Financial journal regressions cover reload, logout, account isolation, storage
  failure, lost responses and an unsuccessful retry retaining the original key.
- Dependency audit reports zero known npm production advisories. This is not a
  proof that the application has no vulnerabilities.
- macOS full Xcode suite: 40/40 passed, no skipped tests or runtime warnings.
  The 0.1.20 validation DMG builds and passes image, version, service URL and
  license checks. Windows MSVC build, self-tests and installer install/self-test/uninstall passed
  in CI run 39414011111. All three workflow jobs completed successfully.
- The local API on port 8080 was updated after a fresh database backup. Counts,
  wallet, ledger and encrypted credential bytes are unchanged; health is 200
  and the stored provider key still decrypts. No real balance was changed.

## Completion evidence

- Cross-platform CI: https://github.com/HonkyMan/ARType/actions/runs/39414011111
  on source commit `61e32cff0f42b652d25b4ca3d7fc1d27c63d0819`.
- Security report generated by Codex Security: six implementation findings in
  baseline 5e5d88a (one medium, five low), fixed and regression-checked in 61e32cf.
  Coverage exclusions and OS runtime boundaries are explicit.
- Owner browser fixture verified: no platform controls or manual credits; balance
  and a three-seat invoice request at USD 5 correctly display USD 15.
- Fresh real backup restored in a disposable network-isolated PostgreSQL container;
  the original data snapshot matched. The container was then removed.
- Both validation installers published to the local download manifest; pilot and
  server archives contain committed source metadata and no local secret files.
