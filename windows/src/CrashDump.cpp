#include "CrashDump.h"
#include "CrashMetadata.h"
#include "Util.h"
#include <windows.h>
#include <algorithm>
#include <string>
#include <vector>

namespace crashdump {

namespace {

// Prepared before installing the exception filter; the crash path allocates no strings.
wchar_t crashDirectory[MAX_PATH]{};

std::wstring crashesDir() {
    std::wstring dir = util::AppDataDir() + L"\\crashes";
    CreateDirectoryW(dir.c_str(), nullptr);
    return dir;
}

/// Retain the five newest metadata reports; legacy memory dumps remain untouched.
void pruneOld(const std::wstring& dir) {
    std::vector<std::wstring> dumps;
    WIN32_FIND_DATAW fd;
    HANDLE h = FindFirstFileW((dir + L"\\crash-*.json").c_str(), &fd);
    if (h == INVALID_HANDLE_VALUE) return;
    do {
        dumps.push_back(fd.cFileName);
    } while (FindNextFileW(h, &fd));
    FindClose(h);
    if (dumps.size() <= 5) return;
    std::sort(dumps.begin(), dumps.end());  // 文件名含时间戳，字典序即时间序
    for (size_t i = 0; i + 5 < dumps.size(); ++i)
        DeleteFileW((dir + L"\\" + dumps[i]).c_str());
}

LONG WINAPI unhandledFilter(EXCEPTION_POINTERS* info) {
    // 崩溃路径里只做最少的事
    wchar_t path[MAX_PATH * 2];
    if (!crashDirectory[0]) return EXCEPTION_EXECUTE_HANDLER;
    SYSTEMTIME st;
    GetSystemTime(&st);
    swprintf_s(path, L"%s\\crash-%04d%02d%02d-%02d%02d%02d-%lu.json",
               crashDirectory, st.wYear, st.wMonth, st.wDay, st.wHour, st.wMinute, st.wSecond,
               GetCurrentProcessId());

    const auto* exception = info ? info->ExceptionRecord : nullptr;
    char report[512]{};
    const auto length = FormatMetadata(report, sizeof(report), {
        st.wYear, st.wMonth, st.wDay, st.wHour, st.wMinute, st.wSecond,
        exception ? exception->ExceptionCode : 0, exception ? exception->ExceptionFlags : 0,
        GetCurrentProcessId(), GetCurrentThreadId()
    });
    if (!length) return EXCEPTION_EXECUTE_HANDLER;
    HANDLE file = CreateFileW(path, GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS,
                              FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file != INVALID_HANDLE_VALUE) {
        DWORD written = 0;
        WriteFile(file, report, static_cast<DWORD>(length), &written, nullptr);
        CloseHandle(file);
    }
    return EXCEPTION_EXECUTE_HANDLER;
}

} // namespace

void Install() {
    const auto directory = crashesDir();
    if (directory.size() >= MAX_PATH) return;
    wcscpy_s(crashDirectory, directory.c_str());
    pruneOld(directory);
    SetUnhandledExceptionFilter(unhandledFilter);
}

} // namespace crashdump
