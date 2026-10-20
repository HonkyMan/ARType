#include "ManagedAccount.h"
#include "ManagedProtocol.h"
#include "ManagedResponse.h"
#include "Credentials.h"
#include "Translator.h"
#include "Http.h"
#include "Json.h"
#include "LocalDiagnostics.h"
#include "Settings.h"
#include "Util.h"
#include "WorkerPool.h"
#include <atomic>
#include <chrono>
#include <memory>
#include <mutex>
#include <unordered_map>

namespace translator {

namespace {

// Snapshot account context on the calling thread before the worker starts.
struct ManagedContext {
    std::string serviceURL;
    std::string token;
    std::string tenantId;

    static ManagedContext snapshot() {
        return {account::ServiceURL(), credentials::LoadSessionToken(), Settings::shared().tenantId};
    }
};

// ---------- 活跃请求管理 ----------

struct ActiveRequest {
    std::shared_ptr<std::atomic<bool>> cancel;
};

std::mutex g_mu;
std::unordered_map<uint64_t, ActiveRequest> g_active;
std::atomic<uint64_t> g_nextId{1};

void finishRequest(uint64_t id) {
    std::lock_guard lock(g_mu);
    g_active.erase(id);
}

// ---------- provider 实现（工作线程内运行）----------

struct StreamOutcome {
    bool ok = false;
    std::wstring error;
    std::wstring full;
};

std::wstring providerError(const http::Result& result) {
    if (!result.body.empty()) {
        bool ok = false;
        json::Value body = json::Parse(result.body, &ok);
        if (ok) {
            const json::Value& nested = body["error"];
            if (nested.isObject() && nested["message"].isString())
                return util::Widen(nested["message"].asString());
            if (nested.isString()) return util::Widen(nested.asString());
            if (body["message"].isString()) return util::Widen(body["message"].asString());
        }
    }
    return util::Widen(result.error);
}

StreamOutcome runManaged(const TranslationRequest& req, const ManagedContext& s, uint64_t id,
                        const DeltaFn& onDelta, const std::atomic<bool>& cancel) {
    StreamOutcome out;
    if(!managed::OriginAllowed(s.serviceURL)) {out.error=L"Адрес сервиса ARType не настроен.";return out;}
    if(s.token.empty() || s.tenantId.empty()) {out.error=L"Войдите в ARType и выберите организацию в настройках.";return out;}
    const auto body=managed::Request(util::Narrow(req.text),req.source?lang::Code(*req.source):"",
        lang::Code(req.target),lang::StyleCode(req.style),s.tenantId,account::RequestId());
    const auto result=http::Post(util::Widen(s.serviceURL+"/api/translate"),body.dump(),
        L"Authorization: Bearer "+util::Widen(s.token)+L"\r\n",&cancel);
    if(!result.ok){out.error=providerError(result);return out;}
    try {
        out.full=util::Widen(managed::Translation(result.body));
    } catch (const std::runtime_error&) {
        out.error=L"Ответ сервиса слишком большой, прерван или содержит некорректные данные. Исходный текст сохранён.";
        return out;
    }
    if(cancel.load())return out;
    onDelta(id,out.full);out.ok=true;return out;
}

} // namespace

uint64_t Stream(const TranslationRequest& req, DeltaFn onDelta, DoneFn onDone) {
    uint64_t id = g_nextId.fetch_add(1);
    const auto start = std::chrono::steady_clock::now();

    // 配置快照在调用线程（主线程）拍好带进工作线程
    ManagedContext cfg = ManagedContext::snapshot();

    auto cancel = std::make_shared<std::atomic<bool>>(false);
    {
        std::lock_guard lock(g_mu);
        g_active[id] = {cancel};
    }

    // Also removes cancelled jobs discarded from the queue during shutdown.
    auto lifetime = std::shared_ptr<uint64_t>(new uint64_t(id),
        [](uint64_t* value) { finishRequest(*value); delete value; });
    const auto failed = [id, cancel, onDone](std::exception_ptr) {
        if (!cancel->load()) onDone(id, false, L"Не удалось завершить фоновую операцию.");
        diagnostics::Record("translation", "failure", "artype", {}, "worker");
    };
    const auto rejected = onDone;
    const bool accepted = workers::Shared().submit([req, cfg = std::move(cfg), id, cancel, start, lifetime,
                 onDelta = std::move(onDelta), onDone = std::move(onDone)](std::stop_token stop) {
        std::stop_callback onStop(stop, [cancel] { cancel->store(true); });
        if (cancel->load()) return;
        std::optional<std::chrono::steady_clock::time_point> firstToken;
        DeltaFn trackedDelta = [&](uint64_t requestId, const std::wstring& delta) {
            if (!delta.empty() && !firstToken) firstToken = std::chrono::steady_clock::now();
            onDelta(requestId, delta);
        };
        StreamOutcome out = runManaged(req, cfg, id, trackedDelta, *cancel);
        bool cancelled = cancel->load();
        const auto end = std::chrono::steady_clock::now();
        const int totalMs = (int)std::chrono::duration_cast<std::chrono::milliseconds>(end - start).count();
        const int firstMs = firstToken
            ? (int)std::chrono::duration_cast<std::chrono::milliseconds>(*firstToken - start).count()
            : -1;
        constexpr const char* backend = "artype";
        if (cancelled) {
            diagnostics::Record("translation", "cancelled", backend, {}, "cancelled",
                                firstMs, totalMs, (int)req.text.size());
            return;  // 取消的请求不再回调
        }
        const std::wstring cleaned = util::Trim(out.full);
        if (out.ok && !cleaned.empty()) {

            onDone(id, true, L"");
            diagnostics::Record("translation", "success", backend, {}, {},
                                firstMs, totalMs, (int)req.text.size());
        } else {
            const bool emptyResponse = out.ok && cleaned.empty();
            const std::wstring error = emptyResponse ? L"Empty translation" : out.error;
            onDone(id, false, error);
            diagnostics::Record("translation", "failure", backend, {},
                                emptyResponse ? "emptyResponse" : "provider",
                                firstMs, totalMs, (int)req.text.size());
        }
    }, failed);
    if (!accepted) rejected(id, false, L"Фоновые операции заняты или приложение завершает работу.");

    return id;
}

void Cancel(uint64_t reqId) {
    std::lock_guard lock(g_mu);
    auto it = g_active.find(reqId);
    if (it != g_active.end()) it->second.cancel->store(true);
}

void CancelAll() {
    std::lock_guard lock(g_mu);
    for (auto& [id, req] : g_active) req.cancel->store(true);
}

// Used by the explicit CLI translation self-test; UI requests always use Stream.
std::optional<std::wstring> TranslateFully(const TranslationRequest& req, std::wstring* error) {
    const std::atomic<bool> cancel{false};
    auto result = runManaged(req, ManagedContext::snapshot(), 0,
                             [](uint64_t, const std::wstring&) {}, cancel);
    auto cleaned = util::Trim(result.full);
    if (!result.ok || cleaned.empty()) {
        if (error) *error = result.ok ? L"Empty translation" : result.error;
        return std::nullopt;
    }
    return cleaned;
}

} // namespace translator
