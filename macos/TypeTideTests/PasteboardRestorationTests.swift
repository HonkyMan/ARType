import AppKit
import XCTest
@testable import TypeTide

final class PasteboardRestorationTests: XCTestCase {
    func testSelectionProofRejectsMovedSelectionOrChangedOriginalDocument() {
        let original = ReplacementSelection(text: "same", value: "same same", range: CFRange(location: 0, length: 4), wholeField: false)
        XCTAssertTrue(original.matches(value: "same same", selectedText: "same",
            range: CFRange(location: 0, length: 4), afterSelectAll: false))
        XCTAssertFalse(original.matches(value: "same same", selectedText: "same",
            range: CFRange(location: 5, length: 4), afterSelectAll: false))
        XCTAssertFalse(original.matches(value: "same edit", selectedText: "same",
            range: CFRange(location: 0, length: 4), afterSelectAll: false))
        XCTAssertFalse(original.matches(value: "same same", selectedText: "edit",
            range: CFRange(location: 0, length: 4), afterSelectAll: false))
    }

    func testWholeFieldProofRequiresCompleteSelectionAfterSelectAll() {
        let original = ReplacementSelection(text: "original", value: "original", range: CFRange(location: 2, length: 0), wholeField: true)
        XCTAssertTrue(original.matches(value: "original", selectedText: "original",
            range: CFRange(location: 0, length: 8), afterSelectAll: true))
        XCTAssertFalse(original.matches(value: "original", selectedText: "",
            range: CFRange(location: 2, length: 0), afterSelectAll: true))
        XCTAssertFalse(original.matches(value: "edited", selectedText: "edited",
            range: CFRange(location: 0, length: 6), afterSelectAll: true))
    }

    @MainActor
    func testReplacementWithoutProvenTargetNeverReachesEditor() async {
        var editor = "confidential original"
        TextReplacer.replacementOverride = { value, _ in editor = value }
        defer { TextReplacer.replacementOverride = nil }
        let replaced = await TextReplacer.replace(with: "translation", selectAll: false)
        XCTAssertFalse(replaced)
        XCTAssertEqual(editor, "confidential original")
    }

    func testSnapshotRestoresAllItemsAndRepresentations() throws {
        let pasteboard = NSPasteboard(name: .init("TypeTideTests.\(UUID().uuidString)"))
        pasteboard.clearContents()

        let first = NSPasteboardItem()
        first.setString("original text", forType: .string)
        first.setData(Data([0x01, 0x02, 0x03]), forType: .init("com.typetide.test.binary"))
        let second = NSPasteboardItem()
        second.setString("second item", forType: .string)
        XCTAssertTrue(pasteboard.writeObjects([first, second]))

        let snapshot = PasteboardHelper.snapshot(from: pasteboard)
        pasteboard.clearContents()
        pasteboard.setString("temporary translation", forType: .string)
        PasteboardHelper.restore(snapshot, ifUnchangedSince: pasteboard.changeCount, to: pasteboard)

        let restored = try XCTUnwrap(pasteboard.pasteboardItems)
        XCTAssertEqual(restored.count, 2)
        XCTAssertEqual(restored[0].string(forType: .string), "original text")
        XCTAssertEqual(restored[0].data(forType: .init("com.typetide.test.binary")), Data([0x01, 0x02, 0x03]))
        XCTAssertEqual(restored[1].string(forType: .string), "second item")
        pasteboard.releaseGlobally()
    }

    func testEmptySnapshotRestoresEmptyPasteboard() {
        let pasteboard = NSPasteboard(name: .init("TypeTideTests.\(UUID().uuidString)"))
        pasteboard.setString("temporary", forType: .string)
        PasteboardHelper.restore([], ifUnchangedSince: pasteboard.changeCount, to: pasteboard)
        XCTAssertEqual(pasteboard.pasteboardItems?.count ?? 0, 0)
        pasteboard.releaseGlobally()
    }

