# Workspaces, subscriptions and bilingual console

Confirmed: English and Russian. Browser language selects a supported locale;
English is the fallback. An explicit selection persists and is available before
Google login. Translation target languages remain independent.

Identity is a Google account; authorization and billing belong to a workspace.
Plus is personal, one per identity, with no invitations. Business supports teams.
A person may own Plus and also join Business workspaces. Initial prices:
Plus $5/month including the owner's product access and AI; Business $10/month
plus $5 for every enabled product seat, including an owner who opts in.
All three prices are platform-admin settings.

Calendar month in UTC; full price for any part of the month; no automatic
refund. Charges capture their historical price. Workspace base and unpaid seats
are collected atomically, with workspace locks and unique monthly charge keys.
Existing paid access survives a later unpaid seat batch. Insufficient funds
block product access, never the ability to sign in and pay. Owners can disable
renewal; paid current-month access remains. New seats require renewal enabled.

Self-service uses administrator-configured plan defaults for provider, model,
quotas and available languages. Secrets stay on the server. Platform admins
retain manual Business creation and balance adjustment.

Top-ups are durable payment orders. A trusted settlement service validates
amount, currency and provider reference, then records an immutable, idempotent
ledger credit. Initially only a platform admin confirms an externally paid
invoice. A future acquiring adapter must verify its provider event before
calling the same service. Browser clients cannot claim payment success.

Internal tenant identifiers identify workspaces; keeping this consistent domain
identifier preserves the installed native API contract without a second API or
compatibility layer. The database is one fresh schema, with no upgrade chain.
Startup refuses an incompatible database. Existing local data must be backed up
and explicitly imported into a fresh database before switching the local service.

Acceptance:
- Both locales cover login, onboarding, all console views, validation, errors,
  dialogs, status labels, dates and prices; user-entered content is untouched.
- New Google users can create either plan without an operator creating it.
- Plus team restrictions, ownership, configured defaults and all money handling
  are enforced server-side and tested against an isolated PostgreSQL database.
- Manual creation, team management, native entitlement, monthly renewal,
  balance idempotency and operator controls remain functional.
- Top-up requests survive refresh and duplicate settlement never double credits.
- Keyboard, mobile, empty and insufficient-funds states are verified in-browser.
