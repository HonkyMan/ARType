# Windows worker and clipboard lifecycle

The corporate app must stop accepting work before shutdown, cancel obsolete
results, restore a temporary clipboard only while it still owns that clipboard,
and retain its UI/message loop until workers have returned.

## Agreed implementation

- A fixed, owned worker pool replaces detached capture, replacement, account and
  translation threads. Its queue is bounded. Every task receives a stop token;
  task completion and exception paths decrement the active count.
- Shutdown first stops hotkeys/selection triggers and closes translation UI.
  It invalidates account and translation generations, requests worker stop and
  discards jobs that have not started. A UI timer polls drain completion; it does
  not join workers on the UI thread while they may still be executing.
- The hidden App window remains alive to consume/free posted payloads during
  drain. Handlers discard stale output. Once every worker has exited, the app
  destroys its windows and exits through the message loop; no ExitProcess.
- Account messages carry identifiers into an owned registry. Cancelling or
  closing Settings clears undelivered payloads; late queued identifiers cannot
  resurrect a previous account or leak an orphaned heap token.
- WinHTTP stays synchronous. Cancellation is checked before/after blocking calls,
  finite per-call timeouts and a total deadline bound work between calls.
  A synchronous request handle is never closed concurrently with its WinHTTP
  call. Shutdown does not claim immediate interruption of an in-flight call.
- UIA/clipboard calls into another process are an OS/provider boundary. The UI
  remains responsive while an outstanding call returns; we do not kill workers
  or free their data while they might still be executing.
- Clipboard snapshots preserve all enumerated supported memory formats and their
  order. Unsupported GDI/owner-display/private or unknown registered formats,
  unavailable data and size/count limits reject the whole snapshot before any
  EmptyClipboard or key injection. Restoration preallocates all memory handles
  and verifies sequence/owner under the clipboard lock.

## Verification

Portable tests exercise bounded queue admission, stop propagation, queued-job
discard, completion/error drain and rejection of jobs after stop; clipboard
format/budget policy and replacement effects; deadline expiration; exactly-once
message consumption and undelivered-message cleanup.
Native Windows checks must additionally cover rich clipboard round trips,
unsupported-format preservation, shutdown during delayed rendering and stalled
HTTP, and freeing queued message payloads. macOS/Xcode is outside this change.

## References

- https://learn.microsoft.com/windows/win32/winhttp/concurrency-in-winhttp
- https://learn.microsoft.com/en-us/windows/win32/dataxchg/clipboard-operations
- https://learn.microsoft.com/en-us/windows/win32/dataxchg/clipboard-formats
