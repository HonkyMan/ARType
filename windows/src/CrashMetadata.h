#pragma once

#include <cstddef>
#include <cstdint>
#include <cstdio>

namespace crashdump {

// Deliberately accepts only numeric metadata, never pointers or process contents.
struct Metadata {
    unsigned year, month, day, hour, minute, second;
    std::uint32_t exceptionCode, exceptionFlags, processId, threadId;
};

inline std::size_t FormatMetadata(char* buffer, std::size_t capacity, const Metadata& data) {
    if (!buffer || !capacity) return 0;
    const int length = std::snprintf(buffer, capacity,
        "{\"format\":1,\"timestampUtc\":\"%04u-%02u-%02uT%02u:%02u:%02uZ\","
        "\"exceptionCode\":\"0x%08X\",\"exceptionFlags\":%u,\"processId\":%u,\"threadId\":%u}\n",
        data.year, data.month, data.day, data.hour, data.minute, data.second,
        static_cast<unsigned>(data.exceptionCode), static_cast<unsigned>(data.exceptionFlags),
        static_cast<unsigned>(data.processId), static_cast<unsigned>(data.threadId));
    if (length < 0 || static_cast<std::size_t>(length) >= capacity) {
        buffer[0] = '\0';
        return 0;
    }
    return static_cast<std::size_t>(length);
}

} // namespace crashdump
