import AppKit

@main
struct ServiceTranslationTests {
    @MainActor
    static func main() async throws {
        let board = NSPasteboard(name: .init("ARType-service-test-\(UUID())"))
        defer { board.releaseGlobally() }
        let revision = UUID()
        var enabled = true
        var excluded: [String] = []
        var account = revision
        var tenant = "one"
        var presentations = 0
        var results: [String] = []
        var failures: [String] = []
        var closed = 0
        var pending: CheckedContinuation<String, Error>?
        var cancel: (() -> Void)?
        let provider = SystemServiceProvider(environment: {
            .init(enabled: enabled, exclusions: excluded, accountRevision: account, tenant: tenant)
        }, applicationIdentifiers: { ["Private.app", "com.example.private"] }, makeWork: { request, onDismiss in
            precondition(!request.text.isEmpty)
            presentations += 1
            cancel = onDismiss
            return .init(translate: { _ in
                try await withCheckedThrowingContinuation { pending = $0 }
            }, showResult: { results.append($0) }, showError: { failures.append($0.localizedDescription) }, close: { closed += 1 })
        })
        func put(_ text: String) { board.clearContents(); board.setString(text, forType: .string) }
        func invoke() -> String {
            var error: NSString = ""
            provider.translateSelection(board, userData: "", error: &error)
            return error as String
        }
        func waitUntil(_ ready: () -> Bool) async throws {
            for _ in 0..<100 {
                if ready() { return }
                try await Task.sleep(nanoseconds: 1_000_000)
            }
            preconditionFailure("Service selector failed to make expected progress")
        }
        func complete(_ result: Result<String, Error>) async throws {
            try await waitUntil { pending != nil }
            let continuation = pending!
            pending = nil
            continuation.resume(with: result)
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        put("original")
        enabled = false
        precondition(!invoke().isEmpty && presentations == 0)
        enabled = true; excluded = ["private"]
        precondition(!invoke().isEmpty && presentations == 0)
        excluded = ["COM.EXAMPLE.PRIVATE"]
        precondition(!invoke().isEmpty && presentations == 0)
        excluded = []; put(String(repeating: "a", count: 5001))
        precondition(!invoke().isEmpty && presentations == 0)
        put(String(repeating: "a", count: 5000))
        let inputCount = board.changeCount
        precondition(invoke().isEmpty && presentations == 1)
        precondition(results.isEmpty, "Selector returns with visible loading UI, without awaiting the network")
        try await complete(.success("translated"))
        precondition(results == ["translated"] && failures.isEmpty)
        precondition(board.changeCount == inputCount && board.string(forType: .string)?.count == 5000,
                     "Asynchronous Services must not modify the caller's pasteboard")
        for change in 0..<6 {
            put("original"); enabled = true; excluded = []; account = revision; tenant = "one"
            let beforeClosed = closed
            precondition(invoke().isEmpty)
            try await waitUntil { pending != nil }
            switch change {
            case 0: put("newer clipboard")
            case 1: enabled = false
            case 2: excluded = ["private.app"]
            case 3: account = UUID() // Including A -> B -> A changes with a new revision.
            case 4: tenant = "two"
            default: cancel?()
            }
            try await complete(.success("stale translation"))
            precondition(results == ["translated"] && failures.isEmpty && closed == beforeClosed + 1)
            precondition(board.string(forType: .string) == (change == 0 ? "newer clipboard" : "original"))
        }
        enabled = true; excluded = []; account = revision; tenant = "one"; put("original")
        let count = board.changeCount
        precondition(invoke().isEmpty)
        try await complete(.failure(NSError(domain: "private-server-error", code: 500)))
        precondition(failures.count == 1 && !failures[0].contains("private-server-error"),
                     "Failures must be visible without exposing raw server errors")
        precondition(board.changeCount == count)
        precondition(invoke().isEmpty)
        try await complete(.success(" \n "))
        precondition(failures.count == 2 && board.changeCount == count)
        precondition(invoke().isEmpty)
        try await complete(.failure(CancellationError()))
        precondition(failures.count == 2 && results == ["translated"] && board.changeCount == count)
        precondition(invoke().isEmpty)
        try await waitUntil { pending != nil }
        let superseded = pending!
        pending = nil
        precondition(invoke().isEmpty)
        try await waitUntil { pending != nil }
        superseded.resume(returning: "superseded result")
        try await Task.sleep(nanoseconds: 10_000_000)
        precondition(results == ["translated"])
        try await complete(.success("latest result"))
        precondition(results == ["translated", "latest result"] && board.changeCount == count)
        print("Services selector and asynchronous presentation regressions passed")
    }
}
