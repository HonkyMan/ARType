#include "App.h"
#include "Hooks.h"
#include "LocalDiagnostics.h"
#include "PopupWindow.h"
#include "SelectionIcon.h"
#include "SelectionMonitor.h"
#include "Settings.h"
#include "SettingsWindow.h"
#include "TextReplacer.h"
#include "Translator.h"
#include "Util.h"
#include "ManagedAccount.h"
#include "ManagedProtocol.h"
#include "Credentials.h"
#include "WorkerPool.h"
#include <shellapi.h>
#include <psapi.h>
#include <memory>
#include <mutex>

namespace {
constexpr int kReadHotkeyId = 1;
constexpr int kRewriteHotkeyId = 2;
// 超过这个长度不翻译：LLM 又慢又贵，弹窗也展示不下
constexpr size_t kMaxInputChars = 5000;
constexpr UINT_PTR kShutdownTimer = 4101;
} // namespace

App& App::shared() {
    static App app;
    return app;
}

LRESULT CALLBACK App::wndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
    if (msg == WM_CREATE) return 0;
    App& self = App::shared();
    if (self.hwnd_ == nullptr || hwnd == self.hwnd_) {
        self.hwnd_ = hwnd;
        return self.handle(msg, wp, lp);
    }
    return DefWindowProcW(hwnd, msg, wp, lp);
}

bool App::init(HINSTANCE inst) {
    WNDCLASSW wc{};
    wc.lpfnWndProc = wndProc;
    wc.hInstance = inst;
    wc.lpszClassName = kAppWindowClass;
    RegisterClassW(&wc);

    // 隐藏主窗口（顶层不可见；托盘与热键的宿主）
    hwnd_ = CreateWindowExW(0, kAppWindowClass, L"ARType", 0, 0, 0, 0, 0,
                            nullptr, nullptr, inst, nullptr);
    if (!hwnd_) return false;

    tray_.onToggleEnabled = [this] {
        Settings& s = Settings::shared();
        s.enabled = !s.enabled;
        s.save();
        applyEnabledState();
    };
    tray_.onOpenSettings = [this] { openSettings(); };
    tray_.onQuit = [this] { quit(); };
    tray_.add(hwnd_, WM_APP_TRAY);
    // explorer.exe 重启后托盘图标会消失，收到 TaskbarCreated 时重挂
    taskbarCreatedMsg_ = RegisterWindowMessageW(L"TaskbarCreated");

    applyEnabledState();

    // 首次启动：打开设置窗口，让用户立刻完成配置
    Settings& s = Settings::shared();
    if (!s.hasCompletedFirstLaunch || !shortcutIssue_.empty()) {
        openSettings();
    } else if(const auto token=credentials::LoadSessionToken();!token.empty())account::FetchProfile(hwnd_,WM_APP_ACCOUNT_STATUS,token);
    return true;
}

void App::cancelTranslations() {
    ++contextGeneration_;
    currentReq_=0;
    translator::CancelAll();
    replacer::CancelAll();
    PopupWindow::shared().close();
    SelectionIcon::shared().hide();
}

