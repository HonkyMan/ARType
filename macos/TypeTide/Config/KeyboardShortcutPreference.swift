import Foundation
import Carbon

struct KeyboardShortcutPreference: Codable, Equatable {
    var keyCode: Int
    var modifiers: ModifierFlags

    /// macOS virtual key codes occupy seven bits; recorded shortcuts need a modifier.
    var isValid: Bool {
        (0...127).contains(keyCode) && modifiers.rawValue != 0
            && modifiers.rawValue & ~UInt(0xF) == 0
    }

    init(keyCode: Int, modifiers: ModifierFlags) {
        self.keyCode = keyCode
        self.modifiers = modifiers
    }

    private enum CodingKeys: String, CodingKey { case keyCode, modifiers }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        keyCode = try container.decode(Int.self, forKey: .keyCode)
        modifiers = try container.decode(ModifierFlags.self, forKey: .modifiers)
        guard isValid else {
            throw DecodingError.dataCorrupted(.init(
                codingPath: decoder.codingPath, debugDescription: "Invalid keyboard shortcut"))
        }
    }

    struct ModifierFlags: OptionSet, Codable, Equatable {
        let rawValue: UInt

        static let command = ModifierFlags(rawValue: 1 << 0)
        static let option = ModifierFlags(rawValue: 1 << 1)
        static let control = ModifierFlags(rawValue: 1 << 2)
        static let shift = ModifierFlags(rawValue: 1 << 3)

        var carbonFlags: UInt32 {
            var flags: UInt32 = 0
            if contains(.command) { flags |= UInt32(cmdKey) }
            if contains(.option) { flags |= UInt32(optionKey) }
            if contains(.control) { flags |= UInt32(controlKey) }
            if contains(.shift) { flags |= UInt32(shiftKey) }
            return flags
        }

        var displayString: String {
            var components: [String] = []
            if contains(.control) { components.append("⌃") }
            if contains(.option) { components.append("⌥") }
            if contains(.shift) { components.append("⇧") }
            if contains(.command) { components.append("⌘") }
            return components.joined()
        }
    }

    var displayString: String {
        let keyName = KeyCodeMapper.string(for: keyCode) ?? "Unknown"
        return modifiers.displayString + keyName
    }
}

struct StoredShortcutPreference: Codable {
    let shortcut: KeyboardShortcutPreference?

    private enum CodingKeys: String, CodingKey { case shortcut }

    init(shortcut: KeyboardShortcutPreference?) {
        self.shortcut = shortcut
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        guard container.contains(.shortcut) else {
            throw DecodingError.keyNotFound(
                CodingKeys.shortcut,
                .init(codingPath: decoder.codingPath,
                      debugDescription: "Stored shortcut wrapper requires a shortcut key")
            )
        }
        shortcut = try container.decodeIfPresent(KeyboardShortcutPreference.self, forKey: .shortcut)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        if let shortcut {
            try container.encode(shortcut, forKey: .shortcut)
        } else {
            try container.encodeNil(forKey: .shortcut)
        }
    }

    static func decode(_ data: Data,
                       defaultValue: KeyboardShortcutPreference) -> KeyboardShortcutPreference? {
        if let stored = try? JSONDecoder().decode(Self.self, from: data) {
            return stored.shortcut
        }
        // Migration: older releases encoded KeyboardShortcutPreference directly.
        return (try? JSONDecoder().decode(KeyboardShortcutPreference.self, from: data)) ?? defaultValue
    }
}

// 按键代码映射
struct KeyCodeMapper {
    static func string(for keyCode: Int) -> String? {
        let mapping: [Int: String] = [
            0: "A", 1: "S", 2: "D", 3: "F", 4: "H", 5: "G", 6: "Z", 7: "X",
            8: "C", 9: "V", 11: "B", 12: "Q", 13: "W", 14: "E", 15: "R",
            16: "Y", 17: "T", 18: "1", 19: "2", 20: "3", 21: "4", 22: "6",
            23: "5", 24: "=", 25: "9", 26: "7", 27: "-", 28: "8", 29: "0",
            30: "]", 31: "O", 32: "U", 33: "[", 34: "I", 35: "P", 37: "L",
            38: "J", 39: "'", 40: "K", 41: ";", 42: "\\", 43: ",", 44: "/",
            45: "N", 46: "M", 47: ".", 49: "Space",
            50: "`",
            36: "Return", 48: "Tab", 51: "Delete", 53: "Escape",
            96: "F5", 97: "F6", 98: "F7", 99: "F3",
            100: "F8", 101: "F9", 109: "F10", 103: "F11", 111: "F12",
            118: "F4", 120: "F2", 122: "F1"
        ]
        return mapping[keyCode]
    }
}
