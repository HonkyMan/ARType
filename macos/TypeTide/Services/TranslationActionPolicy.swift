import Foundation

nonisolated enum TranslationActionPolicy {
    static let maximumInputCharacters = 5_000

    static func isExcluded(applicationIdentifiers: [String], exclusions: [String]) -> Bool {
        func normalized(_ value: String) -> String {
            var value = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            if value.hasSuffix(".app") { value.removeLast(4) }
            return value
        }
        let identifiers = Set(applicationIdentifiers.map(normalized).filter { !$0.isEmpty })
        return exclusions.contains { identifiers.contains(normalized($0)) }
    }

    static func permits(_ text: String, enabled: Bool,
                        applicationIdentifiers: [String], exclusions: [String]) -> Bool {
        enabled && !applicationIdentifiers.isEmpty &&
            !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
            text.count <= maximumInputCharacters &&
            !isExcluded(applicationIdentifiers: applicationIdentifiers, exclusions: exclusions)
    }
}
