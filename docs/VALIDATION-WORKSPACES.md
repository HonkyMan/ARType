# Workspaces and localization validation — 2026-10-20

This revision changes the web console, server and deployment tooling. Native
sources and installers remain at their existing 0.1.21 baseline.

## Automated checks

From the repository root:

```sh
npm --prefix server run check
TEST_DATABASE_URL=postgresql://artype@127.0.0.1:55438/artype_test \
  node --test --test-timeout=30000 --test-concurrency=1 server/test/*.test.js
node --test deployment/tests/*.test.mjs
git diff --check
```

Result: syntax checks passed, **97/97 server and interface tests passed**,
**16/16 deployment tests passed**, no whitespace errors.

Coverage includes:

- Concurrent fresh schema initialization and refusal of incompatible databases.
- English/Russian catalog parity, interpolation, browser language fallback,
  localized validation and API errors, and rendering every console view.
- Self-service creation bound to the signed-in owner, trusted plan defaults,
  unique personal workspaces and idempotent organization creation.
- Plus API restrictions, Business base plus every paid seat, insufficient funds,
  current-month access after disabling renewal and future renewal behavior.
- Durable payment orders, owner isolation, administrator-only settlement,
  concurrent retries, mismatched amounts and duplicate provider references.
- Existing authorization, native device pairing, translation entitlement,
  immutable ledger, stale response protection and unsaved-form behavior.

## Browser checks

The disposable preview database and simulated Google/provider adapters were
used for write scenarios. These were not real payments:

- Select Russian before sign-in; create personal Plus and Business workspaces.
- Plus exposes subscription/payment controls without team management.
- Invite a Business member: the free console owner has no product seat; the
  member awaits payment. The amount due is $10 base plus $5 for one seat.
- Create a $15 top-up request, reload and observe the same pending request.
- As the preview administrator, confirm reference `QA-SIMULATED-001`: the ledger
  records +$15, -$10 subscription and -$5 seat; the request becomes paid.
- Switch English/Russian, retain the selection on reload, and check localized
  dates, money, status messages and navigation.
- Change an unsaved price and switch language: Cancel preserves the draft and
  language; discarding restores the saved price. No test price was saved.
- At 390 × 844, the pricing page has no horizontal document overflow.

The live local service at `http://127.0.0.1:8080` was checked separately:

- Real Google sign-in returned to the updated platform overview as the primary
  platform administrator.
- Pricing and registration rendered in both English and Russian: Plus $5,
  Business $10 base, Business $5 per seat. Both registrations are enabled.
- All **27 public files** served by the running container match source hashes.
- `/health` returns `{"status":"ok","service":"ARType"}`; both Docker services
  report healthy.

## Data and recovery

Before cutover, the old database, environment and previous image identity were
saved locally. Existing identities, memberships, sessions, audit/usage rows,
balances and encrypted AI configuration were explicitly imported into a fresh
database with identity `artype-workspaces-v1`; counts and credential ciphertext
were compared. The original database remains available for rollback.

A backup of the new live database was restored into a separate temporary
database; schema identity and row counts matched. The temporary restore
database was then removed. Private backups and configuration are excluded from
Git and distributable archives.

## Boundaries

The acquiring adapter and automatic invoice-document delivery are not connected.
Current payments are external invoices confirmed by a platform administrator.
The trusted settlement service is ready for a future verified provider adapter.

No new native build, native OS test or real paid translation request was performed
for this web/server revision. The existing unsigned, loopback-configured 0.1.21
installers remain validation artifacts. Their prior checks are documented in
`VALIDATION-0.1.21.md`; public HTTPS, production OAuth configuration, signing and
OS acceptance are separate distribution requirements.
