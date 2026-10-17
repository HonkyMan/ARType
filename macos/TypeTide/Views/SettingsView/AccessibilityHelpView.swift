import SwiftUI

/// Shared recovery instructions for onboarding and Settings. Authorization remains
/// an explicit action in macOS; revealing the bundle avoids granting an old copy.
struct AccessibilityHelpView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            SettingsNote(text: "1. In the macOS prompt, choose Open System Settings.\n2. Enable ARType under Privacy & Security → Accessibility (called Device Control and Data Access on some macOS versions).\n3. Return here; permission status refreshes automatically.")
            HStack {
                Button("Open System Settings") { AccessibilityPermission.openSystemSettings() }
                Button("Show Current App") { AccessibilityPermission.revealCurrentApp() }
            }.controlSize(.small)
            DisclosureGroup("ARType is missing or permission still fails") {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Click Show Current App, then drag the revealed ARType.app into the permission list, or use + to select it. Enable its switch.")
                    Text("If a previous copy already appears, remove that ARType entry with − and add this running copy again. Quit and reopen ARType if macOS requests it.")
                    Text("Current app: \(Bundle.main.bundleURL.path)")
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                }.font(.caption).foregroundStyle(.secondary)
            }.font(.caption)
        }
    }
}
