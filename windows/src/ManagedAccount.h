#pragma once
#include <windows.h>
#include <string>
#include <cstdint>
#include <memory>
#include "Json.h"
#include "Language.h"

namespace account {
struct Update { unsigned generation=0; std::wstring message; std::string token; json::Value profile; bool finished=false; };
std::string ServiceURL();
// UI-thread policy snapshot, refreshed from the authenticated profile.
const std::vector<Language>& AllowedLanguages();
void ApplyLanguages(const json::Value& policy);
std::string RequestId();
void StartLogin(HWND window,UINT message);
void FetchProfile(HWND window,UINT message,const std::string& token);
void Logout(HWND window,UINT message,const std::string& token);
void Cancel();
bool Current(unsigned generation);
std::unique_ptr<Update> TakeUpdate(LPARAM identifier);
}