void App::applyEnabledState() {
    if (shuttingDown_) return;
    UnregisterHotKey(hwnd_, kReadHotkeyId);
    UnregisterHotKey(hwnd_, kRewriteHotkeyId);
    SelectionMonitor::shared().stop();
    SelectionIcon::shared().hide();
    readShortcutRegistered_ = false;
    rewriteShortcutRegistered_ = false;
    shortcutsReady_ = false;
    shortcutIssue_.clear();

    const Settings& s = Settings::shared();
    if (!s.enabled) {
        cancelTranslations();
        SettingsWindow::refreshShortcutStatus();
        return;
    }

    if (s.readShortcut.isConfigured() && s.rewriteShortcut.isConfigured()
        && s.readShortcut == s.rewriteShortcut) {
        diagnostics::Record("shortcutRegistration", "failure", {}, {}, "duplicate");
        shortcutIssue_ = L"Translate and rewrite use the same shortcut. Choose different combinations below.";
        SettingsWindow::refreshShortcutStatus();
        setupSelectionTrigger();
        return;
    }

    const bool readConfigured = s.readShortcut.isConfigured();
    const bool rewriteConfigured = s.rewriteShortcut.isConfigured();
    bool ok1 = !readConfigured || RegisterHotKey(hwnd_, kReadHotkeyId,
                                                 s.readShortcut.modifiers | MOD_NOREPEAT,
                                                 s.readShortcut.vk);
    const DWORD readError = ok1 ? ERROR_SUCCESS : GetLastError();
    bool ok2 = !rewriteConfigured || RegisterHotKey(hwnd_, kRewriteHotkeyId,
                                                    s.rewriteShortcut.modifiers | MOD_NOREPEAT,
                                                    s.rewriteShortcut.vk);
    const DWORD rewriteError = ok2 ? ERROR_SUCCESS : GetLastError();
    readShortcutRegistered_ = readConfigured && ok1;
    rewriteShortcutRegistered_ = rewriteConfigured && ok2;
    shortcutsReady_ = (readConfigured || rewriteConfigured) && ok1 && ok2;
    diagnostics::Record("shortcutRegistration", shortcutsReady_ ? "success" : "failure",
                        {}, {}, shortcutsReady_ ? "" :
                                  (!readConfigured && !rewriteConfigured ? "notConfigured" : "unavailable"));
    auto unavailable = [&](const wchar_t* action, const Hotkey& shortcut, DWORD error) {
        if (!shortcutIssue_.empty()) shortcutIssue_ += L"\n";
        shortcutIssue_ += std::wstring(action) + L": " + shortcut.displayString();
        shortcutIssue_ += error == ERROR_HOTKEY_ALREADY_REGISTERED
            ? L" is in use by another application."
            : L" could not register (Windows error " + std::to_wstring(error) + L").";
        util::Log("shortcut registration failed action=%ls error=%lu", action, error);
    };
    if (!ok1) unavailable(L"Translate selection", s.readShortcut, readError);
    if (!ok2) unavailable(L"Rewrite & replace", s.rewriteShortcut, rewriteError);
    SettingsWindow::refreshShortcutStatus();

    setupSelectionTrigger();
}

void App::setupSelectionTrigger() {
    const Settings& s = Settings::shared();
    if (s.selectionTrigger == SelectionTrigger::None) return;

    SelectionMonitor::shared().onSelection = [this](const capture::Capture& cap, POINT mouse) {
        const Settings& st = Settings::shared();
        if (!st.enabled || foregroundAppSkipped()) return;
        if (st.selectionTrigger == SelectionTrigger::Icon) {
            capture::Capture copy = cap;
            SelectionIcon::shared().show(cap.anchor, cap.hasAnchor, mouse,
                                         [this, copy] { presentRead(copy); });
        } else if (st.selectionTrigger == SelectionTrigger::Auto) {
            presentRead(cap);
        }
    };
    SelectionMonitor::shared().start();
}

void App::openSettings() {
    if (shuttingDown_) return;
    SettingsWindow::open(hwnd_, !shortcutIssue_.empty());
}

void App::quit() {
    if (shuttingDown_) return;
    shuttingDown_ = true;
    UnregisterHotKey(hwnd_, kReadHotkeyId);
    UnregisterHotKey(hwnd_, kRewriteHotkeyId);
    cancelTranslations();
    account::Cancel();
    SelectionMonitor::shared().stop();
    EnumThreadWindows(GetCurrentThreadId(), [](HWND window, LPARAM) -> BOOL {
        EnableWindow(window, FALSE);
        return TRUE;
    }, 0);
    tray_.setStatus(L"ARType · Завершение фоновых операций…");
    workers::Shared().stop();
    SetTimer(hwnd_, kShutdownTimer, 50, nullptr);
}

// ---------- 方向决策（与 macOS resolveDirection 一致）----------

App::Direction App::resolveDirection(const std::wstring& text, TranslationDirection mode, bool isWrite) const {
    const Settings& s = Settings::shared();
    auto route = lang::ResolveDirection(text, mode, isWrite, s.nativeLanguage, s.foreignLanguage);
    return {route.source, route.target};
}

