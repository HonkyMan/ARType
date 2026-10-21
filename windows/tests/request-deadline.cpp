#include "RequestDeadline.h"
#include <cassert>
#include <chrono>
#include <iostream>
int main() {
    using namespace std::chrono_literals;
    const auto start = http::Deadline::Clock::time_point{};
    const http::Deadline deadline(start, 120s);
    assert(deadline.remaining(start) == 120000);
    assert(deadline.remaining(start + 119s) == 1000);
    assert(deadline.remaining(start + 120s) == 0);
    assert(deadline.remaining(start + 121s) == 0);
    std::cout << "request deadline: passed\n";
}
