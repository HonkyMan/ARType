import Foundation

private nonisolated final class ManagedNoRedirect: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

nonisolated enum ManagedTransport {
    static let session = URLSession(configuration: .ephemeral, delegate: ManagedNoRedirect(), delegateQueue: nil)

    static func data(for request: URLRequest, session: URLSession = session) async throws -> (Data, URLResponse) {
        try Task.checkCancellation()
        let (bytes, response) = try await session.bytes(for: request)
        // Cancels on oversized bodies, caller cancellation and early exit.
        defer { bytes.task.cancel() }
        guard response.expectedContentLength <= ManagedResponse.maximumBytes else {
            throw ManagedResponseError.tooLarge
        }
        let data = try await ManagedResponse.collect(bytes)
        return (data, response)
    }
}
