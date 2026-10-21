# Platform administration implementation plan

**Goal:** Delegate platform operations and manage AI connections and downloads.
**Spec:** ../specs/2026-10-20-platform-administration.md
**Execution:** Inline in the existing corporate checkout; preserve live data.
**Stack:** Node 24, Express, PostgreSQL, existing Russian web console, Docker.

## 1. Platform administrators

- [ ] Add failing integration tests for grant/revoke, owner denial, CSRF and
  protected bootstrap/self removal in `server/test/product.test.js`.
- [ ] Migrate `platform_admins` and audit details in `server/src/store.js`.
  Resolve database grants in `server/src/auth.js` on every authenticated request.
- [ ] Add GET/PUT/DELETE `/api/platform-admins` and console settings UI.
- [ ] Run the server test suite and verify tenant roles stay independent.

## 2. Provider connections

- [ ] Test per-connection routing, model defaults and URL changes without a key.
- [ ] Add nullable `base_url`/`default_model` metadata, preserving old keys.
- [ ] Extend operator-only connection endpoints and provider HTTP routing.
- [ ] Add editable connection forms and tenant connection/model selection.
- [ ] Verify existing credential rotation, authorization and navigation tests.

## 3. Downloads

- [ ] Test authenticated manifest/download access and rejection of unlisted paths.
- [ ] Add release publishing script, manifest reader and download routes.
- [ ] Mount release directory read-only in both Compose configurations.
- [ ] Display version, platform, signing status and SHA-256 on the help page.
- [ ] Publish the existing pilot installers locally, check downloaded hashes.

## 4. Billing and native access notices

- [ ] Test free owner, paid self-enrollment, per-tenant/month uniqueness,
  atomic renewal, frozen historical rates and disabled-seat exclusion.
- [ ] Add pricing, wallet, immutable ledger and unique monthly seat records.
- [ ] Reconcile on enrollment, credits, profile refresh and a background job.
- [ ] Add dashboard, balance history, manual credit/correction and invoice stub.
- [ ] Add native startup notices from server `can_translate`/`access_message`.
- [ ] Run native protocol tests, Xcode tests and Windows CI installer checks.

## 5. Verification and handoff

- [ ] Run `npm run check`, `npm test` with isolated `_test` PostgreSQL,
  deployment tests and Docker build.
- [ ] Back up real Docker PostgreSQL before updating; keep the encryption master.
- [ ] Check actual console and downloads; report billing decisions still pending.
