#include "ManagedAccount.h"
#include "ManagedProtocol.h"
#include "Http.h"
#include "Util.h"
#include "WorkerPool.h"
#include "OwnedMessages.h"
#include <bcrypt.h>
#include <objbase.h>
#include <shellapi.h>
#include <atomic>
#include <chrono>
#include <memory>
#include <stdexcept>
#include <thread>
#include <vector>

namespace account {
namespace {
std::atomic<unsigned> generation{0};
OwnedMessages<Update> pending;
std::string randomHex() {
    unsigned char b[32];
    if(BCryptGenRandom(nullptr,b,sizeof(b),BCRYPT_USE_SYSTEM_PREFERRED_RNG)<0)throw std::runtime_error("Secure random unavailable");
    const char* hex="0123456789abcdef";std::string s;
    for(auto x:b){s+=hex[x>>4];s+=hex[x&15];}return s;
}
std::string sha256(const std::string& value) {
    BCRYPT_ALG_HANDLE alg=nullptr;BCRYPT_HASH_HANDLE h=nullptr;
    if(BCryptOpenAlgorithmProvider(&alg,BCRYPT_SHA256_ALGORITHM,nullptr,0)<0)throw std::runtime_error("SHA256 unavailable");
    DWORD length=0,received=0;BCryptGetProperty(alg,BCRYPT_OBJECT_LENGTH,(PUCHAR)&length,sizeof(length),&received,0);
    std::vector<unsigned char> buffer(length);unsigned char out[32];
    bool ok=BCryptCreateHash(alg,&h,buffer.data(),length,nullptr,0,0)>=0 &&
        BCryptHashData(h,(PUCHAR)value.data(),(ULONG)value.size(),0)>=0 && BCryptFinishHash(h,out,sizeof(out),0)>=0;
    if(h)BCryptDestroyHash(h);BCryptCloseAlgorithmProvider(alg,0);
    if(!ok)throw std::runtime_error("SHA256 failed");
    const char* hex="0123456789abcdef";std::string s;for(auto x:out){s+=hex[x>>4];s+=hex[x&15];}return s;
}
void send(HWND w,UINT msg,unsigned g,std::wstring text={},std::string token={},json::Value profile={},bool done=false) {
    if(!Current(g))return;
    auto p=std::make_unique<Update>();p->generation=g;p->message=std::move(text);p->token=std::move(token);p->profile=std::move(profile);p->finished=done;
    const auto identifier = pending.put(std::move(p));
    if (!identifier) return;
    if (!Current(g) || !PostMessageW(w,msg,0,static_cast<LPARAM>(identifier)))
        pending.take(identifier);
}
json::Value parsed(const http::Result& r) {
    bool ok=false;auto b=json::Parse(r.body,&ok);
    if(!r.ok || !ok) {
        auto error=b["error"]["message"].asString();
        throw std::runtime_error(error.empty()?"Сервис ARType недоступен. Проверьте соединение.":error);
    }return b;
}
std::wstring headers(const std::string& token) {return token.empty()?L"":L"Authorization: Bearer "+util::Widen(token)+L"\r\n";}
json::Value post(const std::string& path,const json::Object& body,const std::string& token={},
                 const std::atomic<bool>* cancel=nullptr) {
    const auto base=ServiceURL();if(!managed::OriginAllowed(base))throw std::runtime_error("Адрес сервиса ARType не настроен.");
    return parsed(http::Post(util::Widen(base+path),json::Value(body).dump(),headers(token),cancel));
}
void background(HWND window, UINT message, unsigned context,
                std::function<void(const std::atomic<bool>&)> work) {
    const auto failed = [window, message, context](std::exception_ptr) {
        send(window, message, context, L"Не удалось завершить фоновую операцию.", {}, {}, true);
    };
    if (!workers::Shared().submit([work = std::move(work)](std::stop_token stop) {
            std::atomic<bool> cancelled{stop.stop_requested()};
            std::stop_callback onStop(stop, [&] { cancelled = true; });
            if (!cancelled) work(cancelled);
        }, failed)) {
        send(window, message, context, L"Фоновые операции заняты или приложение завершает работу.", {}, {}, true);
    }
}
}
static std::vector<Language> allowedLanguages;
const std::vector<Language>& AllowedLanguages(){return allowedLanguages;}
void ApplyLanguages(const json::Value& policy){allowedLanguages=managed::AllowedLanguages(policy);}
std::string ServiceURL(){return managed::ConfiguredOrigin();}
std::string RequestId(){GUID id{};if(FAILED(CoCreateGuid(&id)))throw std::runtime_error("UUID unavailable");wchar_t b[40]{};StringFromGUID2(id,b,40);auto s=util::Narrow(b);return s.substr(1,36);}
void Cancel(){++generation;pending.clear();}
bool Current(unsigned g){return generation.load()==g;}
std::unique_ptr<Update> TakeUpdate(LPARAM identifier){return pending.take(static_cast<uintptr_t>(identifier));}
void StartLogin(HWND w,UINT msg) {
    Cancel();
    const auto g=generation.load();
    background(w,msg,g,[w,msg,g](const std::atomic<bool>& cancel){try{
        if(!Current(g)||cancel.load())return;
        const auto verifier=randomHex();const auto d=post("/api/device/start",{{"challenge",sha256(verifier)}},{},&cancel);
        const auto login=d["login_url"].asString();
        if(!managed::LoginURLAllowed(ServiceURL(),login))throw std::runtime_error("Неверный адрес входа.");
        send(w,msg,g,L"Сверьте код в браузере: "+util::Widen(d["code"].asString())+L"\nПодтвердите подключение устройства.");
        if(!Current(g)||cancel.load())return;
        if((INT_PTR)ShellExecuteW(nullptr,L"open",util::Widen(login).c_str(),nullptr,nullptr,SW_SHOWNORMAL)<=32)throw std::runtime_error("Не удалось открыть браузер.");
        for(int n=0;n<100&&Current(g)&&!cancel.load();++n){
            for(int tick=0;tick<30&&Current(g)&&!cancel.load();++tick)std::this_thread::sleep_for(std::chrono::milliseconds(100));
            if(!Current(g)||cancel.load())return;
            auto b=post("/api/device/poll",{{"id",d["id"].asString()},{"poll_token",d["poll_token"].asString()},{"verifier",verifier}},{},&cancel);
            if(!b["token"].asString().empty()){send(w,msg,g,L"Вход подтверждён.",b["token"].asString(),{},true);return;}
        }
        send(w,msg,g,L"Время входа истекло. Повторите вход.",{},{},true);
    }catch(const std::exception& e){send(w,msg,g,util::Widen(e.what()),{},{},true);}});
}
void FetchProfile(HWND w,UINT msg,const std::string& token) {
    const auto g=generation.load();
    background(w,msg,g,[w,msg,g,token](const std::atomic<bool>& cancel){try{
        if(!Current(g)||cancel.load())return;
        auto base=ServiceURL();if(!managed::OriginAllowed(base))throw std::runtime_error("Адрес сервиса не настроен.");
        send(w,msg,g,L"",{},parsed(http::Get(util::Widen(base+"/api/me"),headers(token),&cancel)),true);
    }catch(const std::exception& e){send(w,msg,g,util::Widen(e.what()),{},{},true);}});
}
void Logout(HWND w,UINT msg,const std::string& token) {
    Cancel();
    const auto g=generation.load();
    background(w,msg,g,[w,msg,g,token](const std::atomic<bool>& cancel){try{
        if(cancel.load())return;
        post("/api/logout",{},token,&cancel);send(w,msg,g,L"Вы вышли из ARType.",{},{},true);}
        catch(const std::exception&){send(w,msg,g,L"Локальная сессия удалена. Сервер не подтвердил её отзыв; сессия истечёт автоматически.",{},{},true);}});
}
}
