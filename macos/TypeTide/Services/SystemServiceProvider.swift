//
//  SystemServiceProvider.swift
//  TypeTide
//
//  系统服务（Services 菜单）翻译入口。
//

import AppKit
import Foundation

@MainActor
final class SystemServiceProvider: NSObject {
    private let environment: () -> ServiceTranslation.Environment
    private let applicationIdentifiers: () -> [String]
    private let makeWork: (ServiceTranslation.Request, @escaping () -> Void) -> ServiceTranslation.Work
    private var task: Task<Void, Never>?
    private var requestID = UUID()

    init(environment: @escaping () -> ServiceTranslation.Environment,
         applicationIdentifiers: @escaping () -> [String],
         makeWork: @escaping (ServiceTranslation.Request, @escaping () -> Void) -> ServiceTranslation.Work) {
        self.environment = environment
        self.applicationIdentifiers = applicationIdentifiers
        self.makeWork = makeWork
        super.init()
    }

    // MARK: - Service Methods

    /// A send-only Services action: the popup is visible before this selector returns.
    /// The asynchronous result is displayed there; the caller's pasteboard is read-only.
    @objc func translateSelection(_ pasteboard: NSPasteboard, userData: String, error: AutoreleasingUnsafeMutablePointer<NSString>) {
        let source = applicationIdentifiers()
        guard let request = ServiceTranslation.prepare(pasteboard: pasteboard,
            applicationIdentifiers: source, environment: environment()) else {
            error.pointee = "ARType выключен, приложение исключено или текст пустой/длиннее 5000 символов."
            return
        }
        cancel()
        let work = makeWork(request) { [weak self] in self?.cancel() }
        let id = UUID()
        requestID = id
        task = Task { @MainActor [weak self] in
            guard let self else { return }
            let outcome = await ServiceTranslation.perform(request, pasteboard: pasteboard,
                environment: environment, translate: work.translate)
            guard requestID == id else {
                work.close()
                return
            }
            task = nil
            switch outcome {
            case .completed(let result): work.showResult(result)
            case .failed(let error):
                if (error as? SettingsRecoveryError)?.recoveryURL?.absoluteString == "artype://settings/languages" {work.showError(error)}
                else {work.showError(NSError(domain:"ARType",code:1,userInfo:[NSLocalizedDescriptionKey:"Не удалось перевести текст. Повторите действие через меню Services."]))}
            case .discarded: work.close()
            }
        }
    }

    // MARK: - Helper

    private func cancel() {
        requestID = UUID()
        task?.cancel()
        task = nil
    }
}
