import Foundation

nonisolated enum ManagedResponseError: LocalizedError {
    case invalid
    case tooLarge
    case empty

    var errorDescription: String? {
        switch self {
        case .invalid: return "Перевод прерван или содержит некорректные данные. Исходный текст сохранён."
        case .tooLarge: return "Ответ сервиса слишком большой. Исходный текст сохранён."
        case .empty: return "Empty translation"
        }
    }
}

nonisolated enum ManagedResponse {
    static let maximumBytes = 8 * 1024 * 1024
    static let maximumLineBytes = 2 * 1024 * 1024
    static let maximumTranslationBytes = 256 * 1024

    static func collect<S: AsyncSequence>(_ bytes: S, maximumBytes: Int = maximumBytes) async throws -> Data
        where S.Element == UInt8 {
        var data = Data()
        for try await byte in bytes {
            try Task.checkCancellation()
            guard data.count < maximumBytes else { throw ManagedResponseError.tooLarge }
            data.append(byte)
        }
        try Task.checkCancellation()
        return data
    }

    static func translation(_ data: Data) throws -> String {
        guard data.count <= maximumBytes else { throw ManagedResponseError.tooLarge }
        var complete = false
        var result = ""
        var outputBytes = 0
        var start = data.startIndex + (data.starts(with: [0xEF, 0xBB, 0xBF]) ? 3 : 0)
        while start < data.endIndex {
            let end = data[start...].firstIndex(of: 0x0A) ?? data.endIndex
            guard end - start <= maximumLineBytes else { throw ManagedResponseError.tooLarge }
            guard var line = String(data: data[start..<end], encoding: .utf8) else {
                throw ManagedResponseError.invalid
            }
            start = end == data.endIndex ? end : end + 1
            if line.last == "\r" { line.removeLast() }
            if line.isEmpty || line.hasPrefix(":") { continue }
            guard !complete, line.hasPrefix("data:") else { throw ManagedResponseError.invalid }
            let payload = line.dropFirst(5).trimmingCharacters(in: CharacterSet(charactersIn: " \t"))
            if payload == "[DONE]" {
                complete = true
                continue
            }
            guard let json = try? JSONSerialization.jsonObject(with: Data(payload.utf8)) as? [String: Any],
                  let choices = json["choices"] as? [[String: Any]],
                  let delta = choices.first?["delta"] as? [String: Any],
                  let content = delta["content"] as? String else { throw ManagedResponseError.invalid }
            // Native text destinations may stop at NUL; never accept a result
            // that would silently change when copied or pasted.
            guard !content.utf8.contains(0) else { throw ManagedResponseError.invalid }
            let count = content.utf8.count
            guard count <= maximumTranslationBytes - outputBytes else { throw ManagedResponseError.tooLarge }
            outputBytes += count
            result += content
        }
        guard complete else { throw ManagedResponseError.invalid }
        guard !result.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw ManagedResponseError.empty
        }
        return result
    }
}
