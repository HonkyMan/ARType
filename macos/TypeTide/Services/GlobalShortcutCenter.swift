//
//  GlobalShortcutCenter.swift
//  TypeTide
//
//  全局快捷键管理器 - 支持注册多个独立热键（按 id 区分）。
//

import AppKit
import Carbon
import OSLog

enum ShortcutRegistrationStatus: Equatable {
    case inactive
    case notConfigured
    case registered
    case duplicate
    case unavailable(OSStatus)

    var message: String {
        switch self {
        case .inactive: return "TypeTide is off"
        case .notConfigured: return "Not set"
        case .registered: return "Registered"
        case .duplicate: return "Must be different from the other shortcut"
        case .unavailable: return "Unavailable or already used by another app"
        }
    }

    var isSuccess: Bool { self == .registered }
}

enum ShortcutConfiguration {
    static func isDuplicate(_ first: KeyboardShortcutPreference?,
                            _ second: KeyboardShortcutPreference?) -> Bool {
        guard let first, let second else { return false }
        return first == second
    }

    static func isReady(read: KeyboardShortcutPreference?,
                        readStatus: ShortcutRegistrationStatus,
                        rewrite: KeyboardShortcutPreference?,
                        rewriteStatus: ShortcutRegistrationStatus) -> Bool {
        guard read != nil || rewrite != nil else { return false }
        return (read == nil || readStatus.isSuccess)
            && (rewrite == nil || rewriteStatus.isSuccess)
    }
}

/// Carbon can deliver more than one pressed event for a held global shortcut.
/// Coalesce only same-ID events that arrive inside a short repeat window.
struct ShortcutEventDebouncer {
    private var lastHandledNanoseconds: [UInt32: UInt64] = [:]
    let minimumIntervalNanoseconds: UInt64

    init(minimumIntervalNanoseconds: UInt64 = 300_000_000) {
        self.minimumIntervalNanoseconds = minimumIntervalNanoseconds
    }

    mutating func shouldHandle(id: UInt32, nowNanoseconds: UInt64) -> Bool {
        defer { lastHandledNanoseconds[id] = nowNanoseconds }
        guard let previous = lastHandledNanoseconds[id], nowNanoseconds >= previous else { return true }
        return nowNanoseconds - previous >= minimumIntervalNanoseconds
    }
}

final class GlobalShortcutCenter {
    static let shared = GlobalShortcutCenter()
    private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.xnu.typetide",
                                category: "GlobalShortcuts")

    private var hotKeyRefs: [UInt32: EventHotKeyRef] = [:]
    private var handlers: [UInt32: () -> Void] = [:]
    private var eventHandler: EventHandlerRef?
    private var eventDebouncer = ShortcutEventDebouncer()

    private init() {}

    /// 注册一个热键。同一 id 重复注册会覆盖旧的。
    @discardableResult
    func register(id: UInt32, shortcut: KeyboardShortcutPreference,
                  handler: @escaping () -> Void) -> ShortcutRegistrationStatus {
        unregister(id: id)
        guard shortcut.isValid else {
            recordRegistration(outcome: "failure", errorCategory: "invalidShortcut")
            return .unavailable(OSStatus(paramErr))
        }
        installEventHandlerIfNeeded()

        handlers[id] = handler

        let hotKeyID = EventHotKeyID(signature: "TRNL".fourCharCode, id: id)
        var ref: EventHotKeyRef?
        let status = RegisterEventHotKey(UInt32(shortcut.keyCode),
                                         shortcut.modifiers.carbonFlags,
                                         hotKeyID,
                                         GetApplicationEventTarget(),
                                         0,
                                         &ref)
        if status == noErr, let ref {
            hotKeyRefs[id] = ref
            logger.notice("Registered shortcut id=\(id) as \(shortcut.displayString, privacy: .public)")
            recordRegistration(outcome: "success")
            return .registered
        } else {
            handlers[id] = nil
            logger.error("Failed to register shortcut id=\(id), status=\(status)")
            recordRegistration(outcome: "failure", errorCategory: "osStatus_\(status)")
            return .unavailable(status)
        }
    }

    private func recordRegistration(outcome: String, errorCategory: String? = nil) {
        let event = DiagnosticEvent(name: .shortcutRegistration, outcome: outcome,
                                    errorCategory: errorCategory)
        Task { await LocalDiagnostics.shared.record(event) }
    }

    func unregister(id: UInt32) {
        if let ref = hotKeyRefs[id] {
            UnregisterEventHotKey(ref)
        }
        hotKeyRefs[id] = nil
        handlers[id] = nil
    }

    func unregisterAll() {
        for id in Array(hotKeyRefs.keys) { unregister(id: id) }
    }

    private func installEventHandlerIfNeeded() {
        guard eventHandler == nil else { return }
        var eventSpec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard),
                                      eventKind: UInt32(kEventHotKeyPressed))
        let selfPointer = UnsafeMutableRawPointer(Unmanaged.passUnretained(self).toOpaque())
        InstallEventHandler(GetApplicationEventTarget(), { (_, event, userData) -> OSStatus in
            guard let userData, let event else { return noErr }
            let manager = Unmanaged<GlobalShortcutCenter>.fromOpaque(userData).takeUnretainedValue()
            var hkID = EventHotKeyID()
            GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID),
                              nil, MemoryLayout<EventHotKeyID>.size, nil, &hkID)
            let now = DispatchTime.now().uptimeNanoseconds
            guard manager.eventDebouncer.shouldHandle(id: hkID.id, nowNanoseconds: now) else {
                manager.logger.notice("Ignored repeated shortcut id=\(hkID.id)")
                return noErr
            }
            manager.logger.notice("Received shortcut id=\(hkID.id)")
            manager.handlers[hkID.id]?()
            return noErr
        }, 1, &eventSpec, selfPointer, &eventHandler)
    }

    deinit {
        unregisterAll()
        if let eventHandler { RemoveEventHandler(eventHandler) }
    }
}

private extension String {
    var fourCharCode: OSType {
        var result: OSType = 0
        for scalar in unicodeScalars.prefix(4) {
            result = (result << 8) + OSType(scalar.value)
        }
        return result
    }
}
