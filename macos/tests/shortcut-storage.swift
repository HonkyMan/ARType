import Foundation

@main
struct ShortcutStorageTests {
    static func main() throws {
        let fallback = KeyboardShortcutPreference(keyCode: 2, modifiers: [.option])
        let valid = KeyboardShortcutPreference(keyCode: 15, modifiers: [.command, .shift])
        let encoded = try JSONEncoder().encode(valid)
        let decoded = try JSONDecoder().decode(KeyboardShortcutPreference.self, from: encoded)
        precondition(decoded == valid)
        for key in [-1, 128, Int.max] {
            let invalid = try JSONEncoder().encode(KeyboardShortcutPreference(keyCode: key, modifiers: [.option]))
            precondition((try? JSONDecoder().decode(KeyboardShortcutPreference.self, from: invalid)) == nil,
                         "Invalid virtual key must be rejected at the decode boundary")
            precondition(StoredShortcutPreference.decode(invalid, defaultValue: fallback) == fallback)
            let wrapped = try JSONEncoder().encode(StoredShortcutPreference(
                shortcut: KeyboardShortcutPreference(keyCode: key, modifiers: [.option])))
            precondition(StoredShortcutPreference.decode(wrapped, defaultValue: fallback) == fallback)
        }
        for flags: UInt in [0, 16, UInt.max] {
            let invalid = try JSONEncoder().encode(KeyboardShortcutPreference(
                keyCode: 2, modifiers: .init(rawValue: flags)))
            precondition((try? JSONDecoder().decode(KeyboardShortcutPreference.self, from: invalid)) == nil)
        }
        let cleared = try JSONEncoder().encode(StoredShortcutPreference(shortcut: nil))
        precondition(StoredShortcutPreference.decode(cleared, defaultValue: fallback) == nil)
        precondition(StoredShortcutPreference.decode(encoded, defaultValue: fallback) == valid)
        print("shortcut storage tests passed")
    }
}
