# People directory and bulk invitations — 2026-10-20

## Acceptance scope

- One operator-only Users page for all registered and invited identities, with
  Personal and Business flags, search, filters and 50-row server pagination.
- Personal accounts excluded from workspace cards, sidebar shortcuts and the
  dashboard workspace table. Owners retain a single personal subscription entry.
- Multiple email tags with Tab/blur, space, comma, Enter and pasted-list support;
  duplicate normalization, invalid-address feedback and individual removal.
- Optional immediate app connection, confirmed exact charge, atomic insufficient
  funds/capacity rejection, skipped existing memberships and durable retries.
- Google authentication, role separation, calendar-month billing and managed
  native entitlement remain in place. No schema migration is required.

## Automated checks

```sh
npm --prefix server run check
TEST_DATABASE_URL=postgresql://artype@127.0.0.1:55438/artype_test \
  node --test --test-timeout=30000 --test-concurrency=1 server/test/*.test.js
node --test deployment/tests/*.test.mjs
```

Coverage includes 1,000 directory identities, 50-row pages, both account flags,
invited and unassigned accounts, operator-only visibility, duplicate/case
normalization, role preservation, read-only quotes, insufficient funds rollback,
changed prices and balances, concurrent capacity/replay, both language catalogs,
escaped UI content and late navigation responses.

Results: **119/119** tests passed in the full PostgreSQL/interface run, followed
by **50/50** focused UI/navigation tests after adding a stale-dialog guard and
its regression test. Deployment checks: **16/16** passed. Syntax checks and
`git diff --check` passed.

## Browser and deployment evidence

On the isolated `artype_preview` instance, the existing owner session opened its
personal subscription through one navigation entry and a Business team through
its workspace. Email entry by Tab, space and comma produced normalized tags;
pasted mixed lists combined a duplicate, displayed an invalid tag and blocked
submission with the explicit validation message.

Further browser acceptance was interrupted by another Chrome extension's open
UI. The user was asked to dismiss it. Immediate-connect checkbox interaction,
final invitation modal, directory layout and mobile layout have **not** been
visually verified in this revision. Their API/renderer/navigation behavior is
covered by the automated checks above. This limitation is not a claim that the
remaining browser acceptance passed.

The local Docker build is deployed at `http://127.0.0.1:8080`. API and database
report healthy; all **33 public assets** and **42 server files** match the source.
A pre-update dump is saved under
`.local/backups/people-invitations-20261020/before-update.dump`.
Tests used only dedicated `_test` and preview databases. No production employees
or balances were changed for test scenarios. No native installer was rebuilt.
