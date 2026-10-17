//
//  SettingsView.swift
//  TypeTide
//
//  设置页面 - 稳定的双栏布局，不让 NavigationSplitView 注入多余工具栏。
//

import SwiftUI

// MARK: - Main Settings Window

struct SettingsView: View {
    @State private var selection: PreferencesSection = .general
    @AppStorage(AppSettings.Keys.hasCompletedFirstLaunch) private var hasCompletedFirstLaunch = false

    var body: some View {
        HSplitView {
            VStack(alignment: .leading, spacing: 0) {
                VStack(alignment: .leading) {
                    HStack { Image("BrandMark").resizable().aspectRatio(contentMode:.fit).frame(width:30,height:30); Text("ARType").font(.title2.bold()) }
                    Text("Рабочий язык вашей команды").font(.caption).foregroundStyle(.secondary)
                }.padding(16)
                List(PreferencesSection.allCases.filter { $0 != .backend && $0 != .about }, selection: $selection) { section in
                    Label {
                        Text(section.rawValue)
                    } icon: {
                        IconBadge(symbol: section.icon, color: section.tint, size: 20)
                    }
                    .tag(section)
                }
                .listStyle(.sidebar)
            }
            .frame(minWidth: 180, idealWidth: 190, maxWidth: 220)

                switch selection {
                case .general:
                    ManagedAccountView()
                case .behavior:
                    BehaviorSettingsView()
                case .backend:
                    ManagedAccountView()
                case .language:
                    LanguageSettingsView()
                case .shortcuts:
                    ShortcutsSettingsView()
                case .skipApps:
                    SkipAppsSettingsView()
                case .diagnostics:
                    DiagnosticsSettingsView()
                case .about:
                    AboutView()
                }
        }
        .frame(minWidth: 780, minHeight: 560)
        .tint(TypeTideTheme.accent)
    }
}

#Preview {
    SettingsView()
}
