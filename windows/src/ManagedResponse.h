#pragma once
#include "Json.h"
#include "ResponseLimits.h"
#include <stdexcept>
#include <string>
#include <string_view>

namespace managed {

inline std::string Translation(const std::string& response) {
    if (response.size() > response::kMaximumBytes)
        throw std::runtime_error("Response too large");
    std::string text;
    bool complete = false;
    size_t start = response.compare(0, 3, "\xEF\xBB\xBF") == 0 ? 3 : 0;
    while (start < response.size()) {
        const auto newline = response.find('\n', start);
        auto line = std::string_view(response).substr(start, newline == std::string::npos ? newline : newline - start);
        if (line.size() > response::kMaximumLineBytes)
            throw std::runtime_error("Response line too large");
        if (!line.empty() && line.back() == '\r') line.remove_suffix(1);
        if (!line.empty() && line.front() != ':') {
            if (complete || line.rfind("data:", 0) != 0)
                throw std::runtime_error("Invalid translation response");
            auto payload = line.substr(5);
            const auto first = payload.find_first_not_of(" \t");
            payload = first == std::string_view::npos ? std::string_view{} : payload.substr(first);
            const auto last = payload.find_last_not_of(" \t");
            if (last != std::string_view::npos) payload = payload.substr(0, last + 1);
            if (payload == "[DONE]") {
                complete = true;
            } else {
                bool ok = false;
                const auto value = json::Parse(std::string(payload), &ok);
                const auto& content = value["choices"].at(0)["delta"]["content"];
                if (!ok || !content.isString()) throw std::runtime_error("Invalid translation response");
                const auto fragment = content.asString();
                // CF_UNICODETEXT is NUL-terminated. Reject before Copy/Replace
                // can silently truncate an otherwise valid JSON string.
                if (fragment.find('\0') != std::string::npos)
                    throw std::runtime_error("Invalid translation response");
                if (fragment.size() > response::kMaximumTranslationBytes - text.size())
                    throw std::runtime_error("Translation too large");
                text += fragment;
            }
        }
        if (newline == std::string::npos) break;
        start = newline + 1;
    }
    if (!complete || text.find_first_not_of(" \t\r\n") == std::string::npos)
        throw std::runtime_error("Incomplete translation");
    return text;
}

} // namespace managed
