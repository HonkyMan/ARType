import Foundation

@main
struct CredentialOriginTests {
    static func main() {
        precondition(ManagedEndpoint.canonicalOrigin("HTTPS://Example.COM:443/") == "https://example.com")
        precondition(ManagedEndpoint.canonicalOrigin("http://LOCALHOST:00080/") == "http://localhost")
        precondition(ManagedEndpoint.canonicalOrigin("https://example.com:8443") == "https://example.com:8443")
        precondition(ManagedEndpoint.canonicalOrigin("http://[::1]:8080") == "http://[0:0:0:0:0:0:0:1]:8080")
        precondition(ManagedEndpoint.canonicalOrigin("https://[2001:DB8::1]") == "https://[2001:db8:0:0:0:0:0:1]")
        for invalid in ["https://example.com:0", "https://example.com:65536",
                        "https://user@example.com", "https://example.com/path", "https://example.com?x",
                        "http://remote.example", "https://bad..host", "https://[:::1]", "file:///tmp/x"] {
            precondition(ManagedEndpoint.canonicalOrigin(invalid) == nil, invalid)
        }
        let first = ManagedEndpoint.credentialAccount("https://Example.com:443/")
        precondition(first != nil)
        precondition(first == ManagedEndpoint.credentialAccount("https://example.com"))
        precondition(first != ManagedEndpoint.credentialAccount("https://other.example"))
        precondition(first != ManagedEndpoint.credentialAccount("https://example.com:8443"))
        precondition(ManagedEndpoint.credentialAccount("http://localhost") != ManagedEndpoint.credentialAccount("https://localhost"))
        precondition(first != "session-token")
        precondition(ManagedEndpoint.credentialAccount("http://remote.example") == nil)
        precondition(ManagedEndpoint.canonicalOrigin("https://example.com\n") == nil)
        precondition(ManagedEndpoint.origin(of: URL(string: "https://Example.com:443/auth/google?device=test")!) == "https://example.com")
        precondition(ManagedEndpoint.origin(of: URL(string: "https://user@example.com/auth/google")!) == nil)
        precondition(ManagedEndpoint.loginURLAllowed(URL(string: "https://EXAMPLE.com:443/auth/google?device=test")!, origin: "https://example.com"))
        precondition(ManagedEndpoint.loginURLAllowed(URL(string: "http://[::1]:8080/auth/google?device=test")!, origin: "http://[0:0:0:0:0:0:0:1]:8080"))
        for invalid in ["https://example.com:8443/auth/google?device=test", "https://other.example/auth/google?device=test",
                        "https://user@example.com/auth/google?device=test", "https://example.com/auth/google?device=",
                        "https://example.com/auth/google?device=test#fragment", "https://example.com/other?device=test",
                        "https://example.com/auth/google?device=test&next=https://other.example"] {
            precondition(!ManagedEndpoint.loginURLAllowed(URL(string: invalid)!, origin: "https://example.com"))
        }
        print("Credential origin regressions passed")
    }
}
