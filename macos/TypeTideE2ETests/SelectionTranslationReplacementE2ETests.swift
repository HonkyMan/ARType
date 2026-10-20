import AppKit
import XCTest
@testable import TypeTide

private struct MockStreamingProvider: TranslationProvider {
    let id = "e2e-mock"

    func stream(_ request: TranslationRequest) -> AsyncThrowingStream<String, Error> {
        AsyncThrowingStream { continuation in
            XCTAssertEqual(request.text, "你好世界")
            XCTAssertEqual(request.target, .english)
            continuation.yield("MOCK_")
            continuation.yield("TRANSLATION_OK")
            continuation.finish()
        }
    }
}

@MainActor
final class SelectionTranslationReplacementE2ETests: XCTestCase {
    override func tearDown() async throws {
        PopupController.shared.close()
        TranslationService.shared.providerOverride = nil
        TextReplacer.replacementOverride = nil
        try await super.tearDown()
    }

    func testSelectedTextStreamsIntoPopupAndReplaceUpdatesEditor() async throws {
        let oldNative = LanguageConfig.sourceLanguage
        let oldForeign = LanguageConfig.targetLanguage
        defer { LanguageConfig.sourceLanguage = oldNative; LanguageConfig.targetLanguage = oldForeign }
        LanguageConfig.sourceLanguage = .chinese
        LanguageConfig.targetLanguage = .english
        let editor = NSTextView(frame: NSRect(x: 0, y: 0, width: 480, height: 180))
        editor.string = "前缀 你好世界 后缀"
        let selected = (editor.string as NSString).range(of: "你好世界")
        editor.setSelectedRange(selected)
        XCTAssertEqual((editor.string as NSString).substring(with: editor.selectedRange()), "你好世界")

        TranslationService.shared.providerOverride = MockStreamingProvider()
        TextReplacer.replacementOverride = { [weak editor] replacement, selectAll in
            guard let editor else { return }
            if selectAll { editor.selectAll(nil) }
            editor.insertText(replacement, replacementRange: editor.selectedRange())
        }

        // This is the same entry point used after SelectionCapture has obtained
        // a real AX selection. It creates the production NSPanel and streams into it.
        TriggerController.shared.presentRead(
            text: (editor.string as NSString).substring(with: editor.selectedRange()),
            element: nil,
            range: nil,
            dismissOnInteraction: false,
            replacementTarget: ReplacementTarget { _ in
                editor.selectedRange() == selected &&
                    editor.string == "前缀 你好世界 后缀"
            }
        )

        XCTAssertTrue(PopupController.shared.isVisible)
        let model = try XCTUnwrap(PopupController.shared.currentModel)
        try await waitUntil("streamed translation") { model.translation == "MOCK_TRANSLATION_OK" }
        XCTAssertEqual(model.translation, "MOCK_TRANSLATION_OK")
        try await waitUntil("completion animation") { model.tidePhase == .complete }

        model.onReplace?()
        try await waitUntil("editor replacement") { editor.string.contains("MOCK_TRANSLATION_OK") }

        XCTAssertEqual(editor.string, "前缀 MOCK_TRANSLATION_OK 后缀")
        XCTAssertFalse(PopupController.shared.isVisible)
    }

    private func waitUntil(_ state: String, timeout: Duration = .seconds(5),
                           condition: @escaping @MainActor () -> Bool) async throws {
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: timeout)
        while !condition() {
            guard clock.now < deadline else {
                XCTFail("Timed out waiting for end-to-end state: \(state)")
                return
            }
            try await Task.sleep(for: .milliseconds(20))
        }
    }

    func testOrganizationSwitchClosesTranslationFromPreviousAccountContext() async throws {
        let previous = ManagedAccount.shared.selected
        let oldNative = LanguageConfig.sourceLanguage
        let oldForeign = LanguageConfig.targetLanguage
        defer { ManagedAccount.shared.selected = previous; LanguageConfig.sourceLanguage = oldNative; LanguageConfig.targetLanguage = oldForeign }
        LanguageConfig.sourceLanguage = .chinese
        LanguageConfig.targetLanguage = .english
        TranslationService.shared.providerOverride = MockStreamingProvider()
        TriggerController.shared.presentRead(text: "你好世界", element: nil, range: nil, dismissOnInteraction: false)
        XCTAssertTrue(PopupController.shared.isVisible)
        ManagedAccount.shared.selected = UUID().uuidString
        XCTAssertFalse(PopupController.shared.isVisible)
    }

    func testChangedSelectionKeepsCompletedTranslationForManualCopy() async throws {
        let oldNative = LanguageConfig.sourceLanguage
        let oldForeign = LanguageConfig.targetLanguage
        defer { LanguageConfig.sourceLanguage = oldNative; LanguageConfig.targetLanguage = oldForeign }
        LanguageConfig.sourceLanguage = .chinese
        LanguageConfig.targetLanguage = .english
        TranslationService.shared.providerOverride = MockStreamingProvider()
        var originalSelectionStillFocused = true
        var editor = "你好世界"
        TextReplacer.replacementOverride = { value, _ in editor = value }
        TriggerController.shared.presentRead(text: editor, element: nil, range: nil,
            dismissOnInteraction: false,
            replacementTarget: ReplacementTarget { _ in originalSelectionStillFocused })
        let model = try XCTUnwrap(PopupController.shared.currentModel)
        try await waitUntil("translation") { model.translation == "MOCK_TRANSLATION_OK" }
        originalSelectionStillFocused = false
        model.onReplace?()
        try await waitUntil("manual copy fallback") {
            PopupController.shared.currentModel?.replacementNotice != nil
        }
        let fallback = try XCTUnwrap(PopupController.shared.currentModel)
        XCTAssertEqual(editor, "你好世界")
        XCTAssertEqual(fallback.translation, "MOCK_TRANSLATION_OK")
        XCTAssertNil(fallback.onReplace)
        XCTAssertNotNil(fallback.onCopy)
        XCTAssertNil(fallback.errorText)
    }

    func testNewReadInvalidatesPreviousPopupReplacement() async throws {
        TranslationService.shared.providerOverride = MockStreamingProvider()
        var editor = "你好世界"
        TextReplacer.replacementOverride = { value, _ in editor = value }
        let destination = ReplacementTarget { _ in true }
        TriggerController.shared.presentRead(text: editor, element: nil, range: nil,
            targetOverride: .english, dismissOnInteraction: false, replacementTarget: destination)
        let previous = try XCTUnwrap(PopupController.shared.currentModel)
        try await waitUntil("previous translation") { previous.translation == "MOCK_TRANSLATION_OK" }
        TriggerController.shared.presentRead(text: editor, element: nil, range: nil,
            targetOverride: .english, dismissOnInteraction: false, replacementTarget: destination)
        let current = try XCTUnwrap(PopupController.shared.currentModel)
        previous.onReplace?()
        try await waitUntil("current translation") { current.translation == "MOCK_TRANSLATION_OK" }
        XCTAssertEqual(editor, "你好世界")
        XCTAssertTrue(PopupController.shared.currentModel === current)
    }
}
