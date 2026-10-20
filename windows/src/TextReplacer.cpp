#include "TextReplacer.h"
#include "Clipboard.h"
#include "Keyboard.h"
#include "LocalDiagnostics.h"
#include "SelectionCapture.h"
#include "WorkerPool.h"
#include <objbase.h>
#include <atomic>

namespace replacer {
namespace {
constexpr wchar_t kOwnerClass[] = L"ARTypeClipboardOwner";
std::atomic<uint64_t> generation{0};

struct RenderContext {
    const std::wstring* text = nullptr;
    bool rendered = false;
    DWORD sequence = 0;
    uint64_t generation = 0;
};

bool serveText(const std::wstring& text) {
    const size_t bytes = (text.size() + 1) * sizeof(wchar_t);
    HGLOBAL memory = GlobalAlloc(GMEM_MOVEABLE, bytes);
    if (!memory) return false;
    void* data = GlobalLock(memory);
    if (!data) { GlobalFree(memory); return false; }
    memcpy(data, text.c_str(), bytes);
    GlobalUnlock(memory);
    if (!SetClipboardData(CF_UNICODETEXT, memory)) { GlobalFree(memory); return false; }
    return true;
}

LRESULT CALLBACK ownerProc(HWND window, UINT message, WPARAM format, LPARAM parameter) {
    auto* context = reinterpret_cast<RenderContext*>(GetWindowLongPtrW(window, GWLP_USERDATA));
    if (message == WM_RENDERFORMAT && context && context->text && format == CF_UNICODETEXT &&
        context->generation == generation.load()) {
        if (serveText(*context->text)) {
            context->rendered = true;
            context->sequence = GetClipboardSequenceNumber();
        }
        return 0;
    }
    // Never materialize a pending confidential translation during teardown.
    if (message == WM_RENDERALLFORMATS) return 0;
    return DefWindowProcW(window, message, format, parameter);
}

replacement::Result replaceWorker(const std::wstring& text, bool selectAll,
                                 const std::optional<replacement::Snapshot>& target, uint64_t request) {
    const auto cancelled = [request] { return generation.load() != request; };
    if (cancelled()) return replacement::Result::Cancelled;
    if (!target) return replacement::Result::TargetChanged;
    const HRESULT apartment = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    if (FAILED(apartment)) return replacement::Result::Failed;
    struct Apartment { ~Apartment() { CoUninitialize(); } } apartmentLifetime;
    const ULONGLONG deadline = GetTickCount64() + 2000;
    while (GetAsyncKeyState(VK_LBUTTON) & 0x8000) {
        if (cancelled()) return replacement::Result::Cancelled;
        if (GetTickCount64() >= deadline) return replacement::Result::Failed;
        Sleep(5);
    }
    static const bool registered = [] {
        WNDCLASSW cls{};
        cls.lpfnWndProc = ownerProc;
        cls.hInstance = GetModuleHandleW(nullptr);
        cls.lpszClassName = kOwnerClass;
        return RegisterClassW(&cls) != 0 || GetLastError() == ERROR_CLASS_ALREADY_EXISTS;
    }();
    if (!registered) return replacement::Result::Failed;
    HWND owner = CreateWindowExW(0, kOwnerClass, L"", 0, 0, 0, 0, 0,
                                HWND_MESSAGE, nullptr, GetModuleHandleW(nullptr), nullptr);
    if (!owner) return replacement::Result::Failed;
    struct Window {
        HWND handle;
        ~Window() { SetWindowLongPtrW(handle, GWLP_USERDATA, 0); DestroyWindow(handle); }
    } ownerLifetime{owner};
    RenderContext render{&text, false, 0, request};
    SetWindowLongPtrW(owner, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(&render));
    clipboard::Snapshot saved;
    const replacement::Actions actions{
        [&](bool afterSelectAll) { return capture::VerifyReplacementTarget(*target, afterSelectAll); },
        cancelled,
        [&] {
            saved = clipboard::Take();
            if (!saved.valid || !OpenClipboard(owner)) return false;
            // Recheck under the clipboard lock before replacing its contents.
            if (GetClipboardSequenceNumber() != saved.sequence || cancelled()) { CloseClipboard(); return false; }
            if (!EmptyClipboard()) { CloseClipboard(); return false; }
            SetClipboardData(CF_UNICODETEXT, nullptr);
            render.sequence = GetClipboardSequenceNumber();
            const bool prepared = IsClipboardFormatAvailable(CF_UNICODETEXT) != FALSE;
            CloseClipboard();
            if (!prepared) clipboard::RestoreIfUnchanged(saved, render.sequence, owner);
            return prepared;
        },
        [&] { return GetClipboardOwner() == owner && GetClipboardSequenceNumber() == render.sequence; },
        [] { return keyboard::SendSelectAll(); },
        [] { return keyboard::SendPaste(); },
        [] { Sleep(40); },
        [&] {
            const ULONGLONG end = GetTickCount64() + 2000;
            while (!render.rendered && !cancelled() && GetTickCount64() < end) {
                MsgWaitForMultipleObjects(0, nullptr, FALSE, 20, QS_ALLINPUT);
                MSG message;
                while (PeekMessageW(&message, nullptr, 0, 0, PM_REMOVE)) {
                    TranslateMessage(&message);
                    DispatchMessageW(&message);
                }
            }
            if (render.rendered) Sleep(150);
        },
        [&] { clipboard::RestoreIfUnchanged(saved, render.sequence, owner); }
    };
    auto result = replacement::Perform(selectAll, actions);
    if (result == replacement::Result::Replaced && !render.rendered) result = replacement::Result::Failed;
    return result;
}
}

void CancelAll() { ++generation; }

void ReplaceAsync(std::wstring text, bool selectAll, std::optional<replacement::Snapshot> target,
                  std::function<void(replacement::Result)> completion) {
    const auto request = generation.load();
    const auto failed = [completion](std::exception_ptr) {
        diagnostics::Record("replacement", "failure", {}, {}, "worker");
        if (completion) completion(replacement::Result::Failed);
    };
    const auto rejected = completion;
    const bool accepted = workers::Shared().submit(
        [text = std::move(text), selectAll, target = std::move(target), request,
                 completion = std::move(completion)](std::stop_token stop) {
        std::stop_callback onStop(stop, [] { CancelAll(); });
        const auto started = GetTickCount64();
        const auto result = replaceWorker(text, selectAll, target, request);
        diagnostics::Record("replacement", result == replacement::Result::Replaced ? "success" :
                            result == replacement::Result::Cancelled ? "cancelled" : "failure",
                            {}, {}, result == replacement::Result::Replaced ? "" : "destinationUnavailable",
                            -1, static_cast<int>(GetTickCount64() - started), static_cast<int>(text.size()));
        if (completion) completion(result);
    }, failed);
    if (!accepted && rejected) rejected(replacement::Result::Failed);
}
}
