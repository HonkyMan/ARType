# ARType fork

This fork implements the user's corporate ARType product. The upstream TypeTide
brand, offline provider choices and public update feed are superseded here.
Keep upstream license attribution. Provider credentials stay server-side.
Use the Shift A logo and violet accent. Preserve native selection and clipboard
behavior. Never describe unsigned builds or simulated OAuth as distribution ready.

Server checks: `cd server && npm test` (requires TEST_DATABASE_URL).
Client checks: Xcode TypeTide scheme and Windows `--self-test` in CI.
