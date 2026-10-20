import XCTest
@testable import TypeTide

final class OptionalShortcutTests: XCTestCase {
    private let read = KeyboardShortcutPreference(keyCode: 2, modifiers: [.option])
    private let rewrite = KeyboardShortcutPreference(keyCode: 15, modifiers: [.option])

    func testNullableStorageRoundTripsClearedShortcut() throws {
        let data = try JSONEncoder().encode(StoredShortcutPreference(shortcut: nil))
        XCTAssertNil(StoredShortcutPreference.decode(data, defaultValue: read))
    }

    func testStorageMigratesLegacyDirectEncoding() throws {
        let legacy = try JSONEncoder().encode(read)
        XCTAssertEqual(StoredShortcutPreference.decode(legacy, defaultValue: rewrite), read)
    }

    func testCorruptedShortcutFallsBackWithoutIntegerConversionTrap() throws {
        for keyCode in [-1, 128, Int.max] {
            let invalid = KeyboardShortcutPreference(keyCode: keyCode, modifiers: [.option])
            let direct = try JSONEncoder().encode(invalid)
            let wrapped = try JSONEncoder().encode(StoredShortcutPreference(shortcut: invalid))
            XCTAssertThrowsError(try JSONDecoder().decode(KeyboardShortcutPreference.self, from: direct))
            XCTAssertEqual(StoredShortcutPreference.decode(direct, defaultValue: read), read)
            XCTAssertEqual(StoredShortcutPreference.decode(wrapped, defaultValue: read), read)
        }
        for rawValue: UInt in [0, 16, UInt.max] {
            let invalid = KeyboardShortcutPreference(keyCode: 2, modifiers: .init(rawValue: rawValue))
            let data = try JSONEncoder().encode(invalid)
            XCTAssertThrowsError(try JSONDecoder().decode(KeyboardShortcutPreference.self, from: data))
        }
    }

    func testOneRegisteredShortcutIsReady() {
        XCTAssertTrue(ShortcutConfiguration.isReady(
            read: read, readStatus: .registered,
            rewrite: nil, rewriteStatus: .notConfigured
        ))
        XCTAssertFalse(ShortcutConfiguration.isReady(
            read: nil, readStatus: .notConfigured,
            rewrite: nil, rewriteStatus: .notConfigured
        ))
    }

    func testOnlyTwoConfiguredEqualShortcutsAreDuplicates() {
        XCTAssertTrue(ShortcutConfiguration.isDuplicate(read, read))
        XCTAssertFalse(ShortcutConfiguration.isDuplicate(read, nil))
        XCTAssertFalse(ShortcutConfiguration.isDuplicate(nil, nil))
    }

    func testShortcutEventDebouncerCoalescesOnlyRapidRepeatsOfSameShortcut() {
        var debouncer = ShortcutEventDebouncer(minimumIntervalNanoseconds: 300)

        XCTAssertTrue(debouncer.shouldHandle(id: 2, nowNanoseconds: 1_000))
        XCTAssertFalse(debouncer.shouldHandle(id: 2, nowNanoseconds: 1_200))
        XCTAssertTrue(debouncer.shouldHandle(id: 1, nowNanoseconds: 1_200))
        XCTAssertTrue(debouncer.shouldHandle(id: 2, nowNanoseconds: 1_500))
    }
}
