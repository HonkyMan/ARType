//
//  Keyboard.h — 合成按键（对应 macOS 的 Keyboard）。
//
#pragma once
#include <windows.h>

namespace keyboard {

/// 发送 Ctrl+<vk>。先临时抬起用户当前按住的修饰键（如触发热键的 Alt），
/// 避免目标应用收到 Ctrl+Alt+C 之类的组合。
bool SendCtrlCombo(WORD vk);

inline bool SendCopy()      { return SendCtrlCombo('C'); }
inline bool SendPaste()     { return SendCtrlCombo('V'); }
inline bool SendSelectAll() { return SendCtrlCombo('A'); }

} // namespace keyboard
