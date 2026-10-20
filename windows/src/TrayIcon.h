//
//  TrayIcon.h — 系统托盘图标与菜单。
//
#pragma once
#include <windows.h>
#include <shellapi.h>
#include <functional>
#include <string>

class TrayIcon {
public:
    /// owner 接收 WM_APP_TRAY 回调消息
    void add(HWND owner, UINT callbackMessage);
    void remove();
    void setStatus(const std::wstring& text);

    /// 托盘菜单（在 owner 收到回调消息时调用）
    void showMenu(HWND owner);

    std::function<void()> onToggleEnabled;
    std::function<void()> onOpenSettings;
    std::function<void()> onQuit;

private:
    NOTIFYICONDATAW nid_{};
    bool added_ = false;
};
