import XCTest
@testable import TypeTide

final class ManagedProtocolTests: XCTestCase {
    @MainActor
    func testLanguagePolicyKeepsUnavailableSelectionAndOffersOnlyTheTrustedSettingsLink() throws {
        let policy = try JSONDecoder().decode(ManagedLanguagePolicy.self, from: Data(#"{"tenant_id":"P","languages":["ru","en","bn","hi","zh","es","fr","ar","pt","id"]}"#.utf8))
        XCTAssertEqual(policy.available.count, 10)
        XCTAssertTrue(policy.permits([.bengali, .hindi]))
        let restricted = ManagedLanguagePolicy(tenant_id: "P", languages: ["ru","en","unknown"])
        XCTAssertEqual(restricted.available, [.russian,.english])
        XCTAssertFalse(restricted.permits([.russian,.bengali]))
        let model = TranslationPopupModel(original:"Original",target:.bengali)
        model.failTranslation(TranslationError.languageUnavailable)
        XCTAssertEqual(model.targetLanguage,.bengali)
        XCTAssertEqual(model.settingsLink?.absoluteString,"artype://settings/languages")
        model.resetTranslation()
        XCTAssertNil(model.settingsLink)
        XCTAssertEqual(SettingsOpener.section(for: URL(string:"artype://settings/languages")!),.language)
        XCTAssertNil(SettingsOpener.section(for: URL(string:"https://evil.test/settings/languages")!))
        XCTAssertNil(SettingsOpener.section(for: URL(string:"artype://settings/languages?command=anything")!))
    }

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
        let crlf = "\u{FEFF}" + full.replacingOccurrences(of: "\n", with: "\r\n")
        XCTAssertEqual(try ManagedProtocol.translation(Data(crlf.utf8)), "Hello")
    }

    func testMalformedEventsAndContentAfterDoneInvalidateTheWholeTranslation() throws {
        let content = #"data: {"choices":[{"delta":{"content":"Hello"}}]}"#
        for response in [
            content + "\ndata: {broken}\ndata: [DONE]\n",
            content + "\ndata: [DONE]suffix\n",
            content + "\ndata: [DONE]\n" + content + "\n",
            content + "\ndata: {\"choices\":[{\"delta\":{\"content\":42}}]}\ndata: [DONE]\n"
        ] {
            XCTAssertThrowsError(try ManagedProtocol.translation(Data(response.utf8)))
        }
    }

    func testNULContentCannotSilentlyTruncateCopiedOrReplacementText() throws {
        let prefix = #"data: {"choices":[{"delta":{"content":"prefix"}}]}"#
        for event in [
            #"data: {"choices":[{"delta":{"content":"\u0000"}}]}"#,
            #"data: {"choices":[{"delta":{"content":"Hello\u0000world"}}]}"#,
            prefix + "\n" + #"data: {"choices":[{"delta":{"content":"\u0000suffix"}}]}"#
        ] {
            XCTAssertThrowsError(try ManagedProtocol.translation(Data((event + "\ndata: [DONE]\n").utf8))) { error in
                guard case TranslationError.network = error else {
                    return XCTFail("Unexpected error: \(error)")
                }
            }
        }
        let formatted = #"data: {"choices":[{"delta":{"content":"Hello\n\tworld"}}]}"# + "\ndata: [DONE]\n"
        XCTAssertEqual(try ManagedProtocol.translation(Data(formatted.utf8)), "Hello\n\tworld")
    }

    func testResponseLineAndAggregateTranslationLimits() throws {
        let event = { (text: String) in "data: {\"choices\":[{\"delta\":{\"content\":\"\(text)\"}}]}\n" }
        let full = event("Hello") + "data: [DONE]\n"
        let responses = [
            Data((String(repeating: "\n", count: 8 * 1024 * 1024) + full).utf8),
            Data((":" + String(repeating: "x", count: 2 * 1024 * 1024) + "\n" + full).utf8),
            Data((event(String(repeating: "a", count: 128 * 1024)) +
                  event(String(repeating: "b", count: 128 * 1024 + 1)) + "data: [DONE]\n").utf8)
        ]
        for response in responses {
            XCTAssertThrowsError(try ManagedResponse.translation(response)) { error in
                guard case ManagedResponseError.tooLarge = error else {
                    return XCTFail("Unexpected error: \(error)")
                }
            }
        }
    }

    func testChunkedCollectionEnforcesTheLimitWithoutContentLength() async throws {
        let input = AsyncStream<UInt8> { continuation in
            for byte: UInt8 in [1, 2, 3, 4] { continuation.yield(byte) }
            continuation.finish()
        }
        do {
            _ = try await ManagedResponse.collect(input, maximumBytes: 3)
            XCTFail("Oversized response was accepted")
        } catch ManagedResponseError.tooLarge {}
    }

    func testCancelledCollectionDoesNotReturnAnEmptySuccess() async throws {
        let task = Task {
            let input = AsyncStream<UInt8> { $0.finish() }
            withUnsafeCurrentTask { $0?.cancel() }
            return try await ManagedResponse.collect(input)
        }
        do {
            _ = try await task.value
            XCTFail("Cancelled response was accepted")
        } catch is CancellationError {}
    }

    func testManagedTransportBoundsSuccessAndErrorResponseBodies() async throws {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [ManagedResponseURLProtocol.self]
        let session = URLSession(configuration: config)
        defer { session.invalidateAndCancel() }
        for status in [200, 500] {
            let request = URLRequest(url: URL(string: "https://managed.invalid/oversized-\(status)")!)
            do {
                _ = try await ManagedTransport.data(for: request, session: session)
                XCTFail("Oversized HTTP \(status) response was accepted")
            } catch ManagedResponseError.tooLarge {}
        }
        do {
            let request = URLRequest(url: URL(string: "https://managed.invalid/unknown-length")!)
            _ = try await ManagedTransport.data(for: request, session: session)
            XCTFail("Oversized response without Content-Length was accepted")
        } catch ManagedResponseError.tooLarge {}
    }
}

private nonisolated final class ManagedResponseURLProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let status = request.url!.lastPathComponent.hasSuffix("500") ? 500 : 200
        let unknownLength = request.url!.lastPathComponent == "unknown-length"
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1",
                                       headerFields: unknownLength ? [:] : ["Content-Length": "8388609"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: unknownLength ? Data(repeating: 0, count: 8388609) : Data([0]))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
