//
//  TextReplacer.swift
//  TypeTide
//
//  原地替换：合成粘贴，保留撤销栈；用后还原剪贴板。
//

import AppKit
import CoreGraphics

enum TextReplacer {
#if DEBUG
    /// XCTest seam for exercising the complete popup replacement flow without
    /// requiring a CI runner to hold a macOS Accessibility grant.
    @MainActor static var replacementOverride: ((String, Bool) async -> Void)?
#endif

    /// 用译文替换。selectAll=true 时先 ⌘A 全选（整框改写），否则直接粘到当前选区。
    @MainActor
    @discardableResult
    static func replace(
        with text: String, selectAll: Bool, target: ReplacementTarget? = nil,
        pasteboard pb: NSPasteboard = .general,
        press: @MainActor (CGKeyCode, Bool) -> Bool = { Keyboard.press($0, command: $1) },
        pause: (UInt64) async -> Void = { try? await Task.sleep(nanoseconds: $0) }
    ) async -> Bool {
        let start = ContinuousClock.now
        guard !Task.isCancelled, let target, target.isCurrent() else {
            recordReplacement(outcome: "cancelled", start: start)
            return false
        }
#if DEBUG
        if let replacementOverride {
            await replacementOverride(text, selectAll)
            recordReplacement(outcome: "success", start: start)
            return true
        }
#endif
        let before = pb.changeCount
        let saved = PasteboardHelper.snapshot(from: pb)
        guard pb.changeCount == before, !Task.isCancelled, target.isCurrent() else {
            recordReplacement(outcome: "cancelled", start: start)
            return false
        }

        let clearedChangeCount = pb.clearContents()
        guard pb.setString(text, forType: .string) else {
            PasteboardHelper.restore(saved, ifUnchangedSince: clearedChangeCount, to: pb)
            recordReplacement(outcome: "failure", start: start)
            return false
        }
        let ownedChangeCount = pb.changeCount
        defer { PasteboardHelper.restore(saved, ifUnchangedSince: ownedChangeCount, to: pb) }

        if selectAll {
            guard !Task.isCancelled, target.isCurrent(), pb.changeCount == ownedChangeCount,
                  press(Keyboard.aKey, true) else {
                recordReplacement(outcome: "failure", start: start)
                return false
            }
            await pause(40_000_000)
        }
        guard !Task.isCancelled, target.isCurrent(afterSelectAll: selectAll),
              pb.changeCount == ownedChangeCount else {
            recordReplacement(outcome: "cancelled", start: start)
            return false
        }
        guard press(Keyboard.vKey, true) else {
            recordReplacement(outcome: "failure", start: start)
            return false
        }

        // 等粘贴完成再还原剪贴板，避免还原把待粘贴内容覆盖掉
        await pause(150_000_000)
        recordReplacement(outcome: "success", start: start)
        return true
    }

    private static func recordReplacement(outcome: String, start: ContinuousClock.Instant) {
        let elapsed = start.duration(to: .now)
        let event = DiagnosticEvent(
            name: .replacement,
            outcome: outcome,
            totalMilliseconds: elapsed.milliseconds
        )
        Task { await LocalDiagnostics.shared.record(event) }
    }
}

extension Duration {
    var milliseconds: Int {
        let parts = components
        return Int(parts.seconds * 1_000) + Int(parts.attoseconds / 1_000_000_000_000_000)
    }
}
