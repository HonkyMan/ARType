import Foundation

nonisolated enum ManagedEndpoint {
    static let configuredOrigin: String? = {
        guard let path = Bundle.main.url(forResource: "managed-config", withExtension: "json"),
              let data = try? Data(contentsOf: path),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: String],
              let value = object["service_url"] else { return nil }
        return canonicalOrigin(value)
    }()

    static func canonicalOrigin(_ value: String) -> String? {
        // Restrict to the same ASCII authority grammar used by the Windows client.
        let lower = value.lowercased()
        guard lower.range(of: #"^https?://(\[[0-9a-f:]+\]|[a-z0-9.-]+)(:[0-9]{1,5})?/?$"#,
                          options: .regularExpression) == lower.startIndex..<lower.endIndex,
              let parts = URLComponents(string: lower),
              let scheme = parts.scheme, var host = parts.host else { return nil }
        if host.hasPrefix("[") { host.removeFirst(); host.removeLast() }
        if host.contains(":") {
            guard let address = ipv6(host) else { return nil }
            host = "[\(address)]"
        } else {
            if host.hasSuffix(".") { host.removeLast() }
            let labels = host.split(separator: ".", omittingEmptySubsequences: false)
            guard !host.isEmpty, host.utf8.count <= 253,
                  labels.allSatisfy({ !$0.isEmpty && $0.utf8.count <= 63 &&
                      !$0.hasPrefix("-") && !$0.hasSuffix("-") }) else { return nil }
        }
        guard scheme == "https" || ["localhost", "127.0.0.1", "[0:0:0:0:0:0:0:1]"].contains(host) else { return nil }
        let port = parts.port ?? (scheme == "https" ? 443 : 80)
        guard (1...65535).contains(port) else { return nil }
        let isDefault = (scheme == "https" && port == 443) || (scheme == "http" && port == 80)
        return "\(scheme)://\(host)" + (isDefault ? "" : ":\(port)")
    }

    static func credentialAccount(_ origin: String) -> String? {
        canonicalOrigin(origin).map { "session-token-v2|\($0)" }
    }

    static func origin(of url: URL) -> String? {
        guard var parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              parts.user == nil, parts.password == nil else { return nil }
        parts.path = ""
        parts.query = nil
        parts.fragment = nil
        return parts.string.flatMap(canonicalOrigin)
    }

    static func loginURLAllowed(_ url: URL, origin expected: String) -> Bool {
        guard let canonical = canonicalOrigin(expected), origin(of: url) == canonical,
              let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              parts.percentEncodedPath == "/auth/google", parts.fragment == nil,
              let query = parts.percentEncodedQuery else { return false }
        return query.range(of: #"^device=[A-Za-z0-9_-]+$"#, options: .regularExpression)
            == query.startIndex..<query.endIndex
    }

    private static func ipv6(_ address: String) -> String? {
        let parts = address.components(separatedBy: "::")
        guard parts.count <= 2 else { return nil }
        func groups(_ text: String) -> [UInt16]? {
            if text.isEmpty { return [] }
            let pieces = text.split(separator: ":", omittingEmptySubsequences: false)
            var result: [UInt16] = []
            for piece in pieces {
                guard !piece.isEmpty, piece.count <= 4, let value = UInt16(piece, radix: 16) else { return nil }
                result.append(value)
            }
            return result
        }
        guard var left = groups(parts[0]), let right = groups(parts.count == 2 ? parts[1] : "") else { return nil }
        if parts.count == 1 {
            guard left.count == 8 else { return nil }
        } else {
            guard left.count + right.count < 8 else { return nil }
            left += Array(repeating: 0, count: 8 - left.count - right.count)
        }
        return (left + right).map { String($0, radix: 16) }.joined(separator: ":")
    }
}
