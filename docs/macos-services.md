# macOS Services translation

The **Translate with ARType** Services menu action accepts selected text and
immediately opens an ARType popup. Translation runs asynchronously. The popup
shows progress, the finished translation, or a safe error message. Use **Copy**
to copy a finished translation manually; this Services action does not replace
text in the originating application.

The action declares `NSSendTypes` without `NSReturnTypes`. macOS expects returned
pasteboard data to be ready when a Services selector returns. An asynchronous
network request cannot meet that contract. The previous implementation returned
early and attempted to write the caller's pasteboard later; this version removes
that unreliable behavior. The selection and caller's pasteboard remain unchanged.
The normal translation/replacement shortcuts keep their existing purpose.

Services uses the same enabled state, excluded applications and 5000-character
input limit as the native shortcut flow. It records the originating application's
identifiers before any asynchronous work. Closing its popup or invoking a new
Services request cancels the pending result. A changed session, organization,
enabled/exclusion policy or input pasteboard version discards the late response.
A stale completion cannot update a newer popup. The popup's **Copy** button is
the only Services action that writes to the general clipboard.

The portable regression runner invokes the actual Objective-C selector through
an injected presentation and translator, checks immediate presentation before
return, then completes a suspended translation. It covers successful display,
visible failures, cancellation, policy and account changes, and unchanged input
pasteboard content. The manifest regression checks that no synchronous return
type is advertised. A packaged-client acceptance check is still needed to verify
macOS's Services menu registration and visual popup behavior.
