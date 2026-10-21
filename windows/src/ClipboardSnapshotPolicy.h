#pragma once
#include <cstddef>
#include <cstdint>
#include <string_view>

namespace clipboard {
// Only formats with a known, self-contained HGLOBAL representation are copied.
// Owner-display, GDI handles, private formats and unknown application contracts
// make the complete snapshot unavailable: callers must not empty the clipboard.
inline bool SupportsSnapshotFormat(uint32_t format, std::wstring_view name = {}) {
    switch (format) {
    case 1: case 7: case 8: case 13: case 15: case 16: case 17: case 0x81:
        return true; // TEXT, OEMTEXT, DIB, UNICODETEXT, HDROP, LOCALE, DIBV5, DSPTEXT.
    default:
        return format >= 0xc000 && format <= 0xffff &&
            (name == L"HTML Format" || name == L"Rich Text Format" ||
             name == L"Rich Text Format Without Objects" || name == L"PNG" ||
             name == L"JFIF" || name == L"CanIncludeInClipboardHistory" ||
             name == L"CanUploadToCloudClipboard");
    }
}

struct SnapshotBudget {
    static constexpr size_t maxFormats = 64, maxBytes = 32 * 1024 * 1024;
    size_t formats = 0, bytes = 0;
    bool accept(size_t size) {
        if (!size || formats == maxFormats || size > maxBytes - bytes) return false;
        ++formats;
        bytes += size;
        return true;
    }
};
}
