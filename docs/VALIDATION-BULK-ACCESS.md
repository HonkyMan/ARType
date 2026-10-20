# Bulk app access and invoice inbox — 2026-10-20

## Requirements and implementation

1. The team table supports individual selection and select-all-visible. Search
   clears hidden selections. Actions are disabled for an empty selection.
2. Connect/Disconnect apply to the selection. Individual app toggle buttons are
   removed; console sign-in blocking remains a separately named operation.
3. A modal previews the exact charge, including any unpaid Business base,
   selected unpaid seats and already-paid seats. Disconnect explains immediate
   access loss, no current-month refund and the next UTC billing date.
4. Insufficient funds disable confirmation and reject the operation server-side
   without partial changes. The deposit action opens the workspace payment form
   with the required shortfall. Workspace administrators who cannot manage the
   balance are directed to the owner.
5. Requests persist as payment orders. A separate platform inbox displays the
   workspace, requester, amount, date and status. The overview shows a pending
   notice. `MANUAL_INVOICE_INBOX=0` removes this optional interface and endpoint
   while payment orders, settlement, balances and product access still work.
6. Manual renewal controls and the public renewal endpoint are removed.
   Calendar-month billing remains; subscription lifecycle is a server concern
   for the future acquiring adapter.

Invitations are now free and do not connect app access. The owner is already in
the team list and can select their own seat. Restoring console membership never
silently buys or reconnects a seat.

## Automated verification

```sh
npm --prefix server run check
TEST_DATABASE_URL=postgresql://artype@127.0.0.1:55438/artype_test \
  node --test --test-timeout=30000 --test-concurrency=1 server/test/*.test.js
node --test deployment/tests/*.test.mjs
git diff --check
```

Result: syntax checks passed, **109/109 server/interface tests passed**,
**16/16 deployment tests passed**, no whitespace errors.

The new cases exercise read-only quotes, exact amounts, atomic rejection,
concurrent replay, changed balance/price, seat-capacity races, role and workspace
isolation, expired invitations and role edits, blocked direct-patch bypass, no double charge,
stopping future seat charges, invoice pagination/status and the disabled-inbox
configuration. Both language catalogs and modal states are checked.

## Browser verification

Write scenarios used only the isolated `artype_preview` database with simulated
Google and AI adapters. No real payment or production balance was altered.

- Created Business workspace `Access UX QA`, invited two employees without a
  charge, selected both using search and select-all-visible.
- At zero balance, the modal showed $10 for two seats plus $10 Business base,
  disabled confirmation and offered a $20 deposit.
- The deposit action prefilled $20. The invoice request persisted after reload
  and appeared on the operator overview and dedicated inbox with owner email.
- Simulated settlement `QA-SIMULATED-BULK-002` credited $20 and paid the $10 base.
  The request left the pending inbox.
- The owner cancelled a $10 connection preview without changing access, then
  confirmed: both employees became active and the remaining $10 was charged.
- Disconnecting both stopped access and showed 1 November 2026 UTC as the next
  billing date with no further seat charge. Reconnecting both previewed $0 and
  succeeded at a zero balance.
- English and Russian flows were inspected. At 390 × 844 the confirmation dialog
  remained within the viewport; document width was 375px, with no horizontal
  document overflow. Searching after selection cleared hidden selected rows.

The existing database schema is unchanged. New idempotent member operations
retain request/result records in `audit` under action `members.product`;
preserve these records when defining future retention jobs.

## Local deployment

The live database was backed up before recreating the API container. Both Docker
services report healthy and `/health` returns `status: ok`. All 29 public assets
served on port 8080 and all 40 server files inside the running container match
the reviewed source. The existing authenticated browser session opens the updated
Plus payment screen with the deposit action and no manual renewal control.

The write scenarios above remain isolated fixtures. Production users, balances
and memberships were not edited for acceptance. Native installers were not
rebuilt; this server change preserves their managed entitlement contract.
