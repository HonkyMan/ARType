#include "Credentials.h"
#include "ManagedEndpoint.h"
#include <windows.h>
#include <wincred.h>

namespace {
std::wstring target() {
    const auto name = managed::CredentialTarget(managed::ConfiguredOrigin());
    return {name.begin(), name.end()};
}
}

namespace credentials {

std::string LoadSessionToken() {
    const auto name = target();
    if (name.empty()) return {};
    PCREDENTIALW credential = nullptr;
    if (!CredReadW(name.c_str(), CRED_TYPE_GENERIC, 0, &credential)) return {};

    std::string token;
    if (credential->CredentialBlob && credential->CredentialBlobSize) {
        const char* bytes = reinterpret_cast<const char*>(credential->CredentialBlob);
        token.assign(bytes, bytes + credential->CredentialBlobSize);
    }
    CredFree(credential);
    return token;
}

bool SaveSessionToken(const std::string& token) {
    const auto name = target();
    if (name.empty()) return false;
    if (token.empty()) {
        return CredDeleteW(name.c_str(), CRED_TYPE_GENERIC, 0) || GetLastError() == ERROR_NOT_FOUND;
    }

    CREDENTIALW credential{};
    credential.Type = CRED_TYPE_GENERIC;
    credential.TargetName = const_cast<LPWSTR>(name.c_str());
    credential.CredentialBlobSize = static_cast<DWORD>(token.size());
    credential.CredentialBlob = reinterpret_cast<LPBYTE>(const_cast<char*>(token.data()));
    credential.Persist = CRED_PERSIST_LOCAL_MACHINE;
    credential.UserName = const_cast<LPWSTR>(L"ARType");
    return CredWriteW(&credential, 0) != FALSE;
}

} // namespace credentials
