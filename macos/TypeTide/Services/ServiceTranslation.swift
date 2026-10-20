import AppKit

/// Services accepts an immutable input snapshot and presents its result separately.
/// No asynchronous completion writes to the caller's pasteboard.
@MainActor
enum ServiceTranslation {
    struct Environment {
        let enabled: Bool
        let exclusions: [String]
        let accountRevision: UUID
        let tenant: String
    }

    struct Request {
        let text: String
        let changeCount: Int
        let applicationIdentifiers: [String]
        let accountRevision: UUID
        let tenant: String
    }

    struct Work {
        let translate: (String) async throws -> String
        let showResult: (String) -> Void
        let showError: (String) -> Void
        let close: () -> Void
    }

    enum Outcome {
        case completed(String)
        case failed
        case discarded
    }

    static func prepare(pasteboard: NSPasteboard, applicationIdentifiers: [String],
                        environment: Environment) -> Request? {
        guard let text = pasteboard.string(forType: .string),
              TranslationActionPolicy.permits(text, enabled: environment.enabled,
                  applicationIdentifiers: applicationIdentifiers, exclusions: environment.exclusions) else { return nil }
        return Request(text: text, changeCount: pasteboard.changeCount,
                       applicationIdentifiers: applicationIdentifiers,
                       accountRevision: environment.accountRevision, tenant: environment.tenant)
    }

    static func perform(_ request: Request, pasteboard: NSPasteboard,
                        environment: () -> Environment,
                        translate: (String) async throws -> String) async -> Outcome {
        func isCurrent() -> Bool {
            let current = environment()
            return current.accountRevision == request.accountRevision && current.tenant == request.tenant &&
                pasteboard.changeCount == request.changeCount &&
                TranslationActionPolicy.permits(request.text, enabled: current.enabled,
                    applicationIdentifiers: request.applicationIdentifiers, exclusions: current.exclusions)
        }
        guard !Task.isCancelled, isCurrent() else { return .discarded }
        do {
            let result = try await translate(request.text)
            guard !Task.isCancelled, isCurrent() else { return .discarded }
            guard !result.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return .failed }
            return .completed(result)
        } catch {
            if error is CancellationError || Task.isCancelled || !isCurrent() { return .discarded }
            return .failed
        }
    }
}
