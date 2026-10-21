import Foundation

/// Owns the timeout for the currently displayed selection icon.
@MainActor
final class SelectionIconAutoHide {
    private var task: Task<Void, Never>?

    func schedule(afterNanoseconds delay: UInt64 = 3_000_000_000,
                  action: @escaping @MainActor () -> Void) {
        cancel()
        task = Task { @MainActor in
            do {
                try await Task.sleep(nanoseconds: delay)
            } catch {
                return
            }
            guard !Task.isCancelled else { return }
            action()
        }
    }

    func cancel() {
        task?.cancel()
        task = nil
    }
}
