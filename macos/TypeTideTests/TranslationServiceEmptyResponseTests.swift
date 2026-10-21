import XCTest
@testable import TypeTide

private struct EmptyTranslationProvider: TranslationProvider {
    let id = "empty-test-provider"

    func stream(_ request: TranslationRequest) -> AsyncThrowingStream<String, Error> {
        AsyncThrowingStream { continuation in
            continuation.finish()
        }
    }
}

@MainActor
final class TranslationServiceEmptyResponseTests: XCTestCase {
    override func tearDown() {
        TranslationService.shared.providerOverride = nil
        super.tearDown()
    }

    func testStreamRejectsSuccessfulButEmptyProviderResponse() async {
        TranslationService.shared.providerOverride = EmptyTranslationProvider()

        do {
            for try await _ in TranslationService.shared.stream(
                text: "synthetic input",
                from: .english,
                to: .chinese
            ) {}
            XCTFail("Expected an empty-response error")
        } catch let error as TranslationError {
            XCTAssertEqual(error.category, "emptyResponse")
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    func testReplacementRejectsEmptyProviderResponse() async {
        TranslationService.shared.providerOverride = EmptyTranslationProvider()
        do {
            _ = try await TranslationService.shared.translateFully(
                text: "synthetic input", from: .english, to: .chinese
            )
            XCTFail("An empty response must never replace the selected text")
        } catch let error as TranslationError {
            XCTAssertEqual(error.category, "emptyResponse")
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }
}

private struct CancelledTranslationProvider: TranslationProvider {
    let id = "cancelled-test-provider"
    func stream(_ request: TranslationRequest) -> AsyncThrowingStream<String, Error> {
        AsyncThrowingStream { continuation in
            continuation.yield("incomplete")
            continuation.finish(throwing: CancellationError())
        }
    }
}

extension TranslationServiceEmptyResponseTests {
    func testCancelledStreamNeverReturnsPartialTextForReplacement() async {
        TranslationService.shared.providerOverride = CancelledTranslationProvider()
        do {
            _ = try await TranslationService.shared.translateFully(text: "cancelled synthetic input", from: .english, to: .chinese)
            XCTFail("Partial translations must never be returned for replacement")
        } catch is CancellationError {
            // Expected: preserve the original selected text.
        } catch { XCTFail("Unexpected error: \(error)") }
    }
}
