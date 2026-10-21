//
//  TriggerController.swift
//  TypeTide
//
//  编排主链路：
//  - 读·划词翻译：快捷键 / 划词图标 / 自动 → 弹窗流式显示译文。
//  - 写·输入改写：快捷键 → 译为目标语言 → 直接替换或先预览。
//

import AppKit
import ApplicationServices

@MainActor
final class TriggerController {
    static let shared = TriggerController()
    private init() {}

    private let readHotkeyID: UInt32 = 1
    private let rewriteHotkeyID: UInt32 = 2
    private let maximumInputCharacters = TranslationActionPolicy.maximumInputCharacters

    private var streamTask: Task<Void, Never>?
    private var rewriteTask: Task<Void, Never>?
    private var readCaptureTask: Task<Void, Never>?
    private var replacementTask: Task<Void, Never>?
    private var contextGeneration: UInt64 = 0
    private var rewriteRequestID: UInt64 = 0

    private(set) var readShortcutStatus: ShortcutRegistrationStatus = .inactive
    private(set) var rewriteShortcutStatus: ShortcutRegistrationStatus = .inactive

    var shortcutsReady: Bool {
        ShortcutConfiguration.isReady(
            read: AppSettings.readShortcut, readStatus: readShortcutStatus,
            rewrite: AppSettings.rewriteShortcut, rewriteStatus: rewriteShortcutStatus
        )
    }

    /// 母语（读模式的目标 / 写模式的源）
    private var nativeLanguage: Language { LanguageConfig.sourceLanguage }
    /// 外语（写模式的目标）
    private var foreignLanguage: Language { LanguageConfig.targetLanguage }

    // MARK: - 生命周期

    func start() {
        applyEnabledState()
    }

    func cancelTranslations() {
        contextGeneration += 1
        readCaptureTask?.cancel()
        replacementTask?.cancel()
        streamTask?.cancel()
        rewriteTask?.cancel()
        rewriteRequestID += 1
        PopupController.shared.close()
        SelectionIconWindow.shared.hide()
    }

    /// 根据开关 + 快捷键 + 划词设置重新装配触发。
    func applyEnabledState() {
        GlobalShortcutCenter.shared.unregisterAll()
        SelectionMonitor.shared.stop()
        SelectionIconWindow.shared.hide()
        readShortcutStatus = .inactive
        rewriteShortcutStatus = .inactive

        guard AppSettings.isEnabled else { cancelTranslations(); return }

        let readShortcut = AppSettings.readShortcut
        let rewriteShortcut = AppSettings.rewriteShortcut
        if ShortcutConfiguration.isDuplicate(readShortcut, rewriteShortcut) {
            readShortcutStatus = .duplicate
            rewriteShortcutStatus = .duplicate
            return
        }

        if let readShortcut {
            readShortcutStatus = GlobalShortcutCenter.shared.register(id: readHotkeyID, shortcut: readShortcut) { [weak self] in
                Task { @MainActor in self?.performShortcutAction(AppSettings.readShortcutAction) }
            }
        } else {
            readShortcutStatus = .notConfigured
        }
        if let rewriteShortcut {
            rewriteShortcutStatus = GlobalShortcutCenter.shared.register(id: rewriteHotkeyID, shortcut: rewriteShortcut) { [weak self] in
                Task { @MainActor in self?.performShortcutAction(AppSettings.rewriteShortcutAction) }
            }
        } else {
            rewriteShortcutStatus = .notConfigured
        }

        setupSelectionTrigger()
    }

    private func setupSelectionTrigger() {
        let mode = AppSettings.selectionTrigger
        guard mode != .none else { return }

        SelectionMonitor.shared.onSelection = { [weak self] text, location, element, range in
            guard let self, AppSettings.isEnabled, AccessibilityPermission.isGranted,
                  !AppSettings.shouldSkipFrontmostApplication() else { return }
            switch mode {
            case .none:
                break
            case .icon:
                // 图标贴合选区：优先用选区屏幕矩形，拿不到再退回鼠标点
                let anchor = PopupPositioner.anchorRect(element: element, range: range)
                SelectionIconWindow.shared.show(near: anchor, fallback: location) {
                    self.presentRead(text: text, element: element, range: range)
                }
            case .auto:
                self.presentRead(text: text, element: element, range: range)
            }
        }
        SelectionMonitor.shared.start()
    }

    // MARK: - 读·划词翻译

    private func performShortcutAction(_ action: ShortcutAction) {
        if action.usesPopup { handleRead(action: action) }
        else { handleRewrite(action: action) }
    }

