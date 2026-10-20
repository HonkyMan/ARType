//
//  main.cpp — 入口：单实例、COM/控件初始化、消息循环。
//  `--selftest` / `--selftest-translate` 走内建自检（stdout 输出）。
//
#include <windows.h>
#include "App.h"
#include "CrashDump.h"
#include "SelfTest.h"
#include "WorkerPool.h"
#include <objbase.h>
#include <shellapi.h>
#include <cstdio>
#include <string>

namespace {

int runSelfTest(bool live) {
    // stdout 已被重定向（管道/文件）就直接用；否则挂到父进程控制台
    HANDLE out = GetStdHandle(STD_OUTPUT_HANDLE);
    if (out == nullptr || out == INVALID_HANDLE_VALUE) {
        if (!AttachConsole(ATTACH_PARENT_PROCESS)) AllocConsole();
        FILE* f = nullptr;
        freopen_s(&f, "CONOUT$", "w", stdout);
        SetConsoleOutputCP(CP_UTF8);
    }
    int failures = RunSelfTests(live);
    fflush(stdout);
    return failures;
}

} // namespace

int WINAPI wWinMain(HINSTANCE inst, HINSTANCE, PWSTR, int) {
    crashdump::Install();
    const HRESULT apartment = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
    if (FAILED(apartment)) return 1;
    struct Apartment { ~Apartment() { CoUninitialize(); } } apartmentLifetime;

    int argumentCount = 0;
    LPWSTR* arguments = CommandLineToArgvW(GetCommandLineW(), &argumentCount);
    bool selfTest = false, liveTest = false;
    for (int i = 1; arguments && i < argumentCount; ++i) {
        const std::wstring argument = arguments[i];
        if (argument == L"--selftest") selfTest = true;
        if (argument == L"--selftest-translate") { selfTest = true; liveTest = true; }
    }
    if (arguments) LocalFree(arguments);
    if (selfTest) return runSelfTest(liveTest);

    // 单实例：已在运行则让它打开设置窗口
    HANDLE mutex = CreateMutexW(nullptr, TRUE, L"Local\\ARTypeSingleInstance");
    struct Mutex { HANDLE handle; ~Mutex() { if (handle) CloseHandle(handle); } } mutexLifetime{mutex};
    if (GetLastError() == ERROR_ALREADY_EXISTS) {
        if (HWND existing = FindWindowW(kAppWindowClass, nullptr))
            PostMessageW(existing, WM_APP_OPEN_SETTINGS, 0, 0);
        return 0;
    }

    workers::Shared();
    if (!App::shared().init(inst)) { workers::Shared().stop(); return 1; }

    MSG msg{};
    while (GetMessageW(&msg, nullptr, 0, 0) > 0) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }

    workers::Shared().stop();
    return (int)msg.wParam;
}
