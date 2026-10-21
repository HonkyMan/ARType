#include "SelectionCapture.h"
#include "Clipboard.h"
#include "Keyboard.h"
#include "Util.h"
#include <ole2.h>          // WIN32_LEAN_AND_MEAN 不带 OLE，UIA 头需要
#include <uiautomation.h>
#include <wrl/client.h>
#include <algorithm>

using Microsoft::WRL::ComPtr;

namespace capture {

namespace {

std::wstring fromBstr(BSTR b) {
    if (!b) return {};
    std::wstring s(b, SysStringLen(b));
    SysFreeString(b);
    return s;
}

std::optional<std::wstring> boundedText(IUIAutomationTextRange* range) {
    BSTR raw = nullptr;
    if (FAILED(range->GetText(20001, &raw))) return std::nullopt;
    auto value = fromBstr(raw);
    if (value.size() > 20000) return std::nullopt;
    return value;
}

std::optional<replacement::Snapshot> targetSnapshot(IUIAutomationElement* focused) {
    replacement::Snapshot snapshot;
    HWND foreground = GetForegroundWindow();
    DWORD foregroundPID = 0;
    GetWindowThreadProcessId(foreground, &foregroundPID);
    int elementPID = 0;
    BOOL password = TRUE;
    if (!foreground || !foregroundPID || FAILED(focused->get_CurrentProcessId(&elementPID)) ||
        foregroundPID != static_cast<DWORD>(elementPID) ||
        FAILED(focused->get_CurrentIsPassword(&password)) || password) return std::nullopt;
    snapshot.window = reinterpret_cast<uintptr_t>(foreground);
    snapshot.process = foregroundPID;

    SAFEARRAY* runtime = nullptr;
    if (FAILED(focused->GetRuntimeId(&runtime)) || !runtime) return std::nullopt;
    LONG first = 0, last = -1;
    const bool valid = SafeArrayGetDim(runtime) == 1 &&
        SUCCEEDED(SafeArrayGetLBound(runtime, 1, &first)) &&
        SUCCEEDED(SafeArrayGetUBound(runtime, 1, &last)) &&
        last >= first && static_cast<int64_t>(last) - first < 128 &&
        SafeArrayGetElemsize(runtime) == sizeof(int);
    if (valid) {
        for (int64_t offset = 0; offset <= static_cast<int64_t>(last) - first; ++offset) {
            LONG index = static_cast<LONG>(static_cast<int64_t>(first) + offset);
            int value = 0;
            if (FAILED(SafeArrayGetElement(runtime, &index, &value))) { snapshot.element.clear(); break; }
            snapshot.element.push_back(value);
        }
    }
    SafeArrayDestroy(runtime);
    if (snapshot.element.empty()) return std::nullopt;

    ComPtr<IUIAutomationTextPattern> pattern;
    ComPtr<IUIAutomationTextRange> document, selected, prefix;
    ComPtr<IUIAutomationTextRangeArray> selection;
    int count = 0;
    if (FAILED(focused->GetCurrentPatternAs(UIA_TextPatternId, IID_PPV_ARGS(&pattern))) || !pattern ||
        FAILED(pattern->get_DocumentRange(&document)) || !document ||
        FAILED(pattern->GetSelection(&selection)) || !selection ||
        FAILED(selection->get_Length(&count)) || count != 1 ||
        FAILED(selection->GetElement(0, &selected)) || !selected ||
        FAILED(document->Clone(&prefix)) || !prefix ||
        FAILED(prefix->MoveEndpointByRange(TextPatternRangeEndpoint_End, selected.Get(), TextPatternRangeEndpoint_Start)))
        return std::nullopt;
    const auto whole = boundedText(document.Get()), before = boundedText(prefix.Get()), text = boundedText(selected.Get());
    if (!whole || !before || !text || before->size() > whole->size() ||
        text->size() > whole->size() - before->size() ||
        whole->substr(0, before->size()) != *before ||
        whole->substr(before->size(), text->size()) != *text) return std::nullopt;
    snapshot.value = *whole;
    snapshot.start = before->size();
    snapshot.end = snapshot.start + text->size();
    if (GetForegroundWindow() != foreground) return std::nullopt;
    return snapshot;
}

/// 选区各行矩形的并集（SAFEARRAY of double: l,t,w,h ×N，屏幕物理像素）
bool unionBounds(IUIAutomationTextRange* range, RECT* out) {
    SAFEARRAY* sa = nullptr;
    if (FAILED(range->GetBoundingRectangles(&sa)) || !sa) return false;
    LONG lo = 0, hi = -1;
    SafeArrayGetLBound(sa, 1, &lo);
    SafeArrayGetUBound(sa, 1, &hi);
    LONG count = hi - lo + 1;
    bool ok = false;
    if (count >= 4) {
        double* data = nullptr;
        if (SUCCEEDED(SafeArrayAccessData(sa, (void**)&data))) {
            RECT u{LONG_MAX, LONG_MAX, LONG_MIN, LONG_MIN};
            for (LONG i = 0; i + 3 < count; i += 4) {
                LONG l = (LONG)data[i], t = (LONG)data[i + 1];
                LONG r = l + (LONG)data[i + 2], b = t + (LONG)data[i + 3];
                u.left = std::min(u.left, l);
                u.top = std::min(u.top, t);
                u.right = std::max(u.right, r);
                u.bottom = std::max(u.bottom, b);
            }
            if (u.right > u.left && u.bottom > u.top) { *out = u; ok = true; }
            SafeArrayUnaccessData(sa);
        }
    }
    SafeArrayDestroy(sa);
    return ok;
}

/// 焦点元素的 TextPattern 选区：文字 + 矩形
std::optional<Capture> uiaSelection(IUIAutomationElement* focused) {
    ComPtr<IUIAutomationTextPattern> tp;
    HRESULT hr = focused->GetCurrentPatternAs(UIA_TextPatternId, IID_PPV_ARGS(&tp));
    if (FAILED(hr) || !tp) {
        util::Log("uiaSelection: no TextPattern hr=0x%08lx tp=%d", hr, tp ? 1 : 0);
        return std::nullopt;
    }

    ComPtr<IUIAutomationTextRangeArray> sel;
    hr = tp->GetSelection(&sel);
    if (FAILED(hr) || !sel) {
        util::Log("uiaSelection: GetSelection hr=0x%08lx", hr);
        return std::nullopt;
    }
    int count = 0;
    sel->get_Length(&count);
    if (count <= 0) return std::nullopt;

    ComPtr<IUIAutomationTextRange> range;
    if (FAILED(sel->GetElement(0, &range)) || !range) return std::nullopt;

    BSTR b = nullptr;
    if (FAILED(range->GetText(-1, &b))) return std::nullopt;
    std::wstring text = fromBstr(b);
    if (util::Trim(text).empty()) return std::nullopt;

    Capture cap;
    cap.text = std::move(text);
    cap.replacementTarget = targetSnapshot(focused);
    if (cap.replacementTarget &&
        cap.replacementTarget->value.substr(cap.replacementTarget->start,
            cap.replacementTarget->end - cap.replacementTarget->start) != cap.text)
        cap.replacementTarget.reset();
    cap.hasAnchor = unionBounds(range.Get(), &cap.anchor);
    return cap;
}

/// 焦点元素整个值（ValuePattern 优先，退回 TextPattern 文档全文）
std::optional<std::wstring> uiaWholeValue(IUIAutomationElement* focused) {
    ComPtr<IUIAutomationValuePattern> vp;
    if (SUCCEEDED(focused->GetCurrentPatternAs(UIA_ValuePatternId, IID_PPV_ARGS(&vp))) && vp) {
        BSTR b = nullptr;
        if (SUCCEEDED(vp->get_CurrentValue(&b))) {
            std::wstring v = fromBstr(b);
            if (!util::Trim(v).empty()) return v;
        }
    }
    ComPtr<IUIAutomationTextPattern> tp;
    if (SUCCEEDED(focused->GetCurrentPatternAs(UIA_TextPatternId, IID_PPV_ARGS(&tp))) && tp) {
        ComPtr<IUIAutomationTextRange> doc;
        if (SUCCEEDED(tp->get_DocumentRange(&doc)) && doc) {
            BSTR b = nullptr;
            if (SUCCEEDED(doc->GetText(-1, &b))) {
                std::wstring v = fromBstr(b);
                if (!util::Trim(v).empty()) return v;
            }
        }
    }
    return std::nullopt;
}

ComPtr<IUIAutomationElement> focusedElement() {
    ComPtr<IUIAutomationElement> el;
    // Each caller stays in its own COM apartment; do not share raw UIA interfaces
    // between the UI thread and the replacement worker.
    ComPtr<IUIAutomation> automation;
    if (SUCCEEDED(CoCreateInstance(CLSID_CUIAutomation, nullptr, CLSCTX_INPROC_SERVER,
                                   IID_PPV_ARGS(&automation))) && automation)
        automation->GetFocusedElement(&el);
    return el;
}

/// 元素自身屏幕矩形（整框改写的锚点）
bool elementRect(IUIAutomationElement* el, RECT* out) {
    RECT r{};
    if (SUCCEEDED(el->get_CurrentBoundingRectangle(&r)) && r.right > r.left && r.bottom > r.top) {
        *out = r;
        return true;
    }
    return false;
}

} // namespace

RECT CursorAnchor() {
    POINT p{};
    GetCursorPos(&p);
    return RECT{p.x, p.y - 4, p.x + 1, p.y + 14};
}

std::optional<Capture> UIASelectionOnly() {
    ComPtr<IUIAutomationElement> el = focusedElement();
    if (!el) return std::nullopt;
    return uiaSelection(el.Get());
}

std::optional<Capture> UIAReadSelection() {
    ComPtr<IUIAutomationElement> el = focusedElement();
    util::Log("UIAReadSelection focused=%d", el ? 1 : 0);
    if (!el) return std::nullopt;
    auto cap = uiaSelection(el.Get());
    util::Log("UIAReadSelection uia=%d", cap.has_value());
    return cap;
}

std::optional<Capture> UIACaptureForRewrite() {
    ComPtr<IUIAutomationElement> el = focusedElement();
    if (!el) return std::nullopt;
    // 有选区 → 只改选区
    if (auto cap = uiaSelection(el.Get())) return cap;
    // 无选区 → 改整个输入框
    if (auto value = uiaWholeValue(el.Get())) {
        Capture cap;
        cap.text = *value;
        cap.isWholeField = true;
        cap.replacementTarget = targetSnapshot(el.Get());
        if (cap.replacementTarget && cap.replacementTarget->value != cap.text) cap.replacementTarget.reset();
        cap.hasAnchor = elementRect(el.Get(), &cap.anchor);
        return cap;
    }
    return std::nullopt;
}

std::optional<std::wstring> ClipboardFallbackCopy(const std::function<bool()>& cancelled) {
    if (cancelled()) return std::nullopt;
    clipboard::Snapshot saved = clipboard::Take();
    if (!saved.valid || cancelled() || clipboard::SequenceNumber() != saved.sequence) return std::nullopt;
    const DWORD before = saved.sequence;

    if (!keyboard::SendCopy()) return std::nullopt;

    std::optional<std::wstring> result;
    DWORD copiedSequence = 0;
    // 最多等 ~400ms 让目标应用写入剪贴板
    int waited = 0;
    for (int i = 0; i < 20; ++i) {
        Sleep(20);
        waited += 20;
        if (clipboard::SequenceNumber() != before) {
            const auto observed = clipboard::SequenceNumber();
            auto text = clipboard::GetText();
            if (clipboard::SequenceNumber() == observed) {
                copiedSequence = observed;
                result = std::move(text);
            }
            break;
        }
        if (cancelled()) break;
    }
    util::Log("ClipboardFallbackCopy seqChanged=%d waited=%dms got_len=%d",
              clipboard::SequenceNumber() != before, waited, result ? (int)result->size() : -1);
    // Only undo the copy observed by this operation, never a subsequent copy.
    if (copiedSequence) clipboard::RestoreIfUnchanged(saved, copiedSequence);
    if (cancelled()) return std::nullopt;
    if (result && util::Trim(*result).empty()) result.reset();
    return result;
}

bool VerifyReplacementTarget(const replacement::Snapshot& expected, bool afterSelectAll) {
    auto focused = focusedElement();
    if (!focused) return false;
    auto current = targetSnapshot(focused.Get());
    return current && replacement::Matches(expected, *current, afterSelectAll);
}

} // namespace capture
