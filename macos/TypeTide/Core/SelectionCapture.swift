//
//  SelectionCapture.swift
//  TypeTide
//
//  取词：优先 AX kAXSelectedText，兜底模拟 ⌘C 复制并还原剪贴板。
//

import ApplicationServices
import AppKit

/// 改写模式抓取的上下文
struct RewriteCapture {
    let text: String
    /// true = 取的是整个输入框（替换时需先全选）；false = 取的是当前选区
    let isWholeField: Bool
    let element: AXUIElement?
    let selectedRange: CFRange?
    let method: CaptureMethod
    let replacementTarget: ReplacementTarget?
}

struct ReplacementSelection {
    let text: String
    let value: String?
    let range: CFRange
    let wholeField: Bool

    func matches(value currentValue: String?, selectedText: String?, range currentRange: CFRange,
                 afterSelectAll: Bool) -> Bool {
        if let value, currentValue != value { return false }
        if afterSelectAll {
            return wholeField && currentRange.location == 0 &&
                currentRange.length == (text as NSString).length && selectedText == text
        }
        guard currentRange.location == range.location, currentRange.length == range.length else { return false }
        return wholeField ? currentValue == text : selectedText == text
    }
}

/// A proof of the original destination, retained across network requests.
/// The verifier is injected so replacement can be tested without Accessibility
/// permission or sending keyboard events to the user's applications.
@MainActor
struct ReplacementTarget {
    private let verify: (Bool) -> Bool

    init(verify: @escaping (Bool) -> Bool) { self.verify = verify }

    func isCurrent(afterSelectAll: Bool = false) -> Bool { verify(afterSelectAll) }

    func requiring(_ contextIsCurrent: @escaping () -> Bool) -> ReplacementTarget {
        ReplacementTarget { contextIsCurrent() && self.isCurrent(afterSelectAll: $0) }
    }

    static func capture(element: AXUIElement?, range: CFRange?, text: String,
                        wholeField: Bool) -> ReplacementTarget? {
        guard let element, let window = SelectionCapture.axWindow(element),
              let focused = SelectionCapture.focusedElement(), CFEqual(element, focused) else { return nil }
        var pid: pid_t = 0
        guard AXUIElementGetPid(element, &pid) == .success,
              NSWorkspace.shared.frontmostApplication?.processIdentifier == pid else { return nil }
        let originalValue = SelectionCapture.axValue(element)
        let originalRange = range ?? SelectionCapture.axSelectedRange(element)
        guard let originalRange, originalRange.location >= 0, originalRange.length >= 0,
              wholeField ? originalValue == text : SelectionCapture.axSelectedText(element) == text else { return nil }
        let selection = ReplacementSelection(text: text, value: originalValue, range: originalRange, wholeField: wholeField)

        let target = ReplacementTarget { afterSelectAll in
            guard NSWorkspace.shared.frontmostApplication?.processIdentifier == pid,
                  let current = SelectionCapture.focusedElement(), CFEqual(element, current),
                  let currentWindow = SelectionCapture.axWindow(current), CFEqual(window, currentWindow),
                  let selected = SelectionCapture.axSelectedRange(current) else { return false }
            return selection.matches(value: SelectionCapture.axValue(current),
                                     selectedText: SelectionCapture.axSelectedText(current),
                                     range: selected, afterSelectAll: afterSelectAll)
        }
        return target.isCurrent() ? target : nil
    }
}

enum CaptureMethod: String {
    case accessibility
    case clipboardFallback
}

enum SelectionCapture {

    // MARK: 读模式：拿到选中的文字

