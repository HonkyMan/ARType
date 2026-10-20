//
//  PreferencesSection.swift
//  TypeTide
//

import SwiftUI

enum PreferencesSection: String, CaseIterable, Identifiable {
    case general = "Аккаунт"
    case behavior = "Поведение"
    case language = "Языки"
    case shortcuts = "Горячие клавиши"
    case skipApps = "Исключения"
    case diagnostics = "Диагностика"

    var id: String { rawValue }

    var icon: String {
        switch self {
        case .general: return "gearshape.fill"
        case .behavior: return "wand.and.stars"
        case .language: return "globe"
        case .shortcuts: return "keyboard.fill"
        case .skipApps: return "nosign"
        case .diagnostics: return "waveform.path.ecg"
        }
    }

    /// 侧栏彩色徽标的 tint（与各页面分区标题保持一致）
    var tint: Color {
        switch self {
        case .general: return .blue
        case .behavior: return .purple
        case .language: return .green
        case .shortcuts: return .pink
        case .skipApps: return .red
        case .diagnostics: return .purple
        }
    }
}
