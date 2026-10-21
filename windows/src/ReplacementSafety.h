#pragma once
#include <cstdint>
#include <functional>
#include <string>
#include <vector>

namespace replacement {

struct Snapshot {
    uintptr_t window = 0;
    uint32_t process = 0;
    std::vector<int> element;
    std::wstring value;
    size_t start = 0, end = 0;
};

inline bool Matches(const Snapshot& expected, const Snapshot& current, bool afterSelectAll) {
    if (!expected.window || !expected.process || expected.element.empty() ||
        expected.start > expected.end || expected.end > expected.value.size()) return false;
    return expected.window == current.window && expected.process == current.process &&
        expected.element == current.element && expected.value == current.value &&
        current.start == (afterSelectAll ? 0 : expected.start) &&
        current.end == (afterSelectAll ? expected.value.size() : expected.end);
}

enum class Result { Replaced, TargetChanged, Cancelled, ClipboardChanged, Failed };

// OS effects remain outside the policy, so the actual replacement ordering is
// exercised with deterministic focus/clipboard changes in portable tests.
struct Actions {
    std::function<bool(bool)> verifyTarget;
    std::function<bool()> cancelled;
    std::function<bool()> prepareClipboard;
    std::function<bool()> ownsClipboard;
    std::function<bool()> selectAll;
    std::function<bool()> paste;
    std::function<void()> settleSelection;
    std::function<void()> settlePaste;
    std::function<void()> restoreClipboard;
};

inline Result Perform(bool selectAll, const Actions& a) {
    if (a.cancelled()) return Result::Cancelled;
    if (!a.verifyTarget(false)) return Result::TargetChanged;
    if (!a.prepareClipboard()) return Result::Failed;
    struct Restore { const Actions& a; ~Restore() { a.restoreClipboard(); } } restore{a};
    if (a.cancelled()) return Result::Cancelled;
    if (!a.verifyTarget(false)) return Result::TargetChanged;
    if (!a.ownsClipboard()) return Result::ClipboardChanged;
    if (selectAll) {
        if (!a.selectAll()) return Result::Failed;
        a.settleSelection();
    }
    if (a.cancelled()) return Result::Cancelled;
    if (!a.verifyTarget(selectAll)) return Result::TargetChanged;
    if (!a.ownsClipboard()) return Result::ClipboardChanged;
    if (!a.paste()) return Result::Failed;
    a.settlePaste();
    return Result::Replaced;
}

}
