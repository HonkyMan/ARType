import XCTest
@testable import TypeTide

final class ManagedProtocolTests: XCTestCase {
    func testUnpaidOrganizationCarriesStartupNoticeAndLegacyProfileStillDecodes() throws {
        let unpaid=Data(#"{"id":"tenant","name":"Team","status":"active","languages":["ru","en"],"can_translate":false,"access_message":"Balance is unpaid"}"#.utf8)
        let org=try JSONDecoder().decode(ManagedOrganization.self,from:unpaid)
        XCTAssertEqual(org.blockedMessage,"Balance is unpaid")
        let legacy=Data(#"{"id":"tenant","name":"Team","status":"active","languages":["ru","en"]}"#.utf8)
        XCTAssertNil(try JSONDecoder().decode(ManagedOrganization.self,from:legacy).blockedMessage)
    }
    func testStructuredRequestContainsIdentityAndNoClientPromptOrProviderModel() throws {
        let request = TranslationRequest(text: "Привет", source: .russian, target: .english, style: .formal)
        let data = try ManagedProtocol.body(request, tenant: "6e2ca0b8-284c-4fe1-8a57-f4876fa0b36c")
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(body["text"] as? String, "Привет")
        XCTAssertEqual(body["target"] as? String, "en")
        XCTAssertEqual(body["style"] as? String, "formal")
        XCTAssertNotNil(UUID(uuidString: try XCTUnwrap(body["request_id"] as? String)))
        XCTAssertNil(body["model"])
        XCTAssertNil(body["messages"])
    }

    func testServiceOriginRejectsNonTLSAndDeceptiveLoopbackHosts() throws {
        XCTAssertNotNil(ManagedProtocol.origin("https://translate.example.com"))
        XCTAssertNotNil(ManagedProtocol.origin("http://127.0.0.1:8080"))
        for value in ["http://127.0.0.1.evil.test", "http://example.com", "https://user:pass@example.com", "https://example.com/path", "file:///tmp/test"] {
            XCTAssertNil(ManagedProtocol.origin(value), value)
        }
    }

    func testIncompleteSSEAndServerFailureNeverBecomeReplacementText() throws {
        XCTAssertThrowsError(try ManagedProtocol.translation(Data("data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n".utf8)))
        let full = "data: {\"choices\":[{\"delta\":{\"content\":\"Hello\"}}]}\n\ndata: [DONE]\n\n"
        XCTAssertEqual(try ManagedProtocol.translation(Data(full.utf8)), "Hello")
    }
}
