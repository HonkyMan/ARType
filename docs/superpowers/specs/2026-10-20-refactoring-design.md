# ARType architecture and security refactoring

The target is the complete corporate product: Express/PostgreSQL service,
browser console, macOS client, Windows client and their delivery tools. The
starting revision is `5e5d88a`. Existing tenant data, encrypted credentials,
balances, role semantics, monthly charges and native clipboard behavior are
compatibility requirements.

## Decisions

Use incremental domain extraction with regression checks. A framework rewrite
would increase migration risk without resolving the observed problems. Formatting
alone would leave circular dependencies, mixed responsibilities and unsafe native
replacement unchanged.

The server composition root owns middleware and route installation. Domain
services own authorization and transaction boundaries; database primitives and
versioned migrations do not import business services. Billing policy, billing
queries and HTTP adaptation have distinct responsibilities. Shared input schemas
and errors replace duplicated policy. Provider adapters validate external output
and enforce resource limits.

The console keeps its current visual design, but separates API/session handling,
navigation state, rendering and feature actions into browser modules. Stale
responses must not restore a previous tenant or authenticated screen after logout.

Desktop clients remain native. Corporate builds retain only the managed product
path and necessary capture, language, clipboard and diagnostic functionality.
Legacy offline providers and their delivery dependencies must be traced before
removal. Stored sessions and user settings must not be silently erased.

Replacement carries the captured target identity through the asynchronous
translation. Before changing the clipboard or injecting keys, the client must
verify that the original target and selection remain valid. An uncertain target
must preserve the original and offer the completed translation for manual copying.
Bounded network responses, strict JSON parsing and cancellation protect native
processes against malformed input.

## Acceptance

- Every supported entry point has a documented owner and explicit trust boundary.
- Confirmed security findings have code fixes and regression evidence.
- Database migrations work both on an empty database and an existing version 4
  database, preserving credentials, owners, paid seats and ledger records.
- Server imports are acyclic; routes, policy, storage and external adapters are
  independently understandable and tested.
- Console tests cover tenant navigation, session expiration and stale responses.
- Native tests cover response limits, malformed JSON, wrong-target replacement,
  cancellation and clipboard preservation.
- Corporate builds exclude unused local-model runtime dependencies and preserve
  full upstream license attribution.
- Relevant checks pass on macOS and Windows, including installed Windows
  self-tests; server and deployment tests run against isolated data.
- Operations and packaging documentation match actual scripts and artifacts.
- Final review reconciles all findings and coverage gaps. Unreviewed or unverified
  areas remain explicit; absence of a finding is not proof of security.

## Constraints

No changes to real tenant balances during tests. No secret values in logs,
reports or commits. No new product framework or external tool installation.
Unsigned localhost builds remain validation artifacts. Public deployment,
signing certificates and payment acquiring are external delivery prerequisites,
not substitutes for completing the code refactoring.
