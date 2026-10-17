#pragma once
#include <windows.h>
#include <string>
#include <cstdint>
#include "Json.h"

namespace account {
struct Update { unsigned generation=0; std::wstring message; std::string token; json::Value profile; bool finished=false; };
std::string ServiceURL();
std::string RequestId();
void StartLogin(HWND window,UINT message);
void FetchProfile(HWND window,UINT message,const std::string& token);
void Logout(HWND window,UINT message,const std::string& token);
void Cancel();
bool Current(unsigned generation);
}
