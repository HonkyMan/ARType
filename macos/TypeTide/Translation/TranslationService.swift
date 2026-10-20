//
//  TranslationService.swift
//  TypeTide
//
//  Managed translation lifecycle, cancellation and diagnostics.
//

import Foundation

@MainActor
final class TranslationService {
    static let shared = TranslationService()
    private init() {}

#if DEBUG
    /// XCTest seam used to keep network behavior deterministic.
    var providerOverride: TranslationProvider?
#endif

    private func currentProvider() -> TranslationProvider {
#if DEBUG
        if let providerOverride { return providerOverride }
#endif
        return ManagedTranslationProvider()
    }

    /// Each request is authorized by the managed service; selected text is not cached.
    func stream(text: String, from: Language?, to: Language, style: RewriteStyle = .faithful) -> AsyncThrowingStream<String, Error> {
        let provider = currentProvider()
        let characterCount = text.count

        return AsyncThrowingStream { continuation in
            let start = ContinuousClock.now
            let task = Task {
                var full = ""
                var firstToken: ContinuousClock.Instant?
                do {
                    for try await delta in provider.stream(.init(text: text, source: from, target: to, style: style)) {
                        if firstToken == nil { firstToken = .now }
                        full += delta
                        continuation.yield(delta)
                    }
                    let cleaned = full.trimmingCharacters(in: .whitespacesAndNewlines)
                    guard !cleaned.isEmpty else { throw TranslationError.empty }
                    continuation.finish()
                    Self.recordTranslation(outcome: "success", provider: provider.id, start: start,
                                           firstToken: firstToken, characterCount: characterCount)
                } catch is CancellationError {
                    continuation.finish(throwing: CancellationError())
                    Self.recordTranslation(outcome: "cancelled", provider: provider.id, start: start,
                                           firstToken: firstToken, characterCount: characterCount)
                } catch {
                    continuation.finish(throwing: error)
                    Self.recordTranslation(outcome: "failure", provider: provider.id, start: start,
                                           firstToken: firstToken, characterCount: characterCount,
                                           errorCategory: Self.errorCategory(error))
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    /// 一次性翻译（用于改写：需要完整结果再替换）。
    func translateFully(text: String, from: Language?, to: Language, style: RewriteStyle = .faithful) async throws -> String {
        var full = ""
        for try await delta in stream(text: text, from: from, to: to, style: style) {
            full += delta
        }
        try Task.checkCancellation()
        let cleaned = full.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleaned.isEmpty else { throw TranslationError.empty }
        return cleaned
    }

    private static func recordTranslation(
        outcome: String,
        provider: String,
        start: ContinuousClock.Instant,
        firstToken: ContinuousClock.Instant?,
        characterCount: Int,
        errorCategory: String? = nil
    ) {
        let event = DiagnosticEvent(
            name: .translation,
            outcome: outcome,
            backend: provider,
            errorCategory: errorCategory,
            firstTokenMilliseconds: firstToken.map { start.duration(to: $0).milliseconds },
            totalMilliseconds: start.duration(to: .now).milliseconds,
            inputCharacterCount: characterCount
        )
        Task { await LocalDiagnostics.shared.record(event) }
    }

    private static func errorCategory(_ error: Error) -> String {
        if error is CancellationError { return "cancelled" }
        if let error = error as? TranslationError {
            return error.category
        }
        return "provider"
    }
}
