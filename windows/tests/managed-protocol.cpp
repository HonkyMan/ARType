#include "ManagedProtocol.h"
#include "ManagedResponse.h"
#include <cassert>
#include <iostream>
#include <iterator>
#include <limits>

static int checkStrictJSON() {
    int failures = 0;
    const std::string invalid[] = {
        "true false", "{} trailing", "[1,]", "{\"a\":1,}", "01", "+1", ".1",
        "1.", "1e", "1e+", "NaN", "Infinity", "0x10", "1e999",
        "\"line\nbreak\"", "\"\\u123\"", "\"\\uD800\"", "\"\\uDC00\"",
        "\"\\uD800\\u0041\"", std::string("\"") + char(0xC0) + char(0xAF) + "\"",
        std::string(65, '[') + "0" + std::string(65, ']')
    };
    for (size_t i = 0; i < std::size(invalid); ++i) {
        bool ok = false;
        json::Parse(invalid[i], &ok);
        if (ok) { std::cerr << "Accepted invalid JSON case " << i << '\n'; ++failures; }
    }
    for (const auto* input : {"null", "true", "-0", "0.25", "-2.5e+2", R"("\u0000")",
                              R"({"a":[false,null,"Привет","\uD83D\uDE00"]})"}) {
        bool ok = false;
        json::Parse(input, &ok);
        if (!ok) { std::cerr << "Rejected valid JSON\n"; ++failures; }
    }
    bool ok = false;
    json::Parse(std::string(64, '[') + "0" + std::string(64, ']'), &ok);
    if (!ok) { std::cerr << "Rejected maximum allowed nesting\n"; ++failures; }
    // Settings use asInt for untrusted numeric fields. Avoid undefined floating
    // point conversion even when the JSON number itself is finite and valid.
    for (double value : {4294967295.0, -2147483649.0, 1e99,
                         std::numeric_limits<double>::infinity(),
                         std::numeric_limits<double>::quiet_NaN()}) {
        if (json::Value(value).asInt(7) != 7) {
            std::cerr << "Out-of-range integer conversion did not use fallback\n";
            ++failures;
        }
    }
    assert(json::Value(2147483647.0).asInt() == 2147483647);
    assert(json::Value(-2147483648.0).asInt() == (-2147483647 - 1));
    return failures;
}

static int checkManagedResponse() {
    response::Budget budget(4);
    assert(budget.consume(3));
    assert(budget.consume(1));
    assert(!budget.consume(1));
    assert(!budget.consume(0));
    response::Budget huge;
    assert(!huge.consume(static_cast<size_t>(-1)));
    const std::string content = R"(data: {"choices":[{"delta":{"content":"Hello"}}]})";
    const std::string valid = content + "\n\ndata: [DONE]\n\n";
    assert(managed::Translation(valid) == "Hello");
    assert(managed::Translation("\xEF\xBB\xBF" + content + "\r\n\r\ndata: [DONE]\r\n") == "Hello");
    assert(managed::Translation(R"(data: {"choices":[{"delta":{"content":"Hello\n\tworld"}}]})" +
                               std::string("\ndata: [DONE]\n")) == "Hello\n\tworld");
    const auto event = [](size_t bytes) {
        return "data: {\"choices\":[{\"delta\":{\"content\":\"" + std::string(bytes, 'a') + "\"}}]}\n";
    };
    assert(managed::Translation(event(131072) + event(131072) + "data: [DONE]\n").size() == 262144);
    const std::string invalid[] = {
        content,
        content + "\ndata: {broken}\ndata: [DONE]\n",
        content + "\ndata: [DONE]suffix\n",
        content + "\ndata: [DONE]\n" + content + "\n",
        content + "\ndata: {\"choices\":[{\"delta\":{\"content\":42}}]}\ndata: [DONE]\n",
        R"(data: {"choices":[{"delta":{"content":"\u0000"}}]})" + std::string("\ndata: [DONE]\n"),
        R"(data: {"choices":[{"delta":{"content":"Hello\u0000world"}}]})" + std::string("\ndata: [DONE]\n"),
        content + "\n" + R"(data: {"choices":[{"delta":{"content":"\u0000suffix"}}]})" + "\ndata: [DONE]\n",
        "data: {\"choices\":[{\"delta\":{\"content\":\"" + std::string(262145, 'a') + "\"}}]}\ndata: [DONE]\n",
        event(131072) + event(131073) + "data: [DONE]\n",
        ":" + std::string(2097152, 'x') + "\n" + valid,
        std::string(8388608, '\n') + valid
    };
    int failures = 0;
    for (size_t i = 0; i < std::size(invalid); ++i) {
        try {
            managed::Translation(invalid[i]);
            std::cerr << "Accepted invalid managed response case " << i << '\n';
            ++failures;
        } catch (const std::runtime_error&) {}
    }
    return failures;
}

int main() {
    auto blocked=json::Parse(R"({"tenants":[{"id":"one","can_translate":true},{"id":"two","can_translate":false,"access_message":"Balance is unpaid"}]})");
    assert(managed::AccessNotice(blocked,"two")=="Balance is unpaid");
    assert(managed::AccessNotice(blocked,"one").empty());
    assert(managed::AccessNotice(json::Parse(R"({"tenants":[{"id":"old"}]})"),"old").empty());
    assert(managed::OriginAllowed("https://translate.example.com"));
    assert(managed::OriginAllowed("http://127.0.0.1:8080"));
    for (const auto* url : {"http://example.com", "http://localhost.evil", "https://user:pass@example.com", "https://example.com/path", "https://example.com?x"})
        assert(!managed::OriginAllowed(url));
    auto b=managed::Request("Привет", "ru", "en", "formal", "tenant", "request");
    assert(b["text"].asString()=="Привет");
    assert(b["target"].asString()=="en");
    assert(b["tenant_id"].asString()=="tenant");
    assert(b["model"].isNull() && b["messages"].isNull());
    return checkStrictJSON() + checkManagedResponse() == 0 ? 0 : 1;
}
