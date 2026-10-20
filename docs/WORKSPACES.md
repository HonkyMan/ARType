# Workspaces and payment integration

ARType identity is a Google account. A workspace owns its subscription, balance,
provider policy and memberships. One identity may own a personal Plus workspace
and join or own Business workspaces. Internal `tenant_id` names identify the same
workspace throughout the existing native API; there is no parallel compatibility API.

## Self-service

After Google sign-in, a user without memberships sees the plan selector.
`POST /api/workspaces` accepts only `plan`, `name`, and a UUID `idempotency_key`.
The server takes owner identity from the session and provider/model/quotas from
`plan_defaults`. A repeated creation request returns the original workspace;
a reused key with different fields is rejected. Plus is unique per identity.

Platform administrators enable registration separately for each plan in
**Pricing and registration**, after configuring an AI connection. On a fresh
installation registration is closed until these defaults are configured.
`GET /api/plans` is public and returns only prices and registration availability.
The operator-only organization form remains available for manual Business setup.

## Billing

Initial USD monthly prices: Plus 500 cents including the personal seat and AI;
Business 1000 cents for the workspace plus 500 cents for every enabled app seat.
A Business owner has console access without a paid seat and must enable their
own product seat to translate. Business does not include an owner seat.
All three prices are configurable by platform administrators.

Months are calendar months in UTC. No prorating or automatic refunds. Subscription
charges are unique by workspace/month; Business seat charges by workspace/email/month.
Historical rows retain their original prices. Re-enabling a paid seat does not
charge twice. A subscription and its unpaid seats are paid as one atomic batch;
insufficient funds leave the batch pending. Existing paid seats remain usable
when a later batch cannot be paid. Product access requires both subscription
and seat payment (Plus needs only subscription payment), plus active membership
and workspace status. Role alone never grants product access.

There is no manual renewal switch or renewal HTTP endpoint in the console.
Monthly renewal remains a server billing operation; future acquiring adapters
can manage subscription lifecycle through the trusted domain service.
Unpaid missed months are not charged retroactively. Disabled/expired memberships
do not renew.

### Explicit seat activation

Invitations are free and start with app access disabled. Existing owners already
appear in the table and can be selected like other employees. The table supports
selection, select-all-visible, and one Connect/Disconnect action per selection.
Search clears hidden selections. The server accepts up to 1,000 selected IDs.

`POST /api/tenants/:id/member-access/quote` is read-only. It returns the exact
current-month seat charge, any unpaid Business base subscription, already-paid
seats, balance shortfall and next UTC billing date. Workspace administrators
may act only on ordinary members and do not receive balance amounts.

`POST /api/tenants/:id/member-access` requires the confirmed quote fingerprint
and an idempotency UUID. Under the workspace lock it rechecks authorization,
membership, capacity, subscription state, month, prices and balance. A stale
quote requires a new confirmation. Insufficient funds reject the entire action
without enabling employees or recording a charge. Only selected unpaid seats
are charged by this operation. The same email/month is not charged twice.

Disconnecting stops app access immediately, without refunding the current month.
The dialog shows the next UTC month from which the selected seats will no longer
be charged. Restoring console membership does not silently restore app access.
Direct `product_enabled` membership patches are rejected.

The `members.product` audit row uses the operation UUID as its primary key and
retains the normalized request and result. Preserve these rows as the durable
replay journal: they must not be purged by general audit-retention jobs.

## Payment boundary

1. Owner or platform administrator creates a `payment_orders` row through
   `POST /api/tenants/:id/payment-orders` with amount in cents and an idempotency UUID.
2. The request remains pending and visible after reload. The operator sees a
   pending-request link on the dashboard and issues an invoice outside ARType.
3. Once money has actually arrived, the operator confirms the exact amount and
   a globally unique payment/invoice reference with
   `POST /api/payment-orders/:id/settle`.
4. `settleManualPayment` enforces platform authorization and calls the trusted
   `settlePayment` service. This service verifies amount/currency, locks the
   workspace and order, writes an immutable ledger credit, records the provider
   reference, and reconciles subscription/seat charges in the same transaction.
