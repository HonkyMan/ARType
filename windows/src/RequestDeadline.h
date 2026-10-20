#pragma once
#include <algorithm>
#include <chrono>
#include <cstdint>

namespace http {
class Deadline {
public:
    using Clock = std::chrono::steady_clock;
    explicit Deadline(Clock::time_point now = Clock::now(),
                      std::chrono::milliseconds budget = std::chrono::seconds(120))
        : end_(now + budget) {}
    int remaining(Clock::time_point now = Clock::now()) const {
        const auto value = std::chrono::duration_cast<std::chrono::milliseconds>(end_ - now).count();
        return static_cast<int>(std::clamp<int64_t>(value, 0, 120000));
    }
private:
    Clock::time_point end_;
};
}
