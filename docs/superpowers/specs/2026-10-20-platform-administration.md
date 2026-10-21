# ARType platform administration

The platform owner needs to delegate operations, configure AI connections and
distribute installers without changing server environment variables. Existing
organizations and encrypted credentials must survive the update.

## Roles

`ADMIN_EMAILS` remains the protected bootstrap administrator list. Additional
platform administrators are assigned by Google email in the database. Only a
platform administrator may grant or revoke that role. Each API request reads
the current assignment; revocation applies to existing sessions immediately.
Bootstrap administrators cannot be removed through the console and an
administrator cannot revoke their own assignment. Changes are audited.

Tenant owner, tenant administrator and member remain separate roles. Owners
may appoint tenant administrators; that grants no platform privileges. Use
explicit Russian labels and show the distinction in invitation forms.

## AI connections

Each named connection owns an encrypted key, provider base URL and default
model. Existing records without the new metadata inherit the deployment
defaults. Operators choose a connection and may override its model per tenant.
Provider URL accepts HTTPS without credentials, query or fragment. Changing
an existing connection's URL requires explicitly supplying a new key, to avoid
silently forwarding an old secret to a different destination. Metadata-only
edits preserve the encrypted key. Provider redirects remain forbidden.

## Downloads

Serve a read-only local release directory mounted into the API. Its manifest
lists only published DMG/EXE files with SHA-256, version, platform, signing
status and service URL. An authenticated user can download a listed file;
unlisted paths are inaccessible. An empty directory shows an honest empty
state. Existing localhost unsigned installers are labeled pilot builds.
Publishing a production installer requires the final server URL and signing
certificates; this change does not claim employee distribution readiness.

## Billing agreed with the user

- USD 5 per unique email per tenant per calendar month, configurable only by
  platform administrators. The same email in two tenants incurs two charges.
- Full month price applies regardless of the enrollment day; disabling a seat
  does not refund it. Re-enrollment in the same tenant/month is free.
- Owners have free management access and no product access by default. They
  enable their own paid product seat explicitly, preserving the owner role.
- Enrollment and renewal serialize on the tenant row. The ledger records the
  original price; future price changes do not rewrite prior charges.
- Enabled product seats renew at the UTC calendar month boundary. Insufficient
  funds leave all unpaid seats Disabled, without a partial renewal. A later
  credit reconciles pending seats automatically. Paid current seats keep access.
- Invitation status is distinct from product access. Expired invitations and
  disabled product seats do not renew. Suspended/expired tenants do not renew.
- Manual credits and corrections are platform-admin only, append-only and
  idempotent. Balances are integer cents; a correction records a delta rather
  than rewriting history. Future acquiring can use payment-source entries and
  provider transaction IDs after webhook verification.
- Owner balance page includes a temporary invoice-request calculator with seat
  count. It does not issue fiscal documents, send email or pretend to collect
  payment. The operator manually credits paid invoices with a reason.
- Dashboard reports actual monthly seat charges, connected seats and usage.
  The native clients show the server's blocked-access reason on startup;
  translation authorization always remains server-enforced.

## Acceptance

- Owner/member requests cannot list or mutate platform administrators.
- Added platform administrators gain console access after verified Google login;
  removed administrators lose global privileges on the next request.
- Existing keys keep decrypting; routing uses the selected connection's URL.
- Model remains editable at tenant creation and in platform-only settings.
- Help displays working authenticated downloads with hashes and honest labels.
- Relevant server, browser navigation and deployment tests pass; a backup
  precedes updating the user's running Docker installation.
