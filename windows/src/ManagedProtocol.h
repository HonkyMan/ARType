#pragma once
#include "Json.h"
#include <regex>
#include <string>

namespace managed {
inline bool OriginAllowed(std::string value) {
    if (!value.empty() && value.back()=='/') value.pop_back();
    static const std::regex https(R"(^https://([A-Za-z0-9.-]+|\[[0-9a-fA-F:]+\])(:[0-9]{1,5})?$)");
    static const std::regex local(R"(^http://(localhost|127\.0\.0\.1|\[::1\])(:[0-9]{1,5})?$)");
    return std::regex_match(value,https) || std::regex_match(value,local);
}
inline json::Value Request(const std::string& text,const std::string& source,
                           const std::string& target,const std::string& style,
                           const std::string& tenant,const std::string& request) {
    json::Object b;
    b["text"]=text;b["target"]=target;b["style"]=style;b["tenant_id"]=tenant;b["request_id"]=request;
    if(!source.empty())b["source"]=source;
    return json::Value(std::move(b));
}
}
