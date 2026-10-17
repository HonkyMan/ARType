# ARType corporate distribution

## Intent
Fork TypeTide into ARType for employees of multiple products. Employees install a
DMG or EXE, sign in with Google and translate or replace selected text. The
operator provisions organizations and invoices manually; organization owners and
administrators manage their teams. Acquiring is outside this release.

## Architecture
Retain native SwiftUI and Win32 clients and existing capture/replacement code.
Add a Node 24 server and PostgreSQL 15+ database. A same-origin web cabinet serves
the operator, organization owners and administrators. All translations go through
the server. Server-side provider keys come from environment variables, selected
per organization by credential alias; the cabinet never returns keys.

Google OIDC uses a confidential web client, PKCE, state bound to a browser cookie
and a nonce checked against a verified ID token. The desktop starts a short-lived
pairing session, opens a system browser, displays a matching code and polls with a
separate secret plus a PKCE verifier. The authenticated person explicitly approves
the displayed device. The resulting opaque ARType token is stored in macOS
Keychain / Windows Credential Manager; only token hashes persist on the server.
No Google or provider secrets ship in installers. Web sessions use HttpOnly,
SameSite cookies with CSRF and origin checks on mutations.

Organizations have seats, access expiration, suspension, model, provider alias,
monthly character quota, maximum text size, requests/minute, concurrency limit,
allowed languages and translation instructions. Membership is explicit by email
invitation, verified Google identity and role (owner/admin/member). No automatic
domain enrollment. Google login alone grants no organization access. Operator
emails are an explicit deployment allowlist. Every request checks current access.

Transactions lock the organization for seat changes and translation reservations.
In-flight reservations count toward monthly limits. Usage retains counts, timings,
status and identities, never selected text, prompts, translation or provider errors.
Do not use client translation caches: access revocation and current policy must
be checked before every translation. Do not retry billable requests automatically.
SSE deltas are presented only after a complete upstream result is validated, so a
provider failure cannot cause partial text replacement. This buffers first-token
delivery in v1; true upstream streaming is a later latency optimization.

## Product surfaces
Mac: account/organization, shortcuts, languages, behavior, excluded apps. Windows:
same account and personal controls. Both remove provider/model/key configuration,
local downloads and upstream update checks from employee flows. Login opens the
system browser; logout revokes the session and clears credentials. Transport is
HTTPS, with HTTP allowed only on loopback during development.

Cabinet: Google login, operator organization list and creation, per-organization
settings, team invitations and role/status changes, seat and monthly usage, usage
CSV for manual invoicing. Owners/admins see only their organization. Invitations
are copied and delivered manually, no unrequested email integrations.

Brand: vector Shift A sign reconstructed from the selected raster reference;
outline wordmark, template menu mark, ICNS/ICO and web SVG. Restrained violet,
ink and warm off-white UI. Retain upstream MIT notice.

## Delivery and acceptance
- Server tests cover isolation, roles, seat races, quota races, revocation,
  nonce/state, one-time device redemption, HTTP errors and text-free usage.
- Mac build and tests pass; Windows CI builds installer and runs self-tests.
- Browser verifies cabinet forms, empty/error states and organization switching.
- Docker Compose includes PostgreSQL, API, TLS reverse proxy, health checks,
  persistent volumes and documented backups/restores.
- Release scripts embed the deployment URL, produce ARType artifacts and checksums,
  and enforce signing for distributable artifacts.
- Live Google sign-in, actual provider translation, installation on clean Mac and
  Windows machines, signatures and production server health must be observed before
  calling the product ready for employee distribution.

## External dependencies
Await user domain/server access, Google client ID/secret and admin email, provider
credential/model choice and Apple/Windows signing availability. Independent code,
local tests and unsigned validation packages proceed while these are pending.
