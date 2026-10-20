#pragma once

#include <string>

namespace credentials {

std::string LoadSessionToken();
bool SaveSessionToken(const std::string& token);

} // namespace credentials
