#pragma once
#include "Json.h"
#include "ManagedEndpoint.h"
#include <string>

namespace managed {
inline std::string AccessNotice(const json::Value& profile,const std::string& selected) {
    const auto* tenants=profile["tenants"].array();
    if(!tenants||tenants->empty())return {};
    const json::Value* chosen=&tenants->front();
    for(const auto& tenant:*tenants)if(tenant["id"].asString()==selected){chosen=&tenant;break;}
    if((*chosen)["can_translate"].type()==json::Value::Type::Bool&&!(*chosen)["can_translate"].asBool()){
        const auto text=(*chosen)["access_message"].asString();
        return text.empty()?"Доступ к программе отключён. Обратитесь к владельцу организации.":text;
    }
    return {};
}
inline bool OriginAllowed(std::string value) {
    return !CanonicalOrigin(std::move(value)).empty();
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