    /// 读模式取词：AX 选区优先，兜底复制。返回 (文字, 元素, 选区range) 供定位。
    @MainActor
    static func readSelection() async -> (text: String, element: AXUIElement?, range: CFRange?, method: CaptureMethod)? {
        let element = focusedElement()
        if let element {
            if let t = axSelectedText(element), !t.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                recordCapture(outcome: "success", method: .accessibility, characterCount: t.count)
                return (t, element, axSelectedRange(element), .accessibility)
            }
        }
        if let copied = await copyViaPasteboard(),
           !copied.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            recordCapture(outcome: "success", method: .clipboardFallback, characterCount: copied.count)
            // Clipboard text alone cannot prove the identity/range of an editor.
            return (copied, nil, nil, .clipboardFallback)
        }
        recordCapture(outcome: "failure", method: nil, characterCount: nil)
        return nil
    }

    // MARK: 写模式：拿到选区或整个输入框

    @MainActor
    static func captureForRewrite() async -> RewriteCapture? {
        if let element = focusedElement() {
            // 有选区 → 只改选区
            if let range = axSelectedRange(element), range.length > 0,
               let sel = axSelectedText(element),
               !sel.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                recordCapture(outcome: "success", method: .accessibility, characterCount: sel.count)
                return RewriteCapture(text: sel, isWholeField: false, element: element,
                                      selectedRange: range, method: .accessibility,
                                      replacementTarget: .capture(element: element, range: range, text: sel, wholeField: false))
            }
            // 无选区 → 改整个输入框
            if let value = axValue(element),
               !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                recordCapture(outcome: "success", method: .accessibility, characterCount: value.count)
                return RewriteCapture(text: value, isWholeField: true, element: element,
                                      selectedRange: nil, method: .accessibility,
                                      replacementTarget: .capture(element: element, range: nil, text: value, wholeField: true))
            }
        }
        // AX 拿不到 → 兜底复制（按选区处理）
        if let copied = await copyViaPasteboard(),
           !copied.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            recordCapture(outcome: "success", method: .clipboardFallback, characterCount: copied.count)
            return RewriteCapture(text: copied, isWholeField: false, element: nil,
                                  selectedRange: nil, method: .clipboardFallback, replacementTarget: nil)
        }
        recordCapture(outcome: "failure", method: nil, characterCount: nil)
        return nil
    }

    // MARK: - AX helpers

    static func focusedElement() -> AXUIElement? {
        let systemWide = AXUIElementCreateSystemWide()
        var focused: AnyObject?
        let err = AXUIElementCopyAttributeValue(systemWide, kAXFocusedUIElementAttribute as CFString, &focused)
        guard err == .success, let element = focused,
              CFGetTypeID(element) == AXUIElementGetTypeID() else { return nil }
        return (element as! AXUIElement)
    }

    static func axSelectedText(_ element: AXUIElement) -> String? {
        var value: AnyObject?
        let err = AXUIElementCopyAttributeValue(element, kAXSelectedTextAttribute as CFString, &value)
        guard err == .success else { return nil }
        return value as? String
    }

    static func axValue(_ element: AXUIElement) -> String? {
        var value: AnyObject?
        let err = AXUIElementCopyAttributeValue(element, kAXValueAttribute as CFString, &value)
        guard err == .success else { return nil }
        return value as? String
    }

    static func axSelectedRange(_ element: AXUIElement) -> CFRange? {
        var value: AnyObject?
        let err = AXUIElementCopyAttributeValue(element, kAXSelectedTextRangeAttribute as CFString, &value)
        guard err == .success, let value, CFGetTypeID(value) == AXValueGetTypeID() else { return nil }
        var range = CFRange()
        if AXValueGetValue(value as! AXValue, .cfRange, &range) {
            return range
        }
        return nil
    }

    static func axWindow(_ element: AXUIElement) -> AXUIElement? {
        var value: AnyObject?
        guard AXUIElementCopyAttributeValue(element, kAXWindowAttribute as CFString, &value) == .success,
              let value, CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
        return (value as! AXUIElement)
    }

    // MARK: - 模拟复制兜底

    @MainActor
    static func copyViaPasteboard() async -> String? {
        let pb = NSPasteboard.general
        let beforeCount = pb.changeCount
        let saved = PasteboardHelper.snapshot()
        guard !Task.isCancelled, pb.changeCount == beforeCount,
              Keyboard.press(Keyboard.cKey, command: true) else { return nil }

        var result: String?
        var copiedChangeCount: Int?
        // 最多等 ~400ms 让目标 app 写入剪贴板
        for _ in 0..<20 {
            try? await Task.sleep(nanoseconds: 20_000_000)
            if pb.changeCount != beforeCount {
                copiedChangeCount = pb.changeCount
                result = pb.string(forType: .string)
                break
            }
        }
        if let copiedChangeCount {
            PasteboardHelper.restore(saved, ifUnchangedSince: copiedChangeCount)
        }
        return result
    }

    private static func recordCapture(outcome: String, method: CaptureMethod?, characterCount: Int?) {
        let event = DiagnosticEvent(
            name: .selectionCapture,
            outcome: outcome,
            captureMethod: method?.rawValue,
            inputCharacterCount: characterCount
        )
        Task { await LocalDiagnostics.shared.record(event) }
    }
}
