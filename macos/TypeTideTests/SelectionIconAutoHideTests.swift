import XCTest
@testable import TypeTide

final class SelectionIconAutoHideTests: XCTestCase {
    @MainActor
    func testReplacingOrCancellingTimeoutDoesNotDismissCurrentIcon() async throws {
        let timer = SelectionIconAutoHide()
        var hidden: [String] = []
        timer.schedule { hidden.append("old") }
        try await Task.sleep(nanoseconds: 10_000_000)
        timer.schedule { hidden.append("new") }
        try await Task.sleep(nanoseconds: 20_000_000)
        XCTAssertEqual(hidden, [])
        timer.cancel()
        try await Task.sleep(nanoseconds: 20_000_000)
        XCTAssertEqual(hidden, [])
        timer.schedule(afterNanoseconds: 10_000_000) { hidden.append("current") }
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertEqual(hidden, ["current"])
    }
}
