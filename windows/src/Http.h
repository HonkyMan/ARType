//
//  Http.h — Bounded WinHTTP requests to the managed service.
//  在调用线程同步执行；配合工作线程 + cancel 标志使用。
//
#pragma once
#include <atomic>
#include <string>

namespace http {

struct Result {
    bool ok = false;
    int status = 0;
    std::string error;   // 人读错误（网络失败 / HTTP 状态码）
    std::string body;    // Bounded response body
};

/// Requests run on the calling worker thread; all status/body sizes are bounded.
Result Get(const std::wstring& url, const std::wstring& extraHeaders = L"",
           const std::atomic<bool>* cancel = nullptr);
Result Post(const std::wstring& url, const std::string& body, const std::wstring& extraHeaders = L"",
            const std::atomic<bool>* cancel = nullptr);

} // namespace http