    func handleRead(action: ShortcutAction = .smartPopup) {
        guard AppSettings.isEnabled else { return }
        guard AccessibilityPermission.isGranted else {
            AccessibilityPermission.request()
            return
        }
        guard !AppSettings.shouldSkipFrontmostApplication() else { return }
        cancelTranslations()
        let context=contextGeneration
        readCaptureTask = Task { @MainActor in
            let captured=await SelectionCapture.readSelection()
            guard context==contextGeneration, !Task.isCancelled else {return}
            guard let cap = captured else {
                presentCaptureFailure("Couldn’t read selected text. The app may not expose its selection and the clipboard fallback received no text.")
                return
            }
            guard cap.text.count <= maximumInputCharacters else {
                presentCaptureFailure("The selection is too long (\(cap.text.count) characters; maximum \(maximumInputCharacters)).")
                return
            }
            // presentRead starts a new presentation context. Detach this finished
            // capture so cancelling the previous context does not cancel itself.
            readCaptureTask = nil
            presentRead(text: cap.text, element: cap.element, range: cap.range,
                        targetOverride: targetOverride(for: action))
        }
    }

    private func presentCaptureFailure(_ message: String) {
        let mouse = NSEvent.mouseLocation
        let anchor = NSRect(x: mouse.x, y: mouse.y, width: 1, height: 1)
        let model = PopupController.shared.show(original: "No selection", target: nativeLanguage,
                                                anchor: anchor, onReplace: nil)
        model.failTranslation(message)
    }

    /// 显示读翻译弹窗并流式填充（供快捷键 / 图标 / 自动模式共用）。
    func presentRead(text: String, element: AXUIElement?, range: CFRange?, targetOverride: Language? = nil,
                     dismissOnInteraction: Bool = true, replacementTarget: ReplacementTarget? = nil) {
        guard TranslationActionPolicy.permits(text, enabled: AppSettings.isEnabled,
            applicationIdentifiers: AppSettings.applicationIdentifiers(NSWorkspace.shared.frontmostApplication),
            exclusions: AppSettings.skipApps) else { return }
        cancelTranslations()
        let anchor = PopupPositioner.anchorRect(element: element, range: range)
        let destination = replacementTarget ??
            ReplacementTarget.capture(element: element, range: range, text: text, wholeField: false)
        let dir = targetOverride.map { (from: Language.detect(in: text), to: $0) }
            ?? resolveDirection(text: text, mode: AppSettings.readDirection, isWrite: false)
        let model = PopupController.shared.show(original: text, target: dir.to, anchor: anchor,
                                                onReplace: nil, dismissOnInteraction: dismissOnInteraction)
        model.onDismiss = { [weak self] in self?.streamTask?.cancel() }
        let context=contextGeneration
        model.onReplace = { [weak self, weak model] in
            guard let self, self.contextGeneration==context, let model, !model.translation.isEmpty else { return }
            self.replacementTask = Task { @MainActor in
                guard self.contextGeneration==context, !Task.isCancelled else {return}
                PopupController.shared.close()
                await self.replaceOrOfferCopy(model.translation, original: text, language: model.targetLanguage,
                                             anchor: anchor, selectAll: false, target: destination, context: context)
            }
        }
        model.onRetarget = { [weak self, weak model] newTarget in
            guard let self, let model else { return }
            model.targetLanguage = newTarget
            self.runTranslationStream(text: text, from: dir.from, to: newTarget,
                                      style: .faithful, into: model)
        }
        runTranslationStream(text: text, from: dir.from, to: dir.to,
                             style: .faithful, into: model)
    }

    // MARK: - 方向决策与共用流式

    /// 按模式决定 from/to。
    /// - auto：检测选中文字语言；母语→外语、外语→母语、第三种/检测不确定→（读:母语 / 写:外语）。
    /// - 固定模式：跳过检测，直接用配置好的方向（对中英混排等检测易错场景更稳）。
    private func resolveDirection(text: String, mode: TranslationDirection, isWrite: Bool) -> (from: Language?, to: Language) {
        let route = TranslationRouting.resolve(
            text: text, mode: mode, isWrite: isWrite,
            native: nativeLanguage, foreign: foreignLanguage
        )
        return (route.source, route.target)
    }