// ---------- 跳过列表 ----------

bool App::foregroundAppSkipped() const {
    const Settings& s = Settings::shared();
    if (s.skipApps.empty()) return false;

    HWND fg = GetForegroundWindow();
    if (!fg) return false;
    DWORD pid = 0;
    GetWindowThreadProcessId(fg, &pid);
    if (!pid) return false;
    HANDLE proc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
    if (!proc) return false;
    wchar_t path[MAX_PATH]{};
    DWORD size = MAX_PATH;
    bool got = QueryFullProcessImageNameW(proc, 0, path, &size);
    CloseHandle(proc);
    if (!got) return false;

    std::wstring exe = path;
    auto slash = exe.find_last_of(L"\\/");
    if (slash != std::wstring::npos) exe = exe.substr(slash + 1);
    std::wstring exeLower = util::ToLower(exe);
    std::wstring exeNoExt = exeLower;
    if (exeNoExt.size() > 4 && exeNoExt.rfind(L".exe") == exeNoExt.size() - 4)
        exeNoExt.resize(exeNoExt.size() - 4);

    for (const auto& entry : s.skipApps) {
        std::wstring e = util::ToLower(util::Trim(entry));
        if (e.empty()) continue;
        if (e.size() > 4 && e.rfind(L".exe") == e.size() - 4) e.resize(e.size() - 4);
        if (e == exeNoExt) return true;
    }
    return false;
}

// ---------- 读·划词翻译 ----------

void App::performShortcutAction(ShortcutAction action) {
    const Settings& s = Settings::shared();
    switch (action) {
    case ShortcutAction::NativePopup: handleRead(s.nativeLanguage); break;
    case ShortcutAction::ForeignPopup: handleRead(s.foreignLanguage); break;
    case ShortcutAction::NativeReplace: handleRewrite(s.nativeLanguage); break;
    case ShortcutAction::ForeignReplace: handleRewrite(s.foreignLanguage); break;
    case ShortcutAction::SmartReplace: handleRewrite(); break;
    case ShortcutAction::SmartPopup:
    default: handleRead(); break;
    }
}

void App::handleRead(std::optional<Language> targetOverride) {
    const Settings& s = Settings::shared();
    util::Log("handleRead enabled=%d", s.enabled);
    if (shuttingDown_ || !s.enabled || foregroundAppSkipped()) return;
    cancelTranslations();

    // UIA 快路径在主线程（无睡眠）；拿不到再去工作线程走剪贴板兜底
    // （兜底要等最多 400ms，主线程睡了低级钩子会被系统摘掉）
    if (auto cap = capture::UIAReadSelection()) {
        diagnostics::Record("selectionCapture", "success", {}, "uia", {}, -1, -1,
                            (int)cap->text.size());
        presentRead(*cap, targetOverride);
        return;
    }
    HWND hwnd = hwnd_;
    const auto generation=contextGeneration_.load();
    const bool accepted = workers::Shared().submit([this, hwnd, targetOverride, generation](std::stop_token stop) {
        const auto cancelled = [this, generation, stop] { return stop.stop_requested() || contextGeneration_.load() != generation; };
        auto copied = capture::ClipboardFallbackCopy(cancelled);
        capture::Capture* cap = nullptr;
        if (copied) {
            diagnostics::Record("selectionCapture", "success", {}, "clipboardFallback", {}, -1, -1,
                                (int)copied->size());
            cap = new capture::Capture;
            cap->generation=generation;
            cap->text = *copied;
            cap->anchor = capture::CursorAnchor();
            cap->hasAnchor = true;
        }
        else diagnostics::Record("selectionCapture", "failure");
        if (!PostMessageW(hwnd, WM_APP_READ_CAPTURED,
                          targetOverride ? (WPARAM)((int)*targetOverride + 1) : 0, (LPARAM)cap)) delete cap;
    }, [](std::exception_ptr) { diagnostics::Record("selectionCapture", "failure", {}, {}, "worker"); });
    if (!accepted) showErrorPopup(L"", targetOverride.value_or(s.nativeLanguage), capture::CursorAnchor(),
                                 L"Фоновые операции заняты или приложение завершает работу.");
}

