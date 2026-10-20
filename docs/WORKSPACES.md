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

Owners may turn off auto-renewal. Paid current-month access is preserved; future
charges stop. New seats cannot be enabled while renewal is off. Turning renewal
back on reconciles current charges immediately. Unpaid missed months are not
charged retroactively. Disabled/expired memberships do not renew.

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