5. Repeated settlement with the same reference returns the recorded result;
   different details or reusing a reference for another order produce HTTP 409.

No payment gateway or automatic invoice-document delivery is configured.
A future acquiring adapter must create a checkout from the server-side order
amount, verify the provider's signature and authoritative event/payment data,
then call `settlePayment(pool, {orderId, amountCents, currency, provider, reference})`.
Do not trust browser redirect parameters or expose this function directly as an
unauthenticated endpoint. The adapter's provider/reference must identify the
payment globally and consistently across retries. Failed settlement rolls back
both the ledger and order. Cancellation/refunds require their own audited domain
operations; they must not modify historical ledger rows.

### Optional manual invoice inbox

The operator's **Top-up requests** page displays workspace, requester, amount,
date and status, with pending/paid/all filters and cursor pagination. The overview
links to pending requests. Owner-facing text explicitly describes an invoice
request, not a generated invoice document. Counts update on page load/refresh.

`server/src/invoice-inbox.js` and the corresponding view are read-only projections
of existing payment orders. Set `MANUAL_INVOICE_INBOX=0` and recreate the API to
hide the navigation/overview notice and disable this endpoint. Payment-order
creation, settlement, wallet history and translation access continue unchanged.
This switch is tested with actual payment creation, settlement and entitlement.

## Localization

English and Russian dictionaries live in `server/public/modules/locales`.
Browser preferences select a supported language, with English fallback. An explicit
choice is retained in local storage and available before login. Language changes
respect the unsaved-form dialog. Message keys, interpolation, locale-aware dates,
money, validation and HTTP error codes are covered by tests. User text is never
translated by replacing DOM content. Translation target languages are independent.

## Fresh schema and deployment

`server/src/schema.sql` is the complete schema. `schema.js` initializes it under
an advisory transaction lock and records identity `artype-workspaces-v1`.
It refuses an existing incompatible database; there is no automatic upgrade chain
and no destructive reset on startup. Back up existing data and encryption keys
before an explicit import into a fresh database. The optional `ARTYPE_DATABASE`
Compose setting selects an already provisioned database; changing it does not
create a new database in an existing PostgreSQL volume.

## People directory and bulk invitations

Platform administrators use **Users** (`#users`) to find registered accounts and
pending membership emails in one list. It is one row per normalized email, with
server-side search, Personal/Business/both/no-workspace filters, and 50 rows per
page. Personal means a personal subscription exists; Business means at least one
organization membership exists, including disabled memberships. These flags do
not indicate payment or app entitlement. An account may have neither flag before
choosing a plan. The personal subscription action opens its existing management
screen; the owner has one **Personal subscription** navigation entry.

Workspace lists and the dashboard's workspace table contain only Business
organizations. Platform totals still include subscription and seat charges from
both plans. `/api/me` returns the administrator's own memberships rather than
enumerating all customer workspaces; administrators retain access to individual
workspace management through the directory and workspace list.

The invitation field accepts up to 200 emails per request. Tab, blur, space,
comma, Enter, semicolon and newline create tags. Invalid tags are highlighted;
duplicates are normalized and combined. Existing members are explicitly skipped,
without changing their roles or product access. All new recipients use the role
selected in the form, subject to the existing owner/admin permissions.

**Connect app access immediately** defaults off. Both free and paid invitations
have a confirmation step. `POST /api/tenants/:id/invitations/quote` previews the
new recipients, skipped addresses and exact current-month charge. Confirmation
uses `POST /api/tenants/:id/invitations` with the quote token and operation UUID.
Paid invitations insert memberships and charge only those new seats in one
transaction, including any unpaid Business base. Insufficient funds or capacity
reject the entire operation. Concurrent changes require a new confirmed quote.
Audit action `members.invite` stores durable idempotency request/result records;
preserve it alongside `members.product` when setting retention policies.

No invitation emails are sent. Share the console URL for Google sign-in. A
submitted invitation draft survives an in-console trip to the deposit form until
sign-out or page reload; it is not persisted in browser storage.