bool App::rejectIfTooLong(const capture::Capture& cap) {
    if (cap.text.size() <= kMaxInputChars) return false;
    RECT anchor = cap.hasAnchor ? cap.anchor : capture::CursorAnchor();
    wchar_t msg[128];
    swprintf_s(msg, L"Selection is too long (%zu characters, max %zu)",
               cap.text.size(), kMaxInputChars);
    showErrorPopup(cap.text.substr(0, 80), Settings::shared().nativeLanguage, anchor, msg);
    return true;
}

void App::presentRead(const capture::Capture& cap, std::optional<Language> targetOverride) {
    if (shuttingDown_) return;
    if (rejectIfTooLong(cap)) return;
    cancelTranslations();
    const Settings& s = Settings::shared();
    RECT anchor = cap.hasAnchor ? cap.anchor : capture::CursorAnchor();
    Direction dir = targetOverride ? Direction{lang::Detect(cap.text), *targetOverride}
                                   : resolveDirection(cap.text, s.readDirection, false);

    currentSource_ = dir.from;
    currentText_ = cap.text;
    currentStyle_ = s.readStyle;
    currentReplaceSelectAll_ = false;

    PopupWindow& popup = PopupWindow::shared();
    popup.show(cap.text, dir.to, anchor, /*showReplace=*/true);
    popup.onReplace = [this, destination = cap.replacementTarget, original = cap.text, anchor] {
        std::wstring t = PopupWindow::shared().translation();
        if (util::Trim(t).empty()) return;
        bool selectAll = currentReplaceSelectAll_;
        const auto language = PopupWindow::shared().target();
        PopupWindow::shared().close();
        replaceOrOfferCopy(std::move(t), selectAll, destination, original, language, anchor);
    };
    popup.onRetarget = [this](Language newTarget) {
        translator::Cancel(currentReq_);
        PopupWindow& p = PopupWindow::shared();
        p.setTarget(newTarget);
        p.resetForRetranslate();
        startStream(currentText_, currentSource_, newTarget, currentStyle_);
    };
    popup.onRetry = [this] {
        PopupWindow& p = PopupWindow::shared();
        p.resetForRetranslate();
        startStream(currentText_, currentSource_, p.target(), currentStyle_);
    };
    popup.onClosed = [this] { translator::Cancel(currentReq_); };

    startStream(cap.text, dir.from, dir.to, s.readStyle);
}

void App::startStream(const std::wstring& text, std::optional<Language> from, Language to, RewriteStyle style) {
    HWND hwnd = hwnd_;
    currentReq_ = translator::Stream(
        {text, from, to, style},
        [hwnd](uint64_t id, const std::wstring& delta) {
            auto* payload = new std::wstring(delta);
            if (!PostMessageW(hwnd, WM_APP_TR_DELTA, (WPARAM)id, (LPARAM)payload))
                delete payload;
        },
        [hwnd](uint64_t id, bool ok, const std::wstring& error) {
            auto* payload = new DoneMsg{ok, error};
            if (!PostMessageW(hwnd, WM_APP_TR_DONE, (WPARAM)id, (LPARAM)payload))
                delete payload;
        });
}

// ---------- 写·输入改写 ----------

