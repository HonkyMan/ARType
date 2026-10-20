import Foundation
import XCTest
@testable import TypeTide

final class SharedContractTests: XCTestCase {
    private struct Contracts: Decodable {
        struct Detection: Decodable { let text: String; let expected: String }
        struct Direction: Decodable {
            let text: String
            let mode: String
            let isWrite: Bool
            let native: String
            let foreign: String
            let source: String?
            let target: String
        }
        let languageDetection: [Detection]
        let directionCases: [Direction]
    }

    func testSharedLanguageAndDirectionContracts() throws {
        let testFile = URL(fileURLWithPath: #filePath)
        let root = testFile.deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let data = try Data(contentsOf: root.appendingPathComponent("contracts/translation-contracts.json"))
        let contracts = try JSONDecoder().decode(Contracts.self, from: data)

        for item in contracts.languageDetection {
            XCTAssertEqual(Language.detect(in: item.text)?.rawValue, item.expected, item.text)
        }
        for item in contracts.directionCases {
            let mode = try XCTUnwrap(TranslationDirection(rawValue: item.mode))
            let native = try XCTUnwrap(Language(rawValue: item.native))
            let foreign = try XCTUnwrap(Language(rawValue: item.foreign))
            let target = try XCTUnwrap(Language(rawValue: item.target))
            let expectedSource = item.source.flatMap(Language.init(rawValue:))
            let route = TranslationRouting.resolve(
                text: item.text, mode: mode, isWrite: item.isWrite,
                native: native, foreign: foreign
            )
            XCTAssertEqual(route, TranslationRoute(source: expectedSource, target: target), item.text)
        }
    }
}
