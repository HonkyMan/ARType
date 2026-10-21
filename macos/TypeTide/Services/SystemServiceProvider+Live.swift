import AppKit

extension SystemServiceProvider {
    static let shared: SystemServiceProvider = {
        let provider = SystemServiceProvider(environment: {
            .init(enabled: AppSettings.isEnabled, exclusions: AppSettings.skipApps,
                  accountRevision: ManagedAccount.shared.translationContextID,
                  tenant: ManagedAccount.shared.selected)
        }, applicationIdentifiers: {
            AppSettings.applicationIdentifiers(NSWorkspace.shared.frontmostApplication)
        }, makeWork: { request, cancel in
            let target = LanguageConfig.targetLanguage
            let point = NSEvent.mouseLocation
            let popup = PopupController.shared
            let model = popup.show(original: request.text, target: target,
                anchor: NSRect(x: point.x, y: point.y, width: 1, height: 1),
                onReplace: nil, dismissOnInteraction: false)
            model.onDismiss = cancel
            return ServiceTranslation.Work(translate: { text in
                try await TranslationService.shared.translateFully(text: text, from: nil, to: target)
            }, showResult: { [weak model] result in
                guard let model, popup.currentModel === model else { return }
                model.appendTranslation(result)
                model.finishTranslation()
                model.finishTide()
            }, showError: { [weak model] message in
                guard let model, popup.currentModel === model else { return }
                model.failTranslation(message)
            }, close: { [weak model] in
                guard let model, popup.currentModel === model else { return }
                popup.close()
            })
        })
        NSApp.servicesProvider = provider
        return provider
    }()
}
