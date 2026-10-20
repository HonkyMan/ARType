import Foundation

@main
struct SelectionIconTimeoutTests {
    @MainActor
    static func main() async throws {
        let timer = SelectionIconAutoHide()
        var hidden: [String] = []
        timer.schedule { hidden.append("old icon") }
        try await Task.sleep(nanoseconds: 10_000_000)
        timer.schedule { hidden.append("new icon") }
        try await Task.sleep(nanoseconds: 20_000_000)
        precondition(hidden.isEmpty, "Cancelling the old timeout must not hide the new icon")
        timer.cancel()
        try await Task.sleep(nanoseconds: 20_000_000)
        precondition(hidden.isEmpty, "Explicit dismissal must cancel its pending action")
        timer.schedule(afterNanoseconds: 10_000_000) { hidden.append("current icon") }
        try await Task.sleep(nanoseconds: 100_000_000)
        precondition(hidden == ["current icon"], "The current icon must still auto-hide once")
        print("selection icon timeout tests passed")
    }
}
