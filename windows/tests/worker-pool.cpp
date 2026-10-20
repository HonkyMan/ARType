#include "WorkerPool.h"
#include <cassert>
#include <chrono>
#include <future>
#include <iostream>
#include <stdexcept>

int main() {
    using namespace std::chrono_literals;
    {
        workers::Pool pool(1, 1);
        std::promise<void> began, stopped;
        std::atomic<bool> queuedRan{false};
        assert(pool.submit([&](std::stop_token stop) {
            began.set_value();
            std::mutex mutex;
            std::condition_variable_any condition;
            std::unique_lock lock(mutex);
            condition.wait(lock, stop, [] { return false; });
            stopped.set_value();
        }));
        began.get_future().wait();
        assert(pool.submit([&](std::stop_token) { queuedRan = true; }));
        assert(!pool.submit([](std::stop_token) {})); // Queue bound.
        const auto before = std::chrono::steady_clock::now();
        pool.stop();
        assert(std::chrono::steady_clock::now() - before < 100ms); // No joining blocked work.
        assert(!pool.submit([](std::stop_token) {}));
        assert(stopped.get_future().wait_for(2s) == std::future_status::ready);
        while (!pool.exited()) std::this_thread::yield();
        assert(!queuedRan);
    }
    {
        workers::Pool pool(1);
        std::promise<void> failure;
        assert(pool.submit([](std::stop_token) { throw std::runtime_error("test"); },
            [&](std::exception_ptr error) { assert(error); failure.set_value(); }));
        assert(failure.get_future().wait_for(2s) == std::future_status::ready);
        pool.stop();
        while (!pool.exited()) std::this_thread::yield();
        assert(pool.failures() == 1);
    }
    std::cout << "owned worker pool: passed\n";
}
