#include "CrashMetadata.h"
#include "Json.h"
#include <cassert>
#include <cstdint>
#include <string>

int main() {
    const crashdump::Metadata metadata{2026, 10, 20, 13, 4, 5, 0xC0000005, 1, 42, 7};
    char buffer[512]{};
    const auto length = crashdump::FormatMetadata(buffer, sizeof(buffer), metadata);
    assert(length > 0 && length < sizeof(buffer));
    assert(length == std::string(buffer).size());
    const auto record = json::Parse(buffer);
    assert(record.isObject() && record.size() == 6);
    assert(record["exceptionCode"].asString() == "0xC0000005");
    assert(record["timestampUtc"].asString() == "2026-10-20T13:04:05Z");
    assert(record["exceptionFlags"].asInt() == 1);
    assert(record["processId"].asInt() == 42);
    assert(record["threadId"].asInt() == 7);
    assert(record["format"].asInt() == 1);
    char small[4] = "abc";
    assert(crashdump::FormatMetadata(small, sizeof(small), metadata) == 0 && small[0] == '\0');
    assert(crashdump::FormatMetadata(nullptr, 0, metadata) == 0);
    const crashdump::Metadata maximum{2026, 10, 20, 13, 4, 5, UINT32_MAX, UINT32_MAX, UINT32_MAX, UINT32_MAX};
    assert(crashdump::FormatMetadata(buffer, sizeof(buffer), maximum) < sizeof(buffer));
    assert(std::string(buffer).find("0xFFFFFFFF") != std::string::npos);
}
