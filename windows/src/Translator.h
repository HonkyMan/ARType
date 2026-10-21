// Managed ARType translation. Callbacks run on the worker thread; the UI marshals
// them through PostMessage. Every request is authorized by the configured server.
#pragma once
#include "Language.h"
#include <cstdint>
#include <functional>
#include <optional>
#include <string>

struct TranslationRequest {
    std::wstring text;
    std::optional<Language> source;  // nullopt = 让模型自动判断
    Language target = Language::English;
    RewriteStyle style = RewriteStyle::Faithful;
};

namespace translator {

using DeltaFn = std::function<void(uint64_t reqId, const std::wstring& delta)>;
using DoneFn = std::function<void(uint64_t reqId, bool ok, const std::wstring& error, bool languageSettings)>;

/// Start a managed request. Only a complete, validated result is emitted.
uint64_t Stream(const TranslationRequest& req, DeltaFn onDelta, DoneFn onDone);

/// 取消某个请求（对应流式任务尽快退出，不再回调）
void Cancel(uint64_t reqId);

/// 取消全部活跃请求（退出前调用）
void CancelAll();

/// Blocking managed translation for the explicit CLI self-test. Never used by the UI.
std::optional<std::wstring> TranslateFully(const TranslationRequest& req, std::wstring* error);

} // namespace translator