    func testLaterUserCopySurvivesAttemptedRestoration() {
        let pasteboard = NSPasteboard(name: .init("TypeTideTests.\(UUID().uuidString)"))
        defer { pasteboard.releaseGlobally() }
        pasteboard.setString("original", forType: .string)
        let saved = PasteboardHelper.snapshot(from: pasteboard)
        pasteboard.clearContents()
        pasteboard.setString("temporary translation", forType: .string)
        let owned = pasteboard.changeCount
        pasteboard.clearContents()
        pasteboard.setString("new user copy", forType: .string)
        XCTAssertFalse(PasteboardHelper.restore(saved, ifUnchangedSince: owned, to: pasteboard))
        XCTAssertEqual(pasteboard.string(forType: .string), "new user copy")
    }

    @MainActor
    func testChangedFieldRejectsReplacementBeforeClipboardMutation() async {
        let pasteboard = NSPasteboard(name: .init("TypeTideTests.\(UUID().uuidString)"))
        defer { pasteboard.releaseGlobally() }
        pasteboard.setString("user clipboard", forType: .string)
        let before = pasteboard.changeCount
        var keys = [CGKeyCode]()
        let target = ReplacementTarget { _ in false }
        let result = await TextReplacer.replace(with: "translation", selectAll: false, target: target,
            pasteboard: pasteboard, press: { key, _ in keys.append(key); return true }, pause: { _ in })
        XCTAssertFalse(result)
        XCTAssertTrue(keys.isEmpty)
        XCTAssertEqual(pasteboard.changeCount, before)
        XCTAssertEqual(pasteboard.string(forType: .string), "user clipboard")
    }

    @MainActor
    func testFieldChangeDuringSelectAllNeverPastesAndRestoresOwnedClipboard() async {
        let pasteboard = NSPasteboard(name: .init("TypeTideTests.\(UUID().uuidString)"))
        defer { pasteboard.releaseGlobally() }
        pasteboard.setString("user clipboard", forType: .string)
        var currentField = "original"
        var keys = [CGKeyCode]()
        let target = ReplacementTarget { _ in currentField == "original" }
        let result = await TextReplacer.replace(with: "translation", selectAll: true, target: target,
            pasteboard: pasteboard, press: { key, _ in keys.append(key); return true },
            pause: { _ in currentField = "different field in the same app" })
        XCTAssertFalse(result)
        XCTAssertEqual(keys, [Keyboard.aKey])
        XCTAssertEqual(pasteboard.string(forType: .string), "user clipboard")
    }

    @MainActor
    func testAccountCancellationDuringSelectAllNeverPastes() async {
        let pasteboard = NSPasteboard(name: .init("TypeTideTests.\(UUID().uuidString)"))
        defer { pasteboard.releaseGlobally() }
        pasteboard.setString("user clipboard", forType: .string)
        var accountGeneration = 1
        var keys = [CGKeyCode]()
        let target = ReplacementTarget { _ in true }.requiring { accountGeneration == 1 }
        let result = await TextReplacer.replace(with: "translation", selectAll: true, target: target,
            pasteboard: pasteboard, press: { key, _ in keys.append(key); return true },
            pause: { _ in accountGeneration = 2 })
        XCTAssertFalse(result)
        XCTAssertEqual(keys, [Keyboard.aKey])
        XCTAssertEqual(pasteboard.string(forType: .string), "user clipboard")
    }

    @MainActor
    func testUserCopyDuringPasteIsPreserved() async {
        let pasteboard = NSPasteboard(name: .init("TypeTideTests.\(UUID().uuidString)"))
        defer { pasteboard.releaseGlobally() }
        pasteboard.setString("old clipboard", forType: .string)
        var editor = "original"
        let result = await TextReplacer.replace(with: "translation", selectAll: false,
            target: ReplacementTarget { _ in editor == "original" }, pasteboard: pasteboard,
            press: { key, _ in
                XCTAssertEqual(key, Keyboard.vKey)
                editor = pasteboard.string(forType: .string) ?? ""
                return true
            }, pause: { _ in
                pasteboard.clearContents()
                pasteboard.setString("new user copy", forType: .string)
            })
        XCTAssertTrue(result)
        XCTAssertEqual(editor, "translation")
        XCTAssertEqual(pasteboard.string(forType: .string), "new user copy")
    }
}
