# Native session storage

ARType stores desktop sessions in macOS Keychain or Windows Credential Manager.
The credential identifier now includes the configured service origin. Origins are
normalized by scheme, lowercase host and effective port; default ports and a
trailing slash do not create a new identity. Different schemes, hosts or
non-default ports use separate credentials. HTTPS is required outside the
explicit loopback development origins.

Existing versions stored one unscoped session token. Its issuing origin cannot
be established safely, so the new client never reads, copies or deletes that
legacy record. Users upgrading from that version must sign in with Google once
again. Organization, language, shortcut and behavior preferences remain intact.
Signing out removes only the session for the current configured origin.

Changing the server in a new installer requires signing in to that server.
An existing session from another deployment is never sent automatically.
No provider API keys or model configuration are stored by the native clients.

The origin regression runners use synthetic values and the Services regression
runner uses its own uniquely named pasteboard. They do not inspect real
credentials or modify the general clipboard.