void App::handleRewrite(std::optional<Language> targetOverride) {
    const Settings& s = Settings::shared();
    if (shuttingDown_ || !s.enabled || foregroundAppSkipped()) return;
    cancelTranslations();

    // 与 handleRead 同理：UIA 主线程快路径，剪贴板兜底进工作线程
    if (auto cap = capture::UIACaptureForRewrite()) {
        diagnostics::Record("selectionCapture", "success", {}, "uia", {}, -1, -1,
                            (int)cap->text.size());
        proceedRewrite(*cap, targetOverride);
        return;
    }
    HWND hwnd = hwnd_;
    const auto generation=contextGeneration_.load();
    const bool accepted = workers::Shared().submit([this, hwnd, targetOverride, generation](std::stop_token stop) {
        const auto cancelled = [this, generation, stop] { return stop.stop_requested() || contextGeneration_.load() != generation; };
        auto copied = capture::ClipboardFallbackCopy(cancelled);
        capture::Capture* cap = nullptr;
        if (copied) {
            diagnostics::Record("selectionCapture", "success", {}, "clipboardFallback", {}, -1, -1,
                                (int)copied->size());
            cap = new capture::Capture;
            cap->generation=generation;
            cap->text = *copied;
            cap->anchor = capture::CursorAnchor();
            cap->hasAnchor = true;
        }
        else diagnostics::Record("selectionCapture", "failure");
        if (!PostMessageW(hwnd, WM_APP_REWRITE_CAPTURED,
                          targetOverride ? (WPARAM)((int)*targetOverride + 1) : 0, (LPARAM)cap)) delete cap;
    }, [](std::exception_ptr) { diagnostics::Record("selectionCapture", "failure", {}, {}, "worker"); });
    if (!accepted) showErrorPopup(L"", targetOverride.value_or(s.nativeLanguage), capture::CursorAnchor(),
                                 L"Фоновые операции заняты или приложение завершает работу.");
}

void App::proceedRewrite(const capture::Capture& capIn, std::optional<Language> targetOverride) {
    if (rejectIfTooLong(capIn)) return;
    const Settings& s = Settings::shared();
    const capture::Capture* cap = &capIn;

    Direction dir = targetOverride ? Direction{lang::Detect(cap->text), *targetOverride}
                                   : resolveDirection(cap->text, s.rewriteDirection, true);

    if (s.rewritePreview) {
        // 先预览：弹窗显示译文 + Replace（整框改写替换时先全选）
        RECT anchor = cap->hasAnchor ? cap->anchor : capture::CursorAnchor();
        currentSource_ = dir.from;
        currentText_ = cap->text;
        currentStyle_ = s.rewriteStyle;
        currentReplaceSelectAll_ = cap->isWholeField;

        PopupWindow& popup = PopupWindow::shared();
        popup.show(cap->text, dir.to, anchor, /*showReplace=*/true);
        popup.onReplace = [this, destination = cap->replacementTarget, original = cap->text, anchor] {
            std::wstring t = PopupWindow::shared().translation();
            if (util::Trim(t).empty()) return;
            bool selectAll = currentReplaceSelectAll_;
            const auto language = PopupWindow::shared().target();
            PopupWindow::shared().close();
            replaceOrOfferCopy(std::move(t), selectAll, destination, original, language, anchor);
        };
        popup.onRetarget = [this](Language newTarget) {
            translator::Cancel(currentReq_);
            PopupWindow& p = PopupWindow::shared();
            p.setTarget(newTarget);
            p.resetForRetranslate();
            startStream(currentText_, currentSource_, newTarget, currentStyle_);
        };
        popup.onRetry = [this] {
            PopupWindow& p = PopupWindow::shared();
            p.resetForRetranslate();
            startStream(currentText_, currentSource_, p.target(), currentStyle_);
        };
        popup.onClosed = [this] { translator::Cancel(currentReq_); };

        startStream(cap->text, dir.from, dir.to, s.rewriteStyle);
    } else {
        // 直接替换：在主线程拍配置快照并启动异步流，完成后回主线程粘贴。
        HWND hwnd = hwnd_;
        capture::Capture c = *cap;
        Direction d = dir;
        RewriteStyle style = s.rewriteStyle;
        struct RewriteStreamState {
            std::mutex mutex;
            std::wstring result;
        };
        auto state = std::make_shared<RewriteStreamState>();
        const auto generation=contextGeneration_.load();
        translator::Stream(
            {c.text, d.from, d.to, style},
            [state](uint64_t, const std::wstring& delta) {
                std::lock_guard lock(state->mutex);
                state->result += delta;
            },
            [hwnd, state, c, d, generation](uint64_t, bool ok, const std::wstring& error) {
                std::lock_guard lock(state->mutex);
                std::wstring cleaned = util::Trim(state->result);
                const bool emptyResponse = ok && cleaned.empty();
                auto* msg = new RewriteResult{
                    generation,
                    ok && !cleaned.empty(),
                    std::move(cleaned),
                    emptyResponse ? L"Empty translation" : error,
                    c.isWholeField,
                    c.hasAnchor ? c.anchor : capture::CursorAnchor(),
                    true,
                    c.text,
                    d.to,
                    c.replacementTarget,
                };
                if (!PostMessageW(hwnd, WM_APP_REWRITE_DONE, 0, (LPARAM)msg)) delete msg;
            });
    }
}

