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

After the Chrome extension popup was dismissed, the remaining browser checks
completed on the same isolated preview database:

- Immediate connection at zero balance showed three new seats × $5 = $15,
  skipped the existing owner and disabled confirmation. The deposit form was
  prefilled with $15, and returning to the team restored all four email tags.
- Fixture credit `QA-SIMULATED-INVITATIONS-20261020` funded exactly $15. Confirming
  the three invitations created paid seats, leaving balance $0. The existing
  owner retained management-only access and their owner role.
- A second batch of two invitations with immediate connection off completed at
  zero balance. Both employees appeared as Not connected, without a seat charge.
- The operator directory displayed the owner once, with both Personal and
  Business marks and two organizations. The combined filter returned one row.
- With 60 additional fixture identities, search returned 50 rows on page 1 and
  the remaining 10 on page 2, starting at identity 051. English and Russian
  navigation, search and filter labels were inspected.
- Personal subscription management opened from the person's row. Workspace cards
  listed only the two Business organizations; no customer-specific sidebar items
  appeared for the operator.
- At 390 × 844, the invitation form, confirmation dialog and directory rendered
  within the viewport. Document width was 375px with a vertical scrollbar and
  no horizontal overflow. The temporary viewport override was reset afterward.

Screenshots are retained in `.local/qa/people-invitations/`, including
`directory-both-ru.png`, `confirm-ru.png`, `connected-ru.png`,
`mobile-form-ru.png`, `mobile-confirm-ru.png` and `mobile-directory-en.png`.
The console contained two autofill-extension errors attributed to its own
`chrome-extension://` script; no application-script errors were observed.
No product-code changes were needed during the resumed browser acceptance.

The local Docker build is deployed at `http://127.0.0.1:8080`. API and database
report healthy; all **33 public assets** and **42 server files** match the source.
A pre-update dump is saved under
`.local/backups/people-invitations-20261020/before-update.dump`.
Tests used only dedicated `_test` and preview databases. No production employees
or balances were changed for test scenarios. No native installer was rebuilt.