    /// 共用的流式翻译，把结果写入弹窗 model（读 / 改写预览 / 弹窗重定向复用）。
    private func runTranslationStream(text: String, from: Language?, to: Language,
                                      style: RewriteStyle, into model: TranslationPopupModel) {
        streamTask?.cancel()
        model.onRetry = { [weak self, weak model] in
            guard let self, let model else { return }
            self.runTranslationStream(text: text, from: from, to: to, style: style, into: model)
        }
        model.resetTranslation()
        streamTask = Task { @MainActor in
            do {
                for try await delta in TranslationService.shared.stream(text: text, from: from, to: to, style: style) {
                    if Task.isCancelled { return }
                    model.appendTranslation(delta)
                }
                model.finishTranslation()
                if model.translation.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    model.failTranslation("No translation returned")
                } else {
                    try? await Task.sleep(for: .milliseconds(420))
                    if !Task.isCancelled { model.finishTide() }
                }
            } catch {
                model.failTranslation(error)
            }
        }
    }

    // MARK: - 写·输入改写

    func handleRewrite(action: ShortcutAction = .smartReplace) {
        guard AppSettings.isEnabled else { return }
        guard AccessibilityPermission.isGranted else {
            AccessibilityPermission.request()
            return
        }
        guard !AppSettings.shouldSkipFrontmostApplication() else { return }
        cancelTranslations()
        let requestID = rewriteRequestID
        rewriteTask = Task { @MainActor [self] in
            guard let cap = await SelectionCapture.captureForRewrite() else {
                guard isCurrentRewrite(requestID) else { return }
                presentCaptureFailure("Couldn’t read text to rewrite. Select text, or place the cursor in an editable text field, then try again.")
                return
            }
            guard isCurrentRewrite(requestID) else { return }
            guard cap.text.count <= maximumInputCharacters else {
                presentCaptureFailure("The text is too long (\(cap.text.count) characters; maximum \(maximumInputCharacters)).")
                return
            }
            let style = AppSettings.rewriteStyle
            let dir = targetOverride(for: action).map { (from: Language.detect(in: cap.text), to: $0) }
                ?? resolveDirection(text: cap.text, mode: AppSettings.rewriteDirection, isWrite: true)

            if AppSettings.rewritePreview {
                guard isCurrentRewrite(requestID) else { return }
                // 先预览：弹窗显示译文 + Replace 按钮（顶部可改目标语言）
                let anchor = PopupPositioner.anchorRect(element: cap.element, range: cap.selectedRange)
                let model = PopupController.shared.show(original: cap.text, target: dir.to, anchor: anchor, onReplace: nil)
                model.onDismiss = { [weak self] in self?.streamTask?.cancel() }
                model.onReplace = { [weak self, weak model] in
                    guard let self, self.isCurrentRewrite(requestID),
                          let model, !model.translation.isEmpty else { return }
                    let context = self.contextGeneration
                    self.replacementTask = Task { @MainActor in
                        guard self.isCurrentRewrite(requestID) else { return }
                        PopupController.shared.close()
                        await self.replaceOrOfferCopy(model.translation, original: cap.text, language: model.targetLanguage,
                                                     anchor: anchor, selectAll: cap.isWholeField,
                                                     target: cap.replacementTarget?.requiring { self.isCurrentRewrite(requestID) },
                                                     context: context)
                    }
                }
                model.onRetarget = { [weak self, weak model] newTarget in
                    guard let self, let model else { return }
                    model.targetLanguage = newTarget
                    self.runTranslationStream(text: cap.text, from: dir.from, to: newTarget, style: style, into: model)
                }
                runTranslationStream(text: cap.text, from: dir.from, to: dir.to, style: style, into: model)
            } else {
                // 直接替换
                do {
                    let translated = try await TranslationService.shared.translateFully(
                        text: cap.text, from: dir.from, to: dir.to, style: style)
                    guard isCurrentRewrite(requestID) else { return }
                    await replaceOrOfferCopy(translated, original: cap.text, language: dir.to,
                                             anchor: PopupPositioner.anchorRect(element: cap.element, range: cap.selectedRange),
                                             selectAll: cap.isWholeField,
                                             target: cap.replacementTarget?.requiring { self.isCurrentRewrite(requestID) },
                                             context: contextGeneration)
                } catch {
                    guard isCurrentRewrite(requestID) else { return }
                    let anchor = PopupPositioner.anchorRect(element: cap.element, range: cap.selectedRange)
                    let model = PopupController.shared.show(original: cap.text, target: dir.to, anchor: anchor, onReplace: nil)
                    model.failTranslation(error)
                }
            }
        }
    }

    private func isCurrentRewrite(_ requestID: UInt64) -> Bool {
        requestID == rewriteRequestID && !Task.isCancelled
    }

    private func replaceOrOfferCopy(_ translation: String, original: String, language: Language,
                                    anchor: NSRect, selectAll: Bool, target: ReplacementTarget?,
                                    context: UInt64) async {
        let destination = target?.requiring { [weak self] in self?.contextGeneration == context }
        let replaced = await TextReplacer.replace(with: translation, selectAll: selectAll, target: destination)
        guard !replaced, contextGeneration == context, !Task.isCancelled else { return }
        let model = PopupController.shared.show(original: original, target: language, anchor: anchor, onReplace: nil)
        model.translation = translation
        model.replacementNotice = "Исходное поле или выделение изменилось либо недоступно. Перевод сохранён — скопируйте его и вставьте вручную."
        model.finishTranslation()
        model.finishTide()
    }

    private func targetOverride(for action: ShortcutAction) -> Language? {
        switch action {
        case .nativePopup, .nativeReplace: return nativeLanguage
        case .foreignPopup, .foreignReplace: return foreignLanguage
        case .smartPopup, .smartReplace: return nil
        }
    }
}
