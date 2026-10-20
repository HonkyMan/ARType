import Foundation

private nonisolated final class ResponseFixtureProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let path = request.url!.lastPathComponent
        let normal = path == "normal"
        let unknownLength = path == "unknown-length"
        let body = unknownLength ? Data(repeating: 0, count: 8388609) : Data((normal ? "{\"ok\":true}" : "{}").utf8)
        let response = HTTPURLResponse(url: request.url!, statusCode: path.hasSuffix("500") ? 500 : 200,
                                       httpVersion: "HTTP/1.1",
                                       headerFields: unknownLength ? [:] : ["Content-Length": normal ? "11" : "8388609"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

@main
struct ManagedResponseRegression {
    static func main() async throws {
        let content = #"data: {"choices":[{"delta":{"content":"Hello"}}]}"#
        let valid = content + "\n\ndata: [DONE]\n\n"
        let translation = try ManagedResponse.translation(Data(valid.utf8))
        precondition(translation == "Hello")
        let crlf = try ManagedResponse.translation(Data(("\u{FEFF}" + valid.replacingOccurrences(of: "\n", with: "\r\n")).utf8))
        precondition(crlf == "Hello")
        let formatted = #"data: {"choices":[{"delta":{"content":"Hello\n\tworld"}}]}"# + "\ndata: [DONE]\n"
        let formattedTranslation = try ManagedResponse.translation(Data(formatted.utf8))
        precondition(formattedTranslation == "Hello\n\tworld")
        var failures = 0
        let malformed = [
            content,
            content + "\ndata: {broken}\ndata: [DONE]\n",
            content + "\ndata: [DONE]suffix\n",
            content + "\ndata: [DONE]\n" + content + "\n",
            content + "\ndata: {\"choices\":[{\"delta\":{\"content\":42}}]}\ndata: [DONE]\n",
            #"data: {"choices":[{"delta":{"content":"\u0000"}}]}"# + "\ndata: [DONE]\n",
            #"data: {"choices":[{"delta":{"content":"Hello\u0000world"}}]}"# + "\ndata: [DONE]\n",
            content + "\n" + #"data: {"choices":[{"delta":{"content":"\u0000suffix"}}]}"# + "\ndata: [DONE]\n",
            "data: {\"choices\":[{\"delta\":{\"content\":\"" + String(repeating: "a", count: 262145) + "\"}}]}\ndata: [DONE]\n",
            ":" + String(repeating: "x", count: 2097152) + "\n" + valid,
            String(repeating: ":\n", count: 4194304) + valid
        ]
        for (index, response) in malformed.enumerated() {
            do {
                _ = try ManagedResponse.translation(Data(response.utf8))
                fputs("Accepted invalid managed response case \(index)\n", stderr)
                failures += 1
            } catch {}
        }
        let bytes = AsyncStream<UInt8> { continuation in
            for byte: UInt8 in [1, 2, 3, 4] { continuation.yield(byte) }
            continuation.finish()
        }
        do {
            _ = try await ManagedResponse.collect(bytes, maximumBytes: 3)
            fputs("Accepted an oversized chunked response\n", stderr)
            failures += 1
        } catch ManagedResponseError.tooLarge {}
        let exact = AsyncStream<UInt8> { continuation in
            for byte: UInt8 in [1, 2, 3] { continuation.yield(byte) }
            continuation.finish()
        }
        let collected = try await ManagedResponse.collect(exact, maximumBytes: 3)
        precondition(collected == Data([1, 2, 3]))
        let cancelled = Task {
            let input = AsyncStream<UInt8> { $0.finish() }
            withUnsafeCurrentTask { $0?.cancel() }
            return try await ManagedResponse.collect(input)
        }
        cancelled.cancel()
        do {
            _ = try await cancelled.value
            fputs("Cancelled collection succeeded\n", stderr)
            failures += 1
        } catch is CancellationError {}
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [ResponseFixtureProtocol.self]
        let session = URLSession(configuration: config)
        defer { session.invalidateAndCancel() }
        for status in [200, 500] {
            let request = URLRequest(url: URL(string: "https://managed.invalid/oversized-\(status)")!)
            do {
                _ = try await ManagedTransport.data(for: request, session: session)
                fputs("Accepted oversized HTTP \(status) response\n", stderr)
                failures += 1
            } catch ManagedResponseError.tooLarge {}
        }
        do {
            _ = try await ManagedTransport.data(for: URLRequest(url: URL(string: "https://managed.invalid/unknown-length")!), session: session)
            fputs("Accepted oversized response without Content-Length\n", stderr)
            failures += 1
        } catch ManagedResponseError.tooLarge {}
        let normal = URLRequest(url: URL(string: "https://managed.invalid/normal")!)
        let (data, response) = try await ManagedTransport.data(for: normal, session: session)
        precondition(data == Data("{\"ok\":true}".utf8))
        precondition((response as? HTTPURLResponse)?.statusCode == 200)
        if failures > 0 { exit(1) }
        print("Managed response regressions passed")
    }
}
