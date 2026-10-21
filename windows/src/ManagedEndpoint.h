#pragma once
#include <algorithm>
#include <charconv>
#include <regex>
#include <string>
#include <vector>

#ifndef ARTYPE_SERVICE_URL
#define ARTYPE_SERVICE_URL "http://127.0.0.1:8080"
#endif

namespace managed {
namespace detail {
inline std::string IPv6(const std::string& address) {
    const auto gap = address.find("::");
    if (gap != std::string::npos && address.find("::", gap + 2) != std::string::npos) return {};
    std::vector<unsigned> left, right;
    const auto parse = [](const std::string& part, std::vector<unsigned>& groups) {
        if (part.empty()) return true;
        size_t offset = 0;
        for (;;) {
            const auto end = part.find(':', offset);
            const auto group = part.substr(offset, end == std::string::npos ? end : end - offset);
            unsigned value = 0;
            const auto result = std::from_chars(group.data(), group.data() + group.size(), value, 16);
            if (group.empty() || group.size() > 4 || result.ec != std::errc{} ||
                result.ptr != group.data() + group.size()) return false;
            groups.push_back(value);
            if (end == std::string::npos) return true;
            offset = end + 1;
        }
    };
    if (!parse(address.substr(0, gap), left)) return {};
    if (gap != std::string::npos && !parse(address.substr(gap + 2), right)) return {};
    if (gap == std::string::npos ? left.size() != 8 : left.size() + right.size() >= 8) return {};
    left.resize(8 - right.size(), 0);
    left.insert(left.end(), right.begin(), right.end());
    std::string result;
    for (unsigned group : left) {
        char text[4];
        const auto converted = std::to_chars(text, text + sizeof(text), group, 16);
        if (!result.empty()) result += ':';
        result.append(text, converted.ptr);
    }
    return result;
}
}

// One canonical authority is shared by transport configuration and credential storage.
// Paths, credentials, fragments and non-local plaintext origins are never accepted.
inline std::string CanonicalOrigin(std::string value) {
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char c) {
        return c >= 'A' && c <= 'Z' ? static_cast<char>(c + ('a' - 'A')) : static_cast<char>(c);
    });
    static const std::regex pattern(R"(^(https?)://(\[[0-9a-f:]+\]|[a-z0-9.-]+)(:([0-9]{1,5}))?/?$)");
    std::smatch match;
    if (!std::regex_match(value, match, pattern)) return {};
    const auto scheme = match[1].str();
    std::string host = match[2].str();
    if (host.front() == '[') {
        const auto address = detail::IPv6(host.substr(1, host.size() - 2));
        if (address.empty()) return {};
        host = "[" + address + "]";
    } else {
        if (host.back() == '.') host.pop_back();
        if (host.empty() || host.size() > 253) return {};
        size_t offset = 0;
        for (;;) {
            const auto end = host.find('.', offset);
            const auto label = host.substr(offset, end == std::string::npos ? end : end - offset);
            if (label.empty() || label.size() > 63 || label.front() == '-' || label.back() == '-') return {};
            if (end == std::string::npos) break;
            offset = end + 1;
        }
    }
    if (scheme == "http" && host != "localhost" && host != "127.0.0.1" && host != "[0:0:0:0:0:0:0:1]") return {};
    unsigned port = scheme == "https" ? 443 : 80;
    if (match[4].matched) {
        const auto text = match[4].str();
        if (std::from_chars(text.data(), text.data() + text.size(), port).ec != std::errc{} ||
            port == 0 || port > 65535) return {};
    }
    const bool defaultPort = (scheme == "https" && port == 443) || (scheme == "http" && port == 80);
    return scheme + "://" + host + (defaultPort ? "" : ":" + std::to_string(port));
}

inline std::string ConfiguredOrigin() { return CanonicalOrigin(ARTYPE_SERVICE_URL); }

inline bool LoginURLAllowed(const std::string& origin, const std::string& url) {
    const auto expected = CanonicalOrigin(origin);
    const auto schemeEnd = url.find("://");
    if (expected.empty() || schemeEnd == std::string::npos) return false;
    const auto pathStart = url.find('/', schemeEnd + 3);
    if (pathStart == std::string::npos || CanonicalOrigin(url.substr(0, pathStart)) != expected) return false;
    static const std::regex path(R"(^/auth/google\?device=[A-Za-z0-9_-]+$)");
    return std::regex_match(url.substr(pathStart), path);
}

inline std::string CredentialTarget(const std::string& origin) {
    const auto canonical = CanonicalOrigin(origin);
    return canonical.empty() ? "" : "ARType/SessionToken/v2/" + canonical;
}
}
