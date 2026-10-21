#include "Clipboard.h"
#include "ClipboardSnapshotPolicy.h"
#include <algorithm>
#include <utility>

namespace clipboard {

namespace {
/// 打开剪贴板（短重试，其他进程可能占用）
struct Opener {
    bool ok = false;
    HWND owner = nullptr;
    explicit Opener(bool writing = false) {
        if (writing) {
            owner = CreateWindowExW(0, L"STATIC", L"", 0, 0, 0, 0, 0,
                                   HWND_MESSAGE, nullptr, GetModuleHandleW(nullptr), nullptr);
            if (!owner) return;
        }
        for (int i = 0; i < 5; ++i) {
            if (OpenClipboard(owner)) { ok = true; return; }
            Sleep(10);
        }
    }
    ~Opener() { if (ok) CloseClipboard(); if (owner) DestroyWindow(owner); }
};
std::optional<std::wstring> readLocked() {
    HANDLE h = GetClipboardData(CF_UNICODETEXT);
    if (!h) return std::nullopt;
    auto* p = static_cast<const wchar_t*>(GlobalLock(h));
    if (!p) return std::nullopt;
    const SIZE_T count = GlobalSize(h) / sizeof(wchar_t);
    // Clipboard memory is supplied by another process; never scan beyond it.
    if (!count || count > 16 * 1024 * 1024) { GlobalUnlock(h); return std::nullopt; }
    const auto end = std::find(p, p + count, L'\0');
    if (end == p + count) { GlobalUnlock(h); return std::nullopt; }
    std::wstring text(p, end);
    GlobalUnlock(h);
    return text;
}

bool writeLocked(const std::wstring& text) {
    size_t bytes = (text.size() + 1) * sizeof(wchar_t);
    HGLOBAL h = GlobalAlloc(GMEM_MOVEABLE, bytes);
    if (!h) return false;
    void* p = GlobalLock(h);
    if (!p) { GlobalFree(h); return false; }
    memcpy(p, text.c_str(), bytes);
    GlobalUnlock(h);
    if (!SetClipboardData(CF_UNICODETEXT, h)) {
        GlobalFree(h);
        return false;
    }
    return true;
}

struct Memory {
    HGLOBAL handle = nullptr;
    explicit Memory(const std::vector<std::byte>& data) {
        handle = GlobalAlloc(GMEM_MOVEABLE, data.size());
        if (!handle) return;
        auto* destination = GlobalLock(handle);
        if (!destination) { GlobalFree(handle); handle = nullptr; return; }
        memcpy(destination, data.data(), data.size());
        GlobalUnlock(handle);
    }
    Memory(Memory&& other) noexcept : handle(std::exchange(other.handle, nullptr)) {}
    Memory(const Memory&) = delete;
    ~Memory() { if (handle) GlobalFree(handle); }
};
} // namespace

std::optional<std::wstring> GetText() {
    Opener open;
    return open.ok ? readLocked() : std::nullopt;
}

bool SetText(const std::wstring& text) {
    Opener open(true);
    if (!open.ok || !EmptyClipboard()) return false;
    return writeLocked(text);
}

DWORD SequenceNumber() {
    return GetClipboardSequenceNumber();
}

Snapshot Take() {
    Opener open;
    if (!open.ok) return {};
    Snapshot snapshot;
    SnapshotBudget budget;
    UINT format = 0;
    for (;;) {
        SetLastError(ERROR_SUCCESS);
        format = EnumClipboardFormats(format);
        if (!format) {
            if (GetLastError() != ERROR_SUCCESS) return {};
            break;
        }
        wchar_t name[256]{};
        if (format >= 0xc000) GetClipboardFormatNameW(format, name, 256);
        if (!SupportsSnapshotFormat(format, name)) return {};
        HANDLE handle = GetClipboardData(format);
        if (!handle) return {};
        const SIZE_T size = GlobalSize(handle);
        if (!budget.accept(size)) return {};
        auto* data = static_cast<const std::byte*>(GlobalLock(handle));
        if (!data) return {};
        struct Unlock { HANDLE handle; ~Unlock() { GlobalUnlock(handle); } } unlock{handle};
        Format copy{format, std::vector<std::byte>(data, data + size)};
        snapshot.formats.push_back(std::move(copy));
    }
    snapshot.text = readLocked();
    snapshot.sequence = GetClipboardSequenceNumber();
    snapshot.valid = true;
    return snapshot;
}

bool RestoreIfUnchanged(const Snapshot& snap, DWORD expectedSequence, HWND expectedOwner) {
    if (!snap.valid) return false;
    Opener open(true);
    if (!open.ok || GetClipboardSequenceNumber() != expectedSequence ||
        (expectedOwner && GetClipboardOwner() != expectedOwner)) return false;
    // Allocate every representation before destroying the temporary clipboard.
    // Ownership transfers individually only after a successful SetClipboardData.
    std::vector<Memory> copies;
    copies.reserve(snap.formats.size());
    for (const auto& format : snap.formats) {
        copies.emplace_back(format.data);
        if (!copies.back().handle) return false;
    }
    if (!EmptyClipboard()) return false;
    bool restored = true;
    for (size_t i = 0; i < copies.size(); ++i) {
        if (SetClipboardData(snap.formats[i].type, copies[i].handle))
            copies[i].handle = nullptr;
        else
            restored = false;
    }
    return restored;
}

} // namespace clipboard
