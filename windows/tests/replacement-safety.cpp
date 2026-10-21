#include "ReplacementSafety.h"
#include <cassert>
#include <iostream>

using namespace replacement;

int main() {
    const Snapshot captured{10, 20, {1, 2, 3}, L"prefix original suffix", 7, 15};
    auto current = captured;
    assert(Matches(captured, current, false));
    current.element = {1, 2, 4};
    assert(!Matches(captured, current, false)); // Another field in the same window.
    current = captured; current.start = 0; current.end = 8;
    assert(!Matches(captured, current, false));
    current = captured; current.value = L"prefix modified suffix";
    assert(!Matches(captured, current, false));
    current = captured; current.window = 11;
    assert(!Matches(captured, current, false));
    current = captured; current.start = 0; current.end = captured.value.size();
    assert(Matches(captured, current, true));

    std::wstring clipboard = L"user clipboard", editor = L"original";
    bool valid = false, cancelled = false, owned = false;
    int writes = 0, selects = 0;
    Actions actions{
        [&](bool) { return valid; },
        [&] { return cancelled; },
        [&] { ++writes; clipboard = L"translation"; owned = true; return true; },
        [&] { return owned; },
        [&] { ++selects; return true; },
        [&] { editor = clipboard; return true; },
        [] {},
        [] {},
        [&] { if (owned) clipboard = L"user clipboard"; }
    };
    assert(Perform(false, actions) == Result::TargetChanged);
    assert(writes == 0 && editor == L"original" && clipboard == L"user clipboard");

    valid = true;
    actions.settleSelection = [&] { valid = false; };
    assert(Perform(true, actions) == Result::TargetChanged);
    assert(selects == 1 && editor == L"original" && clipboard == L"user clipboard");

    valid = true;
    actions.settleSelection = [&] { cancelled = true; };
    assert(Perform(true, actions) == Result::Cancelled);
    assert(editor == L"original" && clipboard == L"user clipboard");

    cancelled = false;
    actions.settleSelection = [&] { clipboard = L"new user copy"; owned = false; };
    assert(Perform(true, actions) == Result::ClipboardChanged);
    assert(editor == L"original" && clipboard == L"new user copy");

    actions.settlePaste = [&] { clipboard = L"new user copy"; owned = false; };
    assert(Perform(false, actions) == Result::Replaced);
    assert(editor == L"translation" && clipboard == L"new user copy");
    std::cout << "replacement safety: passed\n";
}
