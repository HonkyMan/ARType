//
//  AppSettings.swift
//  TypeTide
//
//  统一配置入口（替代散落的 UserDefaults 读写）。
//

import AppKit

/// 划词触发方式
enum SelectionTrigger: String, CaseIterable, Identifiable {
    case none      // 仅快捷键
    case icon      // 划词后显示小图标，点击翻译
    case auto      // 划词后直接弹出翻译

    var id: String { rawValue }
    var displayName: String {
        switch self {
        case .none: return "Off (shortcut only)"
        case .icon: return "Show floating icon"
        case .auto: return "Auto-translate"
        }
    }
}

enum ShortcutAction: String, CaseIterable, Identifiable {
    case smartPopup
    case nativePopup
    case foreignPopup
    case smartReplace
    case nativeReplace
    case foreignReplace

    var id: String { rawValue }
    var displayName: String {
        switch self {
        case .smartPopup: return "Smart translate · popup"
        case .nativePopup: return "Translate to native language · popup"
        case .foreignPopup: return "Translate to foreign language · popup"
        case .smartReplace: return "Smart translate · replace"
        case .nativeReplace: return "Translate to native language · replace"
        case .foreignReplace: return "Translate to foreign language · replace"
        }
    }
    var usesPopup: Bool {
        switch self {
        case .smartPopup, .nativePopup, .foreignPopup: return true
        case .smartReplace, .nativeReplace, .foreignReplace: return false
        }
    }
}

/// 改写/翻译风格（仅改写使用；读翻译固定 faithful）
enum RewriteStyle: String, CaseIterable, Identifiable {
    case faithful  // 纯翻译
    case formal    // 正式
    case casual    // 口语
    case polished  // 润色

    var id: String { rawValue }
    var displayName: String {
        switch self {
        case .faithful: return "Faithful (plain translation)"
        case .formal: return "Formal"
        case .casual: return "Casual / spoken"
        case .polished: return "Polished"
        }
    }

}

/// 全局设置。非 View 代码用静态访问；View 用 @AppStorage 直接绑定同名 key。
enum AppSettings {
    static let defaultReadShortcut = KeyboardShortcutPreference(keyCode: 2, modifiers: [.option])
    static let defaultRewriteShortcut = KeyboardShortcutPreference(keyCode: 15, modifiers: [.option])

    enum Keys {
        static let enabled = "isTypeTideEnabled"
        // 语言：sourceLanguage = 用户母语，targetLanguage = 外语（见 LanguageConfig）
        // 触发快捷键
        static let readShortcut = "readShortcut"
        static let rewriteShortcut = "rewriteShortcut"
        static let readShortcutAction = "readShortcutAction"
        static let rewriteShortcutAction = "rewriteShortcutAction"

        // 翻译方向（读 / 写 各自独立；默认 auto 双向）
        static let readDirection = "readDirection"
        static let rewriteDirection = "rewriteDirection"

        // 行为
        static let selectionTrigger = "selectionTrigger"
        static let rewritePreview = "rewritePreview"
        static let rewriteStyle = "rewriteStyle"
        static let skipApps = "appSkipList"
        static let hasCompletedFirstLaunch = "hasCompletedFirstLaunch"
    }

    private static let d = UserDefaults.standard

    static var isEnabled: Bool {
        get { d.object(forKey: Keys.enabled) as? Bool ?? true }
        set { d.set(newValue, forKey: Keys.enabled) }
    }

    // MARK: 快捷键
    static var readShortcut: KeyboardShortcutPreference? {
        get { shortcut(forKey: Keys.readShortcut, defaultValue: defaultReadShortcut) }   // ⌥D
        set { saveShortcut(newValue, forKey: Keys.readShortcut) }
    }
    static var rewriteShortcut: KeyboardShortcutPreference? {
        get { shortcut(forKey: Keys.rewriteShortcut, defaultValue: defaultRewriteShortcut) } // ⌥R
        set { saveShortcut(newValue, forKey: Keys.rewriteShortcut) }
    }
    static var readShortcutAction: ShortcutAction {
        get { ShortcutAction(rawValue: d.string(forKey: Keys.readShortcutAction) ?? "") ?? .smartPopup }
        set { d.set(newValue.rawValue, forKey: Keys.readShortcutAction) }
    }
    static var rewriteShortcutAction: ShortcutAction {
        get { ShortcutAction(rawValue: d.string(forKey: Keys.rewriteShortcutAction) ?? "") ?? .smartReplace }
        set { d.set(newValue.rawValue, forKey: Keys.rewriteShortcutAction) }
    }

    // MARK: 翻译方向
    static var readDirection: TranslationDirection {
        get { TranslationDirection(rawValue: d.string(forKey: Keys.readDirection) ?? "") ?? .auto }
        set { d.set(newValue.rawValue, forKey: Keys.readDirection) }
    }
    static var rewriteDirection: TranslationDirection {
        get { TranslationDirection(rawValue: d.string(forKey: Keys.rewriteDirection) ?? "") ?? .auto }
        set { d.set(newValue.rawValue, forKey: Keys.rewriteDirection) }
    }

    // MARK: 行为
    static var selectionTrigger: SelectionTrigger {
        get { SelectionTrigger(rawValue: d.string(forKey: Keys.selectionTrigger) ?? "") ?? .none }
        set { d.set(newValue.rawValue, forKey: Keys.selectionTrigger) }
    }
    static var rewritePreview: Bool {
        get { d.bool(forKey: Keys.rewritePreview) }   // 默认 false = 直接替换
        set { d.set(newValue, forKey: Keys.rewritePreview) }
    }
    static var rewriteStyle: RewriteStyle {
        get { RewriteStyle(rawValue: d.string(forKey: Keys.rewriteStyle) ?? "") ?? .faithful }
        set { d.set(newValue.rawValue, forKey: Keys.rewriteStyle) }
    }
    /// 跳过列表兼容现有逗号分隔存储；匹配应用名、bundle id 或 .app 名称。
    static var skipApps: [String] {
        d.string(forKey: Keys.skipApps)?
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty } ?? []
    }

    static func applicationIdentifiers(_ app: NSRunningApplication?) -> [String] {
        guard let app else { return [] }
        return [
            app.localizedName,
            app.bundleIdentifier,
            app.bundleURL?.deletingPathExtension().lastPathComponent
        ].compactMap { $0 }
    }

    static func shouldSkipFrontmostApplication() -> Bool {
        TranslationActionPolicy.isExcluded(
            applicationIdentifiers: applicationIdentifiers(NSWorkspace.shared.frontmostApplication),
            exclusions: skipApps
        )
    }

    private static func shortcut(forKey key: String,
                                 defaultValue: KeyboardShortcutPreference) -> KeyboardShortcutPreference? {
        guard let data = d.data(forKey: key) else { return defaultValue }
        return StoredShortcutPreference.decode(data, defaultValue: defaultValue)
    }
    private static func saveShortcut(_ shortcut: KeyboardShortcutPreference?, forKey key: String) {
        if let data = try? JSONEncoder().encode(StoredShortcutPreference(shortcut: shortcut)) {
            d.set(data, forKey: key)
        }
    }
}
