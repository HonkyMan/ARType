#include "ClipboardSnapshotPolicy.h"
#include "ReplacementSafety.h"
#include <cassert>
#include <iostream>

int main() {
    using namespace clipboard;
    assert(SupportsSnapshotFormat(13)); // UTF-16 text.
    assert(SupportsSnapshotFormat(0xc001, L"HTML Format"));
    assert(SupportsSnapshotFormat(0xc002, L"Rich Text Format"));
    assert(SupportsSnapshotFormat(15)); // File list memory.
    assert(!SupportsSnapshotFormat(2)); // Bitmap handle needs CopyImage/DeleteObject.
    assert(!SupportsSnapshotFormat(14)); // Enhanced metafile has separate ownership.
    assert(!SupportsSnapshotFormat(0x80)); // Owner-display.
    assert(!SupportsSnapshotFormat(0x200)); // Private ownership.
    assert(!SupportsSnapshotFormat(0xc003, L"Unknown application object"));
    SnapshotBudget budget;
    assert(!budget.accept(0));
    assert(budget.accept(128));
    assert(!budget.accept(SnapshotBudget::maxBytes));
    for (size_t i = 1; i < SnapshotBudget::maxFormats; ++i) assert(budget.accept(1));
    assert(!budget.accept(1));
    bool pasted = false, restored = false;
    replacement::Actions actions{
        [](bool) { return true; }, [] { return false; },
        [] { return false; }, // Unsupported snapshot rejects before clipboard mutation.
        [] { return true; }, [] { return true; },
        [&] { pasted = true; return true; }, [] {}, [] {},
        [&] { restored = true; }
    };
    assert(replacement::Perform(false, actions) == replacement::Result::Failed);
    assert(!pasted && !restored);
    std::cout << "clipboard snapshot policy: passed\n";
}
