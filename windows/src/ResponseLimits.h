#pragma once
#include <cstddef>

namespace response {
inline constexpr size_t kMaximumBytes = 8 * 1024 * 1024;
inline constexpr size_t kMaximumLineBytes = 2 * 1024 * 1024;
inline constexpr size_t kMaximumTranslationBytes = 256 * 1024;

// Counts bytes before buffering or handing them to a streaming consumer.
class Budget {
public:
    explicit Budget(size_t maximum = kMaximumBytes) : maximum_(maximum) {}
    bool consume(size_t bytes) {
        if (failed_ || bytes > maximum_ - received_) {
            failed_ = true;
            return false;
        }
        received_ += bytes;
        return true;
    }
private:
    size_t maximum_;
    size_t received_ = 0;
    bool failed_ = false;
};
} // namespace response
