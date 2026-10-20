import XCTest
@testable import TypeTide

final class LanguageAndLifecycleTests: XCTestCase {
    @MainActor
    func testTideStateTracksStreamingLifecycle() {
        let model = TranslationPopupModel(original: "你好", target: .english)
        XCTAssertEqual(model.tidePhase, .waiting)

        model.appendTranslation("Hel")
        XCTAssertEqual(model.translation, "Hel")
        XCTAssertEqual(model.tidePhase, .flowing)

        model.appendTranslation("lo")
        model.finishTranslation()
        XCTAssertEqual(model.tidePhase, .settling)

        model.finishTide()
        XCTAssertEqual(model.tidePhase, .complete)

        model.resetTranslation()
        XCTAssertEqual(model.tidePhase, .waiting)
        XCTAssertTrue(model.translation.isEmpty)

        model.failTranslation("offline")
        XCTAssertEqual(model.tidePhase, .failed)
        XCTAssertEqual(model.errorText, "offline")
    }

    func testLanguageDetectionAndUnknownInput() {
        XCTAssertEqual(Language.detect(in: "今天天气很好，我们出去散步吧。"), .chinese)
        XCTAssertEqual(Language.detect(in: "The quick brown fox jumps over the lazy dog."), .english)
        XCTAssertNil(Language.detect(in: "   \n"))
    }

    func testDirectionLabels() {
        XCTAssertEqual(TranslationDirection.nativeToForeign.label(native: .chinese, foreign: .english), "中文 → English")
        XCTAssertEqual(TranslationDirection.foreignToNative.label(native: .chinese, foreign: .english), "English → 中文")
    }
}
