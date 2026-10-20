//
//  Pasteboard.swift
//  TypeTide
//
//  剪贴板快照/还原，避免取词/粘贴污染用户剪贴板。
//

import AppKit

enum PasteboardHelper {
    /// 深拷贝当前剪贴板所有 item。
    static func snapshot(from pb: NSPasteboard = .general) -> [NSPasteboardItem] {
        var items: [NSPasteboardItem] = []
        for item in pb.pasteboardItems ?? [] {
            let copy = NSPasteboardItem()
            for type in item.types {
                if let data = item.data(forType: type) {
                    copy.setData(data, forType: type)
                }
            }
            items.append(copy)
        }
        return items
    }

    /// Never overwrite a copy performed after our temporary clipboard write.
    @discardableResult
    static func restore(_ items: [NSPasteboardItem], ifUnchangedSince changeCount: Int,
                        to pb: NSPasteboard = .general) -> Bool {
        guard pb.changeCount == changeCount else { return false }
        pb.clearContents()
        if !items.isEmpty {
            return pb.writeObjects(items)
        }
        return true
    }
}
