//
//  Clipboard.h — 文本剪贴板读写与快照/还原（对应 macOS 的 Pasteboard）。
//
#pragma once
#include <windows.h>
#include <optional>
#include <string>
#include <vector>
#include <cstddef>

namespace clipboard {

/// 当前剪贴板文本；非文本或为空返回 nullopt
std::optional<std::wstring> GetText();

/// 写入文本
bool SetText(const std::wstring& text);

/// 剪贴板序列号（变化说明有新内容写入）
DWORD SequenceNumber();

struct Format {
    UINT type = 0;
    std::vector<std::byte> data;
};

/// Complete snapshot of supported memory formats; valid=false if any format
/// cannot be preserved. An invalid snapshot must never precede EmptyClipboard.
struct Snapshot {
    std::optional<std::wstring> text;
    DWORD sequence = 0;
    bool valid = false;
    std::vector<Format> formats;
};

Snapshot Take();
bool RestoreIfUnchanged(const Snapshot& snap, DWORD expectedSequence, HWND expectedOwner = nullptr);

} // namespace clipboard
