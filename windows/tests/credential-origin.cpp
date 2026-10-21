#include "ManagedEndpoint.h"
#include <cassert>

int main() {
    assert(managed::CanonicalOrigin("HTTPS://Example.COM:443/") == "https://example.com");
    assert(managed::CanonicalOrigin("http://LOCALHOST:00080/") == "http://localhost");
    assert(managed::CanonicalOrigin("https://example.com:8443") == "https://example.com:8443");
    assert(managed::CanonicalOrigin("http://[::1]:8080") == "http://[0:0:0:0:0:0:0:1]:8080");
    assert(managed::CanonicalOrigin("https://[2001:DB8::1]") == "https://[2001:db8:0:0:0:0:0:1]");
    for (const auto* invalid : {"https://example.com:0", "https://example.com:65536",
         "https://user@example.com", "https://example.com/path", "https://example.com?x",
         "http://remote.example", "https://bad..host", "https://[:::1]", "file:///tmp/x"})
        assert(managed::CanonicalOrigin(invalid).empty());
    const auto first = managed::CredentialTarget("https://Example.com:443/");
    assert(!first.empty());
    assert(first == managed::CredentialTarget("https://example.com"));
    assert(first != managed::CredentialTarget("https://other.example"));
    assert(first != managed::CredentialTarget("https://example.com:8443"));
    assert(managed::CredentialTarget("http://localhost") != managed::CredentialTarget("https://localhost"));
    assert(first != "ARType/SessionToken"); // Legacy credentials have no proven origin.
    assert(managed::CredentialTarget("http://remote.example").empty());
    assert(managed::LoginURLAllowed("https://example.com", "https://EXAMPLE.com:443/auth/google?device=test"));
    assert(managed::LoginURLAllowed("http://[0:0:0:0:0:0:0:1]:8080", "http://[::1]:8080/auth/google?device=test"));
    for (const auto* invalid : {"https://example.com:8443/auth/google?device=test",
         "https://other.example/auth/google?device=test", "https://example.com@other.example/auth/google?device=test",
         "https://example.com/auth/google?device=test#fragment", "https://example.com/auth/google?device=",
         "https://example.com/auth/google?device=test&next=https://other.example",
         "https://example.com/auth/google?device=test\n"})
        assert(!managed::LoginURLAllowed("https://example.com", invalid));
}
