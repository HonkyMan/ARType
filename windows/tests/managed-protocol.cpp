#include "ManagedProtocol.h"
#include <cassert>
int main() {
    assert(managed::OriginAllowed("https://translate.example.com"));
    assert(managed::OriginAllowed("http://127.0.0.1:8080"));
    for (const auto* url : {"http://example.com", "http://localhost.evil", "https://user:pass@example.com", "https://example.com/path", "https://example.com?x"})
        assert(!managed::OriginAllowed(url));
    auto b=managed::Request("Привет", "ru", "en", "formal", "tenant", "request");
    assert(b["text"].asString()=="Привет");
    assert(b["target"].asString()=="en");
    assert(b["tenant_id"].asString()=="tenant");
    assert(b["model"].isNull() && b["messages"].isNull());
}
