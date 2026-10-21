#pragma once
#include <atomic>
#include <condition_variable>
#include <deque>
#include <exception>
#include <functional>
#include <mutex>
#include <stop_token>
#include <thread>
#include <vector>

namespace workers {

class Pool {
public:
    using Work = std::function<void(std::stop_token)>;
    using Failure = std::function<void(std::exception_ptr)>;
    explicit Pool(size_t count = 4, size_t capacity = 32) : capacity_(capacity) {
        try {
            for (size_t i = 0; i < count; ++i) {
                ++live_;
                try { threads_.emplace_back([this] { run(); }); }
                catch (...) { --live_; throw; }
            }
        } catch (...) {
            stop();
            for (auto& thread : threads_) thread.join();
            throw;
        }
    }
    ~Pool() {
        stop();
        for (auto& thread : threads_) if (thread.joinable()) thread.join();
    }
    Pool(const Pool&) = delete;
    Pool& operator=(const Pool&) = delete;

    bool submit(Work work, Failure failure = {}) {
        std::lock_guard lock(mutex_);
        if (stopping_ || queue_.size() >= capacity_) return false;
        queue_.push_back({std::move(work), std::move(failure)});
        condition_.notify_one();
        return true;
    }
    void stop() {
        {
            std::lock_guard lock(mutex_);
            stopping_ = true;
            queue_.clear();
        }
        cancellation_.request_stop();
        condition_.notify_all();
    }
    bool exited() const { return live_.load() == 0; }
    size_t failures() const { return failures_.load(); }

private:
    struct Task { Work work; Failure failure; };
    void run() {
        for (;;) {
            Task task;
            {
                std::unique_lock lock(mutex_);
                condition_.wait(lock, [&] { return stopping_ || !queue_.empty(); });
                if (stopping_) break;
                task = std::move(queue_.front());
                queue_.pop_front();
            }
            try { task.work(cancellation_.get_token()); }
            catch (...) {
                ++failures_;
                if (task.failure) {
                    try { task.failure(std::current_exception()); }
                    catch (...) { ++failures_; }
                }
            }
        }
        --live_;
    }
    const size_t capacity_;
    std::mutex mutex_;
    std::condition_variable condition_;
    std::deque<Task> queue_;
    std::vector<std::thread> threads_;
    std::stop_source cancellation_;
    bool stopping_ = false;
    std::atomic<size_t> live_{0}, failures_{0};
};

inline Pool& Shared() { static Pool pool; return pool; }
}