void App::replaceOrOfferCopy(std::wstring text, bool selectAll,
                            std::optional<replacement::Snapshot> target,
                            std::wstring original, Language language, RECT anchor) {
    const auto generation = contextGeneration_.load();
    const auto window = hwnd_;
    auto completed = std::make_shared<ReplacementResult>(
        ReplacementResult{generation, replacement::Result::Failed, text, std::move(original), language, anchor});
    replacer::ReplaceAsync(std::move(text), selectAll, std::move(target),
        [window, completed](replacement::Result result) {
            auto message = std::make_unique<ReplacementResult>(*completed);
            message->result = result;
            if (PostMessageW(window, WM_APP_REPLACEMENT_DONE, 0, reinterpret_cast<LPARAM>(message.get())))
                message.release();
        });
}

void App::showErrorPopup(const std::wstring& original, Language target, RECT anchor, const std::wstring& error) {
    PopupWindow& popup = PopupWindow::shared();
    popup.show(original, target, anchor, /*showReplace=*/false);
    popup.onReplace = nullptr;
    popup.onRetarget = nullptr;
    popup.onRetry = nullptr;
    popup.onClosed = nullptr;
    popup.setError(error);
}

// ---------- 消息处理 ----------

LRESULT App::handle(UINT msg, WPARAM wp, LPARAM lp) {
    if (shuttingDown_) {
        // Keep this window alive until every sender exits. Drain payloads without
        // presenting output or starting more work from a retiring account/context.
        switch (msg) {
        case WM_APP_TR_DELTA: delete reinterpret_cast<std::wstring*>(lp); return 0;
        case WM_APP_TR_DONE: delete reinterpret_cast<DoneMsg*>(lp); return 0;
        case WM_APP_REWRITE_DONE: delete reinterpret_cast<RewriteResult*>(lp); return 0;
        case WM_APP_REPLACEMENT_DONE: delete reinterpret_cast<ReplacementResult*>(lp); return 0;
        case WM_APP_ACCOUNT_STATUS: account::TakeUpdate(lp); return 0;
        case WM_APP_READ_CAPTURED:
        case WM_APP_REWRITE_CAPTURED: delete reinterpret_cast<capture::Capture*>(lp); return 0;
        case WM_APP_TRAY: case WM_APP_OPEN_SETTINGS: case WM_HOTKEY: return 0;
        }
    }
    switch (msg) {
    case WM_CLOSE:
        quit();
        return 0;
    case WM_TIMER:
        if (wp == kShutdownTimer && shuttingDown_ && workers::Shared().exited()) {
            KillTimer(hwnd_, kShutdownTimer);
            // All senders have returned. Deliver remaining messages to their
            // still-live windows so each typed payload is released exactly once.
            MSG pending{};
            while (PeekMessageW(&pending, nullptr, 0, 0, PM_REMOVE)) {
                if (pending.message != WM_QUIT) DispatchMessageW(&pending);
            }
            diagnostics::Record("shutdown", "success", {}, {},
                                workers::Shared().failures() ? "workerFailures" : "");
            tray_.remove();
            EnumThreadWindows(GetCurrentThreadId(), [](HWND window, LPARAM) -> BOOL {
                DestroyWindow(window);
                return TRUE;
            }, 0);
            PostQuitMessage(0);
        }
        return 0;
    case WM_APP_ACCOUNT_STATUS: {
        auto update = account::TakeUpdate(lp);
        if(!update||!account::Current(update->generation)||!update->profile.isObject())return 0;
        const auto notice=managed::AccessNotice(update->profile,Settings::shared().tenantId);
        if(!notice.empty())MessageBoxW(hwnd_,util::Widen(notice).c_str(),L"ARType · доступ к программе",MB_OK|MB_ICONINFORMATION);
        return 0;
    }
    case WM_HOTKEY:
        if (wp == kReadHotkeyId) performShortcutAction(Settings::shared().readShortcutAction);
        else if (wp == kRewriteHotkeyId) performShortcutAction(Settings::shared().rewriteShortcutAction);
        return 0;

    case WM_APP_TRAY: {
        UINT event = LOWORD(lp);
        if (event == WM_CONTEXTMENU || event == WM_RBUTTONUP || event == WM_LBUTTONUP)
            tray_.showMenu(hwnd_);
        else if (event == WM_LBUTTONDBLCLK)
            openSettings();
        return 0;
    }

    case WM_APP_TR_DELTA: {
        auto* delta = (std::wstring*)lp;
        if ((uint64_t)wp == currentReq_ && PopupWindow::shared().isVisible())
            PopupWindow::shared().appendDelta(*delta);
        delete delta;
        return 0;
    }

    case WM_APP_TR_DONE: {
        auto* done = (DoneMsg*)lp;
        if ((uint64_t)wp == currentReq_ && PopupWindow::shared().isVisible()) {
            if (!done->ok)
                PopupWindow::shared().setError(done->error);
            else if (util::Trim(PopupWindow::shared().translation()).empty())
                PopupWindow::shared().setError(L"No translation returned");
            else
                PopupWindow::shared().finishTranslation();
        }
        delete done;
        return 0;
    }

    case WM_APP_REWRITE_DONE: {
        auto* r = (RewriteResult*)lp;
        if(r->generation!=contextGeneration_){delete r;return 0;}
        if (r->ok)
            replaceOrOfferCopy(std::move(r->text), r->isWholeField, std::move(r->replacementTarget),
                               std::move(r->original), r->target, r->anchor);
        else
            showErrorPopup(r->original, r->target, r->anchor, r->error);
        delete r;
        return 0;
    }

    case WM_APP_REPLACEMENT_DONE: {
        std::unique_ptr<ReplacementResult> result(reinterpret_cast<ReplacementResult*>(lp));
        if (!result || result->generation != contextGeneration_ ||
            result->result == replacement::Result::Cancelled || result->result == replacement::Result::Replaced) return 0;
        auto& popup = PopupWindow::shared();
        popup.show(result->original, result->language, result->anchor, false);
        popup.onReplace = nullptr;
        popup.onRetarget = nullptr;
        popup.onRetry = nullptr;
        popup.onClosed = nullptr;
        popup.appendDelta(result->translation);
        popup.setReplacementNotice(L"Автоматическая вставка недоступна. Скопируйте готовый перевод и вставьте его вручную.");
        popup.finishTranslation();
        return 0;
    }
    case WM_APP_OPEN_SETTINGS:
        openSettings();
        return 0;

    case WM_APP_READ_CAPTURED: {
        auto* cap = (capture::Capture*)lp;
        if (cap) {
            if(cap->generation!=contextGeneration_){delete cap;return 0;}
            std::optional<Language> target = wp ? std::optional<Language>((Language)((int)wp - 1)) : std::nullopt;
            presentRead(*cap, target);
            delete cap;
        }
        return 0;
    }

    case WM_APP_REWRITE_CAPTURED: {
        auto* cap = (capture::Capture*)lp;
        if (cap) {
            if(cap->generation!=contextGeneration_){delete cap;return 0;}
            std::optional<Language> target = wp ? std::optional<Language>((Language)((int)wp - 1)) : std::nullopt;
            proceedRewrite(*cap, target);
            delete cap;
        }
        return 0;
    }

    case WM_DESTROY:
        tray_.remove();
        return 0;
    }

    // explorer 重启 → 托盘图标丢失，重挂
    if (taskbarCreatedMsg_ && msg == taskbarCreatedMsg_) {
        tray_.remove();
        tray_.add(hwnd_, WM_APP_TRAY);
        return 0;
    }
    return DefWindowProcW(hwnd_, msg, wp, lp);
}
