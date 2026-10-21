# Plus navigation and live language policy

Scope: make the existing Plus subscription visible without adding personal
accounts to the organization list; propagate Plus language changes to existing
accounts; sync macOS and Windows without rebuilding for each policy change;
preserve disabled selections and provide a direct settings recovery action.

Decisions:
- The workspace overview shows the current user's own Plus summary separately
  from Business organizations. Creating a Business organization is optional.
- Plus inherits languages from plan configuration at read time. Business keeps
  per-organization languages. Other plan defaults retain their creation scope.
- Authenticated profiles and a read-only language-policy endpoint share one
  resolver; translations enforce the same effective list on the server.
- Clients refresh profiles every 30 seconds and fetch the selected workspace's
  language policy before each translation. Failure to fetch does not bypass it.
- Clients preserve the selected pair. Disabled choices remain visibly marked;
  translation errors open `artype://settings/languages`, a strict fixed route.
- A one-time client update is necessary to install polling and error recovery.
  Subsequent toggles among the ten supported languages require no new build.

Acceptance evidence to collect before completion:
1. Existing Plus owner sees their subscription and an explicitly Business-only
   empty/list state in English and Russian, including small viewport.
2. Admin edits Plus languages; an already-created account immediately receives
   the new policy. Business configuration is unchanged.
3. The same running native client updates choices on addition/removal; it does
   not silently replace the stored pair. A disabled-language request cannot call
   the provider or replace text. Recovery opens the language settings section.
4. Server/UI, native policy checks, full Xcode tests, Windows build/self-tests and
   installed self-tests, deployment checks pass for the reviewed source.
5. Local server is deployed with backup; versioned DMG/EXE and Docker source
   packages contain the reviewed source/origin and are available in downloads.

These remain unsigned local validation installers. External distribution still
requires public HTTPS, matching OAuth configuration and release signing.
