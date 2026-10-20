# ARType architecture

The corporate product has one Express/PostgreSQL service, a browser console and
native macOS/Windows clients. Google confirms identity; tenant membership and
product entitlement separately determine access. Provider credentials remain on
the server. Text is passed to the selected provider without persistence in
application usage or audit tables.

| Area | Owner and boundary |
|---|---|
| HTTP composition | `server/src/app.js`, `http.js`, `routes/` install authentication, validation, routes and sanitized errors. |
| Authentication | `auth.js` adapts HTTP; `auth-oauth.js`, `auth-device.js`, `auth-session.js`, `auth-google.js`, `auth-crypto.js` own the corresponding workflows and primitives. |
| Authorization | `access.js` checks platform and tenant roles. Product access is described by `entitlements.js` and shared membership policy. |
| Organizations | `tenants.js` owns tenant and membership transactions. Mutations and seat checks serialize on the tenant row. |
| Billing | `billing.js` reconciles monthly seats; `wallets.js` owns balance adjustments and dashboard queries. Ledger records are immutable and operations are idempotent. |
| Provider connections | `connections.js` owns aliases and metadata; `credentials.js` encrypts keys. Stored connections override the environment alias. |
| Translation | `translation.js` reserves entitlement and usage under the tenant lock; `provider.js` owns external HTTP, bounded complete responses and metadata validation. |
| Persistence | `database.js` owns transactions. `migrations.js` applies versioned SQL atomically and refuses a newer unknown schema. |
| Browser | `public/modules` separates API/session, state/navigation, rendering and actions. Session/navigation generations reject stale results. |
| Native clients | Capture, managed account/transport and replacement preserve the original target and clipboard across asynchronous work. No direct provider or local-model runtime is distributed. |
| Delivery | Corporate platform builders produce installers. The package scripts combine committed server inputs and explicitly supplied installers into a Docker source bundle. |

Browser sessions use HttpOnly cookies with exact-origin and CSRF checks on
writes. Desktop credentials use the managed device grant and OS credential
storage. A local logout clears the browser state immediately; a failed server
request does not prove that the server session was revoked.

Billing identifies a paid seat by tenant, email and UTC calendar month.
Reconciliation charges the entire unpaid batch only when the wallet covers it.
Changing the rate does not rewrite existing charges. The owner can manage an
organization without buying a product seat; enabling the native product is a
separate action. External payment collection and invoice issuance remain manual.

The browser saves pending balance operations in an account-scoped sessionStorage
journal before sending them. Reloads of the same tab retain the exact request
and idempotency key; retries are explicit. A failed retry cannot disprove an
earlier commit whose response was lost. The journal is not a payment provider
or a durable cross-device ledger: PostgreSQL remains the financial source of truth.

The repository keeps internal TypeTide identifiers where compatibility requires
them, including the Xcode scheme and some native storage/resource paths. The
distributed application and active workflows use ARType. Historical content is
listed in [ARCHIVE.md](ARCHIVE.md); operations and release commands are in
[OPERATIONS.md](OPERATIONS.md).
